import os
from pathlib import Path
from unittest.mock import patch, mock_open
import pytest


import sys
sys.path.insert(0, str(Path(__file__).parent.parent.resolve() / "src"))
from crown_cli.core.config import CrownConfig, load_config


def test_defaults():
    with patch.dict(os.environ, {}, clear=True):
        with patch("crown_cli.core.config.CONFIG_PATH", Path("/nonexistent/config.toml")):
            cfg = load_config()
    assert cfg.model_cache == Path.home() / ".crown" / "models"
    assert cfg.freesurfer_home == Path("/usr/local/freesurfer")


def test_env_var_override():
    with patch.dict(os.environ, {"CROWN_MODEL_CACHE": "/scratch/models", "CROWN_OFFLINE": "1"}):
        with patch("crown_cli.core.config.CONFIG_PATH", Path("/nonexistent/config.toml")):
            cfg = load_config()
    assert cfg.model_cache == Path("/scratch/models")
    assert cfg.offline is True


def test_toml_override(tmp_path):
    toml_content = b'[paths]\nfreesurfer_home = "/opt/freesurfer"\n'
    toml_file = tmp_path / "config.toml"
    toml_file.write_bytes(toml_content)
    with patch("crown_cli.core.config.CONFIG_PATH", toml_file):
        with patch.dict(os.environ, {}, clear=True):
            cfg = load_config()
    assert cfg.freesurfer_home == Path("/opt/freesurfer")


def test_crown_jobs_dir_env_override(tmp_path):
    custom = str(tmp_path / "scratch" / "jobs")
    with patch("crown_cli.core.config.CONFIG_PATH", Path("/nonexistent/config.toml")):
        with patch.dict(os.environ, {"CROWN_JOBS_DIR": custom}, clear=True):
            cfg = load_config()
    assert str(cfg.jobs_dir) == custom


def test_crown_jobs_dir_toml_override(tmp_path):
    jobs_dir = str(tmp_path / "custom_jobs")
    toml_content = f'[paths]\njobs_dir = "{jobs_dir}"\n'.encode()
    toml_file = tmp_path / "config.toml"
    toml_file.write_bytes(toml_content)
    with patch("crown_cli.core.config.CONFIG_PATH", toml_file):
        with patch.dict(os.environ, {}, clear=True):
            cfg = load_config()
    assert str(cfg.jobs_dir) == jobs_dir


def test_env_overrides_toml_for_jobs_dir(tmp_path):
    """Env var must win over TOML for jobs_dir."""
    toml_jobs = str(tmp_path / "toml_jobs")
    env_jobs = str(tmp_path / "env_jobs")
    toml_content = f'[paths]\njobs_dir = "{toml_jobs}"\n'.encode()
    toml_file = tmp_path / "config.toml"
    toml_file.write_bytes(toml_content)
    with patch("crown_cli.core.config.CONFIG_PATH", toml_file):
        with patch.dict(os.environ, {"CROWN_JOBS_DIR": env_jobs}, clear=True):
            cfg = load_config()
    assert str(cfg.jobs_dir) == env_jobs
