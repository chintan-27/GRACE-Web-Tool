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

from config import SIMNIBS_TIMEOUT_SECONDS, SIMNIBS_HOME, MNI_TEMPLATE
from runtime.session import (
    session_input_native,
    model_output_path,
    simnibs_working_dir,
    simnibs_charm_base_dir,
    simnibs_output_path,
    session_log,
)
from runtime.sse import push_event
from services.redis_client import (
    set_simnibs_status,
    set_simnibs_progress,
    acquire_charm_base_lock,
    release_charm_base_lock,
    set_charm_base_ready,
    is_charm_base_ready,
)
from services.logger import log_event, log_error

# Fixed subject name used for charm and SimNIBS session
SUBJECT = "subject"

# Seconds to sleep between polls when waiting for another model to build the charm base
CHARM_BASE_POLL_INTERVAL = 10

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


def _find_mni_template() -> str | None:
    """
    Find the MNI152 T1 template used for ANTs registration.
    Priority: MNI_TEMPLATE env var → SIMNIBS_HOME glob → simnibs import fallback.
    """
    if MNI_TEMPLATE and Path(MNI_TEMPLATE).exists():
        return MNI_TEMPLATE

    # Search directly inside SIMNIBS_HOME (works even if simnibs is not importable
    # in the current venv, e.g. when the API runs in a separate virtualenv).
    # Scan simnibs_env/lib/python3.x/ directories rather than using rglob,
    # which can fail with PermissionError on some subdirectories.
    if SIMNIBS_HOME:
        lib_dir = Path(SIMNIBS_HOME) / "simnibs_env" / "lib"
        if lib_dir.exists():
            for py_dir in lib_dir.iterdir():
                if not py_dir.name.startswith("python"):
                    continue
                for name in ("MNI152_T1_1mm.nii.gz", "mni_icbm152_t1_tal_nlin_asym_09c.nii.gz"):
                    tmpl = py_dir / "site-packages" / "simnibs" / "resources" / "templates" / name
                    if tmpl.exists():
                        return str(tmpl)

    # Fallback: try importing simnibs from the current Python environment
    try:
        import simnibs
        pkg = Path(simnibs.__file__).parent
        for rel in (
            "resources/templates/MNI152_T1_1mm.nii.gz",
            "resources/templates/mni_icbm152_t1_tal_nlin_asym_09c.nii.gz",
        ):
            tmpl = pkg / rel
            if tmpl.exists():
                return str(tmpl)
    except ImportError:
        pass

    return None


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
    def _run_proc(self, cmd: list, tag: str, cwd: Path, deadline: float) -> None:
        """Run a subprocess, streaming stdout to the session log. Raises on failure."""
        session_log(self.session_id, f"[SimNIBS] cmd: {' '.join(cmd)}")
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            cwd=str(cwd),
            env=_simnibs_env(),
        )
        for line in proc.stdout:
            line = line.rstrip()
            if line:
                session_log(self.session_id, f"[{tag}] {line}")
            if time.time() > deadline:
                proc.kill()
                raise TimeoutError(f"{tag} timed out")
        proc.wait()
        if proc.returncode != 0:
            raise RuntimeError(f"{tag} exited with code {proc.returncode}")

    # ------------------------------------------------------------------
    def _build_charm_base(self) -> None:
        """
        Build the session-level shared charm base (Option A+B):
          1. Gunzip T1 → _charm_base/T1.nii
          2. charm --initatlas   (atlas registration, creates m2m_subject/)
          3. antsRegistrationSyNQuick.sh  (nonlinear MNI warp, ~5–10 min)
             Replaces the slow charm --segment step (~20–40 min).

        The resulting m2m_subject/ (with toMNI/ warp) is then copied by each
        model that needs it, so this work is paid only once per session.
        """
        base_work = simnibs_charm_base_dir(self.session_id)
        deadline  = time.time() + SIMNIBS_TIMEOUT_SECONDS

        # Gunzip the session T1 into the shared base directory
        t1_gz  = session_input_native(self.session_id)
        t1_nii = base_work / "T1.nii"
        if not t1_nii.exists():
            with gzip.open(t1_gz, "rb") as fi, open(t1_nii, "wb") as fo:
                shutil.copyfileobj(fi, fo)
        session_log(self.session_id, f"[SimNIBS] Base T1 → {t1_nii}")

        # Step 1: atlas registration
        session_log(self.session_id, "[SimNIBS] Charm base 1/2: initatlas…")
        self._run_proc(
            [_find_charm(), SUBJECT, str(t1_nii), "--initatlas"],
            "charm-base",
            base_work,
            deadline,
        )

        # Step 2: Create affine MNI warp from the coregistrationMatrices.mat
        # produced by --initatlas.  Split into two sub-steps because scipy is
        # only available in the SimNIBS Python env, while nibabel is only in
        # the API Python env.
        mni_template = _find_mni_template()
        if not mni_template:
            raise RuntimeError(
                "MNI template not found in SimNIBS installation. "
                "Set MNI_TEMPLATE env var to the path of your MNI152 T1 NIfTI."
            )
        if not SIMNIBS_HOME:
            raise RuntimeError(
                "SIMNIBS_HOME is not set; cannot locate SimNIBS Python to extract MNI warp matrix."
            )

        m2m_dir  = base_work / f"m2m_{SUBJECT}"
        mat_file = m2m_dir / "segmentation" / "coregistrationMatrices.mat"
        w2w_npy  = m2m_dir / "W2W.npy"

        # Step 2a: use SimNIBS Python (has scipy) to extract W2W matrix → W2W.npy
        simnibs_python = str(Path(SIMNIBS_HOME) / "simnibs_env" / "bin" / "python3")
        extract_oneliner = (
            "import scipy.io, numpy as np, sys; "
            "m = scipy.io.loadmat(sys.argv[1]); "
            "np.save(sys.argv[2], m['worldToWorldTransformMatrix'].astype('float64'))"
        )
        session_log(self.session_id, "[SimNIBS] Charm base 2/3: extracting MNI→T1 matrix…")
        self._run_proc(
            [simnibs_python, "-c", extract_oneliner, str(mat_file), str(w2w_npy)],
            "mni-matrix",
            base_work,
            deadline,
        )

        # Step 2b: use API Python (has nibabel) to create the warp NIfTIs
        import sys as _sys
        warp_script = Path(__file__).parent / "create_mni_warp.py"
        session_log(self.session_id, "[SimNIBS] Charm base 3/3: creating affine MNI warp…")
        self._run_proc(
            [_sys.executable, str(warp_script), str(m2m_dir), mni_template],
            "mni-warp",
            base_work,
            deadline,
        )

        session_log(self.session_id, f"[SimNIBS] Charm base ready → {base_work / f'm2m_{SUBJECT}'}")

    # ------------------------------------------------------------------
    def _ensure_charm_base(self) -> Path:
        """
        Return the shared m2m_subject/ path, building it if this is the first
        model in the session.  Uses a Redis lock so only one model builds;
        the rest wait and then reuse the result.
        """
        base_m2m = simnibs_charm_base_dir(self.session_id) / f"m2m_{SUBJECT}"

        # Fast path: another model already finished building
        if is_charm_base_ready(self.session_id) and base_m2m.exists():
            session_log(self.session_id, "[SimNIBS] Reusing existing charm base.")
            return base_m2m

        if acquire_charm_base_lock(self.session_id):
            # This model won the lock — it is responsible for building
            session_log(self.session_id, "[SimNIBS] Building charm base (first model in session)…")
            try:
                self._build_charm_base()
                set_charm_base_ready(self.session_id)
            except Exception:
                release_charm_base_lock(self.session_id)
                raise
        else:
            # Another model is building — wait for it to finish
            session_log(self.session_id, "[SimNIBS] Waiting for charm base (built by another model)…")
            deadline = time.time() + SIMNIBS_TIMEOUT_SECONDS
            while not is_charm_base_ready(self.session_id):
                if time.time() > deadline:
                    raise TimeoutError("Timed out waiting for shared charm base")
                time.sleep(CHARM_BASE_POLL_INTERVAL)
            session_log(self.session_id, "[SimNIBS] Charm base is ready.")

        return base_m2m

    # ------------------------------------------------------------------
    def run_charm(self, t1_path: Path, seg_path: Path) -> Path:
        """
        Build a head mesh from our precomputed segmentation.

        Option A — cross-model caching:
          The charm base (initatlas + ANTs MNI warp) is built once per session
          and shared across all models.  Each model only pays for --mesh.

        Option B — ANTs MNI registration:
          antsRegistrationSyNQuick.sh (~5–10 min) replaces charm's --segment
          (SAMSEG, ~20–40 min) for creating the MNI warp.

        Per-model workflow:
          1. Ensure shared charm base exists (build or wait).
          2. Copy base m2m_subject/ into this model's working directory.
          3. Update settings.ini to reflect the new path.
          4. Replace tissue_labeling_upsampled.nii.gz with our segmentation.
          5. Run charm --mesh to build the FEM mesh (~5–10 min).
        """
        self._emit("simnibs_charm", 8)

        # Step 1 — get (or wait for) the shared charm base
        base_m2m = self._ensure_charm_base()
        self._emit("simnibs_charm_register", 20)

        # Step 2 — copy base into this model's working directory
        model_m2m = self.work_dir / f"m2m_{SUBJECT}"
        if model_m2m.exists():
            shutil.rmtree(str(model_m2m))
        shutil.copytree(str(base_m2m), str(model_m2m))
        session_log(self.session_id, f"[SimNIBS] Copied charm base → {model_m2m}")

        # Step 3 — rewrite absolute paths in settings.ini to the model dir
        settings_file = model_m2m / "settings.ini"
        if settings_file.exists():
            base_work_str = str(simnibs_charm_base_dir(self.session_id))
            model_work_str = str(self.work_dir)
            content = settings_file.read_text()
            content = content.replace(base_work_str, model_work_str)
            settings_file.write_text(content)

        # Step 4 — inject our precomputed segmentation
        label_prep = model_m2m / "label_prep"
        label_prep.mkdir(parents=True, exist_ok=True)
        seg_dest = label_prep / "tissue_labeling_upsampled.nii.gz"
        shutil.copy2(str(seg_path), str(seg_dest))
        session_log(self.session_id, f"[SimNIBS] Injected segmentation → {seg_dest}")
        self._emit("simnibs_charm_segment", 30)

        # Step 5 — build mesh from our label image
        session_log(self.session_id, "[SimNIBS] charm --mesh…")
        cmd      = [_find_charm(), SUBJECT, "--mesh"]
        deadline = time.time() + SIMNIBS_TIMEOUT_SECONDS
        session_log(self.session_id, f"[SimNIBS] charm cmd: {' '.join(cmd)}")

        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            cwd=str(self.work_dir),
            env=_simnibs_env(),
        )
        last_pct = 30
        for line in proc.stdout:
            line = line.rstrip()
            if line:
                session_log(self.session_id, f"[charm-mesh] {line}")
            line_l = line.lower()
            for substr, evt, pct in CHARM_MAP:
                if substr in line_l and pct > last_pct:
                    self._emit(evt, pct)
                    last_pct = pct
                    break
            if time.time() > deadline:
                proc.kill()
                raise TimeoutError("charm --mesh timed out")
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
