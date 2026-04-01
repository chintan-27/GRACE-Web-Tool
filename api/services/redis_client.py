import redis
import json
from config import REDIS_HOST, REDIS_PORT, REDIS_DB, REDIS_PASSWORD

# -------------------------------------------------------------
# Redis client
# -------------------------------------------------------------
redis_client = redis.Redis(
    host=REDIS_HOST,
    port=REDIS_PORT,
    db=REDIS_DB,
    password=REDIS_PASSWORD,
    decode_responses=True
)

JOB_QUEUE = "job_queue"
GPU_POOL = "gpu_pool"              # set of free GPUs
SESSION_STATUS = "session_status"  # hash: session -> status
PROGRESS_KEY = "progress"          # hash: session:model -> %
EVENT_STREAM = "sse_events"        # list
JOB_STATUS = "job_status"          # hash: session:model -> status

# Single source of truth for live jobs shown in the admin dashboard.
# Hash:  field = "{type}:{session_id}:{model}:{run_id}"
#        value = JSON { type, session_id, model, run_id, status, progress, gpu }
# Jobs are inserted on enqueue and DELETED when they reach a terminal state
# (complete / error / cancelled), so this hash only ever contains active jobs.
ACTIVE_JOBS_KEY = "active_jobs"
_TERMINAL = {"complete", "error", "cancelled"}
# TTL (seconds) applied to individual legacy status/progress keys
_ACTIVE_TTL  = 86_400   # 24 h safety net for running keys
_DONE_TTL    = 3_600    # 1 h after a terminal state they can auto-expire


# -------------------------------------------------------------
# Active-jobs registry helpers
# -------------------------------------------------------------
def _active_field(job_type: str, session_id: str, model: str, run_id: str = "") -> str:
    return f"{job_type}:{session_id}:{model}:{run_id}" if run_id else f"{job_type}:{session_id}:{model}"


def _upsert_job(job_type: str, session_id: str, model: str, run_id: str = "",
                status: str | None = None, progress: float | None = None,
                gpu: str | None = None) -> None:
    """Insert or update a job in the active_jobs registry.

    Automatically removes the entry when `status` is terminal.
    """
    field = _active_field(job_type, session_id, model, run_id)
    if status in _TERMINAL:
        redis_client.hdel(ACTIVE_JOBS_KEY, field)
        return
    raw = redis_client.hget(ACTIVE_JOBS_KEY, field)
    data: dict = json.loads(raw) if raw else {
        "type": job_type,
        "session_id": session_id,
        "model": model,
        "run_id": run_id or None,
        "status": "queued",
        "progress": 0.0,
        "gpu": None,
    }
    if status is not None:
        data["status"] = status
    if progress is not None:
        data["progress"] = float(progress)
    if gpu is not None:
        data["gpu"] = str(gpu)
    redis_client.hset(ACTIVE_JOBS_KEY, field, json.dumps(data))


# -------------------------------------------------------------
# Queue handling
# -------------------------------------------------------------
def enqueue_job(job_dict: dict):
    redis_client.rpush(JOB_QUEUE, json.dumps(job_dict))


def pop_job():
    job = redis_client.lpop(JOB_QUEUE)
    if not job:
        return None
    return json.loads(job)


def get_queue_position(session_id: str) -> int:
    queue = redis_client.lrange(JOB_QUEUE, 0, -1)
    for idx, raw in enumerate(queue):
        if raw == session_id:
            return idx
        try:
            job = json.loads(raw)
            if job.get("session_id") == session_id:
                return idx
        except Exception:
            pass
    return -1


# -------------------------------------------------------------
# Session status
# -------------------------------------------------------------
def set_session_status(session_id: str, status: str):
    redis_client.hset(SESSION_STATUS, session_id, status)


def get_session_status(session_id: str):
    return redis_client.hget(SESSION_STATUS, session_id)


# -------------------------------------------------------------
# GPU seg job status  (also maintains active_jobs registry)
# -------------------------------------------------------------
def set_job_status(session_id: str, model: str, status: str, gpu: str | int | None = None):
    """Set per-model GPU-seg job state and keep active_jobs in sync."""
    redis_client.hset(f"{JOB_STATUS}:{session_id}", model, status)
    _upsert_job("gpu_seg", session_id, model, status=status,
                gpu=str(gpu) if gpu is not None else None)


