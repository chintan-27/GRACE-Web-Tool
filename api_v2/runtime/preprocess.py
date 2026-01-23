import nibabel as nib
import numpy as np
from pathlib import Path
from typing import Tuple
import torch
from monai.data import MetaTensor
from monai.transforms import (
    Compose,
    Spacingd,
    Orientationd,
    CropForegroundd,
)

from runtime.session import session_log
import warnings

# Complexity threshold for auto normalization (matches v1)
COMPLEXITY_THRESHOLD = 10000


# -------------------------------------------------------
# NORMALIZATION METHODS (matching v1 implementation)
# -------------------------------------------------------
def normalize_fixed(data: np.ndarray, a_min: float = 0, a_max: float = 255) -> np.ndarray:
    """
    Fixed range normalization matching v1 implementation.
    """
    data = np.clip(data, a_min, a_max)
    return (data - a_min) / (a_max - a_min + 1e-8)


def normalize_percentile(data: np.ndarray, lower: int = 20, upper: int = 80) -> np.ndarray:
    """
    Percentile-based normalization matching v1 implementation.
    """
    pmin, pmax = np.percentile(data, [lower, upper])
    data = np.clip(data, pmin, pmax)
    return (data - pmin) / (pmax - pmin + 1e-8)


# -------------------------------------------------------
# MAIN PREPROCESSING FUNCTION
# -------------------------------------------------------
def preprocess_image(
    image_path: Path,
    session_id: str,
    spatial_size: Tuple[int, int, int],
    normalization: str,
    model_type: str = "grace",
    percentile_range: Tuple[int, int] = (20, 80),
    interpolation_mode: str = "bilinear",
    fixed_range: Tuple[float, float] = (0, 255),
    crop_foreground: bool = False,
):
    """
    Unified preprocessing pipeline for all models.
    Matches v1 implementation for correct inference results.

    Args:
        image_path: Path to input NIfTI file
        session_id: Session ID for logging
        spatial_size: Model's expected spatial size (used for metadata, not resizing)
        normalization: "auto", "fixed", or "percentile"
        model_type: "grace", "domino", or "dominopp"
        percentile_range: (lower, upper) percentiles for percentile normalization
        interpolation_mode: "bilinear" or "trilinear" for spatial transforms
        fixed_range: (a_min, a_max) for fixed normalization
        crop_foreground: Whether to crop to foreground (used by DOMINO)
    """

    session_log(session_id, f"Preprocessing image: {image_path}")

    # Load image
    img_nib = nib.load(str(image_path))
    img_data = img_nib.get_fdata().astype(np.float32)
    affine = img_nib.affine
    header = img_nib.header.copy()

    # Log image stats (matching v1)
    image_max = np.max(img_data)
    image_min = np.min(img_data)
    image_mean = np.mean(img_data)
    session_log(session_id, f"Image shape: {img_data.shape}, dtype: {img_data.dtype}")
    session_log(session_id, f"Image stats - Min: {image_min:.2f}, Max: {image_max:.2f}, Mean: {image_mean:.2f}")

    # AUTO NORMALIZATION (matching v1 logic)
    if normalization == "auto":
        if image_max > COMPLEXITY_THRESHOLD:
            # Complex image - use percentile normalization
            img_data = normalize_percentile(img_data, percentile_range[0], percentile_range[1])
            session_log(session_id, f"Applied percentile normalization ({percentile_range[0]}-{percentile_range[1]}) due to max > {COMPLEXITY_THRESHOLD}")
        elif image_max <= 255.0 and model_type == "grace":
            # GRACE: skip normalization for images already in 0-255 range
            session_log(session_id, "Skipped normalization (image already in 0-255 range)")
        else:
            # Apply fixed normalization
            img_data = normalize_fixed(img_data, fixed_range[0], fixed_range[1])
            session_log(session_id, f"Applied fixed normalization: [{fixed_range[0]}, {fixed_range[1]}]")
    elif normalization == "percentile":
        img_data = normalize_percentile(img_data, percentile_range[0], percentile_range[1])
        session_log(session_id, f"Applied percentile normalization ({percentile_range[0]}-{percentile_range[1]})")
    elif normalization == "fixed":
        img_data = normalize_fixed(img_data, fixed_range[0], fixed_range[1])
        session_log(session_id, f"Applied fixed normalization: [{fixed_range[0]}, {fixed_range[1]}]")
    else:
        session_log(session_id, f"Unknown normalization '{normalization}', skipping.")

    # Wrap in MetaTensor (MONAI-friendly) and add channel dimension
    # Matching v1: add channel dimension before transforms
    meta_tensor = MetaTensor(img_data[np.newaxis, ...], affine=affine)

    # Apply MONAI spatial transforms (matching v1 - NO ResizeWithPadOrCrop)
    warnings.simplefilter("default")

    # Build transform list based on model requirements
    transform_list = [
        Spacingd(keys=["image"], pixdim=(1.0, 1.0, 1.0), mode=(interpolation_mode,)),
        Orientationd(keys=["image"], axcodes="RAS"),
    ]

    # DOMINO models use CropForegroundd
    if crop_foreground:
        transform_list.append(CropForegroundd(keys=["image"], source_key="image"))
        session_log(session_id, "Will apply foreground cropping (DOMINO)")

    transforms = Compose(transform_list)

    session_log(session_id, f"Applying spatial transforms (mode={interpolation_mode})...")
    data_dict = transforms({"image": meta_tensor})

    # Get tensor and add batch dimension: (1, 1, D, H, W)
    tensor = data_dict["image"].unsqueeze(0)
    tensor = torch.as_tensor(tensor, dtype=torch.float32)

    metadata = {
        "affine": affine,
        "header": header,
        "original_shape": img_data.shape,
    }

    session_log(session_id, f"Finished preprocessing - final shape {tensor.shape}")

    return tensor, metadata
