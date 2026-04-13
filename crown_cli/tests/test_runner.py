from pathlib import Path
from unittest.mock import patch, MagicMock, call
import pytest
from crown_cli.core.runner import CLIModelRunner


@pytest.fixture
def mock_cfg(tmp_path):
    cfg = MagicMock()
    cfg.model_cache = tmp_path
    cfg.hf_repo = "smile-lab/crown-models"
    cfg.hf_token = ""
    cfg.offline = False
    return cfg


def test_runner_emits_progress_to_writer(tmp_path, mock_cfg):
    job_dir = tmp_path / "job-abc"
    job_dir.mkdir()

    runner = CLIModelRunner(
        model_name="grace-native",
        job_dir=job_dir,
        gpu_id=0,
        cfg=mock_cfg,
    )
    # _emit should write to progress.jsonl
    runner._emit("test_event", progress=42)

    from crown_cli.core.progress import ProgressReader
    events = ProgressReader(job_dir).read_all()
    assert len(events) == 1
    assert events[0]["event"] == "test_event"
    assert events[0]["progress"] == 42
    assert events[0]["model"] == "grace-native"


def test_runner_raises_on_missing_checkpoint(tmp_path, mock_cfg):
    from huggingface_hub.utils import LocalEntryNotFoundError
    job_dir = tmp_path / "job-abc"
    job_dir.mkdir()

    runner = CLIModelRunner("grace-native", job_dir, gpu_id=0, cfg=mock_cfg)

    with patch("crown_cli.core.runner.get_checkpoint", side_effect=RuntimeError("not in cache")):
        with pytest.raises(RuntimeError, match="not in cache"):
            runner.load_model()
