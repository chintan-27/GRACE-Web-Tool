import time
import click
from rich.console import Console
from rich.table import Table
from rich.live import Live

from crown_cli.core.config import load_config
from crown_cli.core.jobs import JobStore, JobStatus
from crown_cli.core.progress import ProgressReader
from pathlib import Path

console = Console()

STATUS_COLORS = {
    JobStatus.QUEUED: "yellow",
    JobStatus.RUNNING: "cyan",
    JobStatus.DONE: "green",
    JobStatus.FAILED: "red",
    JobStatus.PARTIAL: "magenta",
    JobStatus.CANCELLED: "yellow",
}


@click.command()
@click.argument("job_id", required=False)
@click.option("--list", "show_list", is_flag=True, help="List all jobs.")
@click.option("--last", default=20, show_default=True, help="Number of jobs to show with --list.")
@click.option("--follow", "-f", is_flag=True, help="Follow progress live (like tail -f).")
def status(job_id, show_list, last, follow):
    """Show job status. Use 'crown status <job-id>' or 'crown status --list'."""
    cfg = load_config()
    store = JobStore(cfg.jobs_db)

    if show_list:
        _show_list(store, last)
        return

    if not job_id:
        console.print("[red]Provide a job ID or use --list[/red]")
        raise SystemExit(1)

    # Batch job
    if job_id.startswith("batch-"):
        _show_batch(store, job_id, cfg)
        return

    # Single job
    _show_job(store, job_id, cfg, follow)


def _show_list(store: JobStore, limit: int) -> None:
    jobs = store.list_jobs(limit=limit)
    table = Table(title=f"Recent Jobs (last {limit})")
    table.add_column("ID", style="cyan")
    table.add_column("Type")
    table.add_column("Status")
    table.add_column("Models")
    table.add_column("Created")

    for job in jobs:
        color = STATUS_COLORS.get(job["status"], "white")
        table.add_row(
            job["id"],
            job["type"],
            f"[{color}]{job['status']}[/{color}]",
            ", ".join(job["models"] or []),
            str(job["created_at"])[:19],
        )
    console.print(table)


def _show_batch(store: JobStore, batch_id: str, cfg) -> None:
    batch = store.get_batch(batch_id)
    child_ids = batch["job_ids"]
    table = Table(title=f"Batch {batch_id}")
    table.add_column("Job ID", style="cyan")
    table.add_column("Input")
    table.add_column("Status")

    for cid in child_ids:
        try:
            job = store.get_job(cid)
            color = STATUS_COLORS.get(job["status"], "white")
            inputs = ", ".join(Path(p).name for p in (job["input_paths"] or []))
            table.add_row(cid, inputs, f"[{color}]{job['status']}[/{color}]")
        except KeyError:
            table.add_row(cid, "?", "[red]not found[/red]")

    console.print(table)


def _show_job(store: JobStore, job_id: str, cfg, follow: bool) -> None:
    try:
        job = store.get_job(job_id)
    except KeyError:
        console.print(f"[red]Job not found:[/red] {job_id}")
        raise SystemExit(1)

    color = STATUS_COLORS.get(job["status"], "white")
    console.print(f"Job [cyan]{job_id}[/cyan]  status: [{color}]{job['status']}[/{color}]")
    console.print(f"Models: {', '.join(job['models'] or [])}")
    console.print(f"Output: {job['out_dir']}")

    job_dir = Path(cfg.jobs_dir) / job_id
    reader = ProgressReader(job_dir)

    if follow and job["status"] == JobStatus.RUNNING:
        console.print("\n[dim]Following progress (Ctrl+C to stop)...[/dim]\n")
        try:
            for event in reader.tail():
                if event is None:
                    # heartbeat — check if job finished
                    current = store.get_job(job_id)
                    if current["status"] != JobStatus.RUNNING:
                        c = STATUS_COLORS.get(current["status"], "white")
                        console.print(f"\nJob finished: [{c}]{current['status']}[/{c}]")
                        break
                    continue
                if event.get("event") == "log":
                    continue
                model = event.get("model", "")
                prog = event.get("progress", "")
                evt = event.get("event", "")
                console.print(f"  [{model}] {evt}  {prog}%")
        except KeyboardInterrupt:
            pass
    else:
        events = reader.read_all()
        if events:
            console.print("\n[dim]Progress events:[/dim]")
            for e in events:
                if e.get("event") == "log":
                    continue
                model = e.get("model", "")
                prog = e.get("progress", "")
                evt = e.get("event", "")
                console.print(f"  [{model}] {evt}  {prog}%")
