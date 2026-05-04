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


def test_emit_concurrent_writes_produce_valid_jsonl(tmp_path):
    """Concurrent emits must produce parseable JSONL with no interleaved lines."""
    import threading

    writer = ProgressWriter(tmp_path)
    errors = []

    def emit_many(n):
        for i in range(n):
            try:
                writer.emit("log", message=f"msg-{i}")
            except Exception as e:
                errors.append(e)

    threads = [threading.Thread(target=emit_many, args=(50,)) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert not errors, f"Exceptions during concurrent emit: {errors}"
    events = ProgressReader(tmp_path).read_all()
    assert len(events) == 200, f"Expected 200 events, got {len(events)} — likely interleaved writes"
