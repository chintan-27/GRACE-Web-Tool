#!/usr/bin/env python3
"""
Run a SimNIBS tDCS j-field FEM simulation and post-process WM/GM masked outputs.
Called by SimNIBSRunner.run_fem() via the SimNIBS Python interpreter (which has simnibs).

Usage:
    python run_fem.py <mesh_path> <m2m_dir> <fem_dir> <recipe_json> <electype_json>

mesh_path     : path to <subject>_custom_mesh.msh produced by meshmesh
m2m_dir       : path to m2m_subject/ folder (contains eeg_positions/, custom_tissues.nii.gz)
fem_dir       : output directory for FEM results
recipe_json   : JSON array alternating position/current_mA pairs, e.g. '["F3",2,"F4",-2]'
electype_json : JSON array of electrode type strings (unused, kept for API compatibility)

Conductivity values (S/m) match ROAST defaults:
  WM=0.126, GM=0.276, CSF=1.65, Bone=5.52e-3, Scalp=0.465,
  Eyes=0.5, Compact_bone=5.52e-3, Spongy_bone=2.14e-2,
  Blood=0.67, Muscle=0.16, fat(11)=0.25, air(12)=2.5e-14
"""
import glob
import json
import sys
from pathlib import Path

import nibabel as nib
import numpy as np


def _find_eeg_cap(m2m_dir: Path) -> str | None:
    eeg_folder = m2m_dir / "eeg_positions"
    caps = glob.glob(str(eeg_folder / "*Okamoto_2004.csv"))
    if caps:
        return caps[0]
    # Fall back to any CSV in eeg_positions
    caps = glob.glob(str(eeg_folder / "*.csv"))
    return caps[0] if caps else None


def _create_masked_outputs(fem_dir: Path, m2m_dir: Path, subject: str) -> None:
    """
    Create WM-masked, GM-masked, and WM+GM-masked magnJ NIfTIs.
    Reads custom_tissues.nii.gz from m2m_dir (CHARM labels, WM=1, GM=2).
    Saves wm_magnJ, gm_magnJ, wm_gm_magnJ into the subject_volumes subdirectory.
    """
    # Find magnJ file
    sv_dir  = fem_dir / "subject_volumes"
    magnj_files = list(sv_dir.rglob(f"*magnJ.nii.gz")) if sv_dir.exists() else []
    if not magnj_files:
        magnj_files = list(fem_dir.rglob(f"*magnJ.nii.gz"))
    if not magnj_files:
        print("WARNING: magnJ.nii.gz not found — skipping WM/GM masked outputs", flush=True)
        return

    magnj_file = magnj_files[0]
    sv_out_dir = magnj_file.parent   # save masked files alongside magnJ

    # Load segmentation
    seg_file = m2m_dir / "custom_tissues.nii.gz"
    if not seg_file.exists():
        print(f"WARNING: {seg_file} not found — skipping WM/GM masked outputs", flush=True)
        return

    print(f"Post-processing: creating WM/GM masked magnJ from {magnj_file.name}", flush=True)

    magnj_img  = nib.load(str(magnj_file))
    magnj_data = magnj_img.get_fdata()

    seg_img  = nib.load(str(seg_file))
    seg_data = np.squeeze(seg_img.get_fdata()).astype(np.int32)

    wm_mask    = seg_data == 1
    gm_mask    = seg_data == 2
    wm_gm_mask = wm_mask | gm_mask

    for name, mask in (("wm_magnJ", wm_mask), ("gm_magnJ", gm_mask), ("wm_gm_magnJ", wm_gm_mask)):
        masked = np.zeros_like(magnj_data)
        masked[mask] = magnj_data[mask]
        out = sv_out_dir / f"{name}.nii.gz"
        nib.save(nib.Nifti1Image(masked, magnj_img.affine), str(out))
        vals = magnj_data[mask]
        if vals.size > 0:
            print(f"  {name}: mean={vals.mean():.4e} median={np.median(vals):.4e} max={vals.max():.4e}", flush=True)
        print(f"  Saved {out.name}", flush=True)


