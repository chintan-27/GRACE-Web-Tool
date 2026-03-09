"""
ROASTRunner — prepares the working directory, invokes the compiled ROAST binary,
parses stdout for step progress, and emits SSE events.
"""

import gzip
import json
import os
import pty
import re
import select
import shutil
import signal
import subprocess
import time
from pathlib import Path

import nibabel as nib
import numpy as np
from scipy import ndimage as ndi

from config import ROAST_BUILD_DIR, MATLAB_RUNTIME, ROAST_TIMEOUT_SECONDS
from runtime.roast_config import build_roast_config, DEFAULT_MESH_OPTIONS, FINE_MESH_OPTIONS
from runtime.session import (
    session_input_native,
    session_input_fs,
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
    # --- NN mode: seg8 generation only (gen_seg8 in roast_run.m) ---
    ("ROAST_RUN: Generating seg8",              "roast_seg8",              5),
    ("ROAST_RUN: seg8 saved",                   "roast_seg8_done",         8),

    # --- SPM mode: full segmentation via spm_preproc_run ---
    ("ROAST_RUN: SPM segmentation (direct",     "roast_spm_seg_start",     4),
    ("ROAST_RUN: STEP 1 running spm_preproc",   "roast_spm_seg_run",       5),
    ("ROAST_RUN: SPM segmentation complete",    "roast_spm_seg_done",      8),

    # --- Step 1 / Step 2 banners (may appear in SPM mode) ---
    ("STEP 1 (out of 6): SEGMENT",              "roast_step_seg",          5),
    ("STEP 2 (out of 6): SEGMENTATION TOUCHUP", "roast_step_touchup",      9),
    ("MRI ALREADY SEGMENTED",                   "roast_step_seg_skip",     5),
    ("SEGMENTATION TOUCHUP ALREADY DONE",       "roast_step_touchup_skip", 9),

    # --- Step 2.5: CSF fix ---
    ("STEP 2.5",                                "roast_step_csf_fix",     10),

    # --- Step 3: Electrode placement ---
    ("STEP 3",                            "roast_step_electrode",   12),
    ("measuring head size",               "roast_step_el_measure",  14),
    ("wearing the cap",                   "roast_step_el_cap",      16),
    ("computing pad layers",               "roast_step_el_dilation", 17),
    ("dilating scalp for gel layer",      "roast_step_el_gel_dil",  17),
    ("gel layer done. dilating for electrode", "roast_step_el_elec_dil", 18),
    ("pad layers",                        "roast_step_el_dil_done", 18),
    ("placing electrode",                 "roast_step_el_placing",  19),
    ("% done",                            "roast_step_el_progress", 21),
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
]
# Note: roast_complete (100%) is emitted after collect_outputs() succeeds,
# not from stdout matching, to avoid a stale event being left in the Redis
# queue when the SSE stream has already closed on the first emission.

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


# Voxels to pad on all six sides before ROAST runs.
# FreeSurfer-conformed volumes are 256³; temporal (T7/T8), mastoid (TP9/TP10),
# and occipital (O1/O2) electrode positions sit within ~10 voxels of the image
# boundary.  Padding prevents "goes out of image boundary" errors without any
# change to the compiled MATLAB binary.
_ZERO_PAD_VOXELS = 10


