import os
from pathlib import Path
from unittest.mock import patch, mock_open
import pytest
from crown_cli.core.config import CrownConfig, load_config


def test_defaults():
    with patch.dict(os.environ, {}, clear=True):
        with patch("crown_cli.core.config.CONFIG_PATH", Path("/nonexistent/config.toml")):
            cfg = load_config()
    assert cfg.hf_repo == "smile-lab/crown-models"
    assert cfg.model_cache == Path.home() / ".crown" / "models"
    assert cfg.freesurfer_home == Path("/usr/local/freesurfer")


def test_env_var_override():
    with patch.dict(os.environ, {"CROWN_MODEL_CACHE": "/scratch/models", "CROWN_OFFLINE": "1"}):
        with patch("crown_cli.core.config.CONFIG_PATH", Path("/nonexistent/config.toml")):
            cfg = load_config()
    assert cfg.model_cache == Path("/scratch/models")
    assert cfg.offline is True


def test_toml_override(tmp_path):
    toml_content = b'[paths]\nhf_repo = "my-org/my-models"\n'
    toml_file = tmp_path / "config.toml"
    toml_file.write_bytes(toml_content)
    with patch("crown_cli.core.config.CONFIG_PATH", toml_file):
        with patch.dict(os.environ, {}, clear=True):
            cfg = load_config()
    assert cfg.hf_repo == "my-org/my-models"
