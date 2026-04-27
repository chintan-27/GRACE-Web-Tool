from unittest.mock import patch, MagicMock
from pathlib import Path
from crown_cli.core.deps import check_capabilities, Capabilities


def test_all_present():
    mock_cfg = MagicMock()
    mock_cfg.freesurfer_home = Path("/fs")
    mock_cfg.roast_build_dir = Path("/roast")

    with patch("crown_cli.core.deps.torch") as mock_torch, \
         patch("crown_cli.core.deps.Path.exists", return_value=True), \
         patch("crown_cli.core.deps.Path.is_file", return_value=True):
        mock_torch.cuda.is_available.return_value = True
        caps = check_capabilities(mock_cfg)

    assert caps.cuda is True
    assert caps.freesurfer is True
    assert caps.roast is True


def test_missing_freesurfer():
    mock_cfg = MagicMock()
    mock_cfg.freesurfer_home = Path("/nonexistent")
    mock_cfg.roast_build_dir = Path("/nonexistent")

    with patch("crown_cli.core.deps.torch") as mock_torch, \
         patch("crown_cli.core.deps.Path.exists", return_value=False), \
         patch("crown_cli.core.deps.Path.is_file", return_value=False):
        mock_torch.cuda.is_available.return_value = False
        caps = check_capabilities(mock_cfg)

    assert caps.cuda is False
    assert caps.freesurfer is False
    assert caps.roast is False


def test_available_models_excludes_fs_without_freesurfer():
    caps = Capabilities(cuda=True, freesurfer=False, roast=False)
    available = caps.available_models()
    assert all("-fs" not in m for m in available)
    assert "grace-native" in available


def test_available_models_includes_fs_with_freesurfer():
    caps = Capabilities(cuda=True, freesurfer=True, roast=False)
    available = caps.available_models()
    assert "grace-fs" in available
    assert "domino-fs" in available
