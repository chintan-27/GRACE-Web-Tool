from pathlib import Path
import uuid

from config import SESSION_DIR
from services.logger import log_info


# -----------------------------------------------------------
# SESSION HELPERS
# -----------------------------------------------------------
def session_path(session_id: str) -> Path:
    return Path(SESSION_DIR) / session_id


def session_input_native(session_id: str) -> Path:
    return session_path(session_id) / "input_native.nii.gz"


def session_input_fs(session_id: str) -> Path:
    return session_path(session_id) / "input_fs.nii"


def model_output_path(session_id: str, model_name: str) -> Path:
    """
    Output:
      sessions/<id>/<model_name>/output.nii.gz
    """
    model_dir = session_path(session_id) / model_name
    model_dir.mkdir(parents=True, exist_ok=True)
    return model_dir / "output.nii.gz"


# -----------------------------------------------------------
# SESSION CREATION
# -----------------------------------------------------------
def create_session() -> str:
    """
    Creates a new session directory with logs.jsonl
    """
    session_id = str(uuid.uuid4())
    sp = session_path(session_id)
    sp.mkdir(parents=True, exist_ok=True)

    # Create log file automatically
    log_info(session_id, f"Session created: {session_id}")

    return session_id


# -----------------------------------------------------------
# SAVE UPLOADED FILE
# -----------------------------------------------------------
def save_uploaded_file(session_id: str, file_obj) -> Path:
    """
    Save uploaded NIfTI file to native input path.
    """
    dest = session_input_native(session_id)
    with open(dest, "wb") as f:
        f.write(file_obj.read())
    return dest


# -----------------------------------------------------------
# LOGGING ENTRY POINT
# -----------------------------------------------------------
def session_log(session_id: str, message: str):
    log_info(session_id, message)


# -----------------------------------------------------------
# VALIDATION
# -----------------------------------------------------------
def session_exists(session_id: str) -> bool:
    return session_path(session_id).exists()
