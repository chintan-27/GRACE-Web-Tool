from pathlib import Path
from huggingface_hub import hf_hub_download, snapshot_download
from huggingface_hub.utils import LocalEntryNotFoundError

from crown_cli.core.config import CrownConfig
from crown_cli.inference.registry import get_model_config

ROAST_HF_REPO = "smilelab/roast-11tissue-build"


def get_checkpoint(model_name: str, cfg: CrownConfig) -> Path:
    """Download (or load from cache) the checkpoint for a model."""
    config = get_model_config(model_name)   # raises ValueError if unknown
    filename = config["hf_filename"]
    repo_id = config["hf_repo"]

    try:
        path = hf_hub_download(
            repo_id=repo_id,
            filename=filename,
            cache_dir=cfg.model_cache,
            local_files_only=cfg.offline,
        )
    except LocalEntryNotFoundError:
        raise RuntimeError(
            f"Model '{model_name}' not found in cache ({cfg.model_cache}). "
            f"Run 'crown models download {model_name}' on a node with internet access first."
        )

    return Path(path)


def resolve_roast_build_dir(cfg: CrownConfig) -> Path | None:
    """Return path to ROAST build dir containing run_roast_run.sh, or None."""
    for candidate in [cfg.roast_build_dir, cfg.roast_cache]:
        if (candidate / "bin" / "run_roast_run.sh").is_file():
            return candidate
    return None


def download_roast_build(cfg: CrownConfig) -> Path:
    """Download ROAST build from HuggingFace to roast_cache."""
    try:
        local_dir = snapshot_download(
            repo_id=ROAST_HF_REPO,
            repo_type="dataset",
            local_dir=str(cfg.roast_cache),
            local_files_only=cfg.offline,
        )
    except LocalEntryNotFoundError:
        raise RuntimeError(
            f"ROAST build not in cache ({cfg.roast_cache}). "
            "Run 'crown roast download' on a node with internet access first."
        )
    return Path(local_dir)


def download_all(cfg: CrownConfig, models: list[str] | None = None) -> dict[str, Path]:
    """Download multiple (or all) model checkpoints. Returns {model_name: path}."""
    from crown_cli.inference.registry import list_models
    targets = models or list_models()
    results = {}
    for name in targets:
        results[name] = get_checkpoint(name, cfg)
    return results
