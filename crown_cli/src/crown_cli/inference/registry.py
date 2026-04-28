from pathlib import Path
from typing import Dict, Any

MODEL_REGISTRY: Dict[str, Dict[str, Any]] = {
    "grace-native": {
        "name": "grace-native", "type": "grace", "space": "native",
        "normalization": "auto", "spatial_size": (64, 64, 64),
        "percentile_range": (20, 80), "interpolation_mode": "bilinear",
        "fixed_range": (0, 255), "resize_spatial_size": (176, 256, 256),
        "proj_type": "conv", "hf_repo": "smilelab/GRACE", "hf_filename": "grace_native.pth",
    },
    "grace-fs": {
        "name": "grace-fs", "type": "grace", "space": "freesurfer",
        "normalization": "auto", "spatial_size": (256, 256, 256),
        "percentile_range": (20, 80), "interpolation_mode": "bilinear",
        "fixed_range": (0, 255), "resize_spatial_size": (256, 256, 256),
        "proj_type": "conv", "hf_repo": "smilelab/GRACE", "hf_filename": "grace_fs.pth",
    },
    "domino-native": {
        "name": "domino-native", "type": "domino", "space": "native",
        "normalization": "auto", "spatial_size": (64, 64, 64),
        "percentile_range": (25, 75), "interpolation_mode": "bilinear",
        "fixed_range": (0, 255), "resize_spatial_size": (176, 256, 256),
        "proj_type": "perceptron", "hf_repo": "smilelab/DOMINO", "hf_filename": "domino_native.pth",
    },
    "domino-fs": {
        "name": "domino-fs", "type": "domino", "space": "freesurfer",
        "normalization": "auto", "spatial_size": (256, 256, 256),
        "percentile_range": (25, 75), "interpolation_mode": "bilinear",
        "fixed_range": (0, 255), "resize_spatial_size": (256, 256, 256),
        "proj_type": "perceptron", "hf_repo": "smilelab/DOMINO", "hf_filename": "domino_fs.pth",
    },
    "dominopp-native": {
        "name": "dominopp-native", "type": "dominopp", "space": "native",
        "normalization": "auto", "spatial_size": (64, 64, 64),
        "percentile_range": (25, 75), "interpolation_mode": "bilinear",
        "fixed_range": (0, 255), "resize_spatial_size": (176, 256, 256),
        "proj_type": "perceptron", "hf_repo": "smilelab/DOMINOPP", "hf_filename": "dominopp_native.pth",
    },
    "dominopp-fs": {
        "name": "dominopp-fs", "type": "dominopp", "space": "freesurfer",
        "normalization": "auto", "spatial_size": (256, 256, 256),
        "percentile_range": (25, 75), "interpolation_mode": "bilinear",
        "fixed_range": (0, 255), "resize_spatial_size": (256, 256, 256),
        "proj_type": "perceptron", "hf_repo": "smilelab/DOMINOPP", "hf_filename": "dominopp_fs.pth",
    },
}


def get_model_config(model_name: str) -> Dict[str, Any]:
    if model_name not in MODEL_REGISTRY:
        raise ValueError(f"Unknown model: {model_name}. Available: {list(MODEL_REGISTRY)}")
    return MODEL_REGISTRY[model_name]


def list_models():
    return list(MODEL_REGISTRY.keys())
