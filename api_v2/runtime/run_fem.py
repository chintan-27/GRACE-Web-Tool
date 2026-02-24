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
# Mesh loading helpers (used only when map_to_vol fails)
# ---------------------------------------------------------------------------

# Nodes per Gmsh element type
_NN = {
    1: 2, 2: 3, 3: 4, 4: 4, 5: 8, 6: 6, 7: 5,
    8: 3, 9: 6, 10: 9, 11: 10, 12: 20, 13: 15, 14: 13, 15: 1,
}
# 3-D element types (tetrahedra, hexahedra, prisms, pyramids — linear & quadratic)
_3D_TYPES = {4, 5, 6, 7, 11, 12, 13, 14}


def _load_mesh_gmsh(msh_file: str):
    """
    Try to load the scalar mesh using the gmsh Python API.
    Returns (centroids, phys_tags, fields) or None if gmsh is unavailable.
    """
    try:
        import gmsh
    except ImportError:
        return None

    import numpy as np

    gmsh.initialize()
    try:
        gmsh.option.setNumber("General.Verbosity", 0)
        gmsh.open(str(msh_file))

        # ---- Nodes ----
        node_tags_raw, coords_flat, _ = gmsh.model.mesh.getNodes()
        node_tags_arr = np.array(node_tags_raw, dtype=np.int64)
        coords = np.array(coords_flat, dtype=np.float64).reshape(-1, 3)
        n_sort    = np.argsort(node_tags_arr)
        n_ids_s   = node_tags_arr[n_sort]
        n_xyz_s   = coords[n_sort]

        def lookup_xyz(nids: np.ndarray) -> np.ndarray:
            pos = np.searchsorted(n_ids_s, nids)
            pos = np.clip(pos, 0, len(n_ids_s) - 1)
            return n_xyz_s[pos]

        # ---- Element centroids + tags ----
        all_c, all_t, all_e = [], [], []
        for dim, ent in gmsh.model.getEntities():
            if dim < 3:
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
                nn = _NN.get(etype, 4)
                etags  = np.array(etags,       dtype=np.int64)
                enodes = np.array(enodes_flat, dtype=np.int64).reshape(-1, nn)
                n_sort2 = lookup_xyz(enodes.ravel()).reshape(-1, nn, 3)
                all_c.append(n_sort2.mean(axis=1))
                all_t.append(np.full(len(etags), ptag, dtype=np.int32))
                all_e.append(etags)

        if not all_c:
            return None

        centroids = np.concatenate(all_c)
        phys_tags = np.concatenate(all_t)
        elem_ids  = np.concatenate(all_e)
        e_sort    = np.argsort(elem_ids)
        e_ids_s   = elem_ids[e_sort]

        # ---- Field views ----
        n_elems   = len(elem_ids)
        view_tags = gmsh.view.getTags()
        print(f"  gmsh views loaded: {len(view_tags)}", flush=True)
        fields: dict[str, "np.ndarray"] = {}

        for vi, vtag in enumerate(view_tags):
            try:
                try:
                    vname = gmsh.option.getString(f"View[{vi}].Name")
                except Exception:
                    vname = f"field_{vi}"
                dtype, feid_list, data_list, _, nc = gmsh.view.getModelData(vtag, 0)
                if dtype != "ElementData" or nc == 0 or not feid_list:
                    continue
                feid_arr  = np.array(feid_list, dtype=np.int64)
                data_flat = np.array(data_list, dtype=np.float64)
                if data_flat.ndim == 1:
                    data_flat = data_flat.reshape(-1, max(nc, 1))
                pos   = np.searchsorted(e_ids_s, feid_arr)
                pos   = np.clip(pos, 0, n_elems - 1)
                found = e_ids_s[pos] == feid_arr
                vals  = np.zeros(n_elems, dtype=np.float64)
                if nc == 1:
                    vals[e_sort[pos[found]]] = data_flat[found, 0]
                else:
                    vals[e_sort[pos[found]]] = np.linalg.norm(data_flat[found], axis=1)
                fields[vname] = vals
                print(f"  gmsh field '{vname}' ({found.sum()} elements)", flush=True)
            except Exception as exc:
                print(f"  Skipping gmsh view {vtag}: {exc}", flush=True)

        return centroids, phys_tags, fields

    except Exception as exc:
        import traceback
        print(f"  gmsh load failed: {exc}", flush=True)
        traceback.print_exc()
        return None
    finally:
        gmsh.finalize()


