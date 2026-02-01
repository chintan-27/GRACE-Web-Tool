import json
import time
import hmac
import hashlib
from typing import Dict, Generator

# from fastapi import HTTPException
# from fastapi.responses import StreamingResponse

from config import HMAC_SECRET
from services.redis_client import redis_client
from runtime.session import session_log


# -------------------------------------------------------------------
# HMAC signing
# -------------------------------------------------------------------
def sign_event(event: Dict) -> str:
    """
    Produce an HMAC SHA256 signature for each SSE event.
    Ensures frontend can trust event origin.
    """
    raw = json.dumps(event, sort_keys=True).encode("utf-8")
    signature = hmac.new(
        HMAC_SECRET.encode("utf-8"),
        raw,
        hashlib.sha256
    ).hexdigest()
    return signature


# -------------------------------------------------------------------
# Redis event queue: pushes from scheduler + modelrunner
# Stream reads from: "sse:<session_id>"
# -------------------------------------------------------------------
def redis_event_key(session_id: str):
    return f"sse:{session_id}"


def push_event(session_id: str, event: Dict):
    """
    Scheduler and ModelRunner call this to enqueue SSE events.
    """
    signature = sign_event(event)
    envelope = {"event": event, "sig": signature}

    redis_client.rpush(redis_event_key(session_id), json.dumps(envelope))
    redis_client.expire(redis_event_key(session_id), 3600)  # 1 hour retention


# -------------------------------------------------------------------
# Streaming generator
# -------------------------------------------------------------------
def sse_stream(session_id: str) -> Generator[str, None, None]:
    """
    Reads events from Redis and emits SSE messages.
    Includes:
    - real events
    - heartbeat every 5s
    - graceful stopping on "job_complete" or "job_failed"
    """

    session_log(session_id, "SSE stream opened.")

    queue_key = redis_event_key(session_id)
    last_event_time = time.time()

    while True:
        # Block for up to 1 second for new events
        packet = redis_client.blpop(queue_key, timeout=1)

        # Emit heartbeat if quiet
        if packet is None:
            if time.time() - last_event_time > 5:
                heartbeat = {"event": "heartbeat", "ts": time.time()}
                signed = sign_event(heartbeat)
                yield f"data: {json.dumps({'event': heartbeat, 'sig': signed})}\n\n"
                last_event_time = time.time()
            continue

        # Parse event
        _, raw = packet

        # raw is str when decode_responses=True; bytes otherwise
        if isinstance(raw, bytes):
            raw = raw.decode("utf-8")
        
        envelope = json.loads(raw)

        event = envelope["event"]
        sig = envelope["sig"]

        # Send event to client
        yield f"data: {json.dumps({'event': event, 'sig': sig})}\n\n"
        last_event_time = time.time()

        # Termination signals
        if event.get("event") in ("job_complete", "job_failed"):
            session_log(session_id, "SSE stream closing due to final event.")
            break

    # Final heartbeat for clean closure
    final = {"event": "stream_end", "ts": time.time()}
    signed = sign_event(final)
    yield f"data: {json.dumps({'event': final, 'sig': signed})}\n\n"
