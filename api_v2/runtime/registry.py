from pathlib import Path
from config import MODEL_DIR

"""
MODEL REGISTRY FOR v2 BACKEND

We define all 6 models:

1. grace-native
2. grace-fs
3. domino-native
4. domino-fs
5. dominopp-native
6. dominopp-fs

Each entry tells:
- path to checkpoint
- training/input space
- preprocessing normalization
- required spatial size
- type (grace/domino/dominopp)
- version
- percentile_range for normalization
- interpolation_mode for spatial transforms
"""

MODEL_REGISTRY = {
    # ---------------------------------------------------
    # GRACE models
    # ---------------------------------------------------
    "grace-native": {
        "name": "grace-native",
        "type": "grace",
        "space": "native",
        "normalization": "auto",
        "spatial_size": (64, 64, 64),
        "checkpoint": str(Path(MODEL_DIR) / "grace_native.pth"),
        "percentile_range": (20, 80),
        "interpolation_mode": "bilinear",
        "fixed_range": (0, 255),
        "resize_spatial_size": (176, 256, 256),  # v1 uses this for ResizeWithPadOrCrop
        'proj_type': 'conv',
    },
    "grace-fs": {
        "name": "grace-fs",
        "type": "grace",
        "space": "freesurfer",
        "normalization": "auto",
        "spatial_size": (256, 256, 256),
        "checkpoint": str(Path(MODEL_DIR) / "grace_fs.pth"),
        "percentile_range": (20, 80),
        "interpolation_mode": "bilinear",
        "fixed_range": (0, 255),
        "resize_spatial_size": (256, 256, 256),
        'proj_type': 'perceptron',
    },

    # ---------------------------------------------------
    # DOMINO models
    # ---------------------------------------------------
    "domino-native": {
        "name": "domino-native",
        "type": "domino",
        "space": "native",
        "normalization": "auto",
        "spatial_size": (64, 64, 64),
        "checkpoint": str(Path(MODEL_DIR) / "domino_native.pth"),
        "percentile_range": (25, 75),
        "interpolation_mode": "bilinear",
        "fixed_range": (0, 255),
        "resize_spatial_size": (176, 256, 256),
        'proj_type': 'perceptron',
    },
    "domino-fs": {
        "name": "domino-fs",
        "type": "domino",
        "space": "freesurfer",
        "normalization": "auto",
        "spatial_size": (256, 256, 256),
        "checkpoint": str(Path(MODEL_DIR) / "domino_fs.pth"),
        "percentile_range": (25, 75),
        "interpolation_mode": "bilinear",
        "fixed_range": (0, 255),
        "resize_spatial_size": (256, 256, 256),
        'proj_type': 'perceptron',
    },

    # ---------------------------------------------------
    # DOMINO++
    # ---------------------------------------------------
    "dominopp-native": {
        "name": "dominopp-native",
        "type": "dominopp",
        "space": "native",
        "normalization": "auto",
        "spatial_size": (64, 64, 64),
        "checkpoint": str(Path(MODEL_DIR) / "dominopp_native.pth"),
        "percentile_range": (25, 75),
        "interpolation_mode": "bilinear",
        "fixed_range": (0, 255),
        "resize_spatial_size": (176, 256, 256),
        'proj_type': 'perceptron',
    },
    "dominopp-fs": {
        "name": "dominopp-fs",
        "type": "dominopp",
        "space": "freesurfer",
        "normalization": "auto",
        "spatial_size": (256, 256, 256),
        "checkpoint": str(Path(MODEL_DIR) / "dominopp_fs.pth"),
        "percentile_range": (25, 75),
        "interpolation_mode": "bilinear",
        "fixed_range": (0, 255),
        "resize_spatial_size": (256, 256, 256),
        'proj_type': 'perceptron',
    },
}

# -------------------------------------------------------
# HELPERS
# -------------------------------------------------------
def list_models():
    return list(MODEL_REGISTRY.keys())

def get_model_config(model_name: str):
    if model_name not in MODEL_REGISTRY:
        raise ValueError(f"Model not found: {model_name}")
    return MODEL_REGISTRY[model_name]
