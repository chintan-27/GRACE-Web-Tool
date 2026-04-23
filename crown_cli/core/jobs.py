import json
import sqlite3
import uuid
from datetime import datetime, UTC
from pathlib import Path
from typing import Optional


class JobStatus:
    QUEUED = "queued"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"
    PARTIAL = "partial"
    CANCELLED = "cancelled"


class JobStore:
    def __init__(self, db_path: Path):
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self._path = str(db_path)
        self._warn_old_duckdb(db_path)
        self._init_schema()

    def _warn_old_duckdb(self, db_path: Path) -> None:
        old = db_path.parent / "jobs.duckdb"
        if old.exists() and not db_path.exists():
            from rich.console import Console
            Console(stderr=True).print(
                "[yellow]Note:[/yellow] Found old jobs.duckdb — job history not migrated. "
                "New jobs use jobs.db (SQLite)."
            )

    def _connect(self) -> sqlite3.Connection:
        con = sqlite3.connect(self._path, timeout=30)
        con.row_factory = sqlite3.Row
        return con

    def _init_schema(self) -> None:
        with self._connect() as con:
            con.execute("PRAGMA journal_mode=WAL")
            con.execute("PRAGMA busy_timeout=30000")
            con.execute("PRAGMA synchronous=NORMAL")
            con.execute("""
                CREATE TABLE IF NOT EXISTS jobs (
                    id          TEXT PRIMARY KEY,
                    type        TEXT,
                    status      TEXT,
                    input_paths TEXT,
                    out_dir     TEXT,
                    models      TEXT,
                    gpu         INTEGER,
                    pid         INTEGER,
                    created_at  TEXT,
                    updated_at  TEXT,
                    meta        TEXT
                )
            """)
            try:
                con.execute("ALTER TABLE jobs ADD COLUMN meta TEXT")
            except sqlite3.OperationalError:
                pass  # column already exists
            con.execute("""
                CREATE TABLE IF NOT EXISTS batches (
                    id          TEXT PRIMARY KEY,
                    job_ids     TEXT,
                    status      TEXT,
                    created_at  TEXT,
                    updated_at  TEXT
                )
            """)

    @staticmethod
    def _now() -> str:
        return datetime.now(UTC).isoformat()

    def _row_to_dict(self, row: sqlite3.Row) -> dict:
        d = dict(row)
        for key in ("input_paths", "models"):
            raw = d.get(key)
            try:
                d[key] = json.loads(raw) if raw else []
            except (json.JSONDecodeError, TypeError):
                d[key] = []
        return d

    def create_job(
        self,
        job_type: str,
        input_paths: list[str],
        out_dir: str,
        models: list[str],
        gpu: int,
    ) -> str:
        job_id = str(uuid.uuid4())[:8]
        now = self._now()
        with self._connect() as con:
            con.execute(
                """INSERT INTO jobs
                   (id, type, status, input_paths, out_dir, models, gpu, pid, created_at, updated_at, meta)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                [job_id, job_type, JobStatus.QUEUED,
                 json.dumps(input_paths), out_dir, json.dumps(models),
                 gpu, None, now, now, '{}'],
            )
        return job_id

    def update_status(self, job_id: str, status: str, pid: Optional[int] = None) -> None:
        with self._connect() as con:
            con.execute(
                "UPDATE jobs SET status=?, pid=COALESCE(?,pid), updated_at=? WHERE id=?",
                [status, pid, self._now(), job_id],
            )

    def update_meta(self, job_id: str, meta: dict) -> None:
        with self._connect() as con:
            con.execute(
                "UPDATE jobs SET meta=?, updated_at=? WHERE id=?",
                [json.dumps(meta), self._now(), job_id],
            )

    def get_meta(self, job_id: str) -> dict:
        with self._connect() as con:
            row = con.execute("SELECT meta FROM jobs WHERE id=?", [job_id]).fetchone()
        if row is None or row[0] is None:
            return {}
        try:
            return json.loads(row[0])
        except (json.JSONDecodeError, TypeError):
            return {}

    def get_job(self, job_id: str) -> dict:
        with self._connect() as con:
            row = con.execute("SELECT * FROM jobs WHERE id=?", [job_id]).fetchone()
        if row is None:
            raise KeyError(f"Job not found: {job_id}")
        return self._row_to_dict(row)

    def list_jobs(self, limit: int = 20) -> list[dict]:
        with self._connect() as con:
            rows = con.execute(
                "SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?", [limit]
            ).fetchall()
        return [self._row_to_dict(r) for r in rows]

    def create_batch(self, job_ids: list[str]) -> str:
        batch_id = "batch-" + str(uuid.uuid4())[:6]
        now = self._now()
        with self._connect() as con:
            con.execute(
                """INSERT INTO batches (id, job_ids, status, created_at, updated_at)
                   VALUES (?,?,?,?,?)""",
                [batch_id, json.dumps(job_ids), JobStatus.RUNNING, now, now],
            )
        return batch_id

    def get_batch(self, batch_id: str) -> dict:
        with self._connect() as con:
            row = con.execute("SELECT * FROM batches WHERE id=?", [batch_id]).fetchone()
        if row is None:
            raise KeyError(f"Batch not found: {batch_id}")
        d = dict(row)
        try:
            d["job_ids"] = json.loads(d["job_ids"]) if d["job_ids"] else []
        except (json.JSONDecodeError, TypeError):
            d["job_ids"] = []
        return d

    def update_batch_status(self, batch_id: str, status: str) -> None:
        with self._connect() as con:
            con.execute(
                "UPDATE batches SET status=?, updated_at=? WHERE id=?",
                [status, self._now(), batch_id],
            )
