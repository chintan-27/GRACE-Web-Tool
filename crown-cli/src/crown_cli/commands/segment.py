import click
from rich.console import Console

from crown_cli.core.config import load_config
from crown_cli.core.deps import check_capabilities
from crown_cli.core.jobs import JobStore
from crown_cli.core.batch import discover_inputs, spawn_job
from crown_cli.inference.registry import list_models

console = Console()


@click.command()
@click.argument("inputs", nargs=-1, required=True)
@click.option("--models", "-m", multiple=True, default=["grace-native"],
              help="Models to run. Use multiple --models flags.")
@click.option("--out", "-o", default=None, help="Output directory (default: current working directory).")
@click.option("--gpu", "-g", default=0, show_default=True, help="GPU index.")
@click.option("--space", type=click.Choice(["native", "freesurfer"]),
              default="native", show_default=True)
@click.option("--yes", "-y", is_flag=True, help="Skip confirmation prompt.")
def segment(inputs, models, out, gpu, space, yes):
    """Run MRI segmentation only."""
    import os
    out = out or os.getcwd()
    cfg = load_config()
    caps = check_capabilities(cfg)
    caps.warn()

    available = caps.available_models()
    for m in models:
        if m not in available:
            console.print(f"[red]Error:[/red] Model '{m}' not available. Run 'crown models list'.")
            raise SystemExit(1)

    input_files = discover_inputs(list(inputs))
    n = len(input_files)

    if not yes:
        console.print(f"Found [bold]{n}[/bold] NIfTI file(s). About to launch [bold]{n}[/bold] job(s) on GPU {gpu}.")
        click.confirm("Proceed?", abort=True)

    store = JobStore(cfg.jobs_db)

    if n == 1:
        job_id = store.create_job("segment", [str(input_files[0])], out, list(models), gpu)
        pid = spawn_job(job_id, "segment")
        store.update_status(job_id, "queued", pid=pid)
        console.print(f"Job [cyan]{job_id}[/cyan] started.")
        console.print(f"Run: [bold]crown status {job_id}[/bold]")
    else:
        child_ids = []
        for f in input_files:
            file_out = str(f.stem.replace(".nii", ""))
            child_id = store.create_job("segment", [str(f)], f"{out}/{file_out}", list(models), gpu)
            pid = spawn_job(child_id, "segment")
            store.update_status(child_id, "queued", pid=pid)
            child_ids.append(child_id)

        batch_id = store.create_batch(child_ids)
        console.print(f"\nBatch [cyan]{batch_id}[/cyan] started ({n} files):")
        for f, jid in zip(input_files, child_ids):
            console.print(f"  → [dim]{f.name}[/dim]: job [cyan]{jid}[/cyan]")
        console.print(f"\nRun: [bold]crown status {batch_id}[/bold]  (batch overview)")
        console.print(f"     [bold]crown status {child_ids[0]}[/bold]  (individual file)")
