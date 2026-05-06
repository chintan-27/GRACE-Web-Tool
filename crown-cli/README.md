# CROWN CLI

Command-line interface for whole-head MRI segmentation (UNETR, 11 tissue classes) and Transcranial Electrical Stimulation (TES) simulation via ROAST.

## Installation

### 1. Install PyTorch with CUDA

Install PyTorch matching your CUDA version before installing CROWN CLI. See https://pytorch.org/get-started/locally/ for the right command. Example for CUDA 12.1:

```bash
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121
```

### 2. Install CROWN CLI

```bash
cd crown_cli
pip install -e ".[dev]"
```

Requires Python ≥ 3.8.

### 3. Request HuggingFace access

Model checkpoints and the ROAST build are hosted on private HuggingFace repositories. Visit each repo and request access:

- `smilelab/GRACE` — GRACE UNETR model
- `smilelab/DOMINO` — DOMINO UNETR model
- `smilelab/DOMINOpp` — DOMINO++ UNETR model
- `smilelab/roast-11tissue-build` — compiled ROAST TES simulation build

Access is granted automatically.

### 4. Authenticate with HuggingFace

```bash
huggingface-cli login --token hf_...

OR

hf auth login --token hf_...
```

Your token must have read access to the repositories above.

### 5. Download model checkpoints

```bash
crown models download --all
```

Individual models:

```bash
crown models download grace-native grace-fs
```

### 6. Download ROAST build

```bash
crown roast download
```

Downloads the compiled ROAST build to `~/.crown/roast-build/`. Requires MATLAB Runtime (MCR) R2025b installed separately.

> **After downloading**, make the launcher and compiled binary executable:
> ```bash
> chmod +x ~/.crown/roast-build/bin/run_roast_run.sh
> chmod +x ~/.crown/roast-build/bin/roast_run
> ```
> If you installed ROAST to a custom location, replace `~/.crown/roast-build` with your build directory.

> **Custom ROAST build:** If you have a manually compiled ROAST build, point CROWN to it via `roast_build_dir` in config or `ROAST_BUILD_DIR` env var. The build directory must contain a file named `run_roast_run.sh` — this is the launcher script CROWN invokes as `run_roast_run.sh <MCR_PATH> <config.json>`.

## Configuration

Optional config file at `~/.crown/config.toml`:

```toml
[paths]
roast_build_dir = "/opt/roast/build"     # manual install (overrides auto-download)
roast_cache     = "~/.crown/roast-build" # auto-download destination
freesurfer_home = "/usr/local/freesurfer"
matlab_runtime  = "/opt/mcr/R2025b"      # MATLAB Compiler Runtime root
model_cache     = "~/.crown/models"      # model checkpoint cache

[roast]
timeout     = 7200  # max wall time per job (seconds)
max_workers = 2     # concurrent ROAST jobs
```

All paths can also be set via environment variables:

| Env var           | Default              | Purpose                        |
|-------------------|----------------------|--------------------------------|
| `ROAST_BUILD_DIR` | `/opt/roast/build`   | ROAST build directory (manual install) |
| `ROAST_CACHE`     | `~/.crown/roast-build` | ROAST auto-download cache    |
| `MATLAB_RUNTIME`  | `/opt/mcr/R2025b`    | MATLAB Compiler Runtime root   |
| `FREESURFER_HOME` | `/usr/local/freesurfer` | FreeSurfer installation     |
| `CROWN_MODEL_CACHE` | `~/.crown/models`  | Model checkpoint cache         |
| `ROAST_TIMEOUT_SECONDS` | `7200`         | Max wall time for ROAST job    |
| `ROAST_MAX_WORKERS`     | `2`            | Concurrent ROAST jobs          |
| `CROWN_JOBS_DB`         | `~/.crown/jobs.db` | SQLite jobs database path  |
| `CROWN_OFFLINE`         | —              | Set to `1` to disable HuggingFace downloads |

CLI flags (`--roast-build-dir`, `--matlab-runtime`) override both config file and env vars per invocation.

Jobs DB and progress logs are stored under `~/.crown/`:

```
~/.crown/
  config.toml          # optional user config
  jobs.db              # SQLite job metadata store (WAL mode)
  jobs/<job_id>/
    worker.log         # full worker stdout/stderr
    progress.jsonl     # structured progress events
    cancel             # sentinel file written by crown cancel
```

## Commands

### `crown segment` — MRI segmentation only

```bash
crown segment T1.nii.gz --model grace-native --gpu 0
# or specify output dir explicitly:
crown segment T1.nii.gz --model grace-native --out /my/output --gpu 0
```

Input can be a file or directory (all `.nii`/`.nii.gz` files discovered).
Multiple models: repeat `--model`, or use `all`:

