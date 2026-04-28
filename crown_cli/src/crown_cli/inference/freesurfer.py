import subprocess
from pathlib import Path
from typing import Callable


def convert_to_fs(
    input_path: Path,
    output_path: Path,
    mri_convert: Path,
    log_fn: Callable[[str], None] = print,
) -> bool:
    """
    Convert native-space NIfTI → FreeSurfer-conformed space.
    Uses real FreeSurfer mri_convert.

    Args:
        input_path: native input .nii.gz
        output_path: output .mgz file
        mri_convert: path to the mri_convert binary
        log_fn: callable for logging messages

    Returns:
        bool: True if successful
    """
    log_fn(f"Running FreeSurfer conversion: {input_path} → {output_path}")

    if not mri_convert.exists():
        log_fn("ERROR: mri_convert not found")
        return False

    cmd = [
        str(mri_convert),
        str(input_path),
        str(output_path),
        "--conform"
    ]

    try:
        subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    except subprocess.CalledProcessError as e:
        log_fn(f"ERROR: FreeSurfer conversion failed: {e.stderr.decode('utf-8')}")
        return False

    # Validate output file exists
    if not output_path.exists():
        log_fn("ERROR: FreeSurfer output missing after conversion")
        return False

    log_fn(f"FreeSurfer conversion complete: {output_path}")
    return True


def convert_to_native(
    segmentation_path: Path,
    reference_path: Path,
    output_path: Path,
    mri_vol2vol: Path,
    log_fn: Callable[[str], None] = print,
) -> bool:
    """
    Convert FreeSurfer-conformed segmentation back to native space.
    Uses mri_vol2vol with --regheader to resample from conformed space
    back to the original input's voxel grid + orientation.

    Args:
        segmentation_path: Segmentation in conformed space (model output)
        reference_path: Original native input (target geometry)
        output_path: Output path for native-space segmentation
        mri_vol2vol: path to the mri_vol2vol binary
        log_fn: callable for logging messages

    Returns:
        bool: True if successful
    """
    log_fn(f"Converting segmentation to native space: {segmentation_path} → {output_path}")

    if not mri_vol2vol.exists():
        log_fn("ERROR: mri_vol2vol not found")
        return False

    # Use mri_vol2vol with --regheader to compute transform from headers
    # --interp nearest for label maps to avoid creating new label values
    cmd = [
        str(mri_vol2vol),
        "--mov", str(segmentation_path),
        "--targ", str(reference_path),
        "--regheader",
        "--o", str(output_path),
        "--interp", "nearest"
    ]

    log_fn(f"Running: {' '.join(cmd)}")

    try:
        result = subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        log_fn(f"mri_vol2vol stdout: {result.stdout.decode('utf-8')}")
    except subprocess.CalledProcessError as e:
        log_fn(f"ERROR: mri_vol2vol failed: {e.stderr.decode('utf-8')}")
        return False

    if not output_path.exists():
        log_fn("ERROR: Native space output missing after conversion")
        return False

    log_fn(f"Native space conversion complete: {output_path}")
    return True
