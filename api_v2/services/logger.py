import json
from datetime import datetime
from pathlib import Path

from config import SESSION_DIR


def log_path(session_id: str) -> Path:
    return Path(SESSION_DIR) / session_id / "logs.jsonl"


def write_log(session_id: str, level: str, message: str, extra=None):
    """
    Append a structured line to session logs.
    """
    record = {
        "ts": datetime.utcnow().isoformat(),
        "level": level,
        "message": message,
    }

    if extra:
        record["extra"] = extra

    lp = log_path(session_id)
    lp.parent.mkdir(parents=True, exist_ok=True)

    with open(lp, "a") as f:
        f.write(json.dumps(record) + "\n")


def log_info(session_id: str, message: str, extra=None):
    write_log(session_id, "INFO", message, extra)


def log_error(session_id: str, message: str, extra=None):
    write_log(session_id, "ERROR", message, extra)


def log_event(session_id: str, event: dict):
    write_log(session_id, "EVENT", "SSE event", event)
