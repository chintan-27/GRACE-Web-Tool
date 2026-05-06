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


def test_resolve_t1_converts_native_input_for_fs_model(tmp_path):
    from crown_cli.core.worker import _resolve_t1_for_model

    cfg = MagicMock()
    cfg.freesurfer_home = tmp_path / "freesurfer"
    native_path = tmp_path / "input.nii.gz"
    native_path.touch()
    job_dir = tmp_path / "jobs" / "job-abc"
    job_dir.mkdir(parents=True)

    def fake_convert_to_fs(input_path, output_path, mri_convert, **kwargs):
        output_path.touch()
        return True

    with patch("crown_cli.inference.freesurfer.convert_to_fs", side_effect=fake_convert_to_fs) as mock_convert:
        model_input, input_space = _resolve_t1_for_model(
            "grace-fs", native_path, job_dir, cfg, input_space="native"
        )

    assert model_input == job_dir / "input_fs.nii"
    assert input_space == "native"
    mock_convert.assert_called_once()


def test_resolve_t1_uses_declared_freesurfer_input_as_is(tmp_path):
    from crown_cli.core.worker import _resolve_t1_for_model

    cfg = MagicMock()
    fs_path = tmp_path / "input_fs_upload.nii.gz"
    fs_path.touch()
    job_dir = tmp_path / "jobs" / "job-abc"
    job_dir.mkdir(parents=True)

    with patch("crown_cli.inference.freesurfer.convert_to_fs") as mock_convert:
        model_input, input_space = _resolve_t1_for_model(
            "grace-fs", fs_path, job_dir, cfg, input_space="freesurfer"
        )

    assert model_input == fs_path
    assert input_space == "freesurfer"
    mock_convert.assert_not_called()


def test_segment_job_passes_space_metadata_to_runner(tmp_path):
    store = JobStore(tmp_path / "jobs.duckdb")
    input_path = tmp_path / "input.nii.gz"
    input_path.touch()
    job_id = store.create_job("segment", [str(input_path)], str(tmp_path / "out"), ["grace-fs"], 0)
    store.update_meta(job_id, {"space": "native"})

    cfg = MagicMock()
    cfg.jobs_db = tmp_path / "jobs.duckdb"
    cfg.jobs_dir = tmp_path / "jobs"
    cfg.freesurfer_home = tmp_path / "freesurfer"

    def fake_resolve(model_name, path, job_dir, cfg, input_space="native"):
        return job_dir / "input_fs.nii", input_space

    with patch("crown_cli.core.worker._resolve_t1_for_model", side_effect=fake_resolve), \
         patch("crown_cli.core.worker.CLIModelRunner") as MockRunner:
        from crown_cli.core.worker import run_segment_job
        run_segment_job(job_id, store, cfg)

    MockRunner.assert_called_once()
    assert MockRunner.call_args.kwargs["input_space"] == "native"
    assert MockRunner.call_args.kwargs["native_reference_path"] == input_path
