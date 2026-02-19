"""
SimNIBSRunner — runs SimNIBS tDCS FEM simulation using an existing
GRACE/DOMINO/DOMINO++ segmentation mask (bypasses charm's own segmentation).

Pipeline
--------
1. Gunzip T1 into working directory
2. Load GRACE segmentation → remap 11-tissue labels to SimNIBS 5-tissue format
3. Run `charm <subject> <t1> --precomputed_seg <remapped_seg>` (skips segmentation step)
4. Configure a SimNIBS TDCSLIST session (Python API) and call run_simnibs()
5. Collect emag + voltage NIfTIs into session/simnibs/<model_name>/outputs/

Label mapping (GRACE 11-tissue → SimNIBS 5-tissue)
----------------------------------------------------
 1 WM            → 1 WM
 2 GM            → 2 GM
 3 CSF           → 3 CSF
 4 compact bone  → 4 skull
 5 cancel. bone  → 4 skull
 6 scalp         → 5 scalp
 7 air           → 0 background
 8 muscle        → 5 scalp (soft tissue)
 9 fat           → 5 scalp (soft tissue)
10 blood         → 0 background
11 eye           → 6 eyes (SimNIBS optional label)
"""

import gzip
import os
import shutil
import subprocess
import threading
import time
from pathlib import Path

import nibabel as nib
import numpy as np

from config import SIMNIBS_TIMEOUT_SECONDS, SIMNIBS_HOME
from runtime.session import (
    session_input_native,
    model_output_path,
    simnibs_working_dir,
    simnibs_output_path,
    session_log,
)
from runtime.sse import push_event
from services.redis_client import set_simnibs_status, set_simnibs_progress
from services.logger import log_event, log_error

# Fixed subject name used for charm and SimNIBS session
SUBJECT = "subject"

# GRACE 11-tissue → SimNIBS tissue labels
# SimNIBS: 0=bg, 1=WM, 2=GM, 3=CSF, 4=skull, 5=scalp, 6=eyes
LABEL_MAP = {
    0:  0,   # background
    1:  1,   # white matter
    2:  2,   # gray matter
    3:  3,   # CSF
    4:  4,   # compact bone → skull
    5:  4,   # cancellous bone → skull
    6:  5,   # scalp
    7:  0,   # air → background
    8:  5,   # muscle → scalp/soft tissue
    9:  5,   # fat → scalp/soft tissue
    10: 0,   # blood → background
    11: 6,   # eye
}

# charm stdout substrings → (sse_event, overall_progress)
CHARM_MAP = [
    ("registering",          "simnibs_charm_register",  10),
    ("segmenting",           "simnibs_charm_segment",   20),
    ("classif",              "simnibs_charm_tissue",    30),
    ("surface",              "simnibs_charm_surface",   40),
    ("meshing",              "simnibs_charm_mesh",      50),
    ("finaliz",              "simnibs_charm_finalize",  57),
    ("saving",               "simnibs_charm_saving",    59),
]


def _find_charm() -> str:
    """
    Resolve the charm executable path.
    Priority: SIMNIBS_HOME/bin/charm → which charm → fallback 'charm'.
    """
    if SIMNIBS_HOME:
        candidate = Path(SIMNIBS_HOME) / "bin" / "charm"
        if candidate.exists():
            return str(candidate)

    found = shutil.which("charm")
    if found:
        return found

    return "charm"  # will raise FileNotFoundError with a clear message


def _simnibs_env() -> dict:
    """Build subprocess env that includes SIMNIBS_HOME/bin in PATH."""
    env = os.environ.copy()
    if SIMNIBS_HOME:
        bin_dir = str(Path(SIMNIBS_HOME) / "bin")
        env["PATH"] = bin_dir + os.pathsep + env.get("PATH", "")
    return env


