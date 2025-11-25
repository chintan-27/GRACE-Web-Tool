import sqlite3
from pathlib import Path
from config import BASE_DIR

DB_PATH = Path(BASE_DIR) / "audit.db"

def init_audit_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("""
        CREATE TABLE IF NOT EXISTS audit (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts TEXT,
            session_id TEXT,
            model TEXT,
            event TEXT,
            detail TEXT
        )
    """)
    conn.commit()
    conn.close()


def audit_event(session_id: str, model: str, event: str, detail: str = ""):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("""
        INSERT INTO audit (ts, session_id, model, event, detail)
        VALUES (datetime('now'), ?, ?, ?, ?)
    """, (session_id, model, event, detail))
    conn.commit()
    conn.close()
