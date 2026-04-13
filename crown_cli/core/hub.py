from pathlib import Path
from huggingface_hub import hf_hub_download
from huggingface_hub.utils import LocalEntryNotFoundError

from crown_cli.core.config import CrownConfig
from crown_cli.inference.registry import get_model_config


def get_checkpoint(model_name: str, cfg: CrownConfig) -> Path:
    """Download (or load from cache) the checkpoint for a model."""
    config = get_model_config(model_name)   # raises ValueError if unknown
    filename = config["hf_filename"]
    token = cfg.hf_token or None

    try:
        path = hf_hub_download(
            repo_id=cfg.hf_repo,
            filename=filename,
            cache_dir=cfg.model_cache,
            local_files_only=cfg.offline,
            token=token,
        )
    except LocalEntryNotFoundError:
        raise RuntimeError(
            f"Model '{model_name}' not found in cache ({cfg.model_cache}). "
            f"Run 'crown models download {model_name}' on a node with internet access first."
        )

    return Path(path)


def download_all(cfg: CrownConfig, models: list[str] | None = None) -> dict[str, Path]:
    """Download multiple (or all) model checkpoints. Returns {model_name: path}."""
    from crown_cli.inference.registry import list_models
    targets = models or list_models()
    results = {}
    for name in targets:
        results[name] = get_checkpoint(name, cfg)
    return results