class SimNIBSRunner:
    def __init__(self, session_id: str, payload: dict):
        self.session_id = session_id
        self.payload    = payload
        self.model_name = payload.get("model_name", "")
        self.work_dir   = simnibs_working_dir(session_id, self.model_name)

    # ------------------------------------------------------------------
    def _emit(self, event: str, progress: int, detail: str | None = None):
        data: dict = {"event": event, "progress": progress, "model": self.model_name}
        if detail:
            data["detail"] = detail
        push_event(self.session_id, data)
        log_event(self.session_id, data)
        set_simnibs_progress(self.session_id, progress, self.model_name)

    # ------------------------------------------------------------------
    def prepare_t1(self) -> Path:
        """Gunzip input T1 into the SimNIBS working directory."""
        t1_gz  = session_input_native(self.session_id)
        t1_nii = self.work_dir / "T1.nii"
        with gzip.open(t1_gz, "rb") as fi, open(t1_nii, "wb") as fo:
            shutil.copyfileobj(fi, fo)
        session_log(self.session_id, f"[SimNIBS] T1 gunzipped → {t1_nii}")
        return t1_nii

    # ------------------------------------------------------------------
    def prepare_segmentation(self) -> Path:
        """
        Load the GRACE/DOMINO/DOMINO++ segmentation, remap to SimNIBS labels,
        and save to the working directory.
        """
        seg_gz = model_output_path(self.session_id, self.model_name)
        if not seg_gz.exists():
            raise FileNotFoundError(
                f"Segmentation not found for model '{self.model_name}'. "
                "Run segmentation first."
            )

        session_log(self.session_id, f"[SimNIBS] Loading segmentation: {seg_gz}")
        img  = nib.load(str(seg_gz))
        data = np.asarray(img.dataobj, dtype=np.int16)

        remapped = np.zeros_like(data, dtype=np.uint8)
        for src, dst in LABEL_MAP.items():
            remapped[data == src] = dst

        out_path = self.work_dir / "seg_remapped.nii.gz"
        nib.save(nib.Nifti1Image(remapped, img.affine), str(out_path))
        session_log(self.session_id, f"[SimNIBS] Remapped segmentation → {out_path}")
        return out_path

    # ------------------------------------------------------------------
    def run_charm(self, t1_path: Path, seg_path: Path) -> Path:
        """
        Run `charm <subject> <t1> --precomputed_seg <seg>` to build the head mesh
        from the GRACE segmentation (skips charm's own segmentation step).
        Returns path to the generated head mesh (.msh).
        """
        self._emit("simnibs_charm", 8)
        session_log(self.session_id, "[SimNIBS] Running charm (precomputed seg)…")

        charm_bin = _find_charm()
        cmd = [
            charm_bin,
            SUBJECT,
            str(t1_path),
            "--precomputed_seg", str(seg_path),
        ]
        deadline = time.time() + SIMNIBS_TIMEOUT_SECONDS
        env = _simnibs_env()

        session_log(self.session_id, f"[SimNIBS] charm cmd: {' '.join(cmd)}")

        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            cwd=str(self.work_dir),
            env=env,
        )

        last_pct = 8
        for line in proc.stdout:
            line = line.rstrip()
            if line:
                session_log(self.session_id, f"[charm] {line}")
            line_l = line.lower()
            for substr, evt, pct in CHARM_MAP:
                if substr in line_l and pct > last_pct:
                    self._emit(evt, pct)
                    last_pct = pct
                    break
            if time.time() > deadline:
                proc.kill()
                raise TimeoutError("charm timed out")

        proc.wait()
        if proc.returncode != 0:
            raise RuntimeError(f"charm exited with code {proc.returncode}")

        mesh_path = self.work_dir / f"m2m_{SUBJECT}" / f"{SUBJECT}.msh"
        if not mesh_path.exists():
            raise FileNotFoundError(f"charm did not produce expected mesh: {mesh_path}")

        self._emit("simnibs_charm_done", 62)
        session_log(self.session_id, f"[SimNIBS] charm complete → {mesh_path}")
        return mesh_path

    # ------------------------------------------------------------------
    def run_fem(self, mesh_path: Path) -> None:
        """
        Configure and run a SimNIBS tDCS FEM simulation.
        Uses the Python API (imported inline) so import errors are caught cleanly.
        Progress is approximated via heartbeat ticks during the blocking solve.
        """
        try:
            from simnibs import sim_struct, run_simnibs as _run_simnibs
        except ImportError:
            raise RuntimeError(
                "SimNIBS Python package not installed. "
                "Install it via: pip install simnibs"
            )

        self._emit("simnibs_fem_setup", 65)
        session_log(self.session_id, "[SimNIBS] Configuring tDCS session…")

        fem_dir = self.work_dir / "fem"
        fem_dir.mkdir(exist_ok=True)

        # --- parse electrode recipe -----------------------------------
        recipe   = self.payload.get("recipe") or ["F3", 2, "F4", -2]
        electype = self.payload.get("electrode_type") or []

        pairs: list[tuple[str, float]] = []
        for i in range(0, len(recipe), 2):
            pos = str(recipe[i])
            ma  = float(recipe[i + 1])
            pairs.append((pos, ma / 1000.0))   # SimNIBS wants amperes

        # --- build SimNIBS session ------------------------------------
        s = sim_struct.SESSION()
        s.fnamehead = str(mesh_path)
        s.pathfem   = str(fem_dir)
        s.map_to_mni = False

        tdcs = s.add_tdcslist()
        tdcs.currents  = [p[1] for p in pairs]
        tdcs.map_to_vol = True

        for idx, (pos, _) in enumerate(pairs):
            elec = tdcs.add_electrode()
            elec.channelnr = idx + 1
            elec.centre    = pos
            etype = electype[idx] if idx < len(electype) else "pad"
            if etype == "ring":
                elec.shape      = "ellipse"
                elec.dimensions = [40, 40]
                elec.dimensions_sponge = [70, 70]
            else:
                elec.shape      = "rect"
                elec.dimensions = [70, 50]
            elec.thickness = [3, 3]

        # --- run solve in a background thread so we can heartbeat -----
        self._emit("simnibs_fem_solve", 68)
        session_log(self.session_id, "[SimNIBS] FEM solve running…")

        solve_done  = threading.Event()
        solve_error: list[Exception] = []

        def _solve():
            try:
                _run_simnibs(s)
            except Exception as exc:
                solve_error.append(exc)
            finally:
                solve_done.set()

        threading.Thread(target=_solve, daemon=True).start()

        # Heartbeat: increment 68 → 88 % while waiting (every 10 s)
        progress = 68
        deadline = time.time() + SIMNIBS_TIMEOUT_SECONDS
        while not solve_done.wait(timeout=10):
            if time.time() > deadline:
                raise TimeoutError("SimNIBS FEM solve timed out")
            progress = min(88, progress + 2)
            self._emit("simnibs_fem_solve", progress)

        if solve_error:
            raise solve_error[0]

        self._emit("simnibs_post", 90)
        session_log(self.session_id, "[SimNIBS] FEM solve complete, collecting outputs…")

    # ------------------------------------------------------------------
    def collect_outputs(self) -> None:
        """
        Find SimNIBS output NIfTIs and copy them to a canonical location.

        SimNIBS names outputs as:
          {subject}_TDCS_1_normE.nii.gz  → emag
          {subject}_TDCS_1_v.nii.gz      → voltage
        """
        fem_dir = self.work_dir / "fem"
        out_dir = self.work_dir / "outputs"
        out_dir.mkdir(exist_ok=True)

        candidates: dict[str, list[str]] = {
            "emag":    [f"{SUBJECT}_TDCS_1_normE.nii.gz",
                        f"{SUBJECT}_TDCS_1_E.nii.gz"],
            "voltage": [f"{SUBJECT}_TDCS_1_v.nii.gz"],
        }

        found: dict[str, Path] = {}
        for output_type, fnames in candidates.items():
            for fname in fnames:
                matches = list(fem_dir.rglob(fname))
                if matches:
                    dest = out_dir / f"{output_type}.nii.gz"
                    shutil.copy2(matches[0], dest)
                    found[output_type] = dest
                    session_log(self.session_id,
                                f"[SimNIBS] Collected {output_type} → {dest}")
                    break

        missing = [t for t in ("emag", "voltage") if t not in found]
        if missing:
            raise FileNotFoundError(
                f"SimNIBS finished but output files are missing: {missing}"
            )

    # ------------------------------------------------------------------
    def run(self):
        """Full pipeline: prepare T1 → remap seg → charm → FEM → collect."""
        try:
            set_simnibs_status(self.session_id, "running", self.model_name)
            self._emit("simnibs_start", 2)

            t1_path  = self.prepare_t1()
            self._emit("simnibs_prepare", 4)

            seg_path = self.prepare_segmentation()
            self._emit("simnibs_seg_ready", 6)

            mesh_path = self.run_charm(t1_path, seg_path)
            self.run_fem(mesh_path)
            self.collect_outputs()

            set_simnibs_status(self.session_id, "complete", self.model_name)
            self._emit("simnibs_complete", 100)
            session_log(self.session_id, "[SimNIBS] Completed successfully")

        except Exception as exc:
            log_error(self.session_id, f"[SimNIBS] Failed: {exc}")
            set_simnibs_status(self.session_id, "error", self.model_name)
            self._emit("simnibs_error", -1, detail=str(exc))
            raise
