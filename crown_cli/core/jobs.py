import json
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

import duckdb


class JobStatus:
    QUEUED = "queued"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"
    PARTIAL = "partial"   # batch: some succeeded, some failed
    CANCELLED = "cancelled"


class JobStore:
    def __init__(self, db_path: Path):
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self._path = str(db_path)
        self._init_schema()

    def _connect(self):
        return duckdb.connect(self._path)

    def _connect_ro(self):
        return duckdb.connect(self._path, read_only=True)

    def _init_schema(self):
        with self._connect() as con:
            con.execute("""
                CREATE TABLE IF NOT EXISTS jobs (
                    id          VARCHAR PRIMARY KEY,
                    type        VARCHAR,
                    status      VARCHAR,
                    input_paths VARCHAR[],
                    out_dir     VARCHAR,
                    models      VARCHAR[],
                    gpu         INTEGER,
                    pid         INTEGER,
                    created_at  TIMESTAMP,
                    updated_at  TIMESTAMP,
                    meta        VARCHAR
                )
            """)
            # Upgrade existing DBs that predate the meta column
            try:
                con.execute("ALTER TABLE jobs ADD COLUMN meta VARCHAR")
            except Exception:
                pass  # column already exists
            con.execute("""
                CREATE TABLE IF NOT EXISTS batches (
                    id          VARCHAR PRIMARY KEY,
                    job_ids     VARCHAR[],
                    status      VARCHAR,
                    created_at  TIMESTAMP,
                    updated_at  TIMESTAMP
                )
            """)

    def create_job(
        self,
        job_type: str,
        input_paths: list[str],
        out_dir: str,
        models: list[str],
        gpu: int,
    ) -> str:
        job_id = str(uuid.uuid4())[:8]
        now = datetime.utcnow()
        with self._connect() as con:
            con.execute(
                "INSERT INTO jobs VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                [job_id, job_type, JobStatus.QUEUED, input_paths, out_dir, models, gpu, None, now, now, None],
            )
        return job_id

    def update_status(self, job_id: str, status: str, pid: Optional[int] = None) -> None:
        now = datetime.utcnow()
        with self._connect() as con:
            con.execute(
                "UPDATE jobs SET status=?, pid=COALESCE(?,pid), updated_at=? WHERE id=?",
                [status, pid, now, job_id],
            )

    def update_meta(self, job_id: str, meta: dict) -> None:
        now = datetime.utcnow()
        with self._connect() as con:
            con.execute(
                "UPDATE jobs SET meta=?, updated_at=? WHERE id=?",
                [json.dumps(meta), now, job_id],
            )

    def get_meta(self, job_id: str) -> dict:
        with self._connect_ro() as con:
            row = con.execute("SELECT meta FROM jobs WHERE id=?", [job_id]).fetchone()
        if row is None or row[0] is None:
            return {}
        return json.loads(row[0])

    def get_job(self, job_id: str) -> dict:
        with self._connect_ro() as con:
            row = con.execute("SELECT * FROM jobs WHERE id=?", [job_id]).fetchone()
        if row is None:
            raise KeyError(f"Job not found: {job_id}")
        cols = ["id", "type", "status", "input_paths", "out_dir", "models", "gpu", "pid", "created_at", "updated_at", "meta"]
        return dict(zip(cols, row))

    def list_jobs(self, limit: int = 20) -> list[dict]:
        with self._connect_ro() as con:
            rows = con.execute(
                "SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?", [limit]
            ).fetchall()
        cols = ["id", "type", "status", "input_paths", "out_dir", "models", "gpu", "pid", "created_at", "updated_at", "meta"]
        return [dict(zip(cols, r)) for r in rows]

    def create_batch(self, job_ids: list[str]) -> str:
        batch_id = "batch-" + str(uuid.uuid4())[:6]
        now = datetime.utcnow()
        with self._connect() as con:
            con.execute(
                "INSERT INTO batches VALUES (?,?,?,?,?)",
                [batch_id, job_ids, JobStatus.RUNNING, now, now],
            )
        return batch_id

    def get_batch(self, batch_id: str) -> dict:
        with self._connect_ro() as con:
            row = con.execute("SELECT * FROM batches WHERE id=?", [batch_id]).fetchone()
        if row is None:
            raise KeyError(f"Batch not found: {batch_id}")
        cols = ["id", "job_ids", "status", "created_at", "updated_at"]
        return dict(zip(cols, row))

    def update_batch_status(self, batch_id: str, status: str) -> None:
        now = datetime.utcnow()
        with self._connect() as con:
            con.execute(
                "UPDATE batches SET status=?, updated_at=? WHERE id=?",
                [status, now, batch_id],
            )
