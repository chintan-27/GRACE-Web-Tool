import nibabel as nib
import numpy as np
from pathlib import Path
from typing import Tuple
from monai.data import MetaTensor
from monai.transforms import (
    Compose,
    Spacingd,
    Orientationd,
    ResizeWithPadOrCropd,
)

from runtime.session import session_log

# Threshold for determining normalization strategy (matches v1)
COMPLEXITY_THRESHOLD = 10000


def preprocess_image(
    image_path: Path,
    session_id: str,
    spatial_size: Tuple[int, int, int],
    normalization: str,  # noqa: ARG001 - kept for API compatibility
    model_type: str = "grace",
    percentile_range: Tuple[int, int] = (25, 75),
    interpolation_mode: str = "bilinear",
    fixed_range: Tuple[float, float] = (0, 255),
    resize_spatial_size: Tuple[int, int, int] = None,
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

    # Normalization logic matching v1 exactly:
    # - GRACE: skip normalization if max <= 255 (already in good range)
    # - If max > threshold: use percentile normalization
    # - Otherwise: use fixed range normalization
    if image_max > COMPLEXITY_THRESHOLD:
        # Percentile normalization for high dynamic range images
        pmin, pmax = np.percentile(image_data, [percentile_range[0], percentile_range[1]])
        image_data = np.clip(image_data, pmin, pmax)
        image_data = (image_data - pmin) / (pmax - pmin + 1e-8)
        session_log(session_id, f"Applied percentile normalization ({percentile_range[0]}-{percentile_range[1]}) - image max {image_max:.0f} > {COMPLEXITY_THRESHOLD}")
    elif image_max <= 255.0 and model_type == "grace":
        # GRACE: skip normalization for images already in 0-255 range
        session_log(session_id, "Skipped normalization (GRACE model, image max <= 255)")
    else:
        # Fixed normalization to 0-1 range
        a_min, a_max = fixed_range
        image_data = np.clip(image_data, a_min, a_max)
        image_data = (image_data - a_min) / (a_max - a_min + 1e-8)
        session_log(session_id, f"Applied fixed normalization: [{a_min}, {a_max}]")

    # Wrap in MetaTensor with channel dimension (matching v1 exactly)
    meta_tensor = MetaTensor(image_data[np.newaxis, ...], affine=input_img.affine)

    # Build transforms (matching v1)
    # Use resize_spatial_size if provided, otherwise use spatial_size
    resize_size = resize_spatial_size if resize_spatial_size else spatial_size

    transform_list = [
        Spacingd(keys=["image"], pixdim=(1.0, 1.0, 1.0), mode=interpolation_mode),
        Orientationd(keys=["image"], axcodes="RAS"),
        ResizeWithPadOrCropd(keys=["image"], spatial_size=resize_size),
    ]

    transforms = Compose(transform_list)

    session_log(session_id, f"Applying spatial transforms (mode={interpolation_mode}, resize={resize_size})...")
    transformed = transforms({"image": meta_tensor})

    # Add batch dimension: (1, 1, D, H, W) - matching v1 exactly
    image_tensor = transformed["image"].unsqueeze(0)

    session_log(session_id, f"Finished preprocessing - final shape {image_tensor.shape}")

    # Return tensor and the original nibabel image (for affine/header)
    return image_tensor, input_img
