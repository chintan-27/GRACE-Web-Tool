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

Requires Python ≥ 3.10.

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

> **Custom ROAST build:** If you have a manually compiled ROAST build, point CROWN to it via `roast_build_dir` in config or `ROAST_BUILD_DIR` env var. The build directory must contain a file named `run_roast_run.sh` — this is the launcher script CROWN invokes as `run_roast_run.sh <MCR_PATH> <config.json>`.

## Configuration

Optional config file at `~/.crown/config.toml`:

```toml
[paths]
roast_build_dir = "/opt/roast/build"     # manual install (overrides auto-download)
roast_cache     = "~/.crown/roast-build" # auto-download destination
freesurfer_home = "/usr/local/freesurfer"
```

All paths can also be set via environment variables:

| Env var           | Default              | Purpose                        |
|-------------------|----------------------|--------------------------------|
| `ROAST_BUILD_DIR` | `/opt/roast/build`   | ROAST build directory (manual install) |
| `ROAST_CACHE`     | `~/.crown/roast-build` | ROAST auto-download cache    |
| `MATLAB_RUNTIME`  | `/opt/mcr/R2025b`    | MATLAB Compiler Runtime root   |
| `FREESURFER_HOME` | `/usr/local/freesurfer` | FreeSurfer installation     |
| `ROAST_TIMEOUT_SECONDS` | `7200`         | Max wall time for ROAST job    |
| `ROAST_MAX_WORKERS`     | `2`            | Concurrent ROAST jobs          |
| `CROWN_JOBS_DB`         | `~/.crown/jobs.db` | Override SQLite jobs database path |

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
crown segment T1.nii.gz --models grace-native --gpu 0
# or specify output dir explicitly:
crown segment T1.nii.gz --models grace-native --out /my/output --gpu 0
```

Input can be a file or directory (all `.nii`/`.nii.gz` files discovered).
Multiple models: repeat `--models`:

```bash
crown segment T1.nii.gz --models grace-native --models domino-native --out /output
```

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

| Flag | Default | Description |
|------|---------|-------------|
| `--model` | — | Segmentation model to use |
| `--recipe` | — | Electrode/current pairs (required) |
| `--electrode-type` | `pad pad` | Space-separated type per electrode |
| `--quality` | `standard` | Mesh preset: `fast` or `standard` |

Output location:

```
SESSION_DIR/roast/MODEL/RUN_ID/
  T1_<tag>_v.nii       # voltage field
  T1_<tag>_e.nii       # E-field
  T1_<tag>_emag.nii    # E-field magnitude
  T1_<tag>_jbrain.nii  # current density in brain
```

### `crown run` — full pipeline (segment + simulate)

Runs segmentation then ROAST in a single job.

```bash
crown run T1.nii.gz \
  --models grace-native \
  --out /output \
  --gpu 0 \
  --simulate roast \
  --recipe "P3 -2 P4 2"
```

Multiple inputs launch a batch:

```bash
crown run /data/*.nii.gz --models grace-native --out /output --yes
```

### `crown status` — job monitoring

```bash
crown status <job_id>             # snapshot
crown status <job_id> --follow    # live tail (works from QUEUED state)
crown status --list               # last 20 jobs
crown status --list --last 50
```

`--follow` prints all ROAST progress events and log lines as they arrive. Blocks until job finishes or Ctrl+C.

Worker crash logs:

```bash
cat ~/.crown/jobs/<job_id>/worker.log
```

### `crown cancel` — cancel a job

```bash
crown cancel <job_id>          # SIGTERM
crown cancel <job_id> --force  # SIGKILL
```

Works on both `queued` and `running` jobs. For queued jobs, writes a sentinel file; worker checks it before starting ROAST.

### `crown models` — list available models

```bash
crown models list
```

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

Download the ROAST build from HuggingFace to `~/.crown/roast-build/`:

```bash
crown roast download
```

Check which build is active:

```bash
crown roast info
```

ROAST is resolved in order: `roast_build_dir` (if `run_roast_run.sh` exists there) → `roast_cache` (auto-downloaded). On HPC clusters without internet, run `crown roast download` on a head node first, then set `ROAST_CACHE` to the shared path.

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
