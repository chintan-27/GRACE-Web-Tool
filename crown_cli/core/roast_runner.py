"""
CLIRoastRunner — port of api/runtime/roast_runner.py for the CROWN CLI.

Differences from the web backend:
- Progress emitted via ProgressWriter (JSONL) instead of Redis/SSE
- Cancellation detected via sentinel file (job_dir/cancel) instead of Redis
- Paths resolved relative to session_dir (user-visible output directory)
- T1 path passed directly; no FreeSurfer-model branch
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
import threading
import time
from pathlib import Path

import nibabel as nib
import numpy as np
from scipy import ndimage as ndi

from crown_cli.core.config import CrownConfig
from crown_cli.core.progress import ProgressWriter
from crown_cli.core.roast_config import build_roast_config, DEFAULT_MESH_OPTIONS


# Maps stdout substrings → (event_name, progress_pct). First match wins per line.
STEP_MAP = [
    ("ROAST_RUN: Generating seg8",              "roast_seg8",              5),
    ("ROAST_RUN: seg8 saved",                   "roast_seg8_done",         8),
    ("ROAST_RUN: SPM segmentation (direct",     "roast_spm_seg_start",     4),
    ("ROAST_RUN: STEP 1 running spm_preproc",   "roast_spm_seg_run",       5),
    ("ROAST_RUN: SPM segmentation complete",    "roast_spm_seg_done",      8),
    ("STEP 1 (out of 6): SEGMENT",              "roast_step_seg",          5),
    ("STEP 2 (out of 6): SEGMENTATION TOUCHUP", "roast_step_touchup",      9),
    ("MRI ALREADY SEGMENTED",                   "roast_step_seg_skip",     5),
    ("SEGMENTATION TOUCHUP ALREADY DONE",       "roast_step_touchup_skip", 9),
    ("STEP 2.5",                                "roast_step_csf_fix",     10),
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
    ("STEP 4",                            "roast_step_mesh",        25),
    ("Mesh sizes are",                    "roast_step_mesh_sizing", 28),
    ("surface and volume meshes complete","roast_step_mesh_done",   38),
    ("saving mesh",                       "roast_step_mesh_saving", 40),
    ("STEP 5",                            "roast_step_solve",       42),
    ("Solve[Sys_Ele]",                    "roast_step_solve_fem",   65),
    ("SaveSolution",                      "roast_step_solve_save",  68),
    ("STEP 6",                            "roast_step_postprocess", 75),
    ("converting the results",            "roast_step_post_convert",79),
    ("Computing Jroast",                  "roast_step_post_jroast", 85),
    ("saving the final results",          "roast_step_post_save",   90),
    ("ALL DONE ROAST",                    "roast_step_post_done",   95),
]

_GETDP_PRE  = re.compile(r"(\d+)%\s+:\s+Pre-processing")
_GETDP_GEN  = re.compile(r"(\d+)%\s+:\s+Processing \(Generate\)")
_GETDP_POST = re.compile(r"(\d+)%\s+:\s+Post-processing")

_GETDP_RANGES = [
    (_GETDP_PRE,  42, 52, "roast_step_solve_pre"),
    (_GETDP_GEN,  52, 62, "roast_step_solve_gen"),
    (_GETDP_POST, 65, 73, "roast_step_solve_post"),
]

_ZERO_PAD_VOXELS = 10


def _resolve_mcr(base: Path) -> Path:
    """Handle MCR installers that nest libraries under a version subdirectory."""
    if (base / "runtime").is_dir():
        return base
    if base.is_dir():
        for sub in sorted(base.iterdir()):
            if sub.is_dir() and (sub / "runtime").is_dir():
                return sub
    return base


def _zero_pad_nii(img: nib.Nifti1Image, pad: int) -> nib.Nifti1Image:
    """Return a new NIfTI zero-padded by *pad* voxels on all six sides, affine updated."""
    data = np.asarray(img.dataobj)
    padded = np.pad(data, pad, mode="constant", constant_values=0)
    affine = img.affine.copy()
    affine[:3, 3] = affine[:3, 3] + affine[:3, :3] @ np.array([-pad, -pad, -pad], dtype=float)
    return nib.Nifti1Image(padded.astype(data.dtype), affine)


class CLIRoastRunner:
    def __init__(
        self,
        job_dir: Path,
        session_dir: Path,
        t1_path: Path,
        model_name: str,
        payload: dict,
        cfg: CrownConfig,
    ):
        self.job_dir = job_dir
        self.session_dir = session_dir
        self.t1_path = t1_path
        self.model_name = model_name
        self.payload = payload
        self.cfg = cfg
        self.run_id = payload.get("run_id", "default")

        # Apply path overrides stored in meta (set by simulate CLI flags)
        if "roast_build_dir" in payload:
            cfg.roast_build_dir = Path(payload["roast_build_dir"])
        if "matlab_runtime" in payload:
            cfg.matlab_runtime = Path(payload["matlab_runtime"])
        self.work_dir = session_dir / "roast" / model_name / self.run_id
        self.sim_tag: str = ""
        self._writer = ProgressWriter(job_dir)
        self._cancel_sentinel = job_dir / "cancel"

    def _emit(self, event: str, progress: int, detail: str | None = None) -> None:
        kwargs = {"model": self.model_name, "progress": progress}
        if detail:
            kwargs["detail"] = detail
        self._writer.emit(event, **kwargs)

    def _log(self, msg: str) -> None:
        self._writer.emit("log", message=msg)

    # ------------------------------------------------------------------
    def _prepared_cache_dir(self) -> Path:
        seg_source = self.payload.get("seg_source", "nn")
        return self.work_dir.parent / f"_prepared_{seg_source}"

    def _restore_from_cache(self, cache_dir: Path, t1_nii: Path) -> bool:
        if not (cache_dir / "T1.nii").exists():
            return False
        for src in cache_dir.iterdir():
            shutil.copy2(str(src), str(self.work_dir / src.name))
        self._log(f"[ROAST] Reused prepared files from cache → {cache_dir}")
        return True

    def _save_to_cache(self, cache_dir: Path) -> None:
        cache_dir.mkdir(parents=True, exist_ok=True)
        for name in ("T1.nii", "T1_T1orT2_masks.nii", "T1_ras_T1orT2_masks.nii",
                     "c1T1_T1orT2.nii", "c1T1_ras_T1orT2.nii"):
            src = self.work_dir / name
            if src.exists():
                shutil.copy2(str(src), str(cache_dir / name))
        self._log(f"[ROAST] Saved prepared files to cache → {cache_dir}")

    def prepare_working_directory(self) -> str:
        self._log("[ROAST] Preparing working directory")
        self.work_dir.mkdir(parents=True, exist_ok=True)

        t1_nii = self.work_dir / "T1.nii"
        cache_dir = self._prepared_cache_dir()
        if self._restore_from_cache(cache_dir, t1_nii):
            return str(t1_nii)

        # Decompress T1 into work dir
        t1_src = self.t1_path
        if str(t1_src).endswith(".gz"):
            with gzip.open(t1_src, "rb") as f_in, open(t1_nii, "wb") as f_out:
                shutil.copyfileobj(f_in, f_out)
        else:
            shutil.copy(str(t1_src), str(t1_nii))
        self._log(f"[ROAST] T1 copied → {t1_nii}")

        # RAS reorient + zero-pad in one pass (avoids mmap deadlock on re-read)
        t1_raw = nib.load(str(t1_nii))
        orig_axcodes = nib.aff2axcodes(t1_raw.affine)
        t1_img = nib.Nifti1Image(
            np.asarray(t1_raw.dataobj).copy(), t1_raw.affine, t1_raw.header
        )
        del t1_raw
        t1_ras = nib.as_closest_canonical(t1_img)
        del t1_img
        t1_padded = _zero_pad_nii(t1_ras, _ZERO_PAD_VOXELS)
        del t1_ras
        nib.save(t1_padded, str(t1_nii))
        self._log(
            f"[ROAST] T1 reoriented to RAS (was {orig_axcodes}), "
            f"zero-padded by {_ZERO_PAD_VOXELS} voxels → {t1_nii}"
        )

        # Load segmentation mask from session output
        mask_gz = self.session_dir / self.model_name / "output.nii.gz"
        mask_raw = nib.load(str(mask_gz))
        mask_ras_img = nib.as_closest_canonical(mask_raw)
        del mask_raw
        data = np.asarray(mask_ras_img.dataobj, dtype=np.uint8)
        mask_affine = mask_ras_img.affine.copy()
        del mask_ras_img

        # Sagittal skin closing — prevents fitCap2individual stall
        skin = data == 9
        struct2d = ndi.generate_binary_structure(2, 1)
        cx = data.shape[0] // 2
        for xi in range(max(0, cx - 25), min(data.shape[0], cx + 25)):
            if not skin[xi].any():
                continue
            skin_closed = ndi.binary_closing(skin[xi], structure=struct2d, iterations=40)
            new_skin = skin_closed & ~skin[xi] & (data[xi] == 0)
            data[xi, new_skin] = 9
            skin[xi] |= new_skin
        self._log("[ROAST] Skin label pre-closed at central sagittal slices")

        # Full 3D scalp closing
        skin = data == 9
        struct3d = ndi.generate_binary_structure(3, 1)
        skin_closed_3d = ndi.binary_closing(skin, structure=struct3d, iterations=5)
        new_skin_3d = skin_closed_3d & ~skin & (data == 0)
        data[new_skin_3d] = 9
        self._log("[ROAST] Skin label fully closed in 3D")

        # Per-tissue axial hole fill
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
        self._log("[ROAST] Tissue holes filled per axial slice")

        # Ensure blood label (6) exists — missing subdomain causes electrode mesh failure
        if not (data == 6).any():
            wm_coords = np.argwhere(data == 1)
            if wm_coords.size > 0:
                ci, cj, ck = wm_coords.mean(axis=0).astype(int)
            else:
                ci, cj, ck = (np.array(data.shape) // 2).tolist()
            r = 4
            i0, i1 = max(0, ci - r), min(data.shape[0], ci + r + 1)
            j0, j1 = max(0, cj - r), min(data.shape[1], cj + r + 1)
            k0, k1 = max(0, ck - r), min(data.shape[2], ck + r + 1)
            ii, jj, kk = np.ogrid[i0:i1, j0:j1, k0:k1]
            sphere = (ii - ci) ** 2 + (jj - cj) ** 2 + (kk - ck) ** 2 <= r * r
            sub = data[i0:i1, j0:j1, k0:k1]
            inject = sphere & (sub == 1)
            sub[inject] = 6
            self._log(
                f"[ROAST] Blood label absent — injected {int(inject.sum())} synthetic "
                f"blood voxels (sphere r={r}) at WM centroid ({ci},{cj},{ck})"
            )

        seg_source = self.payload.get("seg_source", "nn")
        mask_nii = self.work_dir / "T1_T1orT2_masks.nii"

        if seg_source == "roast":
            self._log("[ROAST] ROAST segmentation mode: skipping NN mask bypass")
        else:
            pad = _ZERO_PAD_VOXELS
            data_padded = np.pad(data, pad, mode="constant", constant_values=0).astype(np.uint8)
            padded_affine = mask_affine.copy()
            padded_affine[:3, 3] = (
                mask_affine[:3, 3] + mask_affine[:3, :3] @ np.array([-pad, -pad, -pad], dtype=float)
            )
            padded_mask_img = nib.Nifti1Image(data_padded, padded_affine)
            mask_ras_nii = self.work_dir / "T1_ras_T1orT2_masks.nii"
            nib.save(padded_mask_img, str(mask_nii))
            nib.save(padded_mask_img, str(mask_ras_nii))
            self._log(
                f"[ROAST] Masks saved (RAS, zero-padded by {pad} voxels) → "
                f"{mask_nii.name} + {mask_ras_nii.name}"
            )
            for dummy_name in ("c1T1_T1orT2.nii", "c1T1_ras_T1orT2.nii"):
                shutil.copy(str(t1_nii), str(self.work_dir / dummy_name))
            self._log("[ROAST] Dummy c1 files written (bypasses SPM step 1)")

        self._save_to_cache(cache_dir)
        return str(t1_nii)

    # ------------------------------------------------------------------
    def write_config(self, t1_path: str) -> Path:
        cfg_dict = build_roast_config(
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
        self.sim_tag = cfg_dict["simulationtag"]
        config_path = self.work_dir / "config.json"
        with open(config_path, "w") as f:
            json.dump(cfg_dict, f, indent=2)
        recipe_str = " ".join(str(x) for x in cfg_dict.get("recipe", []))
        self._log(f"[ROAST] Config written → {config_path} | recipe={recipe_str} | tag={self.sim_tag}")
        return config_path

    # ------------------------------------------------------------------
    def build_command(self, config_path: Path) -> list[str]:
        launcher = self.cfg.roast_build_dir / "run_roast_run.sh"
        if not launcher.exists():
            raise FileNotFoundError(
                f"ROAST launcher not found: {launcher}. "
                "Ensure roast build dir is correct in config."
            )
        mcr = _resolve_mcr(self.cfg.matlab_runtime)
        self._log(f"[ROAST] Using MCR at: {mcr}")
        return [str(launcher), str(mcr), str(config_path)]

    # ------------------------------------------------------------------
    def _run_subprocess(self, cmd: list[str], progress_start: int = 5) -> tuple[str | None, str | None, int]:
        """Launch ROAST binary, stream stdout, parse progress. Returns (failure_type, error, last_progress)."""
        _home = Path(os.environ.get("HOME", str(Path.home())))
        mcr_cache = _home / ".MathWorks" / "MatlabRuntimeCache"

        def _chmod_mcr(stop_evt: threading.Event):
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

        _chmod_stop = threading.Event()
        threading.Thread(target=_chmod_mcr, args=(_chmod_stop,), daemon=True).start()

        try:
            total_cpus = len(os.sched_getaffinity(0))
        except AttributeError:
            total_cpus = os.cpu_count() or 4
        n_threads = max(1, total_cpus // self.cfg.roast_max_workers)
        omp_env = os.environ.copy()
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
        deadline = time.time() + self.cfg.roast_timeout
        STALL_TIMEOUT = 1800
        CANCEL_POLL = 5

        last_stdout_time = time.time()
        last_roast_error: str | None = None
        failure_type: str | None = None
        _buf = b""

        while True:
            try:
                ready, _, _ = select.select([master_fd], [], [], CANCEL_POLL)
            except (ValueError, OSError):
                break

            if not ready:
                if self._cancel_sentinel.exists():
                    _kill_proc()
                    raise RuntimeError("Job cancelled by user")
                if time.time() - last_stdout_time > STALL_TIMEOUT:
                    _kill_proc()
                    raise TimeoutError(f"ROAST stalled: no stdout for {STALL_TIMEOUT // 60} min")
                if time.time() > deadline:
                    _kill_proc()
                    raise TimeoutError(f"ROAST timed out after {self.cfg.roast_timeout}s")
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

                self._log(f"[ROAST stdout] {line}")

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

                if self._cancel_sentinel.exists():
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
                raise TimeoutError(f"ROAST timed out after {self.cfg.roast_timeout}s")

        try:
            os.close(master_fd)
        except OSError:
            pass

        _chmod_stop.set()
        proc.wait()

        if proc.returncode != 0:
            error = last_roast_error or f"ROAST exited with code {proc.returncode}."
            return failure_type, error, last_progress

        return None, None, last_progress

    # ------------------------------------------------------------------
    def _clean_roast_intermediates(self):
        for pattern in ("*.msh", "sim_*", "*.msh.mat"):
            for p in self.work_dir.glob(pattern):
                try:
                    if p.is_dir():
                        shutil.rmtree(p)
                    else:
                        p.unlink()
                except OSError:
                    pass
        self._log("[ROAST] Cleaned intermediate files for retry")

    def _escalate_mesh(self, failure_type: str | None = None):
        if failure_type == "electrode_mesh":
            self.payload = {**self.payload, "quality": "standard", "mesh_options": None}
            self._log("[ROAST] Mesh escalated (electrode failure): fast → standard")
        else:
            current_quality = self.payload.get("quality", "standard")
            if current_quality == "fast":
                self.payload = {**self.payload, "quality": "standard", "mesh_options": None}
                self._log("[ROAST] Mesh escalated: fast → standard")
            else:
                current_opts = self.payload.get("mesh_options") or DEFAULT_MESH_OPTIONS.copy()
                tighter = {**current_opts, "maxvol": max(5, current_opts.get("maxvol", 10) // 2)}
                self.payload = {**self.payload, "mesh_options": tighter}
                self._log(f"[ROAST] Mesh escalated: maxvol → {tighter['maxvol']}")

    # ------------------------------------------------------------------
    def collect_outputs(self):
        suffix_map = {"voltage": "v", "efield": "e", "emag": "emag", "jbrain": "jbrain"}
        missing = []
        for output_type, suffix in suffix_map.items():
            path = self.work_dir / f"T1_{self.sim_tag}_{suffix}.nii"
            if not path.exists():
                missing.append(str(path))
        if missing:
            raise FileNotFoundError(f"ROAST finished but output files are missing: {missing}")
        self._log("[ROAST] All output files verified")

    # ------------------------------------------------------------------
    def run(self):
        """Full ROAST pipeline: prepare → config → launch → progress. Retries once on mesh failure."""
        try:
            self._emit("roast_start", 2)
            t1_path = self.prepare_working_directory()
            self._emit("roast_prepare", 5)

            for attempt in range(2):
                config_path = self.write_config(t1_path)
                cmd = self.build_command(config_path)
                self._log(f"[ROAST] Launching (attempt {attempt + 1}): {' '.join(cmd)}")

                failure_type, error, last_progress = self._run_subprocess(
                    cmd, progress_start=5 if attempt == 0 else 10
                )

                if error and failure_type and attempt == 0:
                    self._log(f"[ROAST] Retryable failure ({failure_type}): {error}. Escalating mesh.")
                    self._emit("roast_retry", last_progress,
                               detail=f"{error} — retrying with refined mesh…")
                    self._clean_roast_intermediates()
                    self._escalate_mesh(failure_type)
                    continue

                if error:
                    raise RuntimeError(error)
                break

            self.collect_outputs()
            self._emit("roast_complete", 100)
            self._log("[ROAST] Completed successfully")

        except Exception as e:
            self._emit("roast_error", -1, detail=str(e))
            raise
