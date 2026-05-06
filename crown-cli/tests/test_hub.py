from pathlib import Path
from unittest.mock import patch, MagicMock
import pytest
from huggingface_hub.utils import LocalEntryNotFoundError
from crown_cli.core.hub import get_checkpoint, download_all, resolve_roast_build_dir, download_roast_build


def test_get_checkpoint_calls_hf_download(tmp_path):
    mock_cfg = MagicMock()
    mock_cfg.model_cache = tmp_path
    mock_cfg.offline = False

    with patch("crown_cli.core.hub.hf_hub_download", return_value=str(tmp_path / "grace_native.pth")) as mock_dl:
        result = get_checkpoint("grace-native", mock_cfg)

    mock_dl.assert_called_once_with(
        repo_id="smilelab/GRACE",
        filename="grace_native.pth",
        cache_dir=tmp_path,
        local_files_only=False,
    )
    assert result == tmp_path / "grace_native.pth"


def test_get_checkpoint_offline_mode(tmp_path):
    mock_cfg = MagicMock()
    mock_cfg.model_cache = tmp_path
    mock_cfg.offline = True

    with patch("crown_cli.core.hub.hf_hub_download", return_value=str(tmp_path / "grace_native.pth")):
        get_checkpoint("grace-native", mock_cfg)

    from crown_cli.core import hub as hub_mod
    with patch("crown_cli.core.hub.hf_hub_download") as mock_dl:
        mock_dl.return_value = str(tmp_path / "grace_native.pth")
        get_checkpoint("grace-native", mock_cfg)
        _, kwargs = mock_dl.call_args
        assert kwargs["local_files_only"] is True


def test_get_checkpoint_unknown_model(tmp_path):
    mock_cfg = MagicMock()
    mock_cfg.model_cache = tmp_path
    mock_cfg.offline = False
    with pytest.raises(ValueError, match="Unknown model"):
        get_checkpoint("nonexistent-model", mock_cfg)


def test_resolve_roast_build_dir_finds_explicit_path(tmp_path):
    (tmp_path / "run_roast_run.sh").touch()
    cfg = MagicMock()
    cfg.roast_build_dir = tmp_path
    cfg.roast_cache = Path("/nonexistent")
    assert resolve_roast_build_dir(cfg) == tmp_path


def test_resolve_roast_build_dir_falls_back_to_cache(tmp_path):
    (tmp_path / "run_roast_run.sh").touch()
    cfg = MagicMock()
    cfg.roast_build_dir = Path("/nonexistent")
    cfg.roast_cache = tmp_path
    assert resolve_roast_build_dir(cfg) == tmp_path


def test_resolve_roast_build_dir_returns_none_if_missing():
    cfg = MagicMock()
    cfg.roast_build_dir = Path("/nonexistent")
    cfg.roast_cache = Path("/also-nonexistent")
    assert resolve_roast_build_dir(cfg) is None


def test_download_roast_build_offline_raises(tmp_path):
    cfg = MagicMock()
    cfg.roast_cache = tmp_path
    cfg.offline = True
    with patch("crown_cli.core.hub.snapshot_download", side_effect=LocalEntryNotFoundError("x")):
        with pytest.raises(RuntimeError, match="crown roast download"):
            download_roast_build(cfg)


def test_download_roast_build_returns_path(tmp_path):
    cfg = MagicMock()
    cfg.roast_cache = tmp_path
    cfg.offline = False
    with patch("crown_cli.core.hub.snapshot_download", return_value=str(tmp_path)) as mock_dl:
        result = download_roast_build(cfg)
    mock_dl.assert_called_once_with(
        repo_id="smilelab/roast-11tissue-build",
        local_dir=str(tmp_path),
        local_files_only=False,
        repo_type="dataset",
    )
    assert result == tmp_path
