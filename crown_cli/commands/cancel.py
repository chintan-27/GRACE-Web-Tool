import os
import signal

import click
from rich.console import Console

from crown_cli.core.config import load_config
from crown_cli.core.jobs import JobStore, JobStatus

console = Console()


@click.command()
@click.argument("job_id")
@click.option("--force", "-f", is_flag=True, help="Send SIGKILL instead of SIGTERM.")
def cancel(job_id, force):
    """Cancel a running job."""
    cfg = load_config()
    store = JobStore(cfg.jobs_db)

    try:
        job = store.get_job(job_id)
    except KeyError:
        console.print(f"[red]Job not found:[/red] {job_id}")
        raise SystemExit(1)

    if job["status"] != JobStatus.RUNNING:
        console.print(f"Job {job_id} not running (status: {job['status']})")
        raise SystemExit(1)

    pid = job["pid"]
    if pid:
        sig = signal.SIGKILL if force else signal.SIGTERM
        try:
            os.kill(pid, sig)
            console.print(f"Sent {'SIGKILL' if force else 'SIGTERM'} to PID {pid}")
        except ProcessLookupError:
            console.print(f"[yellow]PID {pid} already gone[/yellow]")
        except PermissionError:
            console.print(f"[red]No permission to kill PID {pid}[/red]")
            raise SystemExit(1)
    else:
        console.print("[yellow]No PID recorded for this job[/yellow]")

    store.update_status(job_id, JobStatus.CANCELLED)

    # Write sentinel file so ROAST pty loop detects cancellation
    sentinel = Path(cfg.jobs_dir) / job_id / "cancel"
    sentinel.parent.mkdir(parents=True, exist_ok=True)
    sentinel.touch()

    console.print(f"Job [cyan]{job_id}[/cyan] cancelled")
