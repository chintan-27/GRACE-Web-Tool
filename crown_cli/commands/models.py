import click
from rich.console import Console
from rich.table import Table

from crown_cli.core.config import load_config
from crown_cli.core.hub import get_checkpoint, download_all
from crown_cli.inference.registry import list_models, get_model_config

console = Console()


@click.group()
def models():
    """Manage CROWN model checkpoints."""


@models.command("list")
def models_list():
    """List all available models and their download status."""
    cfg = load_config()
    table = Table(title="CROWN Models")
    table.add_column("Model", style="cyan")
    table.add_column("Type")
    table.add_column("Space")
    table.add_column("Cached", style="green")

    for name in list_models():
        mc = get_model_config(name)
        # Simple heuristic: check if filename appears in cache dir
        is_cached = any(cfg.model_cache.rglob(mc["hf_filename"])) if cfg.model_cache.exists() else False
        table.add_row(
            name,
            mc["type"],
            mc["space"],
            "[green]yes[/green]" if is_cached else "[red]no[/red]",
        )
    console.print(table)


@models.command("download")
@click.argument("model_names", nargs=-1)
@click.option("--all", "all_models", is_flag=True, help="Download all models")
def models_download(model_names, all_models):
    """Pre-download model checkpoints to local cache."""
    cfg = load_config()
    targets = list(model_names) if model_names else (list_models() if all_models else None)

    if not targets:
        console.print("[red]Specify model names or use --all[/red]")
        raise SystemExit(1)

    for name in targets:
        console.print(f"Downloading [cyan]{name}[/cyan]...", end=" ")
        try:
            path = get_checkpoint(name, cfg)
            console.print(f"[green]done[/green] → {path}")
        except Exception as e:
            console.print(f"[red]failed[/red]: {e}")
