"""
Tissue volume statistics from NIfTI segmentation outputs.
Counts voxels per label class and converts to mm³ using the image affine.
Results are cached as stats.json in the model output directory.
"""
import json
import logging
from pathlib import Path

import nibabel as nib
import numpy as np

log = logging.getLogger(__name__)

LABEL_NAMES: dict[int, str] = {
    0:  "Background",
    1:  "White Matter",
    2:  "Grey Matter",
    3:  "Eyes",
    4:  "CSF",
    5:  "Air (internal)",
    6:  "Blood",
    7:  "Spongy Bone",
    8:  "Compact Bone",
    9:  "Skin",
    10: "Fat",
    11: "Muscle",
}


def compute_label_volumes(nifti_path: Path) -> dict:
    """
    Load a NIfTI label map and compute per-label voxel counts and mm³ volumes.
    Returns a dict ready to serialise as JSON.
    """
    img = nib.load(str(nifti_path))
    data = np.asarray(img.dataobj, dtype=np.int16)
    zooms = img.header.get_zooms()[:3]
    voxel_volume_mm3 = float(zooms[0] * zooms[1] * zooms[2])

    labels: dict[str, dict] = {}
    for label_id, label_name in LABEL_NAMES.items():
        count = int(np.sum(data == label_id))
        labels[str(label_id)] = {
            "name": label_name,
            "voxel_count": count,
            "volume_mm3": round(count * voxel_volume_mm3, 2),
        }

    return {
        "voxel_volume_mm3": round(voxel_volume_mm3, 4),
        "labels": labels,
    }


def get_or_compute_stats(nifti_path: Path, cache_path: Path) -> dict:
    """
    Return cached stats if available, otherwise compute and cache them.
    """
    if cache_path.exists():
        try:
            return json.loads(cache_path.read_text())
        except Exception:
            pass  # corrupted cache — recompute

    result = compute_label_volumes(nifti_path)

    try:
        cache_path.write_text(json.dumps(result))
    except Exception as exc:
        log.warning("[VolumeStats] Could not write cache to %s: %s", cache_path, exc)

    return result
