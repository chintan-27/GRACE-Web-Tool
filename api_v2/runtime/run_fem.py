#!/usr/bin/env python3
"""
Run a SimNIBS tDCS FEM simulation.
Called by SimNIBSRunner.run_fem() via the SimNIBS Python interpreter (which has simnibs).

Usage:
    python run_fem.py <mesh_path> <fem_dir> <recipe_json> <electype_json>

recipe_json   : JSON array alternating position/current_mA pairs, e.g. '["F3",2,"F4",-2]'
electype_json : JSON array of electrode type strings, e.g. '["pad","pad"]'
"""
import json
import sys


def _export_fields_to_nifti(fem_dir: str, m2m_dir: str) -> None:
    """
    Manual fallback: interpolate FEM fields from scalar mesh to NIfTI volume
    when SimNIBS map_to_vol silently fails.

    Uses nearest-neighbour interpolation via scipy.spatial.cKDTree from
    element centroids (filtered to tissue tags 1-10) to the T1 voxel grid.
    """
    from pathlib import Path
    import numpy as np
    import nibabel as nib
    from scipy.spatial import cKDTree
    import simnibs.mesh_io as mesh_io

    fem_path = Path(fem_dir)
    m2m_path = Path(m2m_dir)

    # Locate scalar mesh produced by run_simnibs
    scalar_meshes = sorted(fem_path.rglob("*_scalar.msh"))
    if not scalar_meshes:
        print("WARNING: No _scalar.msh found — cannot do manual interpolation", flush=True)
        return

    scalar_mesh_file = scalar_meshes[0]
    # Derive subject prefix from filename, e.g. "sub_TDCS_1_scalar.msh" → "sub"
    subject = scalar_mesh_file.name.split("_TDCS_")[0]

    # Reference NIfTI for grid geometry
    ref_nii_path = m2m_path / "T1fs_conform.nii.gz"
    if not ref_nii_path.exists():
        ref_nii_path = m2m_path / "T1.nii.gz"
    if not ref_nii_path.exists():
        print("WARNING: No reference NIfTI in m2m dir — cannot do manual interpolation", flush=True)
        return

    print(f"Manual mesh→NIfTI interpolation using {scalar_mesh_file.name}", flush=True)

    ref_img = nib.load(str(ref_nii_path))
    affine  = ref_img.affine
    shape   = ref_img.shape[:3]

    # Load FEM scalar mesh
    msh = mesh_io.read_msh(str(scalar_mesh_file))

    # Element centroids in world (mm) coordinates
    centroids = msh.elements_baricenters().value  # (N_elem, 3)

    # Keep only head/brain tissue elements (tags 1-10); electrodes are >500
    tags        = msh.elm.tag1
    tissue_mask = (tags >= 1) & (tags <= 10)

    tissue_centroids = centroids[tissue_mask]
    print(f"  Tissue elements for interpolation: {tissue_mask.sum()}", flush=True)

    if tissue_mask.sum() == 0:
        print("WARNING: No tissue elements found — trying all elements", flush=True)
        tissue_mask      = np.ones(len(tags), dtype=bool)
        tissue_centroids = centroids

    # Build KDTree once for all fields
    tree = cKDTree(tissue_centroids)

    # Convert every voxel to world coordinates
    i_idx, j_idx, k_idx = np.mgrid[0:shape[0], 0:shape[1], 0:shape[2]]
    vox_ijk   = np.column_stack([i_idx.ravel(), j_idx.ravel(), k_idx.ravel()]).astype(np.float32)
    world_xyz = nib.affines.apply_affine(affine, vox_ijk)  # (V, 3)

    print(f"  Querying KDTree for {world_xyz.shape[0]:,} voxels…", flush=True)
    _dists, nn_idx = tree.query(world_xyz, workers=-1)     # nn_idx indexes tissue_centroids

    # Collect fields we want to export
    fields_to_save: dict[str, np.ndarray] = {}
    for edata in msh.elmdata:
        name = edata.field_name
        vals = np.array(edata.value)  # (N_elem,) or (N_elem, 3)
        if name in ("magnE", "E_norm", "normE"):
            if vals.ndim > 1:
                vals = np.linalg.norm(vals, axis=-1)
            fields_to_save["magnE"] = vals[tissue_mask]
        elif name == "E" and "magnE" not in fields_to_save:
            # Use vector E-field magnitude as fallback
            if vals.ndim > 1:
                vals = np.linalg.norm(vals, axis=-1)
            fields_to_save["magnE"] = vals[tissue_mask]
        elif name == "v":
            if vals.ndim > 1:
                vals = vals[:, 0]
            fields_to_save["v"] = vals[tissue_mask]

    if not fields_to_save:
        print("WARNING: No magnE / v fields found in scalar mesh", flush=True)
        # Print available field names for debugging
        print(f"  Available fields: {[e.field_name for e in msh.elmdata]}", flush=True)
        return

    for field_key, tissue_vals in fields_to_save.items():
        vol_flat = tissue_vals[nn_idx]
        vol      = vol_flat.reshape(shape).astype(np.float32)
        out_name = f"{subject}_TDCS_1_{field_key}.nii.gz"
        out_path = fem_path / out_name
        nib.save(nib.Nifti1Image(vol, affine, ref_img.header), str(out_path))
        print(f"  Saved {out_name}", flush=True)


