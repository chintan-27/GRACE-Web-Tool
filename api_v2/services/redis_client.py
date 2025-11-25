import json
import redis
from typing import Optional, Dict, Any, List

from config import (
    REDIS_HOST,
    REDIS_PORT,
    REDIS_DB,
    REDIS_PREFIX,
    GPU_COUNT,
)

# -------------------------------------------------------
# CONNECT TO REDIS
# -------------------------------------------------------
redis_client = redis.Redis(
    host=REDIS_HOST,
    port=REDIS_PORT,
    db=REDIS_DB,
    decode_responses=True  # return strings, not bytes
)

# -------------------------------------------------------
# KEY HELPERS
# -------------------------------------------------------
def _key(*parts):
    """Create namespaced redis keys"""
    return f"{REDIS_PREFIX}:" + ":".join(str(p) for p in parts)

# -------------------------------------------------------
# JOB QUEUE
# -------------------------------------------------------
def enqueue_job(job: Dict[str, Any]):
    """
    job = {
        "session_id": "...",
        "model": "grace-native",
        "space": "freesurfer",
    }
    """
    redis_client.rpush(_key("queue", "jobs"), json.dumps(job))

def dequeue_job() -> Optional[Dict[str, Any]]:
    raw = redis_client.lpop(_key("queue", "jobs"))
    if raw is None:
        return None
    return json.loads(raw)

def queue_length() -> int:
    return redis_client.llen(_key("queue", "jobs"))

# -------------------------------------------------------
# SESSION STATUS
# -------------------------------------------------------
def set_session_status(session_id: str, status: str):
    redis_client.set(_key("session", session_id, "status"), status)

def get_session_status(session_id: str) -> Optional[str]:
    return redis_client.get(_key("session", session_id, "status"))

# -------------------------------------------------------
# PER-MODEL PROGRESS
# -------------------------------------------------------
def set_progress(session_id: str, model: str, progress: int):
    redis_client.set(_key("session", session_id, model, "progress"), progress)

def get_progress(session_id: str, model: str) -> int:
    val = redis_client.get(_key("session", session_id, model, "progress"))
    return int(val) if val is not None else 0

# -------------------------------------------------------
# GPU STATE MANAGEMENT
# -------------------------------------------------------
def lock_gpu(gpu_id: int, session_id: str, model: str) -> bool:
    """
    Attempt to reserve a GPU.
    Returns True if successful.
    """
    key = _key("gpu", gpu_id, "busy")

    # Use SETNX pattern
    acquired = redis_client.setnx(key, f"{session_id}:{model}")

    if acquired:
        redis_client.expire(key, 3600)  # safety timeout
        return True

    return False

def unlock_gpu(gpu_id: int):
    redis_client.delete(_key("gpu", gpu_id, "busy"))

def get_gpu_assignments() -> Dict[int, str]:
    assignments = {}
    for gpu in range(GPU_COUNT):
        val = redis_client.get(_key("gpu", gpu, "busy"))
        assignments[gpu] = val if val else "free"
    return assignments

# -------------------------------------------------------
# SSE EVENT BUFFER
# -------------------------------------------------------
def push_sse_event(session_id: str, event: Dict[str, Any]):
    redis_client.rpush(_key("sse", session_id, "events"), json.dumps(event))

def pop_sse_events(session_id: str) -> List[Dict[str, Any]]:
    """
    Returns all queued SSE events and clears buffer.
    """
    key = _key("sse", session_id, "events")
    raw_events = redis_client.lrange(key, 0, -1)
    redis_client.delete(key)

    return [json.loads(e) for e in raw_events]

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