def get_job_status(session_id: str, model: str):
    return redis_client.hget(f"{JOB_STATUS}:{session_id}", model)


# -------------------------------------------------------------
# GPU reservation pool
# -------------------------------------------------------------
def init_gpu_pool(gpu_count: int):
    redis_client.delete(GPU_POOL)
    for gpu in range(gpu_count):
        redis_client.sadd(GPU_POOL, gpu)


def reserve_gpu() -> int | None:
    gpu = redis_client.spop(GPU_POOL)
    return int(gpu) if gpu is not None else None


def free_gpu(gpu_index: int):
    redis_client.sadd(GPU_POOL, gpu_index)


# -------------------------------------------------------------
# Progress handling  (also maintains active_jobs registry)
# -------------------------------------------------------------
def set_progress(session_id: str, model: str, progress: float):
    redis_client.hset(PROGRESS_KEY, f"{session_id}:{model}", progress)
    _upsert_job("gpu_seg", session_id, model, progress=progress)


def get_progress(session_id: str, model: str) -> float:
    p = redis_client.hget(PROGRESS_KEY, f"{session_id}:{model}")
    return float(p) if p else 0.0


# -------------------------------------------------------------
# SSE events (optional ring buffer)
# -------------------------------------------------------------
def push_sse_event(event: dict):
    redis_client.rpush(EVENT_STREAM, json.dumps(event))


# -------------------------------------------------------------
# ROAST queue
# -------------------------------------------------------------
ROAST_JOB_QUEUE       = "roast_job_queue"
ROAST_JOB_DATA_PREFIX = "roast_job_data:"
ROAST_JOB_STATUS_PREFIX = "roast_job_status:"
ROAST_PROGRESS_PREFIX = "roast_progress:"


def enqueue_roast_job(session_id: str, payload: dict):
    redis_client.set(ROAST_JOB_DATA_PREFIX + session_id, json.dumps(payload), ex=_ACTIVE_TTL)
    redis_client.rpush(ROAST_JOB_QUEUE, session_id)
    model_name = payload.get("model_name", "")
    run_id = payload.get("run_id", "")
    _upsert_job("roast", session_id, model_name, run_id, status="queued")


def pop_roast_job() -> str | None:
    return redis_client.lpop(ROAST_JOB_QUEUE)


def get_roast_job_data(session_id: str) -> dict | None:
    raw = redis_client.get(ROAST_JOB_DATA_PREFIX + session_id)
    return json.loads(raw) if raw else None


def set_roast_status(session_id: str, status: str, model_name: str = "", run_id: str = ""):
    parts = [p for p in [session_id, model_name, run_id] if p]
    key = ROAST_JOB_STATUS_PREFIX + ":".join(parts)
    ttl = _DONE_TTL if status in _TERMINAL else _ACTIVE_TTL
    redis_client.set(key, status, ex=ttl)
    _upsert_job("roast", session_id, model_name, run_id, status=status)


def get_roast_status(session_id: str, model_name: str = "", run_id: str = "") -> str | None:
    parts = [p for p in [session_id, model_name, run_id] if p]
    return redis_client.get(ROAST_JOB_STATUS_PREFIX + ":".join(parts))


def set_roast_progress(session_id: str, progress: float, model_name: str = "", run_id: str = ""):
    parts = [p for p in [session_id, model_name, run_id] if p]
    redis_client.set(ROAST_PROGRESS_PREFIX + ":".join(parts), progress, ex=_ACTIVE_TTL)
    _upsert_job("roast", session_id, model_name, run_id, progress=progress)


def get_roast_progress(session_id: str, model_name: str = "", run_id: str = "") -> float:
    parts = [p for p in [session_id, model_name, run_id] if p]
    p = redis_client.get(ROAST_PROGRESS_PREFIX + ":".join(parts))
    return float(p) if p else 0.0


# -------------------------------------------------------------
# SimNIBS queue
# -------------------------------------------------------------
SIMNIBS_JOB_QUEUE         = "simnibs_job_queue"
SIMNIBS_JOB_DATA_PREFIX   = "simnibs_job_data:"
SIMNIBS_JOB_STATUS_PREFIX = "simnibs_job_status:"
SIMNIBS_PROGRESS_PREFIX   = "simnibs_progress:"


