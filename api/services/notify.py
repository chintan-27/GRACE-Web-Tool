"""
Job completion notification helper.
Checks Redis for a stored notify_email for a session and fires a background
email if found. Uses GETDEL to atomically retrieve-and-delete the key,
preventing duplicate sends if multiple completion events fire.
"""
import logging
import threading

from config import FRONTEND_URL
from services.email import send_completion_email

log = logging.getLogger(__name__)


def maybe_send_completion_notification(
    session_id: str,
    job_type: str,
    completed_models: list[str],
) -> None:
    """
    Non-blocking. Check if an email was registered for this session and send
    a completion notification. Deletes the Redis key atomically to prevent
    duplicate sends.
    """
    # Import here to avoid circular imports at module load time
    from services.redis_client import redis_client

    email = redis_client.getdel(f"notify_email:{session_id}")
    if not email:
        return

    if isinstance(email, bytes):
        email = email.decode()

    results_url = f"{FRONTEND_URL}/?session={session_id}"

    threading.Thread(
        target=send_completion_email,
        args=(email, session_id, job_type, completed_models, results_url),
        daemon=True,
    ).start()
    log.info("[Notify] Queued completion email for session %s → %s", session_id, email)
