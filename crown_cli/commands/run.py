import click
from rich.console import Console

from crown_cli.core.config import load_config
from crown_cli.core.deps import check_capabilities
from crown_cli.core.jobs import JobStore
from crown_cli.core.batch import discover_inputs, spawn_job

console = Console()


@click.command()
@click.argument("inputs", nargs=-1, required=True)
@click.option("--models", "-m", multiple=True, default=["grace-native"])
@click.option("--out", "-o", required=True, help="Output directory.")
@click.option("--gpu", "-g", default=0, show_default=True)
@click.option("--space", type=click.Choice(["native", "freesurfer"]),
              default="native", show_default=True)
@click.option("--simulate", type=click.Choice(["roast", "simnibs"]),
              default=None, help="Run TES simulation after segmentation.")
@click.option("--electrodes", default=None, help="Electrode config (for ROAST/SimNIBS).")
@click.option("--yes", "-y", is_flag=True, help="Skip confirmation prompt.")
def run(inputs, models, out, gpu, space, simulate, electrodes, yes):
    """Run the full CROWN pipeline (segmentation + optional simulation)."""
    cfg = load_config()
    caps = check_capabilities(cfg)
    caps.warn()

    if simulate == "roast":
        caps.require_roast()
    elif simulate == "simnibs":
        caps.require_simnibs()

    available = caps.available_models()
    for m in models:
        if m not in available:
            console.print(f"[red]Error:[/red] Model '{m}' not available. Run 'crown models list'.")
            raise SystemExit(1)

    input_files = discover_inputs(list(inputs))
    n = len(input_files)
    job_type = "pipeline" if simulate else "segment"

    if not yes:
        sim_note = f" + {simulate} simulation" if simulate else ""
        console.print(
            f"Found [bold]{n}[/bold] NIfTI file(s). "
            f"About to launch [bold]{n}[/bold] job(s) on GPU {gpu}{sim_note}."
        )
        click.confirm("Proceed?", abort=True)

    store = JobStore(cfg.jobs_db)

    if n == 1:
        job_id = store.create_job(job_type, [str(input_files[0])], out, list(models), gpu)
        pid = spawn_job(job_id, job_type)
        store.update_status(job_id, "queued", pid=pid)
        console.print(f"Job [cyan]{job_id}[/cyan] started.")
        console.print(f"Run: [bold]crown status {job_id}[/bold]")
    else:
        child_ids = []
        for f in input_files:
            file_out = str(f.stem.replace(".nii", ""))
            child_id = store.create_job(job_type, [str(f)], f"{out}/{file_out}", list(models), gpu)
            pid = spawn_job(child_id, job_type)
            store.update_status(child_id, "queued", pid=pid)
            child_ids.append(child_id)

        batch_id = store.create_batch(child_ids)
        console.print(f"\nBatch [cyan]{batch_id}[/cyan] started ({n} files):")
        for f, jid in zip(input_files, child_ids):
            console.print(f"  → [dim]{f.name}[/dim]: job [cyan]{jid}[/cyan]")
        console.print(f"\nRun: [bold]crown status {batch_id}[/bold]")