def enqueue_simnibs_job(session_id: str, payload: dict):
    redis_client.set(SIMNIBS_JOB_DATA_PREFIX + session_id, json.dumps(payload), ex=_ACTIVE_TTL)
    redis_client.rpush(SIMNIBS_JOB_QUEUE, session_id)
    model_name = payload.get("model_name", "")
    run_id = payload.get("run_id", "")
    _upsert_job("simnibs", session_id, model_name, run_id, status="queued")


def pop_simnibs_job() -> str | None:
    return redis_client.lpop(SIMNIBS_JOB_QUEUE)


def get_simnibs_job_data(session_id: str) -> dict | None:
    raw = redis_client.get(SIMNIBS_JOB_DATA_PREFIX + session_id)
    return json.loads(raw) if raw else None


def set_simnibs_status(session_id: str, status: str, model_name: str = "", run_id: str = ""):
    parts = [p for p in [session_id, model_name, run_id] if p]
    key = SIMNIBS_JOB_STATUS_PREFIX + ":".join(parts)
    ttl = _DONE_TTL if status in _TERMINAL else _ACTIVE_TTL
    redis_client.set(key, status, ex=ttl)
    _upsert_job("simnibs", session_id, model_name, run_id, status=status)


def get_simnibs_status(session_id: str, model_name: str = "", run_id: str = "") -> str | None:
    parts = [p for p in [session_id, model_name, run_id] if p]
    return redis_client.get(SIMNIBS_JOB_STATUS_PREFIX + ":".join(parts))


def set_simnibs_progress(session_id: str, progress: float, model_name: str = "", run_id: str = ""):
    parts = [p for p in [session_id, model_name, run_id] if p]
    redis_client.set(SIMNIBS_PROGRESS_PREFIX + ":".join(parts), progress, ex=_ACTIVE_TTL)
    _upsert_job("simnibs", session_id, model_name, run_id, progress=progress)


def get_simnibs_progress(session_id: str, model_name: str = "", run_id: str = "") -> float:
    parts = [p for p in [session_id, model_name, run_id] if p]
    p = redis_client.get(SIMNIBS_PROGRESS_PREFIX + ":".join(parts))
    return float(p) if p else 0.0


# -------------------------------------------------------------
# SimNIBS charm base lock
# -------------------------------------------------------------
CHARM_BASE_LOCK_PREFIX  = "simnibs_charm_base_lock:"
CHARM_BASE_READY_PREFIX = "simnibs_charm_base_ready:"


def acquire_charm_base_lock(session_id: str, ttl: int = 7200) -> bool:
    return bool(redis_client.set(CHARM_BASE_LOCK_PREFIX + session_id, "1", nx=True, ex=ttl))


def release_charm_base_lock(session_id: str) -> None:
    redis_client.delete(CHARM_BASE_LOCK_PREFIX + session_id)


def set_charm_base_ready(session_id: str) -> None:
    redis_client.set(CHARM_BASE_READY_PREFIX + session_id, "1", ex=86400)


def is_charm_base_ready(session_id: str) -> bool:
    return bool(redis_client.exists(CHARM_BASE_READY_PREFIX + session_id))


# -------------------------------------------------------------
# Session cancellation
# -------------------------------------------------------------
CANCEL_PREFIX = "cancel:"


def cancel_session(session_id: str) -> None:
    redis_client.set(CANCEL_PREFIX + session_id, "1", ex=3600)


def is_session_cancelled(session_id: str) -> bool:
    return bool(redis_client.get(CANCEL_PREFIX + session_id))


# -------------------------------------------------------------
# CLEANUP
# -------------------------------------------------------------
def cleanup_session(session_id: str):
    """Remove Redis keys associated with a session."""
    for prefix in (
        f"{JOB_STATUS}:{session_id}",
        f"{ROAST_JOB_DATA_PREFIX}{session_id}",
        f"{SIMNIBS_JOB_DATA_PREFIX}{session_id}",
        f"{CANCEL_PREFIX}{session_id}",
        f"{CHARM_BASE_LOCK_PREFIX}{session_id}",
        f"{CHARM_BASE_READY_PREFIX}{session_id}",
    ):
        redis_client.delete(prefix)
    # Remove any active_jobs entries for this session
    for field in list(redis_client.hgetall(ACTIVE_JOBS_KEY).keys()):
        if session_id in field:
            redis_client.hdel(ACTIVE_JOBS_KEY, field)
