"""
SimNIBSRunner — runs charm head meshing then a tDCS FEM solve via SimNIBS,
streams granular SSE progress events, and collects output NIfTIs.

Pipeline
--------
1. Gunzip T1 into working directory
2. Run `charm <subject> <t1>` → builds m2m_<subject>/<subject>.msh
3. Configure a SimNIBS TDCSLIST session (Python API) and call run_simnibs()
4. Collect emag + voltage NIfTIs into session/simnibs/outputs/
"""

import gzip
import shutil
import subprocess
import threading
import time
from pathlib import Path

from config import SIMNIBS_TIMEOUT_SECONDS
from runtime.session import (
    session_input_native,
    simnibs_working_dir,
    simnibs_output_path,
    session_log,
)
from runtime.sse import push_event
from services.redis_client import set_simnibs_status, set_simnibs_progress
from services.logger import log_event, log_error

# Fixed subject name used for charm and SimNIBS session
SUBJECT = "subject"

# charm stdout substrings → (sse_event, overall_progress)
# charm progress is coarse (it prints varying messages per version)
CHARM_MAP = [
    ("registering",          "simnibs_charm_register",  10),
    ("segmenting",           "simnibs_charm_segment",   20),
    ("classif",              "simnibs_charm_tissue",    30),
    ("surface",              "simnibs_charm_surface",   40),
    ("meshing",              "simnibs_charm_mesh",      50),
    ("finaliz",              "simnibs_charm_finalize",  57),
    ("saving",               "simnibs_charm_saving",    59),
]


class SimNIBSRunner:
    def __init__(self, session_id: str, payload: dict):
        self.session_id = session_id
        self.payload    = payload
        self.work_dir   = simnibs_working_dir(session_id)

    # ------------------------------------------------------------------
    def _emit(self, event: str, progress: int, detail: str | None = None):
        data: dict = {"event": event, "progress": progress}
        if detail:
            data["detail"] = detail
        push_event(self.session_id, data)
        log_event(self.session_id, data)
        set_simnibs_progress(self.session_id, progress)

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
    def run_charm(self, t1_path: Path) -> Path:
        """
        Run `charm <subject> <t1>` in the working directory.
        Returns path to the generated head mesh (.msh).
        """
        self._emit("simnibs_charm", 5)
        session_log(self.session_id, "[SimNIBS] Running charm head meshing…")

        cmd      = ["charm", SUBJECT, str(t1_path)]
        deadline = time.time() + SIMNIBS_TIMEOUT_SECONDS

        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            cwd=str(self.work_dir),
        )

        last_pct = 5
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

        self._emit("simnibs_charm_done", 60)
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
                "SimNIBS is not installed. Install it with: pip install simnibs"
            )

        self._emit("simnibs_fem_setup", 62)
        session_log(self.session_id, "[SimNIBS] Configuring tDCS session…")

        fem_dir = self.work_dir / "fem"
        fem_dir.mkdir(exist_ok=True)

        # --- parse electrode recipe -----------------------------------
        # Recipe format (same as ROAST): [pos1, mA1, pos2, mA2, ...]
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
        s.map_to_mni = False          # keep results in subject space

        tdcs = s.add_tdcslist()
        tdcs.currents  = [p[1] for p in pairs]
        tdcs.map_to_vol = True        # produce NIfTI volumes

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
        self._emit("simnibs_fem_solve", 65)
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

        # Heartbeat: increment 65 → 88 % while waiting (every 10 s)
        progress = 65
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
        We search recursively under fem/ in case of version-specific sub-dirs.
        """
        fem_dir = self.work_dir / "fem"
        out_dir = self.work_dir / "outputs"
        out_dir.mkdir(exist_ok=True)

        # Candidate filenames per output type (ordered by preference)
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
        """Full pipeline: prepare → charm → FEM → collect."""
        try:
            set_simnibs_status(self.session_id, "running")
            self._emit("simnibs_start", 2)

            t1_path   = self.prepare_t1()
            self._emit("simnibs_prepare", 4)

            mesh_path = self.run_charm(t1_path)
            self.run_fem(mesh_path)
            self.collect_outputs()

            set_simnibs_status(self.session_id, "complete")
            self._emit("simnibs_complete", 100)
            session_log(self.session_id, "[SimNIBS] Completed successfully")

        except Exception as exc:
            log_error(self.session_id, f"[SimNIBS] Failed: {exc}")
            set_simnibs_status(self.session_id, "error")
            self._emit("simnibs_error", -1, detail=str(exc))
            raise
