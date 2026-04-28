from pathlib import Path
from unittest.mock import patch, MagicMock, call
import pytest
from crown_cli.core.jobs import JobStore, JobStatus


def test_worker_updates_status_to_running_then_done(tmp_path):
    store = JobStore(tmp_path / "jobs.duckdb")
    job_id = store.create_job("segment", [str(tmp_path / "input.nii.gz")], str(tmp_path / "out"), ["grace-native"], 0)

    # Create a dummy input file
    (tmp_path / "input.nii.gz").touch()

    with patch("crown_cli.core.worker.load_config") as mock_cfg_fn, \
         patch("crown_cli.core.worker.CLIModelRunner") as MockRunner, \
         patch("crown_cli.core.worker.JobStore", return_value=store):
        mock_cfg = MagicMock()
        mock_cfg.jobs_db = tmp_path / "jobs.duckdb"
        mock_cfg.jobs_dir = tmp_path / "jobs"
        mock_cfg_fn.return_value = mock_cfg

        mock_runner_instance = MagicMock()
        MockRunner.return_value = mock_runner_instance

        from crown_cli.core.worker import run_segment_job
        run_segment_job(job_id, store, mock_cfg)

    job = store.get_job(job_id)
    assert job["status"] == JobStatus.DONE


def test_worker_marks_failed_on_exception(tmp_path):
    store = JobStore(tmp_path / "jobs.duckdb")
    job_id = store.create_job("segment", [str(tmp_path / "input.nii.gz")], str(tmp_path / "out"), ["grace-native"], 0)

    with patch("crown_cli.core.worker.load_config") as mock_cfg_fn, \
         patch("crown_cli.core.worker.CLIModelRunner") as MockRunner, \
         patch("crown_cli.core.worker.JobStore", return_value=store):
        mock_cfg = MagicMock()
        mock_cfg.jobs_db = tmp_path / "jobs.duckdb"
        mock_cfg.jobs_dir = tmp_path / "jobs"
        mock_cfg_fn.return_value = mock_cfg

        MockRunner.return_value.run.side_effect = RuntimeError("GPU exploded")

        from crown_cli.core.worker import run_segment_job
        with pytest.raises(RuntimeError, match="GPU exploded"):
            run_segment_job(job_id, store, mock_cfg)

    job = store.get_job(job_id)
    assert job["status"] == JobStatus.FAILED
