import sys
from pathlib import Path
import numpy as np
import nibabel as nib
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent.resolve() / "src"))

from crown_cli.core.config import CrownConfig
from crown_cli.core.roast_runner import CLIRoastRunner
import crown_cli.core.roast_runner as rr_mod


def _make_runner(tmp_path, session_dir, payload, run_id="testrun"):
    cfg = CrownConfig(
        jobs_dir=tmp_path / "jobs",
        roast_build_dir=tmp_path / "roast",
    )
    job_dir = tmp_path / "jobs" / run_id
    job_dir.mkdir(parents=True, exist_ok=True)
    t1_path = session_dir / "T1.nii.gz"
    return CLIRoastRunner(
        job_dir=job_dir,
        session_dir=session_dir,
        t1_path=t1_path,
        model_name="grace-native",
        payload={"seg_source": "nn", "run_id": run_id, **payload},
        cfg=cfg,
    )


def _make_session(session_dir):
    """Write minimal synthetic T1 + segmentation NIfTI into session_dir."""
    import gzip, shutil
    affine = np.eye(4)
    t1_data = np.zeros((60, 60, 60), dtype=np.float32)
    t1_data[10:50, 10:50, 10:50] = 100.0
    t1_nii = session_dir / "T1.nii"
    nib.save(nib.Nifti1Image(t1_data, affine), str(t1_nii))
    with open(t1_nii, "rb") as f_in, gzip.open(session_dir / "T1.nii.gz", "wb") as f_out:
        shutil.copyfileobj(f_in, f_out)
    t1_nii.unlink()

    seg_data = np.zeros((60, 60, 60), dtype=np.uint8)
    seg_data[10:50, 10:50, 10:50] = 9   # skin label
    seg_data[15:45, 15:45, 15:45] = 1   # white matter inside
    seg_dir = session_dir / "grace-native"
    seg_dir.mkdir(parents=True, exist_ok=True)
    nib.save(nib.Nifti1Image(seg_data, affine), str(seg_dir / "output.nii.gz"))


def test_cap_fit_retry_uses_more_aggressive_sagittal_closing(tmp_path, monkeypatch):
    """prepare_working_directory must use higher sagittal closing iterations when cap_fit_retry=True."""
    session_a = tmp_path / "session_a"
    session_a.mkdir()
    _make_session(session_a)

    session_b = tmp_path / "session_b"
    session_b.mkdir()
    _make_session(session_b)

    from scipy import ndimage as ndi
    original_closing = rr_mod.ndi.binary_closing

    # --- normal run ---
    normal_iters = []

    def track_normal(arr, structure=None, iterations=1, **kwargs):
        normal_iters.append(iterations)
        return original_closing(arr, structure=structure, iterations=iterations, **kwargs)

    runner_normal = _make_runner(tmp_path, session_a, payload={}, run_id="run_normal")
    monkeypatch.setattr(rr_mod.ndi, "binary_closing", track_normal)
    runner_normal.prepare_working_directory()
    monkeypatch.setattr(rr_mod.ndi, "binary_closing", original_closing)

    # --- cap_fit_retry run (separate session so no cache hit) ---
    retry_iters = []

    def track_retry(arr, structure=None, iterations=1, **kwargs):
        retry_iters.append(iterations)
        return original_closing(arr, structure=structure, iterations=iterations, **kwargs)

    runner_retry = _make_runner(tmp_path, session_b, payload={"cap_fit_retry": True}, run_id="run_retry")
    monkeypatch.setattr(rr_mod.ndi, "binary_closing", track_retry)
    runner_retry.prepare_working_directory()
    monkeypatch.setattr(rr_mod.ndi, "binary_closing", original_closing)

    assert normal_iters, "binary_closing was never called in normal run"
    assert retry_iters, "binary_closing was never called in retry run"
    assert max(retry_iters) > max(normal_iters), (
        f"cap_fit_retry must use higher closing iterations "
        f"(normal max={max(normal_iters)}, retry max={max(retry_iters)})"
    )
