import pytest
from crown_cli.core.jobs import JobStore, JobStatus


@pytest.fixture
def store(tmp_path):
    return JobStore(tmp_path / "jobs.duckdb")


def test_create_and_get_job(store):
    job_id = store.create_job(
        job_type="segment",
        input_paths=["/data/sub01.nii.gz"],
        out_dir="/results",
        models=["grace-native"],
        gpu=0,
    )
    job = store.get_job(job_id)
    assert job["id"] == job_id
    assert job["status"] == JobStatus.QUEUED
    assert job["models"] == ["grace-native"]


def test_update_status(store):
    job_id = store.create_job("segment", ["/a.nii.gz"], "/out", ["grace-native"], 0)
    store.update_status(job_id, JobStatus.RUNNING, pid=1234)
    job = store.get_job(job_id)
    assert job["status"] == JobStatus.RUNNING
    assert job["pid"] == 1234


def test_list_jobs(store):
    store.create_job("segment", ["/a.nii.gz"], "/out", ["grace-native"], 0)
    store.create_job("segment", ["/b.nii.gz"], "/out", ["domino-native"], 0)
    jobs = store.list_jobs(limit=10)
    assert len(jobs) == 2


def test_create_and_get_batch(store):
    child1 = store.create_job("segment", ["/a.nii.gz"], "/out/a", ["grace-native"], 0)
    child2 = store.create_job("segment", ["/b.nii.gz"], "/out/b", ["grace-native"], 0)
    batch_id = store.create_batch([child1, child2])
    batch = store.get_batch(batch_id)
    assert batch["id"] == batch_id
    assert set(batch["job_ids"]) == {child1, child2}
    assert batch["status"] == JobStatus.RUNNING
