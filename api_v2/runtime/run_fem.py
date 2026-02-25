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

# Nodes per Gmsh element type (linear and quadratic elements)
_NN = {
    1: 2, 2: 3, 3: 4, 4: 4, 5: 8, 6: 6, 7: 5,
    8: 3, 9: 6, 10: 9, 11: 10, 12: 20, 13: 15, 14: 13, 15: 1,
}
# 3-D element types (tetrahedra, hexahedra, prisms, pyramids — linear & quadratic)
_3D = {4, 5, 6, 7, 11, 12, 13, 14}


# ---------------------------------------------------------------------------
# Mesh loading — gmsh Python API (fast path, often unavailable)
# ---------------------------------------------------------------------------

def _load_mesh_gmsh(msh_file: str):
    """
    Try to load via the gmsh Python API.
    Returns (centroids, phys_tags, fields) or None if gmsh is not importable.
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

        node_tags_raw, coords_flat, _ = gmsh.model.mesh.getNodes()
        node_tags_arr = np.array(node_tags_raw, dtype=np.int64)
        coords = np.array(coords_flat, dtype=np.float64).reshape(-1, 3)
        ns = np.argsort(node_tags_arr)
        n_ids_s = node_tags_arr[ns]
        n_xyz_s = coords[ns]

        def lookup_xyz(nids: np.ndarray) -> np.ndarray:
            pos = np.searchsorted(n_ids_s, nids)
            return n_xyz_s[np.clip(pos, 0, len(n_ids_s) - 1)]

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
                xyz    = lookup_xyz(enodes.ravel()).reshape(-1, nn, 3)
                all_c.append(xyz.mean(axis=1))
                all_t.append(np.full(len(etags), ptag, dtype=np.int32))
                all_e.append(etags)

        if not all_c:
            return None

        centroids = np.concatenate(all_c)
        phys_tags = np.concatenate(all_t)
        elem_ids  = np.concatenate(all_e)
        e_sort    = np.argsort(elem_ids)
        e_ids_s   = elem_ids[e_sort]
        n_elems   = len(elem_ids)
        fields: dict = {}

        for vi, vtag in enumerate(gmsh.view.getTags()):
            try:
                try:
                    vname = gmsh.option.getString(f"View[{vi}].Name")
                except Exception:
                    vname = f"field_{vi}"
                dtype, feid_list, data_list, _, nc = gmsh.view.getModelData(vtag, 0)
                if dtype != "ElementData" or nc == 0 or not feid_list:
                    continue
                feid  = np.array(feid_list, dtype=np.int64)
                dflat = np.array(data_list, dtype=np.float64)
                if dflat.ndim == 1:
                    dflat = dflat.reshape(-1, max(nc, 1))
                pos   = np.searchsorted(e_ids_s, feid)
                pos   = np.clip(pos, 0, n_elems - 1)
                found = e_ids_s[pos] == feid
                vals  = np.zeros(n_elems, dtype=np.float64)
                if nc == 1:
                    vals[e_sort[pos[found]]] = dflat[found, 0]
                else:
                    vals[e_sort[pos[found]]] = np.linalg.norm(dflat[found], axis=1)
                fields[vname] = vals
                print(f"  gmsh field '{vname}' ({found.sum()} elems)", flush=True)
            except Exception as exc:
                print(f"  Skip view {vtag}: {exc}", flush=True)

        return centroids, phys_tags, fields

    except Exception as exc:
        import traceback
        print(f"  gmsh load failed: {exc}", flush=True)
        traceback.print_exc()
        return None
    finally:
        gmsh.finalize()


# ---------------------------------------------------------------------------
# Mesh loading — self-contained .msh v2 parser (ASCII + binary)
# ---------------------------------------------------------------------------

def _load_mesh_msh(msh_file: str):
    """
    Self-contained Gmsh .msh v2 parser supporting both ASCII and binary modes.

    Binary .msh v2 layout (all integers are int32, floats are float64):
      $Nodes:        N×[int32 id, float64 x, y, z]             (28 bytes/node)
      $Elements:     repeated blocks [int32 etype, n, ntags]
                     then n×[int32 id, int32×ntags tags, int32×nn node_ids]
      $ElementData:  ASCII header; binary N×[int32 id, float64×nc values]

    Only 3-D elements (tags in _3D) are used for centroid computation.
    Returns (centroids, phys_tags, fields) or None on failure.
    """
    import numpy as np
    from collections import defaultdict

    print(f"  Parsing .msh file: {msh_file}", flush=True)

    # ---- State shared across section handlers ----
    n_ids_s = n_xyz_s = None          # sorted node arrays (set in $Nodes)
    centroids = phys_tags = elem_ids = None
    e_sort = e_ids_s = None
    n_elems = 0
    all_c: list = []
    all_t: list = []
    all_e: list = []
    fields: dict = {}
    is_bin = False
    endian = '<'

    def lookup_xyz(nids: np.ndarray) -> np.ndarray:
        pos = np.searchsorted(n_ids_s, nids)
        return n_xyz_s[np.clip(pos, 0, len(n_ids_s) - 1)]

    def _finalise_elements():
        nonlocal centroids, phys_tags, elem_ids, e_sort, e_ids_s, n_elems
        if all_c:
            centroids = np.concatenate(all_c)
            phys_tags = np.concatenate(all_t)
            elem_ids  = np.concatenate(all_e)
            e_sort    = np.argsort(elem_ids)
            e_ids_s   = elem_ids[e_sort]
            n_elems   = len(elem_ids)
            print(f"  Parsed {n_elems:,} 3-D elements", flush=True)

    def _map_field(feid: np.ndarray, vals: np.ndarray) -> np.ndarray:
        pos   = np.searchsorted(e_ids_s, feid)
        pos   = np.clip(pos, 0, n_elems - 1)
        found = e_ids_s[pos] == feid
        fvals = np.zeros(n_elems, dtype=np.float64)
        fvals[e_sort[pos[found]]] = vals[found]
        return fvals, found.sum()

    with open(msh_file, 'rb') as fh:

        # ---- $MeshFormat (always first section) ----
        fh.readline()  # "$MeshFormat\n"
        fmt_line = fh.readline().decode('ascii').split()
        is_bin   = (fmt_line[1] == '1')
        if is_bin:
            ev     = np.frombuffer(fh.read(4), dtype='<i4')[0]
            endian = '<' if ev == 1 else '>'
            fh.readline()   # \n after endian int
        # $EndMeshFormat consumed by the main loop's continue

        # ---- Main section loop ----
        while True:
            raw = fh.readline()
            if not raw:
                break
            section = raw.decode('ascii', errors='replace').strip()

            # Skip end-markers and blank/unknown lines
            if not section.startswith('$') or section.startswith('$End'):
                continue
            section = section[1:]   # strip '$'

            # ================================================================
            if section == 'Nodes':
                n_nodes = int(fh.readline())
                if is_bin:
                    dt = np.dtype([('id', f'{endian}i4'),
                                   ('xyz', f'{endian}f8', 3)])
                    node_arr = np.frombuffer(fh.read(n_nodes * dt.itemsize), dtype=dt)
                    fh.readline()   # trailing \n
                    node_ids = node_arr['id'].astype(np.int64)
                    node_xyz = node_arr['xyz']
                else:
                    lines = [fh.readline() for _ in range(n_nodes)]
                    flat  = np.fromstring(
                        b''.join(lines).replace(b'\n', b' '), sep=' ', dtype=np.float64)
                    arr      = flat.reshape(-1, 4)
                    node_ids = arr[:, 0].astype(np.int64)
                    node_xyz = arr[:, 1:]

                ns      = np.argsort(node_ids)
                n_ids_s = node_ids[ns]
                n_xyz_s = node_xyz[ns]

            # ================================================================
            elif section == 'Elements':
                n_total = int(fh.readline())
                if is_bin:
                    n_read = 0
                    while n_read < n_total:
                        hdr    = np.frombuffer(fh.read(12), dtype=f'{endian}i4')
                        etype, n_blk, n_tags = int(hdr[0]), int(hdr[1]), int(hdr[2])
                        nn     = _NN.get(etype, 0)
                        fpe    = 1 + n_tags + nn           # int32 fields per element
                        blk    = np.frombuffer(
                            fh.read(n_blk * fpe * 4),
                            dtype=f'{endian}i4').reshape(n_blk, fpe)
                        if etype in _3D and nn > 0:
                            eids     = blk[:, 0].astype(np.int64)
                            phys_arr = blk[:, 1].astype(np.int32) if n_tags > 0 \
                                       else np.zeros(n_blk, np.int32)
                            nids_arr = blk[:, 1 + n_tags:].astype(np.int64)
                            xyz      = lookup_xyz(nids_arr.ravel()).reshape(-1, nn, 3)
                            all_c.append(xyz.mean(axis=1))
                            all_t.append(phys_arr)
                            all_e.append(eids)
                        n_read += n_blk
                    fh.readline()   # trailing \n after all blocks
                else:
                    # ASCII: group lines by element type for batch-numpy processing
                    tg: dict = defaultdict(list)
                    for _ in range(n_total):
                        ln = fh.readline()
                        p2 = ln.split(None, 2)
                        if len(p2) >= 2:
                            etype = int(p2[1])
                            if etype in _3D:
                                tg[etype].append(ln)
                    for etype, grp in tg.items():
                        nn = _NN.get(etype, 4)
                        nf = 5 + nn   # eid etype ntags phys geom node×nn
                        flat = np.fromstring(
                            b''.join(grp).replace(b'\n', b' '), sep=' ', dtype=np.int64)
                        if flat.size % nf != 0:
                            continue
                        arr      = flat.reshape(-1, nf)
                        nids_arr = arr[:, 5:].astype(np.int64)
                        xyz      = lookup_xyz(nids_arr.ravel()).reshape(-1, nn, 3)
                        all_c.append(xyz.mean(axis=1))
                        all_t.append(arr[:, 3].astype(np.int32))
                        all_e.append(arr[:, 0].astype(np.int64))

                _finalise_elements()

            # ================================================================
            elif section == 'ElementData':
                if e_ids_s is None:
                    # Elements not yet parsed — skip to $EndElementData
                    for skip in fh:
                        if skip.strip() == b'$EndElementData':
                            break
                    continue

                # --- ASCII header (identical in both ASCII and binary modes) ---
                n_str  = int(fh.readline())
                fname  = fh.readline().decode('ascii').strip().strip('"')
                for _ in range(n_str - 1):
                    fh.readline()
                n_real = int(fh.readline())
                for _ in range(n_real):
                    fh.readline()
                n_int  = int(fh.readline())
                itags  = [int(fh.readline()) for _ in range(n_int)]
                n_comp = itags[1] if len(itags) > 1 else 1
                n_data = itags[2] if len(itags) > 2 else 0

                if n_data == 0:
                    continue

                # --- Data block ---
                if is_bin:
                    dt   = np.dtype([('id', f'{endian}i4'),
                                     ('v',  f'{endian}f8', n_comp)])
                    arr  = np.frombuffer(fh.read(n_data * dt.itemsize), dtype=dt)
                    feid = arr['id'].astype(np.int64)
                    vraw = arr['v'].reshape(-1, n_comp)
                    fh.readline()   # trailing \n
                else:
                    lines = [fh.readline() for _ in range(n_data)]
                    flat  = np.fromstring(
                        b''.join(lines).replace(b'\n', b' '), sep=' ', dtype=np.float64)
                    da   = flat.reshape(-1, 1 + n_comp)
                    feid = da[:, 0].astype(np.int64)
                    vraw = da[:, 1:].reshape(-1, n_comp)

                vals          = vraw[:, 0] if n_comp == 1 else np.linalg.norm(vraw, axis=1)
                fvals, n_hit  = _map_field(feid, vals)
                fields[fname] = fvals
                print(f"  Field '{fname}' ({n_hit:,} elements matched)", flush=True)

            # ================================================================
            elif section == 'NodeData':
                # Electric potential 'v' is node-based in some SimNIBS versions.
                # Interpolate to element centroids via nearest-neighbour lookup.
                if n_ids_s is None or centroids is None:
                    end_tag = b'$EndNodeData'
                    for skip in fh:
                        if skip.strip() == end_tag:
                            break
                    continue

                n_str  = int(fh.readline())
                fname  = fh.readline().decode('ascii').strip().strip('"')
                for _ in range(n_str - 1):
                    fh.readline()
                n_real = int(fh.readline())
                for _ in range(n_real):
                    fh.readline()
                n_int  = int(fh.readline())
                itags  = [int(fh.readline()) for _ in range(n_int)]
                n_comp = itags[1] if len(itags) > 1 else 1
                n_data = itags[2] if len(itags) > 2 else 0

                if n_data == 0:
                    continue

                if is_bin:
                    dt   = np.dtype([('id', f'{endian}i4'),
                                     ('v',  f'{endian}f8', n_comp)])
                    arr  = np.frombuffer(fh.read(n_data * dt.itemsize), dtype=dt)
                    nids = arr['id'].astype(np.int64)
                    vraw = arr['v'].reshape(-1, n_comp)
                    fh.readline()   # trailing \n
                else:
                    lines = [fh.readline() for _ in range(n_data)]
                    flat  = np.fromstring(
                        b''.join(lines).replace(b'\n', b' '), sep=' ', dtype=np.float64)
                    da   = flat.reshape(-1, 1 + n_comp)
                    nids = da[:, 0].astype(np.int64)
                    vraw = da[:, 1:].reshape(-1, n_comp)

                vals_1d = vraw[:, 0] if n_comp == 1 else np.linalg.norm(vraw, axis=1)

                # Build dense node-value array (indexed in sorted node order)
                pos     = np.searchsorted(n_ids_s, nids)
                pos     = np.clip(pos, 0, len(n_ids_s) - 1)
                matched = n_ids_s[pos] == nids
                node_vals = np.zeros(len(n_ids_s), dtype=np.float64)
                node_vals[pos[matched]] = vals_1d[matched]

                # Nearest-node interpolation to element centroids
                from scipy.spatial import cKDTree as _nd_cKDTree
                ntree          = _nd_cKDTree(n_xyz_s)
                _, nn_idx      = ntree.query(centroids)
                fields[fname]  = node_vals[nn_idx]
                print(f"  NodeData '{fname}' interpolated to {n_elems:,} elements",
                      flush=True)

            # ================================================================
            else:
                # Unknown section — skip to its end marker
                end_tag = f'$End{section}'.encode()
                for skip in fh:
                    if skip.strip() == end_tag:
                        break

    if centroids is None or len(centroids) == 0:
        print("  No 3-D elements parsed — check mesh format", flush=True)
        return None

    return centroids, phys_tags, fields


# ---------------------------------------------------------------------------
# Main fallback: interpolate mesh fields onto NIfTI grid
# ---------------------------------------------------------------------------

def _export_fields_to_nifti(fem_dir: str, m2m_dir: str) -> None:
    """
    Interpolate FEM fields from the scalar mesh to NIfTI volume via
    nearest-neighbour KDTree when SimNIBS map_to_vol produces nothing.
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
        print("WARNING: No reference NIfTI in m2m dir — cannot do manual interpolation",
              flush=True)
        return

    print(f"Manual mesh→NIfTI interpolation using {scalar_mesh_file.name}", flush=True)

    # ---- Load mesh (gmsh API → self-contained parser) ----------------------
    result = _load_mesh_gmsh(str(scalar_mesh_file))
    if result is None:
        result = _load_mesh_msh(str(scalar_mesh_file))
    if result is None:
        print("ERROR: Cannot load scalar mesh — skipping manual interpolation", flush=True)
        return

    centroids, phys_tags, fields = result
    print(f"  Total 3-D elements: {len(centroids):,}", flush=True)

    # Restrict to brain/head tissue (SimNIBS tags 1-10)
    tissue_mask      = (phys_tags >= 1) & (phys_tags <= 10)
    tissue_centroids = centroids[tissue_mask]
    print(f"  Tissue elements (tags 1-10): {tissue_mask.sum():,}", flush=True)

    if tissue_mask.sum() == 0:
        print("WARNING: No tissue elements found — using all elements", flush=True)
        tissue_mask      = np.ones(len(phys_tags), dtype=bool)
        tissue_centroids = centroids

    # ---- KDTree + voxel grid -----------------------------------------------
    tree = cKDTree(tissue_centroids)

    ref_img   = nib.load(str(ref_nii_path))
    affine    = ref_img.affine
    shape     = ref_img.shape[:3]
    i_i, j_i, k_i = np.mgrid[0:shape[0], 0:shape[1], 0:shape[2]]
    vox_ijk   = np.column_stack([i_i.ravel(), j_i.ravel(), k_i.ravel()]).astype(np.float32)
    world_xyz = nib.affines.apply_affine(affine, vox_ijk)

    print(f"  Querying KDTree for {world_xyz.shape[0]:,} voxels…", flush=True)
    _, nn_idx = tree.query(world_xyz, workers=-1)

    # ---- Select and save fields --------------------------------------------
    fields_to_save: dict = {}
    for fname, fvals in fields.items():
        if fname in ("magnE", "E_norm", "normE"):
            fields_to_save["magnE"] = fvals[tissue_mask]
        elif fname == "E" and "magnE" not in fields_to_save:
            fields_to_save["magnE"] = fvals[tissue_mask]
        elif fname == "v":
            fields_to_save["v"] = fvals[tissue_mask]

    if not fields_to_save:
        print(f"WARNING: No magnE/v fields found. Available: {list(fields.keys())}",
              flush=True)
        return

    for field_key, tissue_vals in fields_to_save.items():
        vol      = tissue_vals[nn_idx].reshape(shape).astype(np.float32)
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
    # created.  T1.nii.gz is in the same 1 mm isotropic RAS space, so we
    # copy it as a stand-in before launching the FEM solve.
    t1fs_conform = _Path(m2m_dir) / "T1fs_conform.nii.gz"
    if not t1fs_conform.exists():
        t1_src = _Path(m2m_dir) / "T1.nii.gz"
        if t1_src.exists():
            _shutil.copy2(str(t1_src), str(t1fs_conform))
            print("Created T1fs_conform.nii.gz from T1.nii.gz for map_to_vol", flush=True)
        else:
            print("WARNING: T1.nii.gz not found — map_to_vol may fail", flush=True)

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

    # Check whether map_to_vol produced BOTH required NIfTI files.
    # map_to_vol reliably exports magnE but often skips the voltage (v) NIfTI.
    # When any required output is missing, fall back to manual mesh→NIfTI
    # interpolation from the _scalar.msh which contains both magnE and v fields.
    import glob as _glob
    emag_niftis = _glob.glob(str(_Path(fem_dir) / "**" / "*_magnE.nii.gz"), recursive=True)
    volt_niftis = _glob.glob(str(_Path(fem_dir) / "**" / "*_v.nii.gz"),     recursive=True)

    if not emag_niftis or not volt_niftis:
        missing = []
        if not emag_niftis:
            missing.append("magnE")
        if not volt_niftis:
            missing.append("voltage (v)")
        print(
            f"map_to_vol did not produce: {missing} — running manual interpolation fallback",
            flush=True,
        )
        _export_fields_to_nifti(fem_dir, m2m_dir)
    else:
        print("map_to_vol produced both magnE and voltage NIfTIs.", flush=True)


if __name__ == "__main__":
    main()
