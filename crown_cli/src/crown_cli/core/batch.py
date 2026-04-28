import os
import sys
import subprocess
from pathlib import Path
from typing import Optional

import click


def discover_inputs(paths: list[str]) -> list[Path]:
    """Resolve file paths or directories to a list of NIfTI files."""
    result = []
    for p in paths:
        path = Path(p)
        if not path.exists():
            raise click.BadParameter(f"Path not found: {p}")
        if path.is_dir():
            niftis = list(path.glob("*.nii.gz")) + list(path.glob("*.nii"))
            if not niftis:
                raise click.BadParameter(f"No NIfTI files found in directory: {p}")
            result.extend(niftis)
        elif path.is_file():
            result.append(path)
        else:
            raise click.BadParameter(f"Not a file or directory: {p}")
    return result


def spawn_job(job_id: str, job_type: str) -> int:
    """Spawn a detached worker subprocess. Returns the PID."""
    from crown_cli.core.config import load_config
    cfg = load_config()
    job_dir = Path(cfg.jobs_dir) / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    log_path = job_dir / "worker.log"

    flags = (
        {"start_new_session": True}
        if sys.platform != "win32"
        else {"creationflags": subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP}
    )
    log_fh = open(log_path, "wb")
    proc = subprocess.Popen(
        [sys.executable, "-m", "crown_cli.core.worker", job_id, job_type],
        **flags,
        stdout=log_fh,
        stderr=subprocess.STDOUT,
    )
    log_fh.close()
    return proc.pid
