from pathlib import Path
from unittest.mock import patch, MagicMock
import pytest
from crown_cli.core.hub import get_checkpoint, download_all


def test_get_checkpoint_calls_hf_download(tmp_path):
    mock_cfg = MagicMock()
    mock_cfg.hf_token = ""
    mock_cfg.model_cache = tmp_path
    mock_cfg.offline = False

    with patch("crown_cli.core.hub.hf_hub_download", return_value=str(tmp_path / "grace_native.pth")) as mock_dl:
        result = get_checkpoint("grace-native", mock_cfg)

    mock_dl.assert_called_once_with(
        repo_id="smilelab/GRACE",
        filename="grace_native.pth",
        cache_dir=tmp_path,
        local_files_only=False,
        token=None,
    )
    assert result == tmp_path / "grace_native.pth"


def test_get_checkpoint_offline_mode(tmp_path):
    mock_cfg = MagicMock()
    mock_cfg.hf_token = ""
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
