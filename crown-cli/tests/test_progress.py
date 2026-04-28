import json
import time
from pathlib import Path
from crown_cli.core.progress import ProgressWriter, ProgressReader


def test_write_and_read_events(tmp_path):
    job_dir = tmp_path / "job-abc"
    job_dir.mkdir()

    writer = ProgressWriter(job_dir)
    writer.emit("model_load_start", model="grace-native", progress=5)
    writer.emit("inference_start", model="grace-native", progress=30)

    reader = ProgressReader(job_dir)
    events = reader.read_all()
    assert len(events) == 2
    assert events[0]["event"] == "model_load_start"
    assert events[0]["model"] == "grace-native"
    assert events[0]["progress"] == 5
    assert events[1]["event"] == "inference_start"


def test_reader_returns_empty_for_missing_file(tmp_path):
    reader = ProgressReader(tmp_path / "nonexistent")
    assert reader.read_all() == []
