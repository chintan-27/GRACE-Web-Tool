# CROWN CLI

Command-line interface for whole-head MRI segmentation (UNETR, 12 tissue classes) and Transcranial Electrical Stimulation (TES) simulation via ROAST.

## Installation

```bash
cd crown_cli
pip install -e ".[dev]"
```

Requires Python ≥ 3.10. GPU inference requires CUDA.

## Configuration

Optional config file at `~/.crown/config.toml`:

```toml
[paths]
roast_build_dir = "/opt/roast/build"     # dir containing run_roast_run.sh
freesurfer_home = "/usr/local/freesurfer"
simnibs_home    = "/opt/simnibs"
```

All paths can also be set via environment variables:

| Env var           | Default              | Purpose                        |
|-------------------|----------------------|--------------------------------|
| `ROAST_BUILD_DIR` | `/opt/roast/build`   | ROAST build directory          |
| `MATLAB_RUNTIME`  | `/opt/mcr/R2025b`    | MATLAB Compiler Runtime root   |
| `FREESURFER_HOME` | `/usr/local/freesurfer` | FreeSurfer installation     |
| `ROAST_TIMEOUT_SECONDS` | `7200`         | Max wall time for ROAST job    |
| `ROAST_MAX_WORKERS`     | `2`            | Concurrent ROAST jobs          |

CLI flags (`--roast-build-dir`, `--matlab-runtime`) override both config file and env vars per invocation.

Jobs DB and progress logs are stored under `~/.crown/`:

```
~/.crown/
  config.toml          # optional user config
  jobs.duckdb          # job metadata store
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
  --recipe "P3 -2 P4 2" \
  --roast-build-dir /opt/roast/build \
  --matlab-runtime /opt/mcr/R2025b
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
| `--roast-build-dir` | from config | Path to ROAST build dir |
| `--matlab-runtime` | from config | Path to MCR root |

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
  --recipe "P3 -2 P4 2" \
  --roast-build-dir /opt/roast/build \
  --matlab-runtime /opt/mcr/R2025b
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

## SimNIBS

*(Coming soon)*

## Tissue Labels (segmentation output)

| Label | Tissue |
|-------|--------|
| 1 | White matter |
| 2 | Gray matter |
| 3 | CSF |
| 4 | Bone (compact) |
| 5 | Bone (spongy) |
| 6 | Blood |
| 7 | Muscle |
| 8 | Bone marrow |
| 9 | Skin |
| 10 | Eye |
| 11 | Air |
| 12 | Fat |

## Job Lifecycle

```
QUEUED → RUNNING → DONE
                 → FAILED
       → CANCELLED
```

Jobs run as detached subprocess (`start_new_session=True`). Parent CLI exits immediately. All state persists in `~/.crown/jobs.duckdb`. Progress streams to `~/.crown/jobs/<job_id>/progress.jsonl`.
