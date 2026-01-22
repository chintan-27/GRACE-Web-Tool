from contextlib import asynccontextmanager
from fastapi import FastAPI, UploadFile, File, HTTPException, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from starlette.responses import StreamingResponse

import gzip
import shutil
import subprocess
import sqlite3
from pathlib import Path

from runtime.session import create_session, session_input_native, model_output_path, session_log
from runtime.scheduler import scheduler
from runtime.inference import InferenceOrchestrator
from runtime.sse import sse_stream
from services.redis_client import redis_client, get_queue_position
from config import GPU_COUNT, SESSION_DIR, DB_PATH
from dotenv import load_dotenv

load_dotenv()

@asynccontextmanager
async def lifespan(app: FastAPI):
    # STARTUP
    import threading
    t = threading.Thread(target=scheduler.scheduler_loop, daemon=True)
    t.start()
    print("GPU Scheduler started under lifespan()")

    yield

    # SHUTDOWN
    print("API shutting down (lifespan)")


app = FastAPI(
    title="WholeHead Segmentator v2",
    version="2.0.0",
    lifespan=lifespan
)


# ============================================================
# CORS
# ============================================================
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # restrict later
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
# POST /predict
# ============================================================
@app.post("/predict")
async def predict(
    file: UploadFile = File(...),
    models: str = Body(...),
    space: str = Body(...),
):
    # Validate input
    if not (file.filename.endswith(".nii") or file.filename.endswith(".nii.gz")):
        raise HTTPException(status_code=400, detail="File must be NIfTI")

    # Create session
    session_id = create_session()
    session_log(session_id, f"Session created. Models={models}, Space={space}")

    # Save uploaded file → input native (always store as real .nii.gz)
    native_path = session_input_native(session_id)
    
    if file.filename.endswith(".nii.gz"):
        # Already gzipped → just save it
        with open(native_path, "wb") as f:
            shutil.copyfileobj(file.file, f)
    else:
        # Uploaded .nii → gzip it while saving so native_path is truly gzipped
        with gzip.open(native_path, "wb") as gz:
            shutil.copyfileobj(file.file, gz)

    # Model list
    if models == "all":
        model_list = [
            "grace-native", "grace-fs",
            "domino-native", "domino-fs",
            "dominopp-native", "dominopp-fs"
        ]
    else:
        model_list = [m.strip() for m in models.split(",")]

    # Prepare inference job (input, FS conversion, model plan)
    orchestrator = InferenceOrchestrator(
        session_id=session_id,
        models=model_list,
        space=space,
    )
    plan = orchestrator.start_job()

    # Enqueue job
    scheduler.enqueue(
        job_id=session_id,
        payload={
            "input_path": str(native_path),
            "models": model_list,
            "space": space,
            "plan": plan,
        }
    )

    # Return queue position
    pos = get_queue_position(session_id)

    return {
        "session_id": session_id,
        "queue_position": pos,
        "models": model_list,
        "space": space,
    }


# ============================================================
# GET /stream/{session_id}  — SSE
# ============================================================
@app.get("/stream/{session_id}")
async def stream(session_id: str):
    return StreamingResponse(
        sse_stream(session_id),
        media_type="text/event-stream"
    )


# ============================================================
# GET /results/{session_id}/{model}
# ============================================================
@app.get("/results/{session_id}/{model_name}")
async def get_result(session_id: str, model_name: str):
    out_path = model_output_path(session_id, model_name)

    if not out_path.exists():
        raise HTTPException(status_code=404, detail="Model output not found")

    return FileResponse(
        path=str(out_path),
        filename=f"{model_name}.nii.gz",
        media_type="application/gzip",
    )


# ============================================================
# GET /health
# ============================================================
@app.get("/health")
async def health():
    gpu_usage = []
    try:
        cmd = [
            "nvidia-smi",
            "--query-gpu=utilization.gpu,memory.used,memory.total",
            "--format=csv,noheader,nounits"
        ]
        result = subprocess.check_output(cmd).decode().strip().split("\n")
        for idx, row in enumerate(result):
            util, used, total = row.split(", ")
            gpu_usage.append({
                "gpu": idx,
                "util": int(util),
                "mem_used": int(used),
                "mem_total": int(total),
            })
    except Exception:
        gpu_usage = "Unavailable"

    try:
        redis_ok = redis_client.ping()
    except Exception:
        redis_ok = False

    queue_len = redis_client.llen("job_queue")

    return {
        "redis": redis_ok,
        "gpu_usage": gpu_usage,
        "queue_length": queue_len,
        "gpu_count": GPU_COUNT,
    }


# ============================================================
# GET /admin/logs/{session_id}
# ============================================================
@app.get("/admin/logs/{session_id}")
def get_logs(session_id: str):
    lp = Path(SESSION_DIR) / session_id / "logs.jsonl"
    if not lp.exists():
        raise HTTPException(404, "No logs for session")
    return FileResponse(str(lp), media_type="text/plain")


# ============================================================
# GET /admin/audit
# ============================================================
@app.get("/admin/audit")
def get_audit():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute(
        "SELECT ts, session_id, model, event, detail FROM audit ORDER BY id DESC LIMIT 500"
    )
    rows = c.fetchall()
    conn.close()
    return {"events": rows}


# ============================================================
# Root endpoint
# ============================================================
@app.get("/")
def root():
    return {"message": "WholeHead Segmentator v2 API running"}
