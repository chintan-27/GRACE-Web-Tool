import json
import threading
import time
from pathlib import Path
from typing import Any


class ProgressWriter:
    """Writes progress events to progress.jsonl in the job directory."""

    def __init__(self, job_dir: Path):
        self.path = job_dir / "progress.jsonl"
        self._lock = threading.Lock()
        job_dir.mkdir(parents=True, exist_ok=True)

    def emit(self, event: str, **kwargs: Any) -> None:
        record = {"event": event, "ts": time.time(), **kwargs}
        with self._lock:
            with open(self.path, "a") as f:
                f.write(json.dumps(record) + "\n")


class ProgressReader:
    """Reads progress events from progress.jsonl."""

    def __init__(self, job_dir: Path):
        self.path = job_dir / "progress.jsonl"

    def read_all(self) -> list[dict]:
        if not self.path.exists():
            return []
        events = []
        with open(self.path) as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        events.append(json.loads(line))
                    except json.JSONDecodeError:
                        continue
        return events

    def tail(self, poll_interval: float = 0.5):
        """Generator that yields new events as they arrive (for crown status live view).

        Yields None as a heartbeat after each poll so consumers can check stop conditions.
        """
        offset = 0
        while True:
            if self.path.exists():
                with open(self.path) as f:
                    f.seek(offset)
                    for line in f:
                        line = line.strip()
                        if line:
                            try:
                                yield json.loads(line)
                            except json.JSONDecodeError:
                                pass
                    offset = f.tell()
            time.sleep(poll_interval)
            yield None  # heartbeat: let consumer check job status
