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

# Thresholds for determining normalization strategy
# Only apply percentile normalization for images with very high dynamic range
PERCENTILE_THRESHOLD = 10000  # Apply percentile normalization only above this
FIXED_NORM_THRESHOLD = 255    # Images at or below this are considered pre-normalized


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
    Preprocessing pipeline matching v1 implementation exactly.
    """
    session_log(session_id, f"Preprocessing image: {image_path}")

    # Load image
    input_img = nib.load(str(image_path))
    image_data = input_img.get_fdata().astype(np.float32)

    # Log image stats
    image_max = np.max(image_data)
    image_min = np.min(image_data)
    image_mean = np.mean(image_data)
    session_log(session_id, f"Image shape: {image_data.shape}, dtype: {image_data.dtype}")
    session_log(session_id, f"Image stats - Min: {image_min:.2f}, Max: {image_max:.2f}, Mean: {image_mean:.2f}")

    # Normalization logic:
    # 1. If max > PERCENTILE_THRESHOLD (very high range), use percentile clipping
    # 2. If max <= 255, image is likely pre-normalized (FS space or already processed), skip normalization
    # 3. Otherwise, use fixed range normalization
    if image_max > PERCENTILE_THRESHOLD:
        # Percentile normalization for very high dynamic range images
        pmin, pmax = np.percentile(image_data, [percentile_range[0], percentile_range[1]])
        image_data = np.clip(image_data, pmin, pmax)
        image_data = (image_data - pmin) / (pmax - pmin + 1e-8)
        session_log(session_id, f"Applied percentile normalization ({percentile_range[0]}-{percentile_range[1]}) - image max {image_max:.0f} > {PERCENTILE_THRESHOLD}")
    elif image_max <= FIXED_NORM_THRESHOLD:
        # Image already in reasonable range (0-255), skip normalization
        # This handles FreeSurfer-conformed images and pre-normalized inputs
        session_log(session_id, f"Skipped normalization (image max {image_max:.2f} <= {FIXED_NORM_THRESHOLD})")
    else:
        # Fixed normalization for intermediate range (255 < max <= 50000)
        a_min, a_max = fixed_range
        image_data = np.clip(image_data, a_min, a_max)
        image_data = (image_data - a_min) / (a_max - a_min + 1e-8)
        session_log(session_id, f"Applied fixed normalization: [{a_min}, {a_max}]")

    # Wrap in MetaTensor with channel dimension (matching v1 exactly)
    meta_tensor = MetaTensor(image_data[np.newaxis, ...], affine=input_img.affine)

    # Build transforms (matching v1)
    transform_list = [
        Spacingd(keys=["image"], pixdim=(1.0, 1.0, 1.0), mode=interpolation_mode),
        Orientationd(keys=["image"], axcodes="RAS"),
    ]

    # DOMINO uses CropForegroundd
    if crop_foreground:
        transform_list.append(CropForegroundd(keys=["image"], source_key="image"))
        session_log(session_id, "Applying foreground cropping")

    transforms = Compose(transform_list)

    session_log(session_id, f"Applying spatial transforms (mode={interpolation_mode})...")
    transformed = transforms({"image": meta_tensor})

    # Add batch dimension: (1, 1, D, H, W) - matching v1 exactly
    image_tensor = transformed["image"].unsqueeze(0)

    session_log(session_id, f"Finished preprocessing - final shape {image_tensor.shape}")

    # Return tensor and the original nibabel image (for affine/header)
    return image_tensor, input_img
