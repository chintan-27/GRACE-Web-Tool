import nibabel as nib
import numpy as np
from pathlib import Path
from typing import Tuple 
import torch
from monai.transforms import (
    Compose,
    EnsureChannelFirstd,
    Orientationd,
    Spacingd,
    ResizeWithPadOrCropd,
)

from runtime.session import session_log
import warnings

# -------------------------------------------------------
# AUTO NORMALIZATION DETECTOR
# -------------------------------------------------------
def choose_normalization(img: np.ndarray) -> str:
    """
    Auto-select normalization based on voxel intensity distribution.
    """
    p99 = np.percentile(img, 99)
    # p1 = np.percentile(img, 1)
    # vmin, vmax = img.min(), img.max()

    # MRI-like range → fixed normalization
    if 0 <= p99 <= 3000:
        return "fixed"

    if 50 <= p99 <= 1500:    # common T1/T2 range
        return "fixed"

    # Otherwise weird ranges → percentile
    return "percentile"



# -------------------------------------------------------
# MANUAL NORMALIZATION METHODS
# -------------------------------------------------------
def percentile_normalize(img, pmin=1, pmax=99):
    lo = np.percentile(img, pmin)
    hi = np.percentile(img, pmax)
    img = np.clip(img, lo, hi)
    return (img - lo) / (hi - lo + 1e-8)


def fixed_scale_normalize(img, a_min=0, a_max=3000):
    img = np.clip(img, a_min, a_max)
    return (img - a_min) / (a_max - a_min + 1e-8)



# -------------------------------------------------------
# MAIN PREPROCESSING FUNCTION
# -------------------------------------------------------
def preprocess_image(
    image_path: Path,
    session_id: str,
    spatial_size: Tuple[int, int, int],
    normalization: str,  
):
    """
    Unified preprocessing pipeline for all models.
    """

    session_log(session_id, f"Preprocessing image: {image_path}")

    img_nib = nib.load(str(image_path))
    img_data = img_nib.get_fdata().astype(np.float32)
    affine = img_nib.affine
    header = img_nib.header.copy()

    # AUTO NORMALIZATION
    if normalization == "auto":
        normalization = choose_normalization(img_data)
        session_log(session_id, f"Auto-selected normalization: {normalization}")

    # APPLY NORMALIZATION
    if normalization == "percentile":
        img_data = percentile_normalize(img_data)
        session_log(session_id, "Applied percentile normalization")
    elif normalization == "fixed":
        img_data = fixed_scale_normalize(img_data)
        session_log(session_id, "Applied fixed normalization")
    else:
        session_log(session_id, f"Unknown normalization '{normalization}', skipping.")

    # Prepare data dict for MONAI
    data_dict = {"image": img_data, "affine": affine}
    warnings.simplefilter("default")
    transforms = Compose([
        EnsureChannelFirstd(keys=["image"], channel_dim="no_channel"),
        Orientationd(keys=["image"], axcodes = "RAS", labels = None),
        Spacingd(keys=["image"], pixdim=(1, 1, 1), mode=("bilinear",)),
        ResizeWithPadOrCropd(keys=["image"], spatial_size=spatial_size),
    ])

    data_dict = transforms(data_dict)

    tensor = torch.as_tensor(data_dict["image"], dtype=torch.float32)

    metadata = {
        "affine": affine,
        "header": header,
        "original_shape": img_data.shape,
    }

    session_log(session_id, f"Finished preprocessing — final shape {tensor.shape}")

    return tensor, metadata
