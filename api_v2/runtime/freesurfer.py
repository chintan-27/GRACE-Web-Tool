import subprocess
from pathlib import Path

from config import MRI_CONVERT
from runtime.session import session_log

# -------------------------------------------------------
# FreeSurfer Conversion Wrapper
# -------------------------------------------------------

def convert_to_fs(input_path: Path, output_path: Path, session_id: str) -> bool:
    """
    Convert native-space NIfTI → FreeSurfer-conformed space.
    Uses real FreeSurfer mri_convert.

    Args:
        input_path (Path): native input .nii.gz
        output_path (Path): output .mgz file
        session_id (str): session ID for logging

    Returns:
        bool: True if successful
    """

    session_log(session_id, f"Running FreeSurfer conversion: {input_path} → {output_path}")

    if not MRI_CONVERT.exists():
        session_log(session_id, "ERROR: mri_convert not found in container")
        return False

    cmd = [
        str(MRI_CONVERT),
        str(input_path),
        str(output_path),
        "--conform"
    ]

    try:
        subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    except subprocess.CalledProcessError as e:
        session_log(session_id, f"ERROR: FreeSurfer conversion failed: {e.stderr.decode('utf-8')}")
        return False

    # Validate output file exists
    if not output_path.exists():
        session_log(session_id, "ERROR: FreeSurfer output missing after conversion")
        return False

    session_log(session_id, f"FreeSurfer conversion complete: {output_path}")
    return True


def convert_to_native(
    segmentation_path: Path,
    reference_path: Path,
    output_path: Path,
    session_id: str
) -> bool:
    """
    Convert FreeSurfer-space segmentation back to native space orientation.
    Uses the original native input as geometry reference.

    Args:
        segmentation_path (Path): FS-space segmentation output
        reference_path (Path): Original native input (for geometry)
        output_path (Path): Output path for native-space segmentation
        session_id (str): Session ID for logging

    Returns:
        bool: True if successful
    """
    session_log(session_id, f"Converting segmentation to native space: {segmentation_path} → {output_path}")

    if not MRI_CONVERT.exists():
        session_log(session_id, "ERROR: mri_convert not found")
        return False

    cmd = [
        str(MRI_CONVERT),
        str(segmentation_path),
        str(output_path),
        "--like", str(reference_path),
        "--nearest"  # Use nearest neighbor for label interpolation
    ]

    try:
        subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    except subprocess.CalledProcessError as e:
        session_log(session_id, f"ERROR: Native space conversion failed: {e.stderr.decode('utf-8')}")
        return False

    if not output_path.exists():
        session_log(session_id, "ERROR: Native space output missing after conversion")
        return False

    session_log(session_id, f"Native space conversion complete: {output_path}")
    return True
