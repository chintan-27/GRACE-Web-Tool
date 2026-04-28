import uuid
import click
from pathlib import Path
from rich.console import Console

from crown_cli.core.batch import spawn_job
from crown_cli.core.config import load_config
from crown_cli.core.deps import check_capabilities
from crown_cli.core.jobs import JobStore
from crown_cli.core.roast_config import validate_recipe

console = Console()


@click.group()
def simulate():
    """Run TES simulation on an existing segmentation output."""


def _parse_recipe(recipe_str: str) -> list:
    """Parse 'P3 -2 P4 2' → ['P3', -2.0, 'P4', 2.0]."""
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
    return result


@simulate.command("roast")
@click.argument("session_dir", type=click.Path(exists=True, file_okay=False))
@click.option("--t1", required=True, type=click.Path(exists=True), help="Original T1 NIfTI file.")
@click.option("--model", required=True, help="Model whose segmentation to use (e.g. grace-native).")
@click.option("--recipe", required=True, help="Electrode/current pairs, e.g. 'P3 -2 P4 2'.")
@click.option("--electrode-type", default=None, help="Space-separated types per electrode (pad/ring/disc).")
@click.option("--quality", default="standard", show_default=True,
              type=click.Choice(["fast", "standard"]), help="Mesh quality preset.")
def simulate_roast(session_dir, t1, model, recipe, electrode_type, quality):
    """Run ROAST TES simulation on an existing segmentation.

    SESSION_DIR is the directory containing MODEL/output.nii.gz, i.e. the
    folder produced by 'crown segment' (named after the T1 stem).
    """
    cfg = load_config()
    caps = check_capabilities(cfg)
    caps.require_roast()

    session_dir = Path(session_dir)
    mask_path = session_dir / model / "output.nii.gz"
    if not mask_path.exists():
        console.print(f"[red]Segmentation not found:[/red] {mask_path}")
        console.print(f"Run 'crown segment' with --models {model} first.")
        raise SystemExit(1)

    try:
        recipe_list = _parse_recipe(recipe)
        validate_recipe(recipe_list)
    except (click.BadParameter, ValueError) as e:
        console.print(f"[red]Invalid recipe:[/red] {e}")
        raise SystemExit(1)

    electype = electrode_type.split() if electrode_type else None

    run_id = uuid.uuid4().hex[:12]
    meta = {
        "recipe": recipe_list,
        "electrode_type": electype,
        "quality": quality,
        "run_id": run_id,
        "seg_source": "nn",
    }

    store = JobStore(cfg.jobs_db)
    job_id = store.create_job("roast", [str(t1)], str(session_dir), [model], gpu=0)
    store.update_meta(job_id, meta)
    spawn_job(job_id, "roast")

    console.print(f"Job [cyan]{job_id}[/cyan] queued")
    console.print(f"Output: {session_dir}/roast/{model}/{run_id}/")
    console.print(f"Logs:   {cfg.jobs_dir}/{job_id}/worker.log")
    console.print(f"Monitor: crown status {job_id} --follow")
