import uuid
import click
from pathlib import Path
from rich.console import Console

from crown_cli.core.config import load_config
from crown_cli.core.deps import check_capabilities
from crown_cli.core.jobs import JobStore
from crown_cli.core.batch import discover_inputs, spawn_job

console = Console()


def _parse_recipe(recipe_str: str) -> list:
    """Parse 'P3 -2 P4 2' → ['P3', -2.0, 'P4', 2.0]."""
    from crown_cli.core.roast_config import validate_recipe
    parts = recipe_str.split()
    if len(parts) % 2 != 0:
        raise click.BadParameter(
            "Recipe must have even number of tokens (electrode current pairs).",
            param_hint="--recipe",
        )
    result = []
    for i, token in enumerate(parts):
        if i % 2 == 0:
            result.append(token)
        else:
            try:
                result.append(float(token))
            except ValueError:
                raise click.BadParameter(
                    f"Expected a number for current, got '{token}'.",
                    param_hint="--recipe",
                )
    validate_recipe(result)
    return result


@click.command()
@click.argument("inputs", nargs=-1, required=True)
@click.option("--models", "-m", multiple=True, default=["grace-native"])
@click.option("--out", "-o", default=None, help="Output directory (default: current working directory).")
@click.option("--gpu", "-g", default=0, show_default=True)
@click.option("--space", type=click.Choice(["native", "freesurfer"]),
              default="native", show_default=True)
@click.option("--simulate", type=click.Choice(["roast"]),
              default=None, help="Run TES simulation after segmentation.")
@click.option("--recipe", default=None, help="ROAST electrode/current pairs, e.g. 'P3 -2 P4 2'.")
@click.option("--electrode-type", default=None, help="Space-separated types per electrode (pad/ring/disc).")
@click.option("--quality", default="standard", show_default=True,
              type=click.Choice(["fast", "standard"]), help="ROAST mesh quality preset.")
@click.option("--roast-build-dir", default=None, type=click.Path(),
              help="Path to ROAST build dir containing run_roast_run.sh.")
@click.option("--matlab-runtime", default=None, type=click.Path(),
              help="Path to MATLAB Compiler Runtime (MCR) root.")
@click.option("--yes", "-y", is_flag=True, help="Skip confirmation prompt.")
def run(inputs, models, out, gpu, space, simulate, recipe, electrode_type, quality,
        roast_build_dir, matlab_runtime, yes):
    """Run the full CROWN pipeline (segmentation + optional simulation)."""
    import os
    out = out or os.getcwd()
    cfg = load_config()

    if roast_build_dir:
        cfg.roast_build_dir = Path(roast_build_dir)
    if matlab_runtime:
        cfg.matlab_runtime = Path(matlab_runtime)

    caps = check_capabilities(cfg)
    caps.warn()

    if simulate == "roast":
        caps.require_roast()
        if not recipe:
            raise click.UsageError("--recipe is required when --simulate roast is set.")

    available = caps.available_models()
    for m in models:
        if m not in available:
            console.print(f"[red]Error:[/red] Model '{m}' not available. Run 'crown models list'.")
            raise SystemExit(1)

    roast_meta = None
    if simulate == "roast":
        try:
            recipe_list = _parse_recipe(recipe)
        except (click.BadParameter, ValueError) as e:
            console.print(f"[red]Invalid recipe:[/red] {e}")
            raise SystemExit(1)
        roast_meta = {
            "recipe": recipe_list,
            "electrode_type": electrode_type.split() if electrode_type else None,
            "quality": quality,
            "run_id": uuid.uuid4().hex[:12],
            "seg_source": "nn",
            "simulate": simulate,
            "roast_build_dir": str(cfg.roast_build_dir),
            "matlab_runtime": str(cfg.matlab_runtime),
        }

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
        if roast_meta:
            store.update_meta(job_id, roast_meta)
        pid = spawn_job(job_id, job_type)
        store.update_status(job_id, "queued", pid=pid)
        console.print(f"Job [cyan]{job_id}[/cyan] started.")
        console.print(f"Run: [bold]crown status {job_id}[/bold]")
    else:
        child_ids = []
        for f in input_files:
            file_out = str(f.stem.replace(".nii", ""))
            child_id = store.create_job(job_type, [str(f)], f"{out}/{file_out}", list(models), gpu)
            if roast_meta:
                # Each child gets a unique run_id
                child_meta = {**roast_meta, "run_id": uuid.uuid4().hex[:12]}
                store.update_meta(child_id, child_meta)
            pid = spawn_job(child_id, job_type)
            store.update_status(child_id, "queued", pid=pid)
            child_ids.append(child_id)

        batch_id = store.create_batch(child_ids)
        console.print(f"\nBatch [cyan]{batch_id}[/cyan] started ({n} files):")
        for f, jid in zip(input_files, child_ids):
            console.print(f"  → [dim]{f.name}[/dim]: job [cyan]{jid}[/cyan]")
        console.print(f"\nRun: [bold]crown status {batch_id}[/bold]")
