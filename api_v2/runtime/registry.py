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
    },
    "grace-fs": {
        "name": "grace-fs",
        "type": "grace",
        "space": "freesurfer",
        "normalization": "auto",
        "spatial_size": (64, 64, 64),
        "checkpoint": str(Path(MODEL_DIR) / "grace_fs.pth"),
    },

    # ---------------------------------------------------
    # DOMINO models
    # ---------------------------------------------------
    "domino-native": {
        "name": "domino-native",
        "type": "domino",
        "space": "native",
        "normalization": "auto",
        "spatial_size": (256, 256, 256),
        "checkpoint": str(Path(MODEL_DIR) / "domino_native.pth"),
    },
    "domino-fs": {
        "name": "domino-fs",
        "type": "domino",
        "space": "freesurfer",
        "normalization": "auto",
        "spatial_size": (256, 256, 256),
        "checkpoint": str(Path(MODEL_DIR) / "domino_fs.pth"),
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
    },
    "dominopp-fs": {
        "name": "dominopp-fs",
        "type": "dominopp",
        "space": "freesurfer",
        "normalization": "auto",
        "spatial_size": (64, 64, 64),
        "checkpoint": str(Path(MODEL_DIR) / "dominopp_fs.pth"),
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
