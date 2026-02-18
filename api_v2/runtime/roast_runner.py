"""
ROASTRunner — prepares the working directory, invokes the compiled ROAST binary,
parses stdout for step progress, and emits SSE events.
"""

import gzip
import json
import shutil
import subprocess
import time
from pathlib import Path

import nibabel as nib
import numpy as np

from config import ROAST_BUILD_DIR, MATLAB_RUNTIME, ROAST_TIMEOUT_SECONDS
from runtime.roast_config import build_roast_config
from runtime.session import (
    session_input_native,
    model_output_path,
    roast_working_dir,
    roast_output_path,
    session_log,
)
from runtime.sse import push_event
from services.redis_client import set_roast_status, set_roast_progress
from services.logger import log_event, log_error


# Maps stdout substrings → (sse_event, progress_pct)
STEP_MAP = [
    ("STEP 2.5",                          "roast_step_csf_fix",      10),
    ("STEP 3",                            "roast_step_electrode",    20),
    ("STEP 4",                            "roast_step_mesh",         35),
    ("STEP 5",                            "roast_step_solve",        60),
    ("STEP 6",                            "roast_step_postprocess",  85),
    ("ROAST_RUN: COMPLETE",               "roast_complete",         100),
]


class ROASTRunner:
    def __init__(self, session_id: str, model_name: str, payload: dict):
        self.session_id = session_id
        self.model_name = model_name
        self.payload = payload
        self.work_dir = roast_working_dir(session_id)

    # ------------------------------------------------------------------
    def _emit(self, event: str, progress: int, detail: str | None = None):
        data = {"event": event, "progress": progress}
        if detail:
            data["detail"] = detail
        push_event(self.session_id, data)
        log_event(self.session_id, data)
        set_roast_progress(self.session_id, progress)

    # ------------------------------------------------------------------
    def prepare_working_directory(self) -> str:
        """
        Gunzip T1 and segmentation mask into the roast/ working directory.
        Returns the absolute path to T1.nii.
        """
        session_log(self.session_id, "[ROAST] Preparing working directory")

        # Gunzip T1
        t1_gz = session_input_native(self.session_id)
        t1_nii = self.work_dir / "T1.nii"
        with gzip.open(t1_gz, "rb") as f_in, open(t1_nii, "wb") as f_out:
            shutil.copyfileobj(f_in, f_out)
        session_log(self.session_id, f"[ROAST] T1 gunzipped → {t1_nii}")

        # Gunzip segmentation mask and cast to uint8 (cgalmesher requirement).
        # Do NOT pass the old header — nibabel would keep the old dtype code
        # (int16/float32) in the header even though the array is uint8, causing
        # MATLAB's load_untouch_nii to read the wrong type. Creating a fresh
        # Nifti1Image from only (data, affine) lets nibabel derive the correct
        # uint8 dtype code automatically.
        mask_gz = model_output_path(self.session_id, self.model_name)
        mask_nii = self.work_dir / "T1_T1orT2_masks.nii"
        img = nib.load(mask_gz)
        data = np.asarray(img.dataobj, dtype=np.uint8)
        nib.save(nib.Nifti1Image(data, img.affine), str(mask_nii))
        session_log(self.session_id, f"[ROAST] Mask saved as uint8 → {mask_nii}")

        # Create a dummy c1T1_T1orT2.nii to bypass ROAST step 1 (SPM segmentation).
        # ROAST checks for this file's existence to decide whether to run SPM.
        # We already provide the final mask (step 2 output), so step 1 can be skipped.
        # SPM's batch system (cfg_mlbatch_appcfg_master) cannot run in compiled MATLAB.
        dummy_c1 = self.work_dir / "c1T1_T1orT2.nii"
        shutil.copy(t1_nii, dummy_c1)
        session_log(self.session_id, f"[ROAST] Dummy c1 written → {dummy_c1} (bypasses SPM step 1)")

        return str(t1_nii)

    # ------------------------------------------------------------------
    def write_config(self, t1_path: str) -> Path:
        """Write config.json for roast_run."""
        cfg = build_roast_config(
            t1_path=t1_path,
            recipe=self.payload.get("recipe"),
            electype=self.payload.get("electrode_type"),
            elecsize=self.payload.get("electrode_size"),
            elecori=self.payload.get("electrode_ori"),
            meshoptions=self.payload.get("mesh_options"),
            simulationtag=self.payload.get("simulation_tag"),
        )
        config_path = self.work_dir / "config.json"
        with open(config_path, "w") as f:
            json.dump(cfg, f, indent=2)
        session_log(self.session_id, f"[ROAST] Config written → {config_path}")
        return config_path

    # ------------------------------------------------------------------
    def build_command(self, config_path: Path) -> list[str]:
        """
        Build the command to run the compiled ROAST binary via the MCR launcher.
        """
        launcher = ROAST_BUILD_DIR / "run_roast_run.sh"
        if not launcher.exists():
            raise FileNotFoundError(
                f"ROAST launcher not found: {launcher}. "
                "Ensure roast-11/build/ is deployed on this server."
            )
        return [str(launcher), str(MATLAB_RUNTIME), str(config_path)]

    # ------------------------------------------------------------------
    def run(self):
        """
        Full ROAST pipeline: prepare → write config → launch binary → stream progress.
        """
        try:
            set_roast_status(self.session_id, "running")
            self._emit("roast_start", 2)

            t1_path = self.prepare_working_directory()
            self._emit("roast_prepare", 5)

            config_path = self.write_config(t1_path)
            cmd = self.build_command(config_path)

            session_log(self.session_id, f"[ROAST] Launching: {' '.join(cmd)}")

            # MCR extracts CTF archive binaries without execute bits on Linux.
            # chmod all .mexa64 and plain binaries in the MCR runtime cache.
            mcr_cache = Path.home() / ".MathWorks" / "MatlabRuntimeCache"
            if mcr_cache.exists():
                for p in mcr_cache.rglob("*"):
                    if p.is_file() and not p.suffix:  # executables (no extension)
                        try:
                            p.chmod(p.stat().st_mode | 0o111)
                        except Exception:
                            pass
                for p in mcr_cache.rglob("*.mexa64"):
                    try:
                        p.chmod(p.stat().st_mode | 0o111)
                    except Exception:
                        pass

            proc = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                cwd=str(self.work_dir),
            )

            last_progress = 5
            deadline = time.time() + ROAST_TIMEOUT_SECONDS

            for line in proc.stdout:
                line = line.rstrip()
                if line:
                    session_log(self.session_id, f"[ROAST stdout] {line}")

                # Match step progress
                for substring, event_name, pct in STEP_MAP:
                    if substring in line:
                        if pct > last_progress:
                            self._emit(event_name, pct)
                            last_progress = pct
                        break

                if time.time() > deadline:
                    proc.kill()
                    raise TimeoutError(
                        f"ROAST timed out after {ROAST_TIMEOUT_SECONDS}s"
                    )

            proc.wait()

            if proc.returncode != 0:
                raise RuntimeError(
                    f"ROAST exited with code {proc.returncode}"
                )

            self.collect_outputs()

            set_roast_status(self.session_id, "complete")
            self._emit("roast_complete", 100)
            session_log(self.session_id, "[ROAST] Completed successfully")

        except Exception as e:
            log_error(self.session_id, f"[ROAST] Failed: {e}")
            set_roast_status(self.session_id, "error")
            self._emit("roast_error", -1, detail=str(e))
            raise

    # ------------------------------------------------------------------
    def collect_outputs(self):
        """Verify expected output NIfTI files exist."""
        expected = ["voltage", "efield", "emag"]
        missing = []
        for output_type in expected:
            path = roast_output_path(self.session_id, output_type)
            if not path.exists():
                missing.append(str(path))

        if missing:
            raise FileNotFoundError(
                f"ROAST finished but output files are missing: {missing}"
            )
        session_log(self.session_id, "[ROAST] All output files verified")
