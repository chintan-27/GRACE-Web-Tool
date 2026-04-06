"""
Workspace database — optional user accounts with magic-link authentication.
Separate SQLite DB (workspace.db) from the audit log.
"""
import logging
import secrets
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

from config import LOG_DIR

log = logging.getLogger(__name__)

WORKSPACE_DB_PATH = LOG_DIR / "workspace.db"

# ---------------------------------------------------------------------------
# Connection
# ---------------------------------------------------------------------------

def _conn() -> sqlite3.Connection:
    c = sqlite3.connect(str(WORKSPACE_DB_PATH))
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA foreign_keys=ON")
    c.row_factory = sqlite3.Row
    return c


def init_workspace_db() -> None:
    conn = _conn()
    cur = conn.cursor()
    cur.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            email          TEXT UNIQUE NOT NULL COLLATE NOCASE,
            created_at     TEXT NOT NULL DEFAULT (datetime('now')),
            last_login     TEXT,
            retention_days INTEGER NOT NULL DEFAULT 7
        );

        CREATE TABLE IF NOT EXISTS magic_tokens (
            token       TEXT PRIMARY KEY,
            user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at  TEXT NOT NULL DEFAULT (datetime('now')),
            expires_at  TEXT NOT NULL,
            used        INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS magic_link_requests (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            email        TEXT NOT NULL COLLATE NOCASE,
            requested_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_magic_tokens_expires
            ON magic_tokens(expires_at);
        CREATE INDEX IF NOT EXISTS idx_mlr_email
            ON magic_link_requests(email, requested_at);
    """)
    conn.commit()
    conn.close()
    log.info("[Workspace] DB initialised at %s", WORKSPACE_DB_PATH)


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------

def get_or_create_user(email: str) -> tuple[int, bool]:
    """Return (user_id, is_new)."""
    conn = _conn()
    cur = conn.cursor()
    cur.execute("INSERT OR IGNORE INTO users (email) VALUES (?)", (email,))
    is_new = cur.rowcount == 1
    conn.commit()
    cur.execute("SELECT id FROM users WHERE email = ?", (email,))
    row = cur.fetchone()
    conn.close()
    return row["id"], is_new


def get_user_by_id(user_id: int) -> dict | None:
    conn = _conn()
    cur = conn.cursor()
    cur.execute(
        "SELECT id, email, created_at, last_login, retention_days FROM users WHERE id = ?",
        (user_id,),
    )
    row = cur.fetchone()
    conn.close()
    return dict(row) if row else None


def get_user_retention_days(user_id: int) -> int:
    conn = _conn()
    cur = conn.cursor()
    cur.execute("SELECT retention_days FROM users WHERE id = ?", (user_id,))
    row = cur.fetchone()
    conn.close()
    return row["retention_days"] if row else 7


def update_retention_days(user_id: int, days: int) -> None:
    conn = _conn()
    conn.execute("UPDATE users SET retention_days = ? WHERE id = ?", (days, user_id))
    conn.commit()
    conn.close()


def delete_user(user_id: int) -> None:
    """Delete user row (cascades magic_tokens). Caller handles session cleanup."""
    conn = _conn()
    conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
    conn.commit()
    conn.close()


# ---------------------------------------------------------------------------
# Rate limiting
# ---------------------------------------------------------------------------

def check_rate_limit(email: str, max_requests: int = 3, window_minutes: int = 10) -> bool:
    """Return True if under limit (request is allowed)."""
    conn = _conn()
    cur = conn.cursor()
    cur.execute(
        "SELECT COUNT(*) AS cnt FROM magic_link_requests "
        "WHERE email = ? AND requested_at > datetime('now', ?)",
        (email, f"-{window_minutes} minutes"),
    )
    count = cur.fetchone()["cnt"]
    conn.close()
    return count < max_requests


def record_magic_link_request(email: str) -> None:
    conn = _conn()
    conn.execute("INSERT INTO magic_link_requests (email) VALUES (?)", (email,))
    conn.commit()
    conn.close()


def prune_old_requests(older_than_minutes: int = 60) -> int:
    """Delete stale rate-limit rows. Call hourly."""
    conn = _conn()
    cur = conn.cursor()
    cur.execute(
        "DELETE FROM magic_link_requests WHERE requested_at < datetime('now', ?)",
        (f"-{older_than_minutes} minutes",),
    )
    deleted = cur.rowcount
    conn.commit()
    conn.close()
    return deleted


# ---------------------------------------------------------------------------
# Magic tokens
# ---------------------------------------------------------------------------

def create_magic_token(user_id: int, ttl_minutes: int = 15) -> str:
    """Create a one-time-use token with 256-bit entropy."""
    token = secrets.token_urlsafe(32)
    expires_at = (
        datetime.now(timezone.utc) + timedelta(minutes=ttl_minutes)
    ).strftime("%Y-%m-%d %H:%M:%S")
    conn = _conn()
    conn.execute(
        "INSERT INTO magic_tokens (token, user_id, expires_at) VALUES (?, ?, ?)",
        (token, user_id, expires_at),
    )
    conn.commit()
    conn.close()
    return token


def consume_magic_token(token: str) -> int | None:
    """
    Validate and consume a magic token.
    Returns user_id on success, None if invalid/expired/already used.
    """
    conn = _conn()
    cur = conn.cursor()
    cur.execute(
        "SELECT user_id FROM magic_tokens "
        "WHERE token = ? AND used = 0 AND expires_at > datetime('now')",
        (token,),
    )
    row = cur.fetchone()
    if not row:
        conn.close()
        return None

    user_id = row["user_id"]
    cur.execute("UPDATE magic_tokens SET used = 1 WHERE token = ?", (token,))
    cur.execute("UPDATE users SET last_login = datetime('now') WHERE id = ?", (user_id,))
    conn.commit()
    conn.close()
    return user_id


def prune_expired_tokens() -> int:
    """Delete used/expired magic tokens. Call hourly."""
    conn = _conn()
    cur = conn.cursor()
    cur.execute(
        "DELETE FROM magic_tokens WHERE used = 1 OR expires_at < datetime('now', '-1 hour')"
    )
    deleted = cur.rowcount
    conn.commit()
    conn.close()
    return deleted