```bash
crown segment T1.nii.gz --model grace-native --model domino-native --out /output
crown segment T1.nii.gz --model all --out /output
```

**Options:**

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--model` | `-m` | `grace-native` | Model(s) to run. Repeat for multiple or pass `all`. |
| `--out` | `-o` | cwd | Output directory. |
| `--gpu` | `-g` | `0` | GPU index. |
| `--space` | — | `native` | Space of the input T1: `native` or `freesurfer`. See [The `--space` Flag](#the---space-flag). |
| `--yes` | `-y` | — | Skip confirmation prompt. |

Output structure:

```
/output/
  T1/
    grace-native/
      output.nii.gz    # 12-class segmentation mask
    domino-native/
      output.nii.gz
```

### `crown simulate roast` — ROAST TES simulation

Requires an existing segmentation (`crown segment` first, or `crown run`).

```bash
crown simulate roast /output/T1 \
  --t1 T1.nii.gz \
  --model grace-native \
  --recipe "P3 -2 P4 2"
```

`SESSION_DIR` is the directory that contains `MODEL/output.nii.gz` — the `T1/` folder produced by `crown segment`.

**Recipe format:** space-separated electrode/current pairs. Currents must sum to 0.

```
"F3 -2 F4 2"        # 2 mA, F3 cathode, F4 anode
"P3 -1 Cz 0.5 P4 0.5"  # multi-electrode
```

**Electrode types** (one per electrode, default: `pad`):

| Type   | Size params              |
|--------|--------------------------|
| `pad`  | `[length, width, height]` mm, default `[70, 50, 3]` |
| `ring` | `[innerRadius, outerRadius, height]` mm             |
| `disc` | `[radius, height]` mm                               |

**Options:**

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--t1` | yes | — | Original T1 NIfTI used for segmentation. |
| `--model` | yes | — | Segmentation model whose output to use (e.g. `grace-native`). |
| `--recipe` | yes | — | Electrode/current pairs (e.g. `"P3 -2 P4 2"`). |
| `--electrode-type` | — | `pad pad` | Space-separated type per electrode (`pad`/`ring`/`disc`). |
| `--quality` | — | `standard` | Mesh quality preset: `fast` or `standard`. |

Output location:

```
SESSION_DIR/roast/MODEL/RUN_ID/
  T1_<tag>_v.nii       # electric potential (voltage) field
  T1_<tag>_e.nii       # E-field (vector, 3 components)
  T1_<tag>_emag.nii    # E-field magnitude
  T1_<tag>_jbrain.nii  # current density restricted to brain tissue
```

**Output file descriptions:**

| File | Unit | Description |
|------|------|-------------|
| `*_v.nii` | V | Electric potential (voltage) at each voxel. Scalar field. |
| `*_e.nii` | V/m | Electric field vector. 4D volume — 3 components (x, y, z) per voxel. |
| `*_emag.nii` | V/m | Electric field magnitude (`‖E‖`). Scalar, most commonly used for TES analysis. |
| `*_jbrain.nii` | A/m² | Current density in brain voxels only; non-brain voxels are zero. |

`<tag>` encodes the electrode montage (e.g. `P3P4` for a P3–P4 pair). `RUN_ID` is a 12-character hex unique per simulation run.

### `crown run` — full pipeline (segment + simulate)

Runs segmentation then ROAST in a single job.

```bash
crown run T1.nii.gz \
  --model grace-native \
  --out /output \
  --gpu 0 \
  --simulate roast \
  --recipe "P3 -2 P4 2"
```

Multiple inputs launch a batch:

```bash
crown run /data/*.nii.gz --model grace-native --out /output --yes
```

**Options:**

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--model` | `-m` | `grace-native` | Model(s) to run. Repeat for multiple or pass `all`. |
| `--out` | `-o` | cwd | Output directory. |
| `--gpu` | `-g` | `0` | GPU index. |
| `--space` | — | `native` | Space of the input T1: `native` or `freesurfer`. See [The `--space` Flag](#the---space-flag). |
| `--simulate` | — | — | Run simulation after segmentation. Only `roast` supported. |
| `--recipe` | — | — | ROAST electrode/current pairs. Required if `--simulate roast`. |
| `--electrode-type` | — | `pad pad` | Space-separated type per electrode (`pad`/`ring`/`disc`). |
| `--quality` | — | `standard` | ROAST mesh quality: `fast` or `standard`. |
| `--yes` | `-y` | — | Skip confirmation prompt. |

> **Note (ROAST + multiple models):** When `--simulate roast` is combined with multiple models, ROAST uses the **first model in the list** for its segmentation input. All models still run for segmentation, but only one feeds into ROAST. With `--model all` the first model is always `grace-native`.

### `crown status` — job monitoring

```bash
crown status <job_id>             # snapshot
crown status <job_id> --follow    # live tail (works from QUEUED state)
crown status --list               # last 20 jobs
crown status --list --last 50
```

**Options:**

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--list` | — | — | List recent jobs instead of showing a single job. |
| `--last` | — | `20` | Number of jobs shown with `--list`. |
| `--follow` | `-f` | — | Live-tail progress events; blocks until job finishes or Ctrl+C. |

