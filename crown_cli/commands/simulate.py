import click
from rich.console import Console
from pathlib import Path

from crown_cli.core.config import load_config
from crown_cli.core.deps import check_capabilities

console = Console()


@click.group()
def simulate():
    """Run TES simulation on an existing segmentation output."""


@simulate.command("roast")
@click.argument("session_dir", type=click.Path(exists=True, file_okay=False))
@click.option("--electrodes", required=True, help="Electrode positions (e.g. 'P3 P4').")
@click.option("--gpu", "-g", default=0, show_default=True)
def simulate_roast(session_dir, electrodes, gpu):
    """Run ROAST TES simulation."""
    cfg = load_config()
    caps = check_capabilities(cfg)
    caps.require_roast()

    console.print(f"Launching ROAST simulation on [cyan]{session_dir}[/cyan]...")
    console.print("[yellow]Note:[/yellow] ROAST integration delegates to the existing api/runtime/roast_scheduler.py logic.")
    console.print("This command is a stub — wire up CLIRoastRunner in a follow-up task.")
    raise SystemExit(0)


@simulate.command("simnibs")
@click.argument("session_dir", type=click.Path(exists=True, file_okay=False))
@click.option("--gpu", "-g", default=0, show_default=True)
def simulate_simnibs(session_dir, gpu):
    """Run SimNIBS TES simulation."""
    cfg = load_config()
    caps = check_capabilities(cfg)
    caps.require_simnibs()

    console.print(f"Launching SimNIBS simulation on [cyan]{session_dir}[/cyan]...")
    console.print("[yellow]Note:[/yellow] SimNIBS integration is a stub — wire up CLISimNIBSRunner in a follow-up task.")
    raise SystemExit(0)
