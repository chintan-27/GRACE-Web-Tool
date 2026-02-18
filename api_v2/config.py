import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env if exists
ENV_PATH = Path(__file__).parent / ".env"
if ENV_PATH.exists():
    load_dotenv(ENV_PATH)

# -------------------------------------------------------
# BASE DIRECTORIES
# -------------------------------------------------------
BASE_DIR = Path(__file__).parent.resolve()

SESSION_DIR = BASE_DIR / "sessions"
MODEL_DIR = BASE_DIR / "models"

SESSION_DIR.mkdir(exist_ok=True)
MODEL_DIR.mkdir(exist_ok=True)

# -------------------------------------------------------
# REDIS CONFIG
# -------------------------------------------------------
REDIS_HOST = os.getenv("REDIS_HOST", "localhost")
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))
REDIS_DB = int(os.getenv("REDIS_DB", "0"))

# Keys prefixing to avoid collisions
REDIS_PREFIX = "api_v2"

# -------------------------------------------------------
# SECURITY CONFIG
# -------------------------------------------------------
JWT_SECRET = os.getenv("JWT_SECRET", "CHANGE_ME")
JWT_ALGORITHM = "HS256"

HMAC_SECRET = os.getenv("HMAC_SECRET", "CHANGE_ME_HMAC")

# SSE heartbeat interval
SSE_HEARTBEAT_SECONDS = 15

# -------------------------------------------------------
# GPU CONFIG
# -------------------------------------------------------
GPU_COUNT = int(os.getenv("GPU_COUNT", "4"))

# Timeout for job execution
JOB_TIMEOUT_SECONDS = int(os.getenv("JOB_TIMEOUT_SECONDS", "3600"))

# -------------------------------------------------------
# ROAST CONFIG
# -------------------------------------------------------
ROAST_BUILD_DIR = Path(os.getenv("ROAST_BUILD_DIR", str(BASE_DIR.parent / "roast-11" / "build")))
MATLAB_RUNTIME = Path(os.getenv("MATLAB_RUNTIME", "/usr/local/MATLAB/MATLAB_Runtime/R2025b"))
ROAST_MAX_WORKERS = int(os.getenv("ROAST_MAX_WORKERS", "2"))
ROAST_TIMEOUT_SECONDS = int(os.getenv("ROAST_TIMEOUT_SECONDS", "7200"))

# -------------------------------------------------------
# FREESURFER
# -------------------------------------------------------
# Path to FreeSurfer tools inside Docker
FREESURFER_HOME = os.getenv("FREESURFER_HOME", "/usr/local/freesurfer")
MRI_CONVERT = Path(FREESURFER_HOME) / "bin" / "mri_convert"
MRI_VOL2VOL = Path(FREESURFER_HOME) / "bin" / "mri_vol2vol"

# Verify FS installation (optional check)
if not MRI_CONVERT.exists():
    print("[Warning] FreeSurfer mri_convert not found at:", MRI_CONVERT)
    print("FS conversion will fail unless installed in Docker image.")

# -------------------------------------------------------
# LOGGING CONFIG
# -------------------------------------------------------
LOG_DIR = BASE_DIR / "logs"
LOG_DIR.mkdir(exist_ok=True)
DB_PATH = f"{LOG_DIR}/audit.db"

# Per-session log filename format
def session_log_file(session_id: str):
    return LOG_DIR / f"{session_id}.jsonl"

# -------------------------------------------------------
# APP METADATA
# -------------------------------------------------------
APP_NAME = "Whole-Head Segmentation API v2"
APP_VERSION = "0.1"
