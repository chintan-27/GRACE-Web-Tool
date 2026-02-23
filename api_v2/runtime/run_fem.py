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

from simnibs import sim_struct, run_simnibs


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

    # subpath = m2m directory (parent of the .msh file)
    # Required for map_to_vol so SimNIBS can find the T1 for interpolation.
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

    s = sim_struct.SESSION()
    s.fnamehead  = mesh_path
    s.subpath    = m2m_dir
    s.pathfem    = fem_dir
    s.map_to_mni = False

    tdcs = s.add_tdcslist()
    tdcs.currents  = [p[1] for p in pairs]
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


if __name__ == "__main__":
    main()