`--follow` prints all ROAST progress events and log lines as they arrive. Works from `QUEUED` state — polls until running then streams.

Worker crash logs:

```bash
cat ~/.crown/jobs/<job_id>/worker.log
```

### `crown cancel` — cancel a job

```bash
crown cancel <job_id>          # SIGTERM
crown cancel <job_id> --force  # SIGKILL
```

**Options:**

| Flag | Short | Description |
|------|-------|-------------|
| `--force` | `-f` | Send SIGKILL instead of SIGTERM. |

Works on both `queued` and `running` jobs. For queued jobs, writes a sentinel file; worker checks it before starting ROAST.

### `crown models` — list available models

```bash
crown models          # show model table (default)
crown models --list   # same
crown models download grace-native grace-fs
crown models download --all
```

**`crown models` options:**

| Flag | Description |
|------|-------------|
| `--list` | Print model table (default when no subcommand given). |

**`crown models download` options:**

| Flag | Description |
|------|-------------|
| `--all` | Download all models. |

| Model | Architecture | Space |
|-------|-------------|-------|
| `grace-native` | GRACE UNETR | native scanner space |
| `grace-fs` | GRACE UNETR | FreeSurfer conformed (requires FreeSurfer) |
| `domino-native` | DOMINO UNETR | native |
| `domino-fs` | DOMINO UNETR | FreeSurfer conformed |
| `dominopp-native` | DOMINO++ UNETR | native |
| `dominopp-fs` | DOMINO++ UNETR | FreeSurfer conformed |

Models are downloaded on first use from HuggingFace (`smilelab/` org).

### `crown roast` — manage ROAST build

```bash
crown roast download   # download ROAST build from HuggingFace
crown roast info       # show active build path + FreeSurfer status
```

**Subcommands:** `download`, `info` — no additional options.

ROAST build is resolved in order: `roast_build_dir` (if `run_roast_run.sh` exists there) → `roast_cache` (auto-downloaded). On HPC clusters without internet, run `crown roast download` on a head node first, then set `ROAST_CACHE` to the shared path.

## The `--space` Flag

`--space` tells CROWN what space **the input T1** is in — it does **not** control the output space.

**Output space always matches input space.** The pipeline does a transparent round-trip for `-fs` models:

| Input space (`--space`) | Model type | What happens | Output space |
|------------------------|------------|--------------|--------------|
| `native` (default) | `-native` (e.g. `grace-native`) | Spatial resampling to 1mm isotropic RAS; resize to model grid | native |
| `native` (default) | `-fs` (e.g. `grace-fs`) | `mri_convert --conform` → model inference → `mri_vol2vol` back | native |
| `freesurfer` | `-fs` | Skip `mri_convert` (already conformed); model inference; no back-conversion | FreeSurfer conformed (256³ 1mm) |
| `freesurfer` | `-native` | No conversion; spatial resampling applied to conformed input | FreeSurfer conformed |

**`--space freesurfer` use case:** you already ran `mri_convert --conform` yourself and have a 256³ 1mm isotropic T1. Passing `--space freesurfer` skips the redundant `mri_convert` call.

> **Warning:** Passing `--space freesurfer` on a native-space T1 will feed the wrong geometry to `-fs` models (no `mri_convert` is run). The output will appear in the native T1's voxel grid but the model inference will be incorrect. Always match `--space` to the actual space of your input file.

## Tissue Labels (segmentation output)

| Label | Tissue          |
|-------|-----------------|
| 0     | Background      |
| 1     | WM              |
| 2     | GM              |
| 3     | Eyes            |
| 4     | CSF             |
| 5     | Air             |
| 6     | Blood           |
| 7     | Cancellous Bone |
| 8     | Cortical Bone   |
| 9     | Skin            |
| 10    | Fat             |
| 11    | Muscle          |

## Job Lifecycle

```
QUEUED → RUNNING → DONE
                 → FAILED
       → CANCELLED
```

Jobs run as detached subprocess (`start_new_session=True`). Parent CLI exits immediately. All state persists in `~/.crown/jobs.db` (SQLite, WAL mode). Progress streams to `~/.crown/jobs/<job_id>/progress.jsonl`.
