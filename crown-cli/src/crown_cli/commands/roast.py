import click
from rich.console import Console

from crown_cli.core.config import load_config
from crown_cli.core.hub import download_roast_build, resolve_roast_build_dir

console = Console()


@click.group()
def roast():
    """Manage the ROAST TES simulation build."""


@roast.command("download")
def roast_download():
    """Download ROAST build from HuggingFace to local cache."""
    cfg = load_config()
    console.print("Downloading ROAST build from HuggingFace...")
    try:
        path = download_roast_build(cfg)
        console.print(f"[green]done[/green] → {path}")
    except Exception as e:
        console.print(f"[red]failed[/red]: {e}")
        raise SystemExit(1)


@roast.command("info")
def roast_info():
    """Show ROAST build and FreeSurfer status."""
    cfg = load_config()
    build_dir = resolve_roast_build_dir(cfg)
    if build_dir:
        console.print(f"[green]ROAST found:[/green] {build_dir}")
    else:
        console.print("[red]ROAST not found.[/red] Run 'crown roast download'.")

    mri_convert = cfg.freesurfer_home / "bin" / "mri_convert"
    if mri_convert.exists():
        console.print(f"[green]FreeSurfer found:[/green] {cfg.freesurfer_home}")
    else:
        console.print(f"[yellow]FreeSurfer not found[/yellow] (looked in {cfg.freesurfer_home}). "
                      "Set freesurfer_home in ~/.crown/config.toml or FREESURFER_HOME env var. "
                      "Required for -fs models.")