def _load_mesh_ascii(msh_file: str):
    """
    Self-contained Gmsh .msh v2 ASCII parser.
    Handles only 3-D elements (tetrahedra etc.) for centroid computation.
    Returns (centroids, phys_tags, fields) or None on failure.

    Assumes SimNIBS convention: ntags = 2 per element (physical + geometric tag).
    If that assumption fails for a type group, falls back to per-line parsing.
    """
    from collections import defaultdict
    import numpy as np

    print(f"  Parsing ASCII .msh (self-contained): {msh_file}", flush=True)

    with open(msh_file, 'r') as fh:
        lines = fh.readlines()

    # ---- Find section boundaries -------------------------------------------
    # sections[name] = list of (first_content_line_idx, end_marker_line_idx)
    sections: dict[str, list[tuple[int, int]]] = defaultdict(list)
    i = 0
    while i < len(lines):
        s = lines[i].rstrip()
        if s.startswith('$') and not s.startswith('$End'):
            sec_name = s[1:]
            start = i + 1
            j = i + 1
            end_marker = f'$End{sec_name}'
            while j < len(lines) and lines[j].rstrip() != end_marker:
                j += 1
            sections[sec_name].append((start, j))
            i = j + 1
        else:
            i += 1

    # ---- Format check -------------------------------------------------------
    if 'MeshFormat' in sections:
        fmt_parts = lines[sections['MeshFormat'][0][0]].split()
        if len(fmt_parts) > 1 and fmt_parts[1] != '0':
            print("  .msh is binary — ASCII parser cannot handle binary format", flush=True)
            return None

    # ---- Nodes --------------------------------------------------------------
    if 'Nodes' not in sections:
        print("  No $Nodes section found", flush=True)
        return None

    ns, _ = sections['Nodes'][0]
    n_nodes = int(lines[ns])
    node_lines = [lines[ns + 1 + k].rstrip() for k in range(n_nodes)]
    node_flat = np.fromstring(' '.join(node_lines), sep=' ', dtype=np.float64)
    node_arr  = node_flat.reshape(-1, 4)       # [id, x, y, z]
    node_ids  = node_arr[:, 0].astype(np.int64)
    node_xyz  = node_arr[:, 1:]
    n_sort    = np.argsort(node_ids)
    n_ids_s   = node_ids[n_sort]
    n_xyz_s   = node_xyz[n_sort]

    def lookup_xyz(nids: np.ndarray) -> np.ndarray:
        pos = np.searchsorted(n_ids_s, nids)
        pos = np.clip(pos, 0, len(n_ids_s) - 1)
        return n_xyz_s[pos]

    # ---- Elements -----------------------------------------------------------
    if 'Elements' not in sections:
        print("  No $Elements section found", flush=True)
        return None

    es, _ = sections['Elements'][0]
    n_elem = int(lines[es])

    # Group 3-D element lines by type (minimal per-line work: only read 2nd token)
    type_groups: dict[int, list[str]] = defaultdict(list)
    for k in range(n_elem):
        raw = lines[es + 1 + k]
        parts2 = raw.split(None, 2)          # eid, etype, rest
        if len(parts2) < 2:
            continue
        etype = int(parts2[1])
        if etype in _3D_TYPES:
            type_groups[etype].append(raw.rstrip())

    all_c, all_t, all_e = [], [], []

    for etype, grp in type_groups.items():
        nn = _NN.get(etype, 4)
        # SimNIBS: ntags=2 → line = eid etype 2 phys geom n1…nN → (5+nn) fields
        n_meta  = 5
        nfields = n_meta + nn
        joined  = ' '.join(grp)
        flat    = np.fromstring(joined, sep=' ', dtype=np.int64)

        if flat.size % nfields != 0:
            # ntags ≠ 2 somewhere — fall back to per-line parse for this type
            print(f"  etype {etype}: batch parse failed, using per-line fallback", flush=True)
            pc, pt, pe = [], [], []
            for line in grp:
                p = line.split()
                ntg  = int(p[2])
                ptag = int(p[3]) if ntg > 0 else 0
                nids = np.array(p[3 + ntg: 3 + ntg + nn], dtype=np.int64)
                if len(nids) < nn:
                    continue
                pc.append(lookup_xyz(nids).mean(axis=0))
                pt.append(ptag)
                pe.append(int(p[0]))
            if pc:
                all_c.append(np.array(pc))
                all_t.append(np.array(pt, dtype=np.int32))
                all_e.append(np.array(pe, dtype=np.int64))
            continue

        arr      = flat.reshape(-1, nfields)
        eids     = arr[:, 0]
        phys_arr = arr[:, 3]                   # physical tag
        nids_arr = arr[:, n_meta:]             # (M, nn)

        flat_nids = nids_arr.ravel()
        flat_xyz  = lookup_xyz(flat_nids).reshape(-1, nn, 3)
        centroids = flat_xyz.mean(axis=1)

        all_c.append(centroids)
        all_t.append(phys_arr.astype(np.int32))
        all_e.append(eids)

    if not all_c:
        print("  No 3-D elements found in mesh", flush=True)
        return None

    centroids = np.concatenate(all_c, axis=0)
    phys_tags = np.concatenate(all_t, axis=0)
    elem_ids  = np.concatenate(all_e, axis=0)
    print(f"  Parsed {len(elem_ids):,} 3-D elements", flush=True)

    # ---- ElementData --------------------------------------------------------
    e_sort    = np.argsort(elem_ids)
    e_ids_s   = elem_ids[e_sort]
    n_elems   = len(elem_ids)
    fields: dict[str, "np.ndarray"] = {}

    for sec_start, _ in sections.get('ElementData', []):
        try:
            idx    = sec_start
            n_str  = int(lines[idx]); idx += 1
            fname  = lines[idx].strip().strip('"'); idx += n_str
            n_real = int(lines[idx]); idx += 1 + n_real
            n_int  = int(lines[idx]); idx += 1
            itags  = [int(lines[idx + k]) for k in range(n_int)]; idx += n_int
            n_comp = itags[1] if len(itags) > 1 else 1
            n_data = itags[2] if len(itags) > 2 else 0

            if n_data == 0:
                continue

            data_lines = [lines[idx + k].rstrip() for k in range(n_data)]
            data_flat  = np.fromstring(' '.join(data_lines), sep=' ', dtype=np.float64)
            data_arr   = data_flat.reshape(-1, 1 + n_comp)
            feid_arr   = data_arr[:, 0].astype(np.int64)

            vals = data_arr[:, 1] if n_comp == 1 else np.linalg.norm(data_arr[:, 1:], axis=1)

            pos   = np.searchsorted(e_ids_s, feid_arr)
            pos   = np.clip(pos, 0, n_elems - 1)
            found = e_ids_s[pos] == feid_arr

            fvals = np.zeros(n_elems, dtype=np.float64)
            fvals[e_sort[pos[found]]] = vals[found]
            fields[fname] = fvals
            print(f"  Parsed field '{fname}' ({found.sum()} matching elements)", flush=True)

        except Exception as exc:
            print(f"  Skipping ElementData section: {exc}", flush=True)

    return centroids, phys_tags, fields


