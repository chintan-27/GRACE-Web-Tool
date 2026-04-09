from pathlib import Path
import uuid
import shutil
import time

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
# ROAST HELPERS
# -----------------------------------------------------------
def roast_working_dir(session_id: str, model_name: str = "", run_id: str = "") -> Path:
    if model_name and run_id:
        d = session_path(session_id) / "roast" / model_name / run_id
    elif model_name:
        d = session_path(session_id) / "roast" / model_name
    else:
        d = session_path(session_id) / "roast"
    d.mkdir(parents=True, exist_ok=True)
    return d


def roast_output_path(session_id: str, output_type: str, model_name: str = "", simulation_tag: str = "tDCSLAB", run_id: str = "") -> Path:
    work_dir = roast_working_dir(session_id, model_name, run_id)
    # Glob-based lookup: ROAST embeds its own hash in the simulation tag, so we
    # match by suffix rather than constructing the exact filename from config.
    glob_patterns = {
        "mask_elec": "T1_*_mask_elec.nii",
        "mask_gel":  "T1_*_mask_gel.nii",
        "voltage":   "T1_*_v.nii",
        "efield":    "T1_*_e.nii",
        "emag":      "T1_*_emag.nii",
        "jbrain":    "T1_*_Jbrain.nii",
    }
    if output_type not in glob_patterns:
        raise ValueError(f"Unknown ROAST output type: {output_type}")
    matches = sorted(work_dir.glob(glob_patterns[output_type]), key=lambda p: p.stat().st_mtime, reverse=True)
    return matches[0] if matches else work_dir / f"_missing_{output_type}.nii"


# -----------------------------------------------------------
# SIMNIBS HELPERS
# -----------------------------------------------------------
def simnibs_working_dir(session_id: str, model_name: str, run_id: str = "") -> Path:
    if run_id:
        d = session_path(session_id) / "simnibs" / model_name / run_id
    else:
        d = session_path(session_id) / "simnibs" / model_name
    d.mkdir(parents=True, exist_ok=True)
    return d


def simnibs_charm_base_dir(session_id: str) -> Path:
    """
    Shared charm base directory for a session.
    Contains T1.nii + m2m_subject/ (atlas registration, EEG positions).
    Built once via charm --forceqform and reused by all models within the session.
    """
    d = session_path(session_id) / "simnibs" / "_charm_base"
    d.mkdir(parents=True, exist_ok=True)
    return d


SIMNIBS_OUTPUT_TYPES = ("magnJ", "wm_magnJ", "gm_magnJ", "wm_gm_magnJ")


def simnibs_output_path(session_id: str, model_name: str, output_type: str, run_id: str = "") -> Path:
    """Collected SimNIBS output NIfTIs per segmentation model."""
    if output_type not in SIMNIBS_OUTPUT_TYPES:
        raise ValueError(
            f"Unknown SimNIBS output type: {output_type!r}. "
            f"Valid: {SIMNIBS_OUTPUT_TYPES}"
        )
    return simnibs_working_dir(session_id, model_name, run_id) / "outputs" / f"{output_type}.nii.gz"


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


# -----------------------------------------------------------
# CLEANUP
# -----------------------------------------------------------
def cleanup_old_sessions(default_max_age_hours: int = 24) -> int:
    """
    Delete session directories past their retention period.
    Workspace sessions use the user's configured retention_days.
    Anonymous sessions use default_max_age_hours.
    Returns number of sessions deleted.
    """
    from services.redis_client import redis_client
    from services.workspace_db import get_user_retention_days

    deleted = 0
    sessions_root = Path(SESSION_DIR)
    if not sessions_root.exists():
        return 0

    for session_dir in sessions_root.iterdir():
        if not session_dir.is_dir():
            continue

        owner = redis_client.get(f"session_owner:{session_dir.name}")
        if owner:
            if isinstance(owner, bytes):
                owner = owner.decode()
            try:
                retention_days = get_user_retention_days(int(owner))
            except Exception:
                retention_days = 7
            cutoff = time.time() - retention_days * 86400
        else:
            cutoff = time.time() - default_max_age_hours * 3600

        if session_dir.stat().st_mtime < cutoff:
            try:
                shutil.rmtree(session_dir)
                log_info("SYSTEM", f"Cleaned up old session: {session_dir.name}")
                deleted += 1
            except Exception as e:
                log_info("SYSTEM", f"Failed to delete session {session_dir.name}: {e}")

    return deleted
