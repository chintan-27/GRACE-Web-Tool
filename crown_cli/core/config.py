import os
import sys
from dataclasses import dataclass, field
from pathlib import Path

if sys.version_info >= (3, 11):
    import tomllib
else:
    import tomli as tomllib

CROWN_DIR = Path.home() / ".crown"
CONFIG_PATH = CROWN_DIR / "config.toml"


@dataclass
class CrownConfig:
    hf_token: str = ""
    model_cache: Path = field(default_factory=lambda: CROWN_DIR / "models")
    jobs_db: Path = field(default_factory=lambda: CROWN_DIR / "jobs.duckdb")
    jobs_dir: Path = field(default_factory=lambda: CROWN_DIR / "jobs")
    freesurfer_home: Path = field(default_factory=lambda: Path("/usr/local/freesurfer"))
    roast_build_dir: Path = field(default_factory=lambda: Path("/opt/roast/build"))
    simnibs_home: Path = field(default_factory=lambda: Path("/opt/simnibs"))
    offline: bool = False


def load_config() -> CrownConfig:
    """Resolve config: CLI flag > env var > config.toml > defaults."""
    cfg = CrownConfig()

    # Load TOML if present
    if CONFIG_PATH.exists():
        with open(CONFIG_PATH, "rb") as f:
            data = tomllib.load(f)
        paths = data.get("paths", {})
        if "hf_token" in paths:
            cfg.hf_token = paths["hf_token"]
        if "freesurfer_home" in paths:
            cfg.freesurfer_home = Path(paths["freesurfer_home"])
        if "roast_build_dir" in paths:
            cfg.roast_build_dir = Path(paths["roast_build_dir"])
        if "simnibs_home" in paths:
            cfg.simnibs_home = Path(paths["simnibs_home"])

    # Env vars take precedence over TOML
    if v := os.getenv("CROWN_MODEL_CACHE"):
        cfg.model_cache = Path(v)
    if v := os.getenv("HF_TOKEN"):
        cfg.hf_token = v
    if v := os.getenv("CROWN_OFFLINE"):
        cfg.offline = v.strip() == "1"
    if v := os.getenv("FREESURFER_HOME"):
        cfg.freesurfer_home = Path(v)
    if v := os.getenv("ROAST_BUILD_DIR"):
        cfg.roast_build_dir = Path(v)
    if v := os.getenv("SIMNIBS_HOME"):
        cfg.simnibs_home = Path(v)

    return cfg