# ---------------------------------------------------------------------------
# Main fallback: interpolate mesh fields onto NIfTI grid
# ---------------------------------------------------------------------------

def _export_fields_to_nifti(fem_dir: str, m2m_dir: str) -> None:
    """
    Interpolate FEM fields from the scalar mesh to NIfTI volume via
    nearest-neighbour (KDTree) when SimNIBS map_to_vol produces nothing.
    """
    from pathlib import Path
    import numpy as np
    import nibabel as nib
    from scipy.spatial import cKDTree

    fem_path = Path(fem_dir)
    m2m_path = Path(m2m_dir)

    # Locate scalar mesh
    scalar_meshes = sorted(fem_path.rglob("*_scalar.msh"))
    if not scalar_meshes:
        print("WARNING: No _scalar.msh found — cannot do manual interpolation", flush=True)
        return

    scalar_mesh_file = scalar_meshes[0]
    subject = scalar_mesh_file.name.split("_TDCS_")[0]

    # Reference NIfTI for grid geometry
    ref_nii_path = m2m_path / "T1fs_conform.nii.gz"
    if not ref_nii_path.exists():
        ref_nii_path = m2m_path / "T1.nii.gz"
    if not ref_nii_path.exists():
        print("WARNING: No reference NIfTI in m2m dir — cannot do manual interpolation", flush=True)
        return

    print(f"Manual mesh→NIfTI interpolation using {scalar_mesh_file.name}", flush=True)

    # ---- Load mesh (gmsh API → ASCII parser) --------------------------------
    result = _load_mesh_gmsh(str(scalar_mesh_file))
    if result is None:
        result = _load_mesh_ascii(str(scalar_mesh_file))
    if result is None:
        print("ERROR: Cannot load scalar mesh — skipping manual interpolation", flush=True)
        return

    centroids, phys_tags, fields = result
    print(f"  Total elements: {len(centroids):,}", flush=True)

    # Restrict to brain/head tissue (SimNIBS tags 1-10)
    tissue_mask      = (phys_tags >= 1) & (phys_tags <= 10)
    tissue_centroids = centroids[tissue_mask]
    print(f"  Tissue elements: {tissue_mask.sum():,}", flush=True)

    if tissue_mask.sum() == 0:
        print("WARNING: No tissue elements (tags 1-10) — using all elements", flush=True)
        tissue_mask      = np.ones(len(phys_tags), dtype=bool)
        tissue_centroids = centroids

    # ---- KDTree on tissue centroids -----------------------------------------
    tree = cKDTree(tissue_centroids)

    # ---- Voxel world coordinates --------------------------------------------
    ref_img = nib.load(str(ref_nii_path))
    affine  = ref_img.affine
    shape   = ref_img.shape[:3]

    i_idx, j_idx, k_idx = np.mgrid[0:shape[0], 0:shape[1], 0:shape[2]]
    vox_ijk   = np.column_stack([i_idx.ravel(), j_idx.ravel(), k_idx.ravel()]).astype(np.float32)
    world_xyz = nib.affines.apply_affine(affine, vox_ijk)

    print(f"  Querying KDTree for {world_xyz.shape[0]:,} voxels…", flush=True)
    _, nn_idx = tree.query(world_xyz, workers=-1)

    # ---- Select fields to export --------------------------------------------
    fields_to_save: dict[str, "np.ndarray"] = {}
    for fname, fvals in fields.items():
        if fname in ("magnE", "E_norm", "normE"):
            fields_to_save["magnE"] = fvals[tissue_mask]
        elif fname == "E" and "magnE" not in fields_to_save:
            fields_to_save["magnE"] = fvals[tissue_mask]
        elif fname == "v":
            fields_to_save["v"] = fvals[tissue_mask]

    if not fields_to_save:
        print(f"WARNING: No magnE/v fields found. Available: {list(fields.keys())}", flush=True)
        return

    # ---- Interpolate and save -----------------------------------------------
    for field_key, tissue_vals in fields_to_save.items():
        vol_flat = tissue_vals[nn_idx]
        vol      = vol_flat.reshape(shape).astype(np.float32)
        out_name = f"{subject}_TDCS_1_{field_key}.nii.gz"
        nib.save(nib.Nifti1Image(vol, affine, ref_img.header), str(fem_path / out_name))
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
