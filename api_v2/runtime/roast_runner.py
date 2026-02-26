"""
ROASTRunner — prepares the working directory, invokes the compiled ROAST binary,
parses stdout for step progress, and emits SSE events.
"""

import gzip
import json
import re
import select
import shutil
import subprocess
import time
from pathlib import Path

import nibabel as nib
import numpy as np
from scipy import ndimage as ndi

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
from services.redis_client import redis_client, set_roast_status, set_roast_progress
from services.logger import log_event, log_error


# Maps stdout substrings → (sse_event, progress_pct)
# Order matters: first match wins per line (break after match).
STEP_MAP = [
    # --- seg8 generation (gen_seg8 in roast_run.m, pre-ROAST step) ---
    ("ROAST_RUN: Generating seg8",        "roast_seg8",              5),
    ("ROAST_RUN: seg8 saved",             "roast_seg8_done",         8),

    # --- Step 2.5: CSF fix ---
    ("STEP 2.5",                          "roast_step_csf_fix",     10),

    # --- Step 3: Electrode placement ---
    ("STEP 3",                            "roast_step_electrode",   12),
    ("measuring head size",               "roast_step_el_measure",  14),
    ("wearing the cap",                   "roast_step_el_cap",      16),
    ("placing electrode F3",              "roast_step_el_f3",       19),
    ("placing electrode F4",              "roast_step_el_f4",       21),
    ("final clean-up",                    "roast_step_el_cleanup",  23),

    # --- Step 4: Mesh generation (CGAL) ---
    ("STEP 4",                            "roast_step_mesh",        25),
    ("Mesh sizes are",                    "roast_step_mesh_sizing", 28),
    ("surface and volume meshes complete","roast_step_mesh_done",   38),
    ("saving mesh",                       "roast_step_mesh_saving", 40),

    # --- Step 5: FEM solve (getDP) ---
    # Percentage lines handled separately by _GETDP_RANGES below.
    ("STEP 5",                            "roast_step_solve",       42),
    ("Solve[Sys_Ele]",                    "roast_step_solve_fem",   65),
    ("SaveSolution",                      "roast_step_solve_save",  68),

    # --- Step 6: Post-processing ---
    ("STEP 6",                            "roast_step_postprocess", 75),
    ("converting the results",            "roast_step_post_convert",79),
    ("Computing Jroast",                  "roast_step_post_jroast", 85),
    ("saving the final results",          "roast_step_post_save",   90),
    ("ALL DONE ROAST",                    "roast_step_post_done",   95),

    # --- Complete ---
    ("ROAST_RUN: COMPLETE",               "roast_complete",        100),
]

# getDP prints percentage lines like "10%    : Pre-processing" as each phase runs 0→100%.
# We interpolate each phase's 0-100% into a sub-range of the overall 42-74% Step 5 window.
_GETDP_PRE  = re.compile(r"(\d+)%\s+:\s+Pre-processing")
_GETDP_GEN  = re.compile(r"(\d+)%\s+:\s+Processing \(Generate\)")
_GETDP_POST = re.compile(r"(\d+)%\s+:\s+Post-processing")

_GETDP_RANGES = [
    # (pattern, overall_lo, overall_hi, event_name)
    (_GETDP_PRE,  42, 52, "roast_step_solve_pre"),
    (_GETDP_GEN,  52, 62, "roast_step_solve_gen"),
    (_GETDP_POST, 65, 73, "roast_step_solve_post"),
]


def _resolve_mcr(base: Path) -> Path:
    """
    MATLAB Runtime installers sometimes place libraries under a version
    subdirectory (e.g. R2025b/v925/runtime/glnxa64/).  If runtime/ doesn't
    exist directly under *base*, look one level deeper for the first subdir
    that contains a runtime/ folder.
    """
    if (base / "runtime").is_dir():
        return base
    if base.is_dir():
        for sub in sorted(base.iterdir()):
            if sub.is_dir() and (sub / "runtime").is_dir():
                return sub
    return base  # will fail with a clear MCR error from the launcher