def _zero_pad_nii(img: nib.Nifti1Image, pad: int) -> nib.Nifti1Image:
    """Return a new NIfTI padded by *pad* zero-voxels on all six sides.

    The affine is updated so world coordinates of existing tissue are preserved:
    new voxel [0,0,0] maps to old voxel [-pad,-pad,-pad] in world space.
    """
    data = np.asarray(img.dataobj)
    padded = np.pad(data, pad, mode="constant", constant_values=0)
    affine = img.affine.copy()
    # Translate origin: shift = R @ [-pad, -pad, -pad] where R is the rotation/scale part.
    affine[:3, 3] = affine[:3, 3] + affine[:3, :3] @ np.array([-pad, -pad, -pad], dtype=float)
    return nib.Nifti1Image(padded.astype(data.dtype), affine)


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

        # Use the T1 that matches the segmentation mask's coordinate space.
        # FS models produce masks in FreeSurfer conformed space (256³ 1mm isotropic);
        # native models produce masks in the original scanner space.
        # Feeding ROAST a T1 in the wrong space causes a silently misaligned mesh.
        t1_nii = self.work_dir / "T1.nii"
        if self.model_name.endswith("-fs"):
            t1_fs = session_input_fs(self.session_id)
            if t1_fs.exists():
                shutil.copy(str(t1_fs), str(t1_nii))
                session_log(self.session_id, f"[ROAST] T1 copied from FS space → {t1_nii}")
            else:
                # Input was uploaded already in FS space (ConvertToFS=False);
                # mri_convert was skipped so input_fs.nii was never written —
                # the native path holds the FS-space file directly.
                t1_gz = session_input_native(self.session_id)
                with gzip.open(t1_gz, "rb") as f_in, open(t1_nii, "wb") as f_out:
                    shutil.copyfileobj(f_in, f_out)
                session_log(self.session_id, f"[ROAST] T1 gunzipped from native path (pre-converted FS input) → {t1_nii}")
        else:
            t1_gz = session_input_native(self.session_id)
            with gzip.open(t1_gz, "rb") as f_in, open(t1_nii, "wb") as f_out:
                shutil.copyfileobj(f_in, f_out)
            session_log(self.session_id, f"[ROAST] T1 gunzipped from native space → {t1_nii}")

        # ---------------------------------------------------------------
        # T1: reorient to RAS + zero-pad in a single load/save pass.
        #
        # WHY single pass: nib.load on an uncompressed .nii uses np.memmap.
        # Writing back to the same path while the mmap is still open blocks
        # indefinitely (mmap deadlock), causing a 9+ minute hang.
        # Forcing the data into a new in-memory array (np.asarray(...).copy())
        # before saving eliminates the file dependency.
        #
        # WHY RAS reorient: mri_convert --conform outputs LIA orientation.
        # ROAST creates T1_ras.nii from T1.nii before checking bypass files.
        # Bypass masks must be in T1_ras space (RAS).  Pre-writing LIA masks
        # with RAS names causes a coordinate mismatch → disoriented electrodes.
        # Reorienting T1 here makes T1 ≡ T1_ras so masks we write are aligned.
        # ---------------------------------------------------------------
        t1_raw = nib.load(str(t1_nii))
        orig_axcodes = nib.aff2axcodes(t1_raw.affine)
        # Force data into RAM — np.asarray() on a mmap'd file returns a view,
        # .copy() creates an independent array so the file handle can be released.
        t1_img = nib.Nifti1Image(
            np.asarray(t1_raw.dataobj).copy(), t1_raw.affine, t1_raw.header
        )
        del t1_raw
        t1_ras = nib.as_closest_canonical(t1_img)
        del t1_img
        # Zero-pad and save T1 once (no re-read of T1.nii)
        t1_padded = _zero_pad_nii(t1_ras, _ZERO_PAD_VOXELS)
        del t1_ras
        nib.save(t1_padded, str(t1_nii))
        session_log(self.session_id,
                    f"[ROAST] T1 reoriented to RAS (was {orig_axcodes}), "
                    f"zero-padded by {_ZERO_PAD_VOXELS} voxels → {t1_nii}")

        # ---------------------------------------------------------------
        # Mask: reorient to RAS → morphological processing → zero-pad →
        # save both mask files in a single load/save pass.
        #
        # The .nii.gz source has no mmap so no deadlock risk there, but we
        # still combine all operations to avoid redundant I/O.
        # ---------------------------------------------------------------
        mask_gz = model_output_path(self.session_id, self.model_name)
        mask_nii = self.work_dir / "T1_T1orT2_masks.nii"
        mask_raw = nib.load(mask_gz)
        mask_ras_img = nib.as_closest_canonical(mask_raw)
        del mask_raw
        # Cast to uint8 for MATLAB cgalmesher; keep RAS affine
        data = np.asarray(mask_ras_img.dataobj, dtype=np.uint8)
        mask_affine = mask_ras_img.affine.copy()
        del mask_ras_img

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

        # --- Full 3D scalp closing (all slices, all axes) ---
        # The sagittal close above only covers cx±25 slices (needed for fitCap2individual).
        # Frontal/parietal scalp (where F3/F4 electrodes land) may still have holes.
        # A 3D close with iterations=5 (≈5 voxel radius) bridges those without
        # overwriting any existing tissue labels (only converts background=0 to skin=9).
        skin = data == 9
        struct3d = ndi.generate_binary_structure(3, 1)  # 6-connectivity 3D
        skin_closed_3d = ndi.binary_closing(skin, structure=struct3d, iterations=5)
        new_skin_3d = skin_closed_3d & ~skin & (data == 0)
        data[new_skin_3d] = 9
        session_log(self.session_id, "[ROAST] Skin label fully closed in 3D")

        # --- Per-tissue binary fill holes (axial slices, labels 1–11) ---
        # Fills enclosed background voids inside each tissue (WM, GM, bone, etc.)
        # without touching voxels already claimed by another label.
        for label in range(1, 12):
            tissue = data == label
            if not tissue.any():
                continue
            for zi in range(data.shape[2]):
                if not tissue[:, :, zi].any():
                    continue
                filled = ndi.binary_fill_holes(tissue[:, :, zi])
                new_vox = filled & ~tissue[:, :, zi] & (data[:, :, zi] == 0)
                data[:, :, zi][new_vox] = label
        session_log(self.session_id, "[ROAST] Tissue holes filled per axial slice")

        seg_source = self.payload.get("seg_source", "nn")

        if seg_source == "spm":
            # SPM mode: do NOT pre-write the mask or dummy c1 files.
            # roast_run.m will call run_spm_seg() to run the full SPM pipeline,
            # then ROAST's segTouchup (Step 2) will generate the masks file.
            session_log(self.session_id, "[ROAST] SPM mode: skipping NN mask and c1 bypass — ROAST will run SPM segmentation")
        else:
            # NN mode: zero-pad the processed mask data, then save both mask files
            # (T1_T1orT2_masks.nii and T1_ras_T1orT2_masks.nii) in one pass.
            pad = _ZERO_PAD_VOXELS
            data_padded = np.pad(data, pad, mode="constant", constant_values=0).astype(np.uint8)
            # Compute padded affine: new voxel[0,0,0] maps to old voxel[-pad,-pad,-pad]
            padded_affine = mask_affine.copy()
            padded_affine[:3, 3] = (
                mask_affine[:3, 3] + mask_affine[:3, :3] @ np.array([-pad, -pad, -pad], dtype=float)
            )
            padded_mask_img = nib.Nifti1Image(data_padded, padded_affine)
            mask_ras_nii = self.work_dir / "T1_ras_T1orT2_masks.nii"
            nib.save(padded_mask_img, str(mask_nii))
            nib.save(padded_mask_img, str(mask_ras_nii))
            session_log(self.session_id,
                        f"[ROAST] Masks saved (RAS, zero-padded by {pad} voxels) → "
                        f"{mask_nii.name} + {mask_ras_nii.name}")

            # Bypass ROAST Step 1 (SPM segmentation) by pre-creating dummy c1 files.
            # ROAST first reorients T1.nii to RAS space → T1_ras.nii, then checks for
            # the c1 file AFTER that reorientation. The bypass check therefore looks for
            # c1T1_ras_T1orT2.nii, not c1T1_T1orT2.nii. We create both to be safe.
            for dummy_name in ("c1T1_T1orT2.nii", "c1T1_ras_T1orT2.nii"):
                shutil.copy(t1_nii, self.work_dir / dummy_name)
            session_log(self.session_id, "[ROAST] Dummy c1 files written (bypasses SPM step 1)")

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
            seg_source=self.payload.get("seg_source", "nn"),
        )
        # Remember the tag so collect_outputs() can locate the correct output files.
        self.sim_tag = cfg["simulationtag"]
        config_path = self.work_dir / "config.json"
        with open(config_path, "w") as f:
            json.dump(cfg, f, indent=2)
        recipe_str = " ".join(str(x) for x in cfg.get("recipe", []))
        session_log(self.session_id, f"[ROAST] Config written → {config_path} | recipe={recipe_str} | tag={self.sim_tag}")
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
        # Binary compiled with -nodisplay so MCR needs no X server.
        # xvfb-run breaks the pty slave fd chain causing stdout block-buffering.
        return cmd

    # ------------------------------------------------------------------
    def _run_subprocess(self, cmd: list[str], progress_start: int = 5) -> tuple[str | None, str | None, int]:
        """
        Launch the ROAST binary, stream stdout, and parse progress events.

        Returns (failure_type, error_message, last_progress).
        failure_type is "electrode_mesh", "fem_convergence", or None (success).
        error_message is non-None when the process exited non-zero.
        """
        import threading as _threading
        _home = Path(os.environ.get("HOME", str(Path.home())))
        mcr_cache = _home / ".MathWorks" / "MatlabRuntimeCache"

        def _chmod_mcr(stop_evt: "_threading.Event"):
            while not stop_evt.is_set():
                if mcr_cache.exists():
                    for _p in mcr_cache.rglob("*.mexa64"):
                        try:
                            _p.chmod(_p.stat().st_mode | 0o111)
                        except OSError:
                            pass
                    for _p in mcr_cache.rglob("*"):
                        if _p.is_file() and not _p.suffix:
                            try:
                                _p.chmod(_p.stat().st_mode | 0o111)
                            except OSError:
                                pass
                stop_evt.wait(timeout=0.5)

        _chmod_stop = _threading.Event()
        _threading.Thread(target=_chmod_mcr, args=(_chmod_stop,), daemon=True).start()

        import os as _os
        from config import ROAST_MAX_WORKERS as _MAX_W
        try:
            total_cpus = len(_os.sched_getaffinity(0))
        except AttributeError:
            total_cpus = _os.cpu_count() or 4
        n_threads = max(1, total_cpus // _MAX_W)
        omp_env = _os.environ.copy()
        omp_env["OMP_NUM_THREADS"] = str(n_threads)

        master_fd, slave_fd = pty.openpty()
        proc = subprocess.Popen(
            cmd,
            stdout=slave_fd,
            stderr=slave_fd,
            stdin=subprocess.DEVNULL,
            cwd=str(self.work_dir),
            env=omp_env,
            start_new_session=True,
            close_fds=True,
        )
        os.close(slave_fd)

        def _kill_proc():
            try:
                os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
            except ProcessLookupError:
                pass

        last_progress = progress_start
        deadline = time.time() + ROAST_TIMEOUT_SECONDS
        STALL_TIMEOUT = 1800
        CANCEL_POLL   = 5

        last_stdout_time = time.time()
        last_roast_error: str | None = None
        failure_type: str | None = None   # "electrode_mesh" | "fem_convergence" | None
        _buf = b""

        while True:
            try:
                ready, _, _ = select.select([master_fd], [], [], CANCEL_POLL)
            except (ValueError, OSError):
                break

            if not ready:
                if redis_client.get(f"cancel:{self.session_id}"):
                    _kill_proc()
                    raise RuntimeError("Job cancelled by user")
                if time.time() - last_stdout_time > STALL_TIMEOUT:
                    _kill_proc()
                    raise TimeoutError(f"ROAST stalled: no stdout for {STALL_TIMEOUT // 60} min")
                if time.time() > deadline:
                    _kill_proc()
                    raise TimeoutError(f"ROAST timed out after {ROAST_TIMEOUT_SECONDS}s")
                continue

            try:
                chunk = os.read(master_fd, 4096)
            except OSError:
                break

            if not chunk:
                break

            last_stdout_time = time.time()
            _buf += chunk

            while b"\n" in _buf:
                raw_line, _buf = _buf.split(b"\n", 1)
                line = raw_line.decode("utf-8", errors="replace").strip("\r")
                if not line:
                    continue

                session_log(self.session_id, f"[ROAST stdout] {line}")

                ll = line.lower()
                if "cfg_mlbatch_appcfg_master" in line or ("Unrecognized function" in line and "cfg_" in line):
                    last_roast_error = "SPM segmentation step failed — compiled MATLAB cannot run SPM's batch system."
                elif "was not meshed properly" in line:
                    last_roast_error = line.strip()
                    failure_type = "electrode_mesh"
                elif "convergence not reached" in ll or ("maximum number of iterations" in ll and "reached" in ll):
                    last_roast_error = "FEM solver failed to converge."
                    failure_type = "fem_convergence"
                elif "matrix is singular" in ll or ("singular" in ll and "working precision" in ll):
                    last_roast_error = "FEM solver hit a singular matrix."
                    failure_type = "fem_convergence"
                elif "nan" in ll and ("solution" in ll or "residual" in ll or "result" in ll):
                    last_roast_error = "FEM solution contains NaN — solver diverged."
                    failure_type = "fem_convergence"
                elif "error in roast>runfem" in ll or "getdp returned" in ll:
                    last_roast_error = f"FEM solver error: {line.strip()}"
                    failure_type = "fem_convergence"
                elif "Error using" in line or "Unrecognized function or variable" in line:
                    last_roast_error = line.strip()

                if redis_client.get(f"cancel:{self.session_id}"):
                    _kill_proc()
                    raise RuntimeError("Job cancelled by user")

                matched = False
                for substring, event_name, pct in STEP_MAP:
                    if substring in line:
                        if pct > last_progress:
                            self._emit(event_name, pct)
                            last_progress = pct
                        matched = True
                        break

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
                _kill_proc()
                raise TimeoutError(f"ROAST timed out after {ROAST_TIMEOUT_SECONDS}s")

        try:
            os.close(master_fd)
        except OSError:
            pass

        _chmod_stop.set()
        proc.wait()

        if proc.returncode != 0:
            error = last_roast_error or (
                f"ROAST exited with code {proc.returncode} — check session logs."
            )
            return failure_type, error, last_progress

        return None, None, last_progress

    # ------------------------------------------------------------------
    def _clean_roast_intermediates(self):
        """Delete ROAST-generated mesh/FEM files so a retry starts fresh."""
        patterns = ["*.msh", "sim_*", "*.msh.mat"]
        for pattern in patterns:
            for p in self.work_dir.glob(pattern):
                try:
                    if p.is_dir():
                        shutil.rmtree(p)
                    else:
                        p.unlink()
                except OSError:
                    pass
        session_log(self.session_id, "[ROAST] Cleaned intermediate files for retry")

    # ------------------------------------------------------------------
    def _escalate_mesh(self, failure_type: str | None = None):
        """
        Tighten the mesh for the retry attempt.

        Electrode mesh failures require a significantly finer mesh (maxvol=5) to capture
        the 3mm electrode layer — standard mesh (maxvol=10) is often still not enough.
        FEM convergence failures are usually fixed by going fast→standard.
        """
        if failure_type == "electrode_mesh":
            # Electrode not meshed properly: escalate to standard mesh (maxvol=10).
            self.payload = {**self.payload, "quality": "standard", "mesh_options": None}
            session_log(self.session_id, "[ROAST] Mesh escalated (electrode failure): fast → standard")
        else:
            # FEM convergence / other: standard escalation
            current_quality = self.payload.get("quality", "standard")
            if current_quality == "fast":
                self.payload = {**self.payload, "quality": "standard", "mesh_options": None}
                session_log(self.session_id, "[ROAST] Mesh escalated: fast → standard")
            else:
                current_opts = self.payload.get("mesh_options") or DEFAULT_MESH_OPTIONS.copy()
                tighter = {**current_opts, "maxvol": max(5, current_opts.get("maxvol", 10) // 2)}
                self.payload = {**self.payload, "mesh_options": tighter}
                session_log(self.session_id, f"[ROAST] Mesh escalated: maxvol → {tighter['maxvol']}")

    # ------------------------------------------------------------------
    def run(self):
        """
        Full ROAST pipeline: prepare → write config → launch binary → stream progress.
        Automatically retries once with a refined mesh on FEM/meshing failures.
        """
        try:
            set_roast_status(self.session_id, "running", self.model_name)
            self._emit("roast_start", 2)

            t1_path = self.prepare_working_directory()
            self._emit("roast_prepare", 5)

            for attempt in range(2):  # at most one automatic retry
                config_path = self.write_config(t1_path)
                cmd = self.build_command(config_path)
                session_log(self.session_id, f"[ROAST] Launching (attempt {attempt + 1}): {' '.join(cmd)}")

                failure_type, error, last_progress = self._run_subprocess(
                    cmd, progress_start=5 if attempt == 0 else 10
                )

                if error and failure_type and attempt == 0:
                    session_log(self.session_id, f"[ROAST] Retryable failure ({failure_type}): {error}. Escalating mesh.")
                    self._emit("roast_retry", last_progress,
                               detail=f"{error} — retrying with refined mesh…")
                    self._clean_roast_intermediates()
                    self._escalate_mesh(failure_type)
                    continue  # retry

                if error:
                    raise RuntimeError(error)
                break  # success

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
            path = roast_output_path(self.session_id, output_type, self.model_name, self.sim_tag)
            if not path.exists():
                missing.append(str(path))

        if missing:
            raise FileNotFoundError(
                f"ROAST finished but output files are missing: {missing}"
            )
        session_log(self.session_id, "[ROAST] All output files verified")
