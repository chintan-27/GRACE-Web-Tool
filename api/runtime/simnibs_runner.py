"""
SimNIBSRunner — runs SimNIBS tDCS FEM simulation using an existing
GRACE/DOMINO/DOMINO++ segmentation mask.

Pipeline
--------
1. Gunzip T1 into working directory
2. Load GRACE segmentation → remap 11-tissue labels to SimNIBS/CHARM labels
3. Run `charm --initatlas <subject> <t1>` once per session (shared base, ~30s):
   atlas affine registration only — no SAMSEG segmentation
4. Per-model: copy initatlas base → inject remapped labels as
   label_prep/tissue_labeling_upsampled.nii.gz, then run
   `charm --surfaces --mesh` to build subject-accurate surfaces + EEG positions
5. Run `meshmesh <labels.nii.gz> <subject_custom_mesh.msh> --voxsize_meshing 0.5`
   to build the FEM mesh from the custom labels
6. Configure a SimNIBS TDCSLIST session (j-field) and call run_simnibs()
7. Post-process: create WM/GM-masked magnJ NIfTIs
8. Collect magnJ + masked volumes into session/simnibs/<model_name>/outputs/

Label mapping (GRACE 11-tissue → SimNIBS/CHARM)
------------------------------------------------
GRACE                    CHARM label
 0  Background      →  0  Air/background
 1  White-Matter    →  1  White-Matter
 2  Grey-Matter     →  2  Gray-Matter
 3  Eyes            →  6  Eye_balls
 4  CSF             →  3  CSF
 5  Air (internal)  → 12  air (custom)
 6  Blood           →  9  Blood
 7  Spongy Bone     →  8  Spongy_bone
 8  Compact Bone    →  7  Compact_bone
 9  Skin            →  5  Scalp
10  Fat             → 11  fat (custom)
11  Muscle          → 10  Muscle
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

# GRACE 11-tissue → SimNIBS/CHARM tissue labels
LABEL_MAP = {
    0:  0,   # background → air/background
    1:  1,   # white matter
    2:  2,   # gray matter
    3:  6,   # eyes → eye_balls
    4:  3,   # CSF
    5:  12,  # air (internal) → air custom label
    6:  9,   # blood
    7:  8,   # spongy bone
    8:  7,   # compact bone
    9:  5,   # skin → scalp
    10: 11,  # fat (custom label)
    11: 10,  # muscle
}



def _find_simnibs_home() -> str:
    """
    Return the SimNIBS installation root directory.
    Priority: SIMNIBS_HOME env var → parent of the charm binary directory.
    """
    if SIMNIBS_HOME:
        return SIMNIBS_HOME
    charm_path = shutil.which("charm")
    if charm_path:
        candidate = Path(charm_path).resolve().parent.parent
        if (candidate / "simnibs_env").exists():
            return str(candidate)
    return ""


def _find_simnibs_python() -> str:
    """
    Find the Python interpreter bundled with SimNIBS.
    """
    homes_to_try: list[str] = []
    charm_path = shutil.which("charm")
    if charm_path:
        homes_to_try.append(str(Path(charm_path).resolve().parent.parent))
    configured = _find_simnibs_home()
    if configured and configured not in homes_to_try:
        homes_to_try.append(configured)

    for home in homes_to_try:
        env_bin = Path(home) / "simnibs_env" / "bin"
        for name in ("python3", "python"):
            candidate = env_bin / name
            if candidate.exists():
                return str(candidate)

    raise RuntimeError(
        "Cannot find Python in SimNIBS virtual environment. "
        "Check your SIMNIBS_HOME / SIM_NIBS setting."
    )


def _charm_cmd() -> list[str]:
    """
    Return the command list prefix for running charm.
    Detects broken wrapper paths (host-installed, container-mounted) and
    falls back to calling simnibs_env Python directly.
    """
    home = _find_simnibs_home()
    if home:
        wrapper = Path(home) / "bin" / "charm"
        if wrapper.exists():
            try:
                first_lines = wrapper.read_text(errors="ignore")[:512]
                import re as _re
                m = _re.search(r'(/\S+/simnibs_env/bin/python\S*)', first_lines)
                if m and Path(m.group(1)).exists():
                    return [str(wrapper)]
                elif not m:
                    return [str(wrapper)]
            except Exception:
                return [str(wrapper)]

        for pyname in ("python3", "python"):
            py = Path(home) / "simnibs_env" / "bin" / pyname
            if py.exists():
                return [str(py), "-m", "simnibs.cli.charm"]

    augmented_path = _simnibs_env().get("PATH")
    found = shutil.which("charm", path=augmented_path)
    if found:
        return [found]

    tried = str(Path(home) / "bin" / "charm") if home else "(SIMNIBS_HOME not set)"
    raise FileNotFoundError(
        f"SimNIBS 'charm' not found. Tried: {tried}. "
        f"SIMNIBS_HOME={SIMNIBS_HOME!r}."
    )


def _meshmesh_cmd() -> list[str]:
    """Return the command list prefix for running meshmesh."""
    home = _find_simnibs_home()
    if home:
        wrapper = Path(home) / "bin" / "meshmesh"
        if wrapper.exists():
            return [str(wrapper)]
        for pyname in ("python3", "python"):
            py = Path(home) / "simnibs_env" / "bin" / pyname
            if py.exists():
                return [str(py), "-m", "simnibs.cli.meshmesh"]

    found = shutil.which("meshmesh")
    if found:
        return [found]

    raise FileNotFoundError(
        "SimNIBS 'meshmesh' not found. Check SIMNIBS_HOME."
    )


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
        self.run_id     = payload.get("run_id", "")
        self.work_dir   = simnibs_working_dir(session_id, self.model_name, self.run_id)

    # ------------------------------------------------------------------
    def _emit(self, event: str, progress: int, detail: str | None = None):
        data: dict = {"event": event, "progress": progress, "model": self.model_name}
        if detail:
            data["detail"] = detail
        push_event(self.session_id, data)
        log_event(self.session_id, data)
        set_simnibs_progress(self.session_id, progress, self.model_name, self.run_id)

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
    def prepare_segmentation(self) -> Path:
        """
        Load the GRACE/DOMINO/DOMINO++ segmentation, remap to SimNIBS/CHARM
        labels, and save to the working directory.
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

        remapped = np.zeros_like(data, dtype=np.int32)
        for src, dst in LABEL_MAP.items():
            remapped[data == src] = dst

        out_path = self.work_dir / "seg_remapped.nii.gz"
        nib.save(nib.Nifti1Image(remapped, img.affine), str(out_path))
        session_log(self.session_id, f"[SimNIBS] Remapped segmentation → {out_path}")
        return out_path

    # ------------------------------------------------------------------
    def _run_charm_initatlas(self) -> None:
        """
        Run charm --initatlas only (shared, ~30s).
        Performs affine atlas registration → creates m2m_subject/ with T1.nii.gz
        and segmentation/coregistrationMatrices.mat. No SAMSEG.
        """
        base_work = simnibs_charm_base_dir(self.session_id)
        deadline  = time.time() + SIMNIBS_TIMEOUT_SECONDS

        t1_gz  = session_input_native(self.session_id)
        t1_nii = base_work / "T1.nii"
        if not t1_nii.exists():
            with gzip.open(t1_gz, "rb") as fi, open(t1_nii, "wb") as fo:
                shutil.copyfileobj(fi, fo)
        session_log(self.session_id, f"[SimNIBS] Base T1 → {t1_nii}")

        session_log(self.session_id, "[SimNIBS] charm --initatlas: affine atlas registration…")
        cmd = _charm_cmd() + ["--forceqform", "--initatlas", SUBJECT, str(t1_nii)]
        self._run_proc(cmd, "charm-initatlas", base_work, deadline)
        session_log(self.session_id, f"[SimNIBS] Atlas registration done → {base_work / f'm2m_{SUBJECT}'}")

    # ------------------------------------------------------------------
    def _ensure_initatlas_base(self) -> Path:
        """
        Return the shared m2m_subject/ path after --initatlas, running it if
        this is the first model in the session. Uses a Redis lock so only one
        model builds; the rest wait and then reuse the result.
        """
        base_m2m = simnibs_charm_base_dir(self.session_id) / f"m2m_{SUBJECT}"

        if is_charm_base_ready(self.session_id) and base_m2m.exists():
            session_log(self.session_id, "[SimNIBS] Reusing existing atlas base.")
            return base_m2m

        if acquire_charm_base_lock(self.session_id):
            session_log(self.session_id, "[SimNIBS] Running charm --initatlas (first model in session)…")
            try:
                self._run_charm_initatlas()
                set_charm_base_ready(self.session_id)
            except Exception:
                release_charm_base_lock(self.session_id)
                raise
        else:
            session_log(self.session_id, "[SimNIBS] Waiting for atlas base (built by another model)…")
            deadline = time.time() + SIMNIBS_TIMEOUT_SECONDS
            while not is_charm_base_ready(self.session_id):
                if time.time() > deadline:
                    raise TimeoutError("Timed out waiting for shared atlas base")
                time.sleep(CHARM_BASE_POLL_INTERVAL)
            session_log(self.session_id, "[SimNIBS] Atlas base is ready.")

        return base_m2m

    # ------------------------------------------------------------------
    def _inject_labels_and_run_charm(self, model_m2m: Path, seg_path: Path, deadline: float) -> None:
        """
        Inject our DL segmentation into charm's label_prep directory (resampled
        to the conformated T1 space), then run charm --surfaces --mesh to build
        subject-accurate cortical surfaces and EEG cap positions from our labels.
        Skips SAMSEG entirely.
        """
        from nibabel.processing import resample_from_to

        # Conformated T1 produced by --initatlas
        t1_path = model_m2m / "T1.nii.gz"
        if not t1_path.exists():
            raise FileNotFoundError(f"Conformated T1 not found in m2m: {t1_path}")

        t1_img  = nib.load(str(t1_path))
        seg_img = nib.load(str(seg_path))

        # Resample labels to conformated T1 space (nearest-neighbour for discrete labels)
        seg_resampled = resample_from_to(seg_img, t1_img, order=0, cval=0)
        seg_data = np.asarray(seg_resampled.dataobj, dtype=np.int16)

        # --- label_prep/tissue_labeling_upsampled.nii.gz ---
        label_prep = model_m2m / "label_prep"
        label_prep.mkdir(exist_ok=True)
        label_out = label_prep / "tissue_labeling_upsampled.nii.gz"
        nib.save(seg_resampled, str(label_out))
        session_log(self.session_id, f"[SimNIBS] Injected labels → {label_out}")

        # --- segmentation/labeling.nii.gz ---
        # "Improving GM from surfaces" loads this after surface creation.
        # Normally produced by SAMSEG; we provide our DL labels instead.
        seg_dir = model_m2m / "segmentation"
        seg_dir.mkdir(exist_ok=True)
        labeling_out = seg_dir / "labeling.nii.gz"
        nib.save(seg_resampled, str(labeling_out))
        session_log(self.session_id, f"[SimNIBS] Created segmentation/labeling.nii.gz from DL labels")

        affine = seg_resampled.affine

        # --- surfaces/ intermediate files needed by charm --surfaces ---
        # charm --surfaces (CAT12) expects these to exist before it runs its
        # cortical reconstruction. We create them from our DL labels + T1,
        # bypassing the SAMSEG step that would normally produce them.
        surfaces_dir = model_m2m / "surfaces"
        surfaces_dir.mkdir(exist_ok=True)

        # norm_image.nii.gz — CAT12 "Ymf" tissue-class image.
        # CAT12 expects tissue class values, not raw T1 intensities:
        #   WM=3, GM=2, CSF=1, background=0
        # Passing raw T1 here causes run_cat_multiprocessing.py to exit with code 1.
        norm_data = np.zeros(seg_data.shape, dtype=np.float32)
        norm_data[seg_data == 1] = 3.0  # WM
        norm_data[seg_data == 2] = 2.0  # GM
        norm_data[seg_data == 4] = 1.0  # CSF
        nib.save(nib.Nifti1Image(norm_data, affine), str(surfaces_dir / "norm_image.nii.gz"))
        session_log(self.session_id, "[SimNIBS] Created surfaces/norm_image.nii.gz (Ymf: WM=3, GM=2, CSF=1)")

        # Hemisphere split: RAS x < 0 → left hemisphere
        brain_mask = (seg_data == 1) | (seg_data == 2)   # WM(1) + GM(2)
        nx = seg_data.shape[0]
        x_ras = affine[0, 0] * np.arange(nx) + affine[0, 3]
        left_x = x_ras < 0

        # hemi_mask.nii.gz → passed as --Yleft_path (Yleft in createCS).
        # createCS expects a BINARY mask: 1=left brain, 0=elsewhere.
        # It inverts this for the right hemisphere (logical_not).
        hemi_mask = np.zeros(seg_data.shape, dtype=np.int8)
        hemi_mask[left_x[:, None, None] & brain_mask] = 1
        nib.save(nib.Nifti1Image(hemi_mask, affine), str(surfaces_dir / "hemi_mask.nii.gz"))
        session_log(self.session_id, "[SimNIBS] Created surfaces/hemi_mask.nii.gz (Yleft: binary left-brain)")

        # cereb_mask.nii.gz → passed as --Ymaskhemis_path (Ymaskhemis in createCS).
        # createCS uses: Ymfs = Ymf * (Ymaskhemis == 1) for lh, * (Ymaskhemis == 2) for rh.
        # Must be 1=left cerebrum, 2=right cerebrum (NOT all zeros, or mask is empty → crash).
        cereb_mask = np.zeros(seg_data.shape, dtype=np.int8)
        cereb_mask[left_x[:, None, None] & brain_mask] = 1
        cereb_mask[(~left_x[:, None, None]) & brain_mask] = 2
        nib.save(nib.Nifti1Image(cereb_mask, affine), str(surfaces_dir / "cereb_mask.nii.gz"))
        session_log(self.session_id, "[SimNIBS] Created surfaces/cereb_mask.nii.gz (Ymaskhemis: 1=left, 2=right)")

        # Run charm --surfaces --mesh from the model working dir (parent of m2m_subject/)
        session_log(self.session_id, "[SimNIBS] charm --surfaces --mesh: building surfaces + EEG positions…")
        cmd = _charm_cmd() + ["--surfaces", "--mesh", SUBJECT]
        self._run_proc(cmd, "charm-surfaces-mesh", model_m2m.parent, deadline)
        session_log(self.session_id, "[SimNIBS] Surfaces + EEG positions ready.")

    # ------------------------------------------------------------------
    def build_mesh(self, seg_path: Path) -> Path:
        """
        Build a FEM mesh from the remapped segmentation labels.

        Steps:
          1. Ensure shared --initatlas base (fast, once per session).
          2. Copy initatlas base into model working directory.
          3. Rewrite settings.ini paths to model directory.
          4. Inject labels + run charm --surfaces --mesh (per model):
             builds subject-accurate surfaces and EEG positions from our labels.
          5. Save remapped labels as custom_tissues.nii.gz for post-processing.
          6. Run meshmesh to build the FEM mesh from custom labels.
        """
        deadline = time.time() + SIMNIBS_TIMEOUT_SECONDS
        self._emit("simnibs_charm", 5)

        # Step 1 — shared --initatlas base (fast, ~30s)
        base_m2m = self._ensure_initatlas_base()
        self._emit("simnibs_charm_register", 12)

        # Step 2 — copy initatlas base into model working directory
        model_m2m = self.work_dir / f"m2m_{SUBJECT}"
        if model_m2m.exists():
            shutil.rmtree(str(model_m2m))
        shutil.copytree(str(base_m2m), str(model_m2m))
        session_log(self.session_id, f"[SimNIBS] Copied atlas base → {model_m2m}")

        # Step 3 — rewrite absolute paths in settings.ini to model dir
        settings_file = model_m2m / "settings.ini"
        if settings_file.exists():
            base_work_str  = str(simnibs_charm_base_dir(self.session_id))
            model_work_str = str(self.work_dir)
            content = settings_file.read_text()
            content = content.replace(base_work_str, model_work_str)
            settings_file.write_text(content)

        # Step 4 — inject DL labels + charm --surfaces --mesh (per model)
        self._emit("simnibs_charm_surface", 15)
        self._inject_labels_and_run_charm(model_m2m, seg_path, deadline)
        self._emit("simnibs_charm_done", 55)

        # Step 5 — save custom labels as custom_tissues.nii.gz for post-processing
        custom_tissues = model_m2m / "custom_tissues.nii.gz"
        shutil.copy2(str(seg_path), str(custom_tissues))
        session_log(self.session_id, f"[SimNIBS] Custom labels → {custom_tissues}")

        # Step 6 — meshmesh
        custom_mesh = self.work_dir / f"{SUBJECT}_custom_mesh.msh"
        self._emit("simnibs_charm_mesh", 58)
        session_log(self.session_id, "[SimNIBS] meshmesh: building FEM mesh from custom labels…")
        cmd = _meshmesh_cmd() + [str(seg_path), str(custom_mesh), "--voxsize_meshing", "0.5"]
        self._run_proc(cmd, "meshmesh", self.work_dir, deadline)

        if not custom_mesh.exists():
            raise FileNotFoundError(f"meshmesh did not produce expected mesh: {custom_mesh}")

        self._emit("simnibs_charm_done", 70)
        session_log(self.session_id, f"[SimNIBS] Mesh ready → {custom_mesh}")
        return custom_mesh

    # ------------------------------------------------------------------
    def run_fem(self, mesh_path: Path) -> None:
        """
        Configure and run a SimNIBS tDCS j-field FEM simulation.
        Delegates to run_fem.py via the SimNIBS Python interpreter.
        Progress is approximated via heartbeat ticks during the blocking solve.
        """
        import json

        self._emit("simnibs_fem_setup", 73)
        session_log(self.session_id, "[SimNIBS] Configuring tDCS j-field session…")

        fem_dir  = self.work_dir / "fem"
        fem_dir.mkdir(exist_ok=True)

        m2m_dir  = self.work_dir / f"m2m_{SUBJECT}"
        recipe   = self.payload.get("recipe") or ["F3", 2, "F4", -2]
        electype = self.payload.get("electrode_type") or []

        simnibs_python = _find_simnibs_python()
        fem_script     = Path(__file__).parent / "run_fem.py"
        cmd = [
            simnibs_python,
            str(fem_script),
            str(mesh_path),
            str(m2m_dir),
            str(fem_dir),
            json.dumps(recipe),
            json.dumps(electype),
        ]
        session_log(self.session_id, f"[SimNIBS] cmd: {' '.join(cmd)}")

        self._emit("simnibs_fem_solve", 76)
        session_log(self.session_id, "[SimNIBS] FEM solve running…")

        solve_done  = threading.Event()
        solve_error: list[Exception] = []

        def _solve():
            try:
                proc = subprocess.Popen(
                    cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    cwd=str(self.work_dir),
                    env=_simnibs_env(),
                )
                for line in proc.stdout:
                    line = line.rstrip()
                    if line:
                        session_log(self.session_id, f"[fem] {line}")
                proc.wait()
                if proc.returncode != 0:
                    solve_error.append(
                        RuntimeError(f"SimNIBS FEM solve exited with code {proc.returncode}")
                    )
            except Exception as exc:
                solve_error.append(exc)
            finally:
                solve_done.set()

        threading.Thread(target=_solve, daemon=True).start()

        # Heartbeat: 76 → 92 % while waiting (every 10 s)
        progress = 76
        deadline = time.time() + SIMNIBS_TIMEOUT_SECONDS
        while not solve_done.wait(timeout=10):
            if time.time() > deadline:
                raise TimeoutError("SimNIBS FEM solve timed out")
            progress = min(92, progress + 2)
            self._emit("simnibs_fem_solve", progress)

        if solve_error:
            raise solve_error[0]

        self._emit("simnibs_post", 94)
        session_log(self.session_id, "[SimNIBS] FEM solve complete, collecting outputs…")

    # ------------------------------------------------------------------
    def collect_outputs(self) -> None:
        """
        Find SimNIBS output NIfTIs produced by run_fem.py and copy them to
        the canonical outputs/ directory.

        Expected files (in fem/ or fem/subject_volumes/):
          subject_TDCS_1_magnJ.nii.gz  — total current density magnitude
          wm_magnJ.nii.gz              — WM-masked magnJ
          gm_magnJ.nii.gz              — GM-masked magnJ
          wm_gm_magnJ.nii.gz           — WM+GM-masked magnJ
        """
        fem_dir = self.work_dir / "fem"
        out_dir = self.work_dir / "outputs"
        out_dir.mkdir(exist_ok=True)

        all_niftis = list(fem_dir.rglob("*.nii.gz"))
        session_log(
            self.session_id,
            f"[SimNIBS] NIfTIs in fem/: {[str(f.relative_to(fem_dir)) for f in all_niftis]}"
        )

        candidates: dict[str, list[str]] = {
            "magnJ":       [f"{SUBJECT}_TDCS_1_magnJ.nii.gz"],
            "wm_magnJ":    ["wm_magnJ.nii.gz"],
            "gm_magnJ":    ["gm_magnJ.nii.gz"],
            "wm_gm_magnJ": ["wm_gm_magnJ.nii.gz"],
        }

        found: dict[str, Path] = {}
        for output_type, fnames in candidates.items():
            for fname in fnames:
                matches = list(fem_dir.rglob(fname))
                if matches:
                    dest = out_dir / f"{output_type}.nii.gz"
                    shutil.copy2(matches[0], dest)
                    found[output_type] = dest
                    session_log(self.session_id, f"[SimNIBS] Collected {output_type} → {dest}")
                    break

        if "magnJ" not in found:
            raise FileNotFoundError(
                f"SimNIBS finished but required output 'magnJ' is missing. "
                f"Found NIfTIs: {[f.name for f in all_niftis]}"
            )
        for optional in ("wm_magnJ", "gm_magnJ", "wm_gm_magnJ"):
            if optional not in found:
                session_log(self.session_id, f"[SimNIBS] {optional} not found — continuing")

    # ------------------------------------------------------------------
    def run(self):
        """Full pipeline: remap seg → charm base → mesh → FEM → collect."""
        try:
            set_simnibs_status(self.session_id, "running", self.model_name, self.run_id)
            self._emit("simnibs_start", 2)

            seg_path = self.prepare_segmentation()
            self._emit("simnibs_seg_ready", 5)

            mesh_path = self.build_mesh(seg_path)
            self.run_fem(mesh_path)
            self.collect_outputs()

            set_simnibs_status(self.session_id, "complete", self.model_name, self.run_id)
            self._emit("simnibs_complete", 100)
            session_log(self.session_id, "[SimNIBS] Completed successfully")

        except Exception as exc:
            log_error(self.session_id, f"[SimNIBS] Failed: {exc}")
            set_simnibs_status(self.session_id, "error", self.model_name, self.run_id)
            self._emit("simnibs_error", -1, detail=str(exc))
            raise
