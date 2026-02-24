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


# ---------------------------------------------------------------------------
# Helpers for manual mesh → NIfTI fallback
# ---------------------------------------------------------------------------

def _load_mesh_gmsh(msh_file: str):
    """
    Load element centroids, physical tags, and field data from a Gmsh .msh file
    using the gmsh Python API (always present in the SimNIBS environment).

    Returns (centroids, phys_tags, fields) where:
      centroids  : np.ndarray (N, 3) world-space mm coordinates
      phys_tags  : np.ndarray (N,)   physical / tissue tag per element
      fields     : dict[str, np.ndarray]  field_name → scalar value per element

    Returns None if gmsh cannot be imported.
    """
    try:
        import gmsh
    except ImportError:
        print("  gmsh Python API not available — cannot read scalar mesh", flush=True)
        return None

    import numpy as np

    gmsh.initialize()
    try:
        gmsh.option.setNumber("General.Verbosity", 0)
        gmsh.open(str(msh_file))

        # ---- Node lookup ----
        node_tags_raw, coords_flat, _ = gmsh.model.mesh.getNodes()
        node_tags_arr = np.array(node_tags_raw, dtype=np.int64)
        coords = np.array(coords_flat, dtype=np.float64).reshape(-1, 3)

        # Build a fast sorted-array lookup: node_tag → row in coords
        sorted_order = np.argsort(node_tags_arr)
        sorted_tags  = node_tags_arr[sorted_order]

        def resolve_node_indices(flat_node_tags: np.ndarray) -> np.ndarray:
            """Binary-search node tags → row indices in `coords`."""
            pos = np.searchsorted(sorted_tags, flat_node_tags)
            pos = np.clip(pos, 0, len(sorted_tags) - 1)
            return sorted_order[pos]

        # ---- Element centroids + physical tags ----
        all_centroids: list[np.ndarray] = []
        all_phys_tags: list[np.ndarray] = []
        all_elem_ids:  list[np.ndarray] = []

        for dim, ent in gmsh.model.getEntities():
            if dim < 2:
                continue
            try:
                phys = gmsh.model.getPhysicalGroupsForEntity(dim, ent)
                ptag = int(phys[0]) if phys else 0
            except Exception:
                ptag = 0

            try:
                etypes, etag_arrs, enode_arrs = gmsh.model.mesh.getElements(dim, ent)
            except Exception:
                continue

            for etype, etags, enodes_flat in zip(etypes, etag_arrs, enode_arrs):
                props = gmsh.model.mesh.getElementProperties(etype)
                nn = props[3]  # nodes per element
                etags   = np.array(etags,       dtype=np.int64)
                enodes  = np.array(enodes_flat, dtype=np.int64).reshape(-1, nn)

                # Vectorised centroid: coords for all nodes, averaged over nn
                indices = resolve_node_indices(enodes.ravel()).reshape(-1, nn)
                block_coords    = coords[indices]             # (M, nn, 3)
                block_centroids = block_coords.mean(axis=1)  # (M, 3)

                all_centroids.append(block_centroids)
                all_phys_tags.append(np.full(len(etags), ptag, dtype=np.int32))
                all_elem_ids.append(etags)

        if not all_centroids:
            print("  No 2-D/3-D elements found in mesh", flush=True)
            return None

        centroids = np.concatenate(all_centroids, axis=0)
        phys_tags = np.concatenate(all_phys_tags, axis=0)
        elem_ids  = np.concatenate(all_elem_ids,  axis=0)

        # Sorted element IDs for fast vectorised lookup (avoids Python dict loop)
        eid_sort_order = np.argsort(elem_ids)
        eid_sorted     = elem_ids[eid_sort_order]

        def resolve_elem_positions(query_eids: np.ndarray) -> np.ndarray:
            """Return index into centroids array for each query element ID (-1 if missing)."""
            pos = np.searchsorted(eid_sorted, query_eids)
            pos = np.clip(pos, 0, len(eid_sorted) - 1)
            found = eid_sorted[pos] == query_eids
            out = np.where(found, eid_sort_order[pos], -1)
            return out

        # ---- Field data from gmsh views (ElementData sections) ----
        n_elems   = len(elem_ids)
        view_tags = gmsh.view.getTags()
        print(f"  Scalar mesh views: {len(view_tags)}", flush=True)
        fields: dict[str, np.ndarray] = {}

        for vi, vtag in enumerate(view_tags):
            try:
                try:
                    vname = gmsh.option.getString(f"View[{vi}].Name")
                except Exception:
                    vname = f"field_{vi}"

                dtype, feid_list, data_list, _, nc = gmsh.view.getModelData(vtag, 0)
                if dtype != "ElementData" or nc == 0 or not feid_list:
                    print(f"  Skipping view '{vname}' (type={dtype}, nc={nc})", flush=True)
                    continue

                feid_arr  = np.array(feid_list, dtype=np.int64)
                data_flat = np.array(data_list,  dtype=np.float64)
                if data_flat.ndim == 1:
                    data_flat = data_flat.reshape(-1, max(nc, 1))

                # Vectorised element-ID → position mapping
                pos_arr = resolve_elem_positions(feid_arr)
                valid   = pos_arr >= 0

                vals = np.zeros(n_elems, dtype=np.float64)
                if nc == 1:
                    vals[pos_arr[valid]] = data_flat[valid, 0]
                else:
                    vals[pos_arr[valid]] = np.linalg.norm(data_flat[valid], axis=1)

                fields[vname] = vals
                print(f"  Loaded field '{vname}' ({valid.sum()} elements)", flush=True)

            except Exception as exc:
                print(f"  Skipping view {vtag}: {exc}", flush=True)

        return centroids, phys_tags, fields

    except Exception as exc:
        import traceback
        print(f"  Error loading mesh with gmsh: {exc}", flush=True)
        traceback.print_exc()
        return None

    finally:
        gmsh.finalize()


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

    fem_path = Path(fem_dir)
    m2m_path = Path(m2m_dir)

    # Locate scalar mesh produced by run_simnibs
    scalar_meshes = sorted(fem_path.rglob("*_scalar.msh"))
    if not scalar_meshes:
        print("WARNING: No _scalar.msh found — cannot do manual interpolation", flush=True)
        return

    scalar_mesh_file = scalar_meshes[0]
    # Derive subject prefix, e.g. "subject_TDCS_1_scalar.msh" → "subject"
    subject = scalar_mesh_file.name.split("_TDCS_")[0]

    # Reference NIfTI for grid geometry
    ref_nii_path = m2m_path / "T1fs_conform.nii.gz"
    if not ref_nii_path.exists():
        ref_nii_path = m2m_path / "T1.nii.gz"
    if not ref_nii_path.exists():
        print("WARNING: No reference NIfTI in m2m dir — cannot do manual interpolation", flush=True)
        return

    print(f"Manual mesh→NIfTI interpolation using {scalar_mesh_file.name}", flush=True)

    # ---- Load mesh ----
    result = _load_mesh_gmsh(str(scalar_mesh_file))
    if result is None:
        print("ERROR: Cannot load scalar mesh — skipping manual interpolation", flush=True)
        return

    centroids, phys_tags, fields = result
    print(f"  Total elements: {len(centroids)}", flush=True)

    # Keep only head/brain tissue elements (SimNIBS tags 1-10)
    tissue_mask      = (phys_tags >= 1) & (phys_tags <= 10)
    tissue_centroids = centroids[tissue_mask]
    print(f"  Tissue elements: {tissue_mask.sum()}", flush=True)

    if tissue_mask.sum() == 0:
        print("WARNING: No tissue elements (tags 1-10) found — using all elements", flush=True)
        tissue_mask      = np.ones(len(phys_tags), dtype=bool)
        tissue_centroids = centroids

    # ---- Build KDTree ----
    tree = cKDTree(tissue_centroids)

    # ---- Voxel grid in world coordinates ----
    ref_img = nib.load(str(ref_nii_path))
    affine  = ref_img.affine
    shape   = ref_img.shape[:3]

    i_idx, j_idx, k_idx = np.mgrid[0:shape[0], 0:shape[1], 0:shape[2]]
    vox_ijk   = np.column_stack([i_idx.ravel(), j_idx.ravel(), k_idx.ravel()]).astype(np.float32)
    world_xyz = nib.affines.apply_affine(affine, vox_ijk)   # (V, 3)

    print(f"  Querying KDTree for {world_xyz.shape[0]:,} voxels…", flush=True)
    _dists, nn_idx = tree.query(world_xyz, workers=-1)

    # ---- Select fields to save ----
    fields_to_save: dict[str, np.ndarray] = {}
    for fname, fvals in fields.items():
        if fname in ("magnE", "E_norm", "normE"):
            fields_to_save["magnE"] = fvals[tissue_mask]
        elif fname == "E" and "magnE" not in fields_to_save:
            fields_to_save["magnE"] = fvals[tissue_mask]
        elif fname == "v":
            fields_to_save["v"] = fvals[tissue_mask]

    if not fields_to_save:
        available = list(fields.keys())
        print(f"WARNING: No magnE/v fields in scalar mesh. Available: {available}", flush=True)
        return

    # ---- Interpolate and save ----
    for field_key, tissue_vals in fields_to_save.items():
        vol_flat = tissue_vals[nn_idx]
        vol      = vol_flat.reshape(shape).astype(np.float32)
        out_name = f"{subject}_TDCS_1_{field_key}.nii.gz"
        out_path = fem_path / out_name
        nib.save(nib.Nifti1Image(vol, affine, ref_img.header), str(out_path))
        print(f"  Saved {out_name}", flush=True)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

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
    # If not, fall back to manual mesh→NIfTI interpolation via gmsh API.
    import glob as _glob
    niftis_produced = _glob.glob(str(_Path(fem_dir) / "**" / "*.nii.gz"), recursive=True)
    if not niftis_produced:
        print("map_to_vol produced no NIfTI files — running manual interpolation fallback", flush=True)
        _export_fields_to_nifti(fem_dir, m2m_dir)
    else:
        print(f"map_to_vol produced {len(niftis_produced)} NIfTI file(s).", flush=True)


if __name__ == "__main__":
    main()
