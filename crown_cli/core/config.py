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
    model_cache: Path = field(default_factory=lambda: CROWN_DIR / "models")
    jobs_db: Path = field(default_factory=lambda: CROWN_DIR / "jobs.db")
    jobs_dir: Path = field(default_factory=lambda: CROWN_DIR / "jobs")
    freesurfer_home: Path = field(default_factory=lambda: Path("/usr/local/freesurfer"))
    roast_build_dir: Path = field(default_factory=lambda: Path("/opt/roast/build"))
    matlab_runtime: Path = field(default_factory=lambda: Path("/opt/mcr/R2025b"))
    roast_timeout: int = 7200
    roast_max_workers: int = 2
    offline: bool = False


def load_config() -> CrownConfig:
    """Resolve config: CLI flag > env var > config.toml > defaults."""
    cfg = CrownConfig()

    # Load TOML if present
    if CONFIG_PATH.exists():
        with open(CONFIG_PATH, "rb") as f:
            data = tomllib.load(f)
        paths = data.get("paths", {})
        if "freesurfer_home" in paths:
            cfg.freesurfer_home = Path(paths["freesurfer_home"])
        if "roast_build_dir" in paths:
            cfg.roast_build_dir = Path(paths["roast_build_dir"])

    # Env vars take precedence over TOML
    if v := os.getenv("CROWN_JOBS_DB"):
        cfg.jobs_db = Path(v)
    if v := os.getenv("CROWN_MODEL_CACHE"):
        cfg.model_cache = Path(v)
    if v := os.getenv("CROWN_OFFLINE"):
        cfg.offline = v.strip() == "1"
    if v := os.getenv("FREESURFER_HOME"):
        cfg.freesurfer_home = Path(v)
    if v := os.getenv("ROAST_BUILD_DIR"):
        cfg.roast_build_dir = Path(v)
    if v := os.getenv("MATLAB_RUNTIME"):
        cfg.matlab_runtime = Path(v)
    if v := os.getenv("ROAST_TIMEOUT_SECONDS"):
        cfg.roast_timeout = int(v)
    if v := os.getenv("ROAST_MAX_WORKERS"):
        cfg.roast_max_workers = int(v)

    return cfg
