from __future__ import annotations
from dataclasses import dataclass
from pathlib import Path
from typing import List

import torch

from crown_cli.core.config import CrownConfig

ALL_MODELS = [
    "grace-native", "grace-fs",
    "domino-native", "domino-fs",
    "dominopp-native", "dominopp-fs",
]


@dataclass
class Capabilities:
    cuda: bool
    freesurfer: bool
    roast: bool
    simnibs: bool

    def available_models(self) -> List[str]:
        return [m for m in ALL_MODELS if self.freesurfer or "-fs" not in m]

    def warn(self) -> None:
        """Print warnings for missing capabilities."""
        from rich.console import Console
        console = Console(stderr=True)
        if not self.cuda:
            console.print("[yellow]Warning:[/yellow] No CUDA GPU found — inference will be very slow on CPU.")
        if not self.freesurfer:
            console.print("[yellow]Warning:[/yellow] FreeSurfer not found — *-fs models are disabled.")

    def require_roast(self) -> None:
        if not self.roast:
            from rich.console import Console
            Console(stderr=True).print(
                "[red]Error:[/red] ROAST not found. "
                "Install ROAST and set roast_build_dir in ~/.crown/config.toml"
            )
            raise SystemExit(1)

    def require_simnibs(self) -> None:
        if not self.simnibs:
            from rich.console import Console
            Console(stderr=True).print(
                "[red]Error:[/red] SimNIBS not found. "
                "Install SimNIBS and set simnibs_home in ~/.crown/config.toml"
            )
            raise SystemExit(1)


def check_capabilities(cfg: CrownConfig) -> Capabilities:
    cuda = torch.cuda.is_available()
    mri_convert = cfg.freesurfer_home / "bin" / "mri_convert"
    freesurfer = mri_convert.exists() and mri_convert.is_file()
    roast_bin = cfg.roast_build_dir / "run_roast.sh"
    roast = roast_bin.exists() and roast_bin.is_file()
    charm_bin = cfg.simnibs_home / "bin" / "charm"
    simnibs = charm_bin.exists() and charm_bin.is_file()
    return Capabilities(cuda=cuda, freesurfer=freesurfer, roast=roast, simnibs=simnibs)