class ROASTRunner:
    def __init__(self, session_id: str, model_name: str, payload: dict):
        self.session_id = session_id
        self.model_name = model_name
        self.payload = payload
        self.work_dir = roast_working_dir(session_id, model_name)

    # ------------------------------------------------------------------
    def _emit(self, event: str, progress: int, detail: str | None = None):
        data = {"event": event, "progress": progress, "model": self.model_name}
        if detail:
            data["detail"] = detail
        push_event(self.session_id, data)
        log_event(self.session_id, data)
        set_roast_progress(self.session_id, progress, self.model_name)

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

        # --- Pre-close the skin label (9) at the central sagittal slices ---
        # fitCap2individual.m has an unbounded while loop that grows a morphological
        # structuring element (se += 8) until the sagittal cross-section of the scalp
        # forms a closed ring.  GRACE skin (label 9) is an open arc at the bottom
        # (open at the neck where the MRI volume is cropped), so imfill('holes') never
        # fills the interior and the loop needs se ≈ 80-150 to bridge the neck gap.
        # imclose(256×256, ones(100,100)) in the compiled MCR takes 10-30 min each →
        # stall timeout fires.  Closing the sagittal slices here reduces the required
        # se to 8 (one iteration), making the loop take seconds instead.
        skin = data == 9
        struct2d = ndi.generate_binary_structure(2, 1)  # 4-connectivity 2D kernel
        cx = data.shape[0] // 2  # approximate central sagittal index
        for xi in range(max(0, cx - 25), min(data.shape[0], cx + 25)):
            if not skin[xi].any():
                continue
            skin_closed = ndi.binary_closing(skin[xi], structure=struct2d, iterations=40)
            # Add only background (air) voxels — never overwrite other tissue labels
            new_skin = skin_closed & ~skin[xi] & (data[xi] == 0)
            data[xi, new_skin] = 9
            skin[xi] |= new_skin
        session_log(self.session_id, "[ROAST] Skin label pre-closed at central sagittal slices")

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
            quality=self.payload.get("quality", "standard"),
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

        mcr = _resolve_mcr(MATLAB_RUNTIME)
        session_log(self.session_id, f"[ROAST] Using MCR at: {mcr}")

        cmd = [str(launcher), str(mcr), str(config_path)]

        # MCR initialises GUI plugins (CEF/web window manager) even in headless
        # environments.  Wrap with xvfb-run so it gets a virtual display instead
        # of hard-failing with missing libgbm / libnss3 errors.
        import shutil as _shutil
        if _shutil.which("xvfb-run"):
            cmd = ["xvfb-run", "-a", "--server-args=-screen 0 1x1x24"] + cmd

        return cmd

    # ------------------------------------------------------------------
    def run(self):
        """
        Full ROAST pipeline: prepare → write config → launch binary → stream progress.
        """
        try:
            set_roast_status(self.session_id, "running", self.model_name)
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

            # Use all cores visible to this process (respects Docker --cpuset / --cpus limits).
            # os.cpu_count() returns the physical host count; sched_getaffinity(0) returns
            # the cores actually allocated to this container.
            import os as _os
            try:
                n_threads = len(_os.sched_getaffinity(0))
            except AttributeError:
                n_threads = _os.cpu_count() or 4
            omp_env = _os.environ.copy()
            omp_env["OMP_NUM_THREADS"] = str(n_threads)

            proc = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                cwd=str(self.work_dir),
                env=omp_env,
            )

            last_progress = 5
            deadline = time.time() + ROAST_TIMEOUT_SECONDS
            STALL_TIMEOUT = 1800  # kill if ROAST produces no stdout for 30 min

            while True:
                ready, _, _ = select.select([proc.stdout], [], [], STALL_TIMEOUT)
                if not ready:
                    proc.kill()
                    raise TimeoutError(
                        f"ROAST stalled: no stdout for {STALL_TIMEOUT // 60} min"
                    )

                line = proc.stdout.readline()
                if not line:  # EOF — process finished
                    break

                line = line.rstrip()
                if line:
                    session_log(self.session_id, f"[ROAST stdout] {line}")

                # Check cancellation
                if redis_client.get(f"cancel:{self.session_id}"):
                    proc.kill()
                    raise RuntimeError("Job cancelled by user")

                # 1) Match fixed step substrings
                matched = False
                for substring, event_name, pct in STEP_MAP:
                    if substring in line:
                        if pct > last_progress:
                            self._emit(event_name, pct)
                            last_progress = pct
                        matched = True
                        break

                # 2) If no fixed match, try getDP percentage patterns (Step 5 only)
                if not matched:
                    for pattern, lo, hi, event_name in _GETDP_RANGES:
                        m = pattern.search(line)
                        if m:
                            raw_pct = int(m.group(1))
                            mapped = lo + int((raw_pct / 100.0) * (hi - lo))
                            if mapped > last_progress:
                                self._emit(event_name, mapped)
                                last_progress = mapped
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

            set_roast_status(self.session_id, "complete", self.model_name)
            self._emit("roast_complete", 100)
            session_log(self.session_id, "[ROAST] Completed successfully")

        except Exception as e:
            log_error(self.session_id, f"[ROAST] Failed: {e}")
            set_roast_status(self.session_id, "error", self.model_name)
            self._emit("roast_error", -1, detail=str(e))
            raise

    # ------------------------------------------------------------------
    def collect_outputs(self):
        """Verify expected output NIfTI files exist."""
        expected = ["voltage", "efield", "emag"]
        missing = []
        for output_type in expected:
            path = roast_output_path(self.session_id, output_type, self.model_name)
            if not path.exists():
                missing.append(str(path))

        if missing:
            raise FileNotFoundError(
                f"ROAST finished but output files are missing: {missing}"
            )
        session_log(self.session_id, "[ROAST] All output files verified")