def main() -> None:
    if len(sys.argv) != 5:
        print("Usage: run_fem.py <mesh_path> <fem_dir> <recipe_json> <electype_json>")
        sys.exit(1)

    mesh_path = sys.argv[1]
    fem_dir   = sys.argv[2]
    recipe    = json.loads(sys.argv[3])
    electype  = json.loads(sys.argv[4])

    pairs: list[tuple[str, float]] = []
    for i in range(0, len(recipe), 2):
        pos = str(recipe[i])
        ma  = float(recipe[i + 1])
        pairs.append((pos, ma / 1000.0))   # SimNIBS wants amperes

    from pathlib import Path as _Path
    import shutil as _shutil
    m2m_dir = str(_Path(mesh_path).parent)

    # map_to_vol needs T1fs_conform.nii.gz as the reference volume.
    # When charm runs without --segment (our pipeline), this file is never
    # created.  T1.nii.gz is already in the same 1 mm isotropic RAS space,
    # so we copy it as a stand-in before launching the FEM solve.
    t1fs_conform = _Path(m2m_dir) / "T1fs_conform.nii.gz"
    if not t1fs_conform.exists():
        t1_src = _Path(m2m_dir) / "T1.nii.gz"
        if t1_src.exists():
            _shutil.copy2(str(t1_src), str(t1fs_conform))
            print("Created T1fs_conform.nii.gz from T1.nii.gz for map_to_vol", flush=True)
        else:
            print("WARNING: T1.nii.gz not found in m2m dir — map_to_vol may fail", flush=True)

    from simnibs import sim_struct, run_simnibs

    s = sim_struct.SESSION()
    s.fnamehead  = mesh_path
    s.subpath    = m2m_dir
    s.pathfem    = fem_dir
    s.map_to_mni = False

    tdcs = s.add_tdcslist()
    tdcs.currents   = [p[1] for p in pairs]
    tdcs.map_to_vol = True

    for idx, (pos, _) in enumerate(pairs):
        elec = tdcs.add_electrode()
        elec.channelnr = idx + 1
        elec.centre    = pos
        etype = electype[idx] if idx < len(electype) else "pad"
        if etype == "ring":
            elec.shape             = "ellipse"
            elec.dimensions        = [40, 40]
            elec.dimensions_sponge = [70, 70]
        else:
            elec.shape      = "rect"
            elec.dimensions = [70, 50]
        elec.thickness = [3, 3]

    print("Starting SimNIBS FEM solve…", flush=True)
    run_simnibs(s)
    print("SimNIBS FEM solve complete.", flush=True)

    # Check whether map_to_vol produced NIfTI files.
    # If not, fall back to manual mesh→NIfTI interpolation.
    import glob as _glob
    niftis_produced = _glob.glob(str(_Path(fem_dir) / "**" / "*.nii.gz"), recursive=True)
    if not niftis_produced:
        print("map_to_vol produced no NIfTI files — running manual interpolation fallback", flush=True)
        _export_fields_to_nifti(fem_dir, m2m_dir)
    else:
        print(f"map_to_vol produced {len(niftis_produced)} NIfTI file(s).", flush=True)


if __name__ == "__main__":
    main()
