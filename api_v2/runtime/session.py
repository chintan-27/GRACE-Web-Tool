import uuid
import os
from config import SESSION_DIR

def create_session():
    sid = str(uuid.uuid4())
    path = os.path.join(SESSION_DIR, sid)
    os.makedirs(path, exist_ok=True)
    return sid, path
