import nibabel as nib
import numpy as np
from pathlib import Path
from typing import Tuple
from monai.data import MetaTensor
from monai.transforms import (
    Compose,
    Spacingd,
    Orientationd,
    CropForegroundd,
)

from runtime.session import session_log

# Threshold for determining normalization strategy (matches v1)
COMPLEXITY_THRESHOLD = 10000


def preprocess_image(
    image_path: Path,
    session_id: str,
    spatial_size: Tuple[int, int, int],  # noqa: ARG001 - kept for API compatibility
    normalization: str,  # noqa: ARG001 - kept for API compatibility
    model_type: str = "grace",  # noqa: ARG001 - kept for API compatibility
    percentile_range: Tuple[int, int] = (25, 75),
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

    # Normalization logic matching v1 exactly:
    # - If max > threshold: use percentile normalization
    # - Otherwise: use fixed range normalization
    # ALWAYS normalize to 0-1 range (model expects normalized input)
    if image_max > COMPLEXITY_THRESHOLD:
        # Percentile normalization for high dynamic range images
        pmin, pmax = np.percentile(image_data, [percentile_range[0], percentile_range[1]])
        image_data = np.clip(image_data, pmin, pmax)
        image_data = (image_data - pmin) / (pmax - pmin + 1e-8)
        session_log(session_id, f"Applied percentile normalization ({percentile_range[0]}-{percentile_range[1]}) - image max {image_max:.0f} > {COMPLEXITY_THRESHOLD}")
    else:
        # Fixed normalization to 0-1 range
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