def main() -> None:
    if len(sys.argv) != 6:
        print("Usage: run_fem.py <mesh_path> <m2m_dir> <fem_dir> <recipe_json> <electype_json>")
        sys.exit(1)

    mesh_path = sys.argv[1]
    m2m_dir   = Path(sys.argv[2])
    fem_dir   = sys.argv[3]
    recipe    = json.loads(sys.argv[4])
    # electype unused — electrode shape is fixed (rect 70×50mm, 5mm gel + 1mm rubber)

    pairs: list[tuple[str, float]] = []
    for i in range(0, len(recipe), 2):
        pos = str(recipe[i])
        ma  = float(recipe[i + 1])
        pairs.append((pos, ma / 1000.0))   # SimNIBS wants amperes

    # Infer subject name from mesh filename (e.g. subject_custom_mesh.msh → subject)
    subject = Path(mesh_path).name.replace("_custom_mesh.msh", "")

    from simnibs import sim_struct, run_simnibs

    s = sim_struct.SESSION()
    s.fnamehead         = mesh_path
    s.subpath           = str(m2m_dir)
    s.pathfem           = fem_dir
    s.fields            = 'j'          # current density (not E-field)
    s.map_to_vol        = True
    s.tissues_in_niftis = 'all'
    s.open_in_gmsh      = False
    s.map_to_mni        = False

    # EEG cap for electrode positions
    eeg_cap = _find_eeg_cap(m2m_dir)
    if eeg_cap:
        s.eeg_cap = eeg_cap
        print(f"Using EEG cap: {eeg_cap}", flush=True)
    else:
        print(f"WARNING: No EEG cap found in {m2m_dir / 'eeg_positions'}", flush=True)

    tdcs = s.add_tdcslist()
    tdcs.anisotropy_type = 'scalar'
    tdcs.currents        = [p[1] for p in pairs]

    # Conductivities matching ROAST values (cond[] is 0-indexed; label = index+1)
    # cond[0]=WM(1), cond[1]=GM(2), cond[2]=CSF(3), cond[3]=Bone(4), cond[4]=Scalp(5)
    # cond[5]=Eyes(6), cond[6]=Compact_bone(7), cond[7]=Spongy_bone(8), cond[8]=Blood(9)
    # cond[9]=Muscle(10), cond[10]=fat(11,custom), cond[11]=air(12,custom)
    tdcs.cond[0].value  = 0.126      # WM
    tdcs.cond[1].value  = 0.276      # GM
    tdcs.cond[2].value  = 1.65       # CSF
    tdcs.cond[3].value  = 5.52e-3    # Bone
    tdcs.cond[4].value  = 0.465      # Scalp
    tdcs.cond[5].value  = 0.5        # Eye_balls
    tdcs.cond[6].value  = 5.52e-3    # Compact_bone
    tdcs.cond[7].value  = 2.14e-2    # Spongy_bone
    tdcs.cond[8].value  = 0.67       # Blood
    tdcs.cond[9].value  = 0.16       # Muscle
    tdcs.cond[10].value = 0.25;  tdcs.cond[10].name = 'fat'
    tdcs.cond[11].value = 2.5e-14;  tdcs.cond[11].name = 'air'

    # Electrodes: rect 70×50mm, 5mm gel layer + 1mm rubber electrode
    for idx, (pos, _) in enumerate(pairs):
        elec            = tdcs.add_electrode()
        elec.channelnr  = idx + 1
        elec.centre     = pos
        elec.shape      = 'rect'
        elec.dimensions = [70, 50]
        elec.thickness  = [5, 1]    # [gel_mm, rubber_mm]

    print("Starting SimNIBS FEM solve…", flush=True)
    run_simnibs(s)
    print("SimNIBS FEM solve complete.", flush=True)

    # Post-process: WM/GM masked magnJ
    _create_masked_outputs(Path(fem_dir), m2m_dir, subject)


if __name__ == "__main__":
    main()
