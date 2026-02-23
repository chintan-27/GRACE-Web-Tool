#!/usr/bin/env python3
"""
Create MNI2Conform_nonl.nii.gz and Conform2MNI_nonl.nii.gz (affine approximation)
from the coregistrationMatrices.mat produced by charm --initatlas.

The warp format matches what charm --mesh expects (saveWarpField convention):
  MNI2Conform_nonl.nii.gz  : 4D NIfTI on MNI grid, values = T1 RAS world coords
  Conform2MNI_nonl.nii.gz  : 4D NIfTI on T1 grid,  values = MNI RAS world coords

worldToWorldTransformMatrix (from coregistrationMatrices.mat) is the affine that
maps MNI RAS world coordinates to T1 RAS world coordinates, output of initatlas.
Using an affine-only warp gives electrode positions accurate to ~5-10 mm, which
is sufficient for tDCS electrode placement.

Usage:
    python create_mni_warp.py <m2m_subject_dir> <mni_template_path>
"""
import sys
from pathlib import Path

import numpy as np
import nibabel as nib
import scipy.io


def create_affine_mni_warp(m2m_dir: str, mni_template_path: str) -> None:
    m2m_dir = Path(m2m_dir)

    # Load MNI→T1 affine from coregistrationMatrices.mat (written by --initatlas)
    mat_path = m2m_dir / "segmentation" / "coregistrationMatrices.mat"
    matrices  = scipy.io.loadmat(str(mat_path))
    W2W     = matrices["worldToWorldTransformMatrix"].astype(np.float64)  # MNI→T1
    W2W_inv = np.linalg.inv(W2W)                                          # T1→MNI

    # MNI template — defines the output grid for MNI2Conform
    mni_img   = nib.load(mni_template_path)
    mni_shape = mni_img.shape[:3]
    mni_aff   = mni_img.affine.astype(np.float64)

    # T1 in m2m dir — defines the output grid for Conform2MNI
    t1_img   = nib.load(str(m2m_dir / "T1.nii.gz"))
    t1_shape = t1_img.shape[:3]
    t1_aff   = t1_img.affine.astype(np.float64)

    to_mni_dir = m2m_dir / "toMNI"
    to_mni_dir.mkdir(exist_ok=True)

    # ── MNI2Conform_nonl.nii.gz ──────────────────────────────────────────────
    # For each MNI template voxel: T1 RAS world coordinates
    print("Creating MNI2Conform_nonl.nii.gz ...", flush=True)
    ii, jj, kk = np.mgrid[0:mni_shape[0], 0:mni_shape[1], 0:mni_shape[2]]
    ones   = np.ones_like(ii, dtype=np.float64)
    vox_h  = np.stack([ii, jj, kk, ones], axis=-1)                  # (X,Y,Z,4)

    mni_world   = np.einsum("ij,...j->...i", mni_aff, vox_h)[..., :3]   # (X,Y,Z,3)
    mni_world_h = np.concatenate([mni_world, ones[..., np.newaxis]], axis=-1)
    t1_world    = np.einsum("ij,...j->...i", W2W, mni_world_h)[..., :3] # (X,Y,Z,3)

    nib.save(
        nib.Nifti1Image(t1_world.astype(np.float32), mni_aff),
        str(to_mni_dir / "MNI2Conform_nonl.nii.gz"),
    )
    print(f"  → {to_mni_dir / 'MNI2Conform_nonl.nii.gz'}", flush=True)

    # ── Conform2MNI_nonl.nii.gz ──────────────────────────────────────────────
    # For each T1 voxel: MNI RAS world coordinates
    print("Creating Conform2MNI_nonl.nii.gz ...", flush=True)
    ii2, jj2, kk2 = np.mgrid[0:t1_shape[0], 0:t1_shape[1], 0:t1_shape[2]]
    ones2   = np.ones_like(ii2, dtype=np.float64)
    vox2_h  = np.stack([ii2, jj2, kk2, ones2], axis=-1)

    t1_world2   = np.einsum("ij,...j->...i", t1_aff, vox2_h)[..., :3]
    t1_world2_h = np.concatenate([t1_world2, ones2[..., np.newaxis]], axis=-1)
    mni_world2  = np.einsum("ij,...j->...i", W2W_inv, t1_world2_h)[..., :3]

    nib.save(
        nib.Nifti1Image(mni_world2.astype(np.float32), t1_aff),
        str(to_mni_dir / "Conform2MNI_nonl.nii.gz"),
    )
    print(f"  → {to_mni_dir / 'Conform2MNI_nonl.nii.gz'}", flush=True)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: create_mni_warp.py <m2m_subject_dir> <mni_template>")
        sys.exit(1)
    create_affine_mni_warp(sys.argv[1], sys.argv[2])
