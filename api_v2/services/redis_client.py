import redis
import json
from config import REDIS_HOST, REDIS_PORT, REDIS_DB

# -------------------------------------------------------------
# Redis client
# -------------------------------------------------------------
redis_client = redis.Redis(
    host=REDIS_HOST,
    port=REDIS_PORT,
    db=REDIS_DB,
    decode_responses=True
)

JOB_QUEUE = "job_queue"
GPU_POOL = "gpu_pool"              # set of free GPUs
SESSION_STATUS = "session_status"  # hash: session -> status
PROGRESS_KEY = "progress"          # hash: session:model -> %
EVENT_STREAM = "sse_events"        # list
JOB_STATUS = "job_status"          # hash: session:model -> status


# -------------------------------------------------------------
# Queue handling
# -------------------------------------------------------------
def enqueue_job(job_dict: dict):
    """
    Adds a job to the queue. job_dict must include:
    {
        "session_id": str,
        "model": str,
        "gpu": None (initial),
        "input_path": str,
        "space": str,
        ...
    }
    """
    redis_client.rpush(JOB_QUEUE, json.dumps(job_dict))


def pop_job():
    """
    Pops next job from queue.
    """
    job = redis_client.lpop(JOB_QUEUE)
    if not job:
        return None
    return json.loads(job)


def get_queue_position(session_id: str) -> int:
    queue = redis_client.lrange(JOB_QUEUE, 0, -1)
    for idx, raw in enumerate(queue):
        # raw is a str because decode_responses=True
        if raw == session_id:
            return idx
        # backwards compatibility if older JSON jobs exist:
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
# Job status
# -------------------------------------------------------------
def set_job_status(session_id: str, model: str, status: str):
    """
    per-model job state:
      queued, assigned, running, complete, error
    """
    redis_client.hset(f"{JOB_STATUS}:{session_id}", model, status)


def get_job_status(session_id: str, model: str):
    return redis_client.hget(f"{JOB_STATUS}:{session_id}", model)


# -------------------------------------------------------------
# GPU reservation pool
# -------------------------------------------------------------
def init_gpu_pool(gpu_count: int):
    """
    Initializes the GPU pool (free GPUs).
    """
    redis_client.delete(GPU_POOL)
    for gpu in range(gpu_count):
        redis_client.sadd(GPU_POOL, gpu)


def reserve_gpu() -> int | None:
    """
    Reserves and returns a GPU index, or None if none free.
    """
    gpu = redis_client.spop(GPU_POOL)
    return int(gpu) if gpu is not None else None


def free_gpu(gpu_index: int):
    """
    Marks a GPU as free.
    """
    redis_client.sadd(GPU_POOL, gpu_index)


# -------------------------------------------------------------
# Progress handling
# -------------------------------------------------------------
def set_progress(session_id: str, model: str, progress: float):
    key = f"{session_id}:{model}"
    redis_client.hset(PROGRESS_KEY, key, progress)


def get_progress(session_id: str, model: str) -> float:
    key = f"{session_id}:{model}"
    p = redis_client.hget(PROGRESS_KEY, key)
    return float(p) if p else 0.0


# -------------------------------------------------------------
# SSE events (optional ring buffer)
# -------------------------------------------------------------
def push_sse_event(event: dict):
    redis_client.rpush(EVENT_STREAM, json.dumps(event))

# -------------------------------------------------------------
# ROAST queue
# -------------------------------------------------------------
ROAST_JOB_QUEUE = "roast_job_queue"
ROAST_JOB_DATA_PREFIX = "roast_job_data:"
ROAST_JOB_STATUS_PREFIX = "roast_job_status:"
ROAST_PROGRESS_PREFIX = "roast_progress:"


def enqueue_roast_job(session_id: str, payload: dict):
    redis_client.set(ROAST_JOB_DATA_PREFIX + session_id, json.dumps(payload))
    redis_client.rpush(ROAST_JOB_QUEUE, session_id)


def pop_roast_job() -> str | None:
    return redis_client.lpop(ROAST_JOB_QUEUE)


def get_roast_job_data(session_id: str) -> dict | None:
    raw = redis_client.get(ROAST_JOB_DATA_PREFIX + session_id)
    return json.loads(raw) if raw else None


def set_roast_status(session_id: str, status: str):
    redis_client.set(ROAST_JOB_STATUS_PREFIX + session_id, status)


def get_roast_status(session_id: str) -> str | None:
    return redis_client.get(ROAST_JOB_STATUS_PREFIX + session_id)


def set_roast_progress(session_id: str, progress: float):
    redis_client.set(ROAST_PROGRESS_PREFIX + session_id, progress)


def get_roast_progress(session_id: str) -> float:
    p = redis_client.get(ROAST_PROGRESS_PREFIX + session_id)
    return float(p) if p else 0.0


# -------------------------------------------------------------
# SIMNIBS queue  (mirrors ROAST queue pattern)
# -------------------------------------------------------------
SIMNIBS_JOB_QUEUE         = "simnibs_job_queue"
SIMNIBS_JOB_DATA_PREFIX   = "simnibs_job_data:"
SIMNIBS_JOB_STATUS_PREFIX = "simnibs_job_status:"
SIMNIBS_PROGRESS_PREFIX   = "simnibs_progress:"


def enqueue_simnibs_job(session_id: str, payload: dict):
    redis_client.set(SIMNIBS_JOB_DATA_PREFIX + session_id, json.dumps(payload))
    redis_client.rpush(SIMNIBS_JOB_QUEUE, session_id)


def pop_simnibs_job() -> str | None:
    return redis_client.lpop(SIMNIBS_JOB_QUEUE)


def get_simnibs_job_data(session_id: str) -> dict | None:
    raw = redis_client.get(SIMNIBS_JOB_DATA_PREFIX + session_id)
    return json.loads(raw) if raw else None


def set_simnibs_status(session_id: str, status: str):
    redis_client.set(SIMNIBS_JOB_STATUS_PREFIX + session_id, status)


def get_simnibs_status(session_id: str) -> str | None:
    return redis_client.get(SIMNIBS_JOB_STATUS_PREFIX + session_id)


def set_simnibs_progress(session_id: str, progress: float):
    redis_client.set(SIMNIBS_PROGRESS_PREFIX + session_id, progress)


def get_simnibs_progress(session_id: str) -> float:
    p = redis_client.get(SIMNIBS_PROGRESS_PREFIX + session_id)
    return float(p) if p else 0.0


# -------------------------------------------------------
# CLEANUP
# -------------------------------------------------------
def cleanup_session(session_id: str):
    """
    Remove all redis keys associated with a session.
    """
    pattern = _key("session", session_id, "*")
    for key in redis_client.scan_iter(match=pattern):
        redis_client.delete(key)

    # also clear SSE events
    redis_client.delete(_key("sse", session_id, "events"))
