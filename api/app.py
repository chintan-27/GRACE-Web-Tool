from contextlib import asynccontextmanager
from fastapi import FastAPI, UploadFile, File, HTTPException, Body, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from starlette.responses import StreamingResponse

import gzip
import json
import shutil
import subprocess
import sqlite3
import threading
import time
import uuid
from pathlib import Path

from runtime.session import create_session, session_input_native, model_output_path, session_log, roast_output_path, simnibs_output_path, cleanup_old_sessions
from runtime.scheduler import scheduler
from runtime.roast_scheduler import roast_scheduler
from runtime.simnibs_scheduler import simnibs_scheduler
from runtime.inference import InferenceOrchestrator
from runtime.sse import sse_stream
from runtime.roast_config import build_roast_config, validate_recipe
from services.redis_client import (
    redis_client, get_queue_position,
    enqueue_roast_job, get_roast_status, get_roast_progress, set_roast_status,
    enqueue_simnibs_job, get_simnibs_status, get_simnibs_progress, set_simnibs_status,
)
from config import (
    GPU_COUNT, SESSION_DIR, DB_PATH, NOTIFY_TOKEN_TTL, FRONTEND_URL, ALLOWED_ORIGINS,
    ADMIN_PASSWORD, MAGIC_TOKEN_TTL_MINUTES, MAGIC_LINK_RATE_LIMIT_MAX, MAGIC_LINK_RATE_LIMIT_WINDOW,
)
from services.auth import require_jwt, require_admin_jwt, optional_user_jwt, create_jwt
from services.workspace_db import (
    init_workspace_db, get_or_create_user, check_rate_limit, record_magic_link_request,
    create_magic_token, consume_magic_token, get_user_by_id, get_user_retention_days,
    delete_user, prune_old_requests, prune_expired_tokens,
)
from services.volume_stats import get_or_compute_stats
from dotenv import load_dotenv

load_dotenv()

# ============================================================
# Security helpers
# ============================================================
import re as _re

_UUID_RE = _re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", _re.IGNORECASE)

ALLOWED_MODELS = {
    "grace-native", "grace-fs",
    "domino-native", "domino-fs",
    "dominopp-native", "dominopp-fs",
}


def _validate_session_id(session_id: str) -> str:
    """Raise 400 if session_id is not a valid UUID."""
    if not session_id or not _UUID_RE.match(session_id):
        raise HTTPException(status_code=400, detail="Invalid session_id")
    return session_id


def _validate_model_name(model_name: str) -> str:
    """Raise 400 if model_name is not in the known model list."""
    if model_name not in ALLOWED_MODELS:
        raise HTTPException(status_code=400, detail=f"Unknown model '{model_name}'")
    return model_name



def _cleanup_stale_jobs():
    """On startup, wipe the active_jobs registry.

    The registry only contains jobs that were in-flight when the server last ran.
    All of those are now dead (workers are gone), so we clear the hash entirely.
    New jobs will be registered fresh as they are submitted.
    """
    try:
        count = redis_client.hlen("active_jobs")
        redis_client.delete("active_jobs")
        print(f"[startup] Cleared active_jobs registry ({count} stale entries removed)")
    except Exception as exc:
        print(f"[startup] active_jobs cleanup failed: {exc}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # STARTUP
    init_workspace_db()
    _cleanup_stale_jobs()
    import threading
    t = threading.Thread(target=scheduler.scheduler_loop, daemon=True)
    t.start()
    print("GPU Scheduler started under lifespan()")

    t2 = threading.Thread(target=roast_scheduler.scheduler_loop, daemon=True)
    t2.start()
    print("ROAST Scheduler started under lifespan()")

    t4 = threading.Thread(target=simnibs_scheduler.scheduler_loop, daemon=True)
    t4.start()
    print("SimNIBS Scheduler started under lifespan()")

    # Session cleanup loop (runs every hour, deletes sessions past retention)
    def cleanup_loop():
        while True:
            deleted = cleanup_old_sessions(default_max_age_hours=24)
            if deleted:
                print(f"Session cleanup: removed {deleted} old session(s)")
            # Prune workspace DB stale rows
            prune_old_requests()
            prune_expired_tokens()
            time.sleep(3600)

    t3 = threading.Thread(target=cleanup_loop, daemon=True)
    t3.start()
    print("Session cleanup scheduler started (30-day retention)")

    # --- Container resource diagnostics ---
    import os as _os
    try:
        n_cpus = len(_os.sched_getaffinity(0))
    except AttributeError:
        n_cpus = _os.cpu_count() or "?"
    print(f"[resources] Container CPUs (sched_getaffinity): {n_cpus}")
    print(f"[resources] OMP_NUM_THREADS: {_os.environ.get('OMP_NUM_THREADS', 'unset')}")
    try:
        with open("/proc/meminfo") as _f:
            for _line in _f:
                if _line.startswith(("MemTotal", "MemAvailable")):
                    print(f"[resources] {_line.rstrip()}")
    except Exception:
        pass
    try:
        import psutil as _psutil
        vm = _psutil.virtual_memory()
        print(f"[resources] RAM total={vm.total//1024//1024}MB available={vm.available//1024//1024}MB")
    except ImportError:
        pass
    # ---

    # Ensure ROAST binaries are executable (best-effort — skipped on read-only mounts)
    import stat
    from config import ROAST_BUILD_DIR
    for binary in ["roast_run", "run_roast_run.sh"]:
        p = ROAST_BUILD_DIR / binary
        if p.exists():
            try:
                p.chmod(p.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
                print(f"chmod +x {p}")
            except OSError:
                print(f"[warn] chmod skipped for {p} (read-only mount — ensure host file is executable)")

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
_cors_allow_credentials = "*" not in ALLOWED_ORIGINS
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=_cors_allow_credentials,
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
    convert_to_fs: str = Body("false"),
    notify_email: str = Body(""),
    workspace_payload: dict | None = Depends(optional_user_jwt),
):
    # Validate input
    if not (file.filename.endswith(".nii") or file.filename.endswith(".nii.gz")):
        raise HTTPException(status_code=400, detail="File must be NIfTI")

    # Validate file content via magic bytes (gzip: 0x1f 0x8b, or raw NIfTI starts with valid header)
    header_bytes = await file.read(2)
    if file.filename.endswith(".nii.gz") and header_bytes[:2] != b"\x1f\x8b":
        raise HTTPException(status_code=400, detail="File does not appear to be a valid gzip archive")
    await file.seek(0)

    # Parse convert_to_fs boolean
    should_convert_to_fs = convert_to_fs.lower() == "true"

    # Create session
    session_id = create_session()
    session_log(session_id, f"Session created. Models={models}, Space={space}, ConvertToFS={should_convert_to_fs}")

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
        convert_to_fs=should_convert_to_fs,
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

    # Link session to workspace user if authenticated
    if workspace_payload and workspace_payload.get("role") == "user":
        user_id = workspace_payload["user_id"]
        retention = get_user_retention_days(user_id)
        redis_client.set(f"session_owner:{session_id}", str(user_id), ex=retention * 86400)
        redis_client.sadd(f"user_sessions:{user_id}", session_id)

    # Register notification email (workspace email takes priority over explicit field)
    _notify = notify_email.strip() if notify_email else ""
    if not _notify and workspace_payload and workspace_payload.get("role") == "user":
        _notify = workspace_payload.get("email", "")
    if _notify and "@" in _notify:
        redis_client.setex(f"notify_email:{session_id}", NOTIFY_TOKEN_TTL, _notify)

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
    _validate_session_id(session_id)
    _validate_model_name(model_name)
    out_path = model_output_path(session_id, model_name)

    if not out_path.exists():
        raise HTTPException(status_code=404, detail="Model output not found")

    return FileResponse(
        path=str(out_path),
        filename=f"{model_name}.nii.gz",
        media_type="application/gzip",
    )


# ============================================================
# GET /results/{session_id}/input
# ============================================================
@app.get("/results/{session_id}/input")
async def get_input(session_id: str):
    _validate_session_id(session_id)
    input_path = session_input_native(session_id)

    if not input_path.exists():
        raise HTTPException(status_code=404, detail="Input file not found")

    return FileResponse(
        path=str(input_path),
        filename="input.nii.gz",
        media_type="application/gzip",
    )


# ============================================================
# POST /simulate  — Enqueue a ROAST TES simulation
# ============================================================
@app.post("/simulate")
async def simulate(body: dict = Body(...)):
    session_id = body.get("session_id")
    model_name = body.get("model_name")

    if not session_id or not model_name:
        raise HTTPException(status_code=400, detail="session_id and model_name are required")

    # Validate segmentation output exists
    seg_path = model_output_path(session_id, model_name)
    if not seg_path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Segmentation output not found for model '{model_name}'. Run segmentation first."
        )

    # Validate recipe if provided
    recipe = body.get("recipe")
    if recipe:
        try:
            validate_recipe(recipe)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

    # Build job payload
    seg_source = body.get("seg_source", "nn")
    session_log(session_id, f"[ROAST] seg_source={seg_source} (SPM bypass not yet implemented — requires ROAST+SPM rebuild)")

    run_id = uuid.uuid4().hex[:12]

    payload = {
        "model_name": model_name,
        "recipe": recipe,
        "electrode_type": body.get("electrode_type"),
        "electrode_size": body.get("electrode_size"),
        "electrode_ori": body.get("electrode_ori"),
        "mesh_options": body.get("mesh_options"),
        "simulation_tag": body.get("simulation_tag"),
        "quality": body.get("quality", "standard"),  # "fast" or "standard"
        "seg_source": seg_source,
        "run_id": run_id,
    }

    # Flush stale SSE events from previous runs so the new stream doesn't
    # immediately close on a leftover roast_complete / roast_error event.
    from runtime.sse import redis_event_key
    redis_client.delete(redis_event_key(session_id))

    set_roast_status(session_id, "queued", model_name, run_id)
    enqueue_roast_job(session_id, payload)
    recipe_log = " ".join(str(x) for x in (recipe or []))
    session_log(session_id, f"ROAST job enqueued for model={model_name} run_id={run_id} recipe=[{recipe_log}] quality={payload['quality']}")

    from runtime.sse import push_event
    push_event(session_id, {"event": "roast_queued", "progress": 0, "model": model_name})

    return {"session_id": session_id, "status": "queued", "run_id": run_id}


# ============================================================
# GET /simulate/results/{session_id}/{model_name}/{output_type}
# (legacy — no run_id; kept for backward compatibility)
# ============================================================
@app.get("/simulate/results/{session_id}/{model_name}/{output_type}")
async def get_simulate_result(session_id: str, model_name: str, output_type: str):
    if output_type not in ("voltage", "efield", "emag", "mask_elec", "mask_gel"):
        raise HTTPException(status_code=400, detail="output_type must be one of: voltage, efield, emag, mask_elec, mask_gel")

    # Read simulation tag from the saved config.json so we use the correct filename
    # regardless of which tag was used (hash-based since v2, "tDCSLAB" in older runs).
    import json as _json
    from runtime.session import roast_working_dir as _roast_wd
    sim_tag = "tDCSLAB"
    config_path = _roast_wd(session_id, model_name) / "config.json"
    if config_path.exists():
        try:
            sim_tag = _json.loads(config_path.read_text()).get("simulationtag", "tDCSLAB")
        except Exception:
            pass

    try:
        out_path = roast_output_path(session_id, output_type, model_name, sim_tag)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if not out_path.exists():
        raise HTTPException(status_code=404, detail=f"ROAST output '{output_type}' not found for model '{model_name}'. Run simulation first.")

    return FileResponse(
        path=str(out_path),
        filename=f"{output_type}.nii",
        media_type="application/octet-stream",
    )


# ============================================================
# GET /simulate/results/{session_id}/{model_name}/{run_id}/{output_type}
# (new — includes run_id so each electrode configuration is isolated)
# ============================================================
@app.get("/simulate/results/{session_id}/{model_name}/{run_id}/{output_type}")
async def get_simulate_result_by_run(session_id: str, model_name: str, run_id: str, output_type: str):
    if output_type not in ("voltage", "efield", "emag", "mask_elec", "mask_gel"):
        raise HTTPException(status_code=400, detail="output_type must be one of: voltage, efield, emag, mask_elec, mask_gel")

    import json as _json
    from runtime.session import roast_working_dir as _roast_wd
    sim_tag = "tDCSLAB"
    config_path = _roast_wd(session_id, model_name, run_id) / "config.json"
    if config_path.exists():
        try:
            sim_tag = _json.loads(config_path.read_text()).get("simulationtag", "tDCSLAB")
        except Exception:
            pass

    try:
        out_path = roast_output_path(session_id, output_type, model_name, sim_tag, run_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if not out_path.exists():
        raise HTTPException(status_code=404, detail=f"ROAST output '{output_type}' not found for model '{model_name}' run '{run_id}'. Run simulation first.")

    return FileResponse(
        path=str(out_path),
        filename=f"{output_type}.nii",
        media_type="application/octet-stream",
    )


# ============================================================
# GET /simulate/status/{session_id}/{model_name}
# ============================================================
@app.get("/simulate/status/{session_id}/{model_name}")
async def get_simulate_status(session_id: str, model_name: str):
    status = get_roast_status(session_id, model_name) or "not_started"
    progress = get_roast_progress(session_id, model_name)
    return {"status": status, "progress": progress}


# ============================================================
# GET /stream/roast/{session_id}  — SSE for ROAST jobs
# ============================================================
@app.get("/stream/roast/{session_id}")
async def stream_roast(session_id: str):
    return StreamingResponse(
        sse_stream(session_id, terminate_on=("roast_complete", "roast_error")),
        media_type="text/event-stream"
    )


# ============================================================
# POST /simulate/simnibs  — Enqueue a SimNIBS TES simulation
# ============================================================
@app.post("/simulate/simnibs")
async def simulate_simnibs(body: dict = Body(...)):
    session_id = body.get("session_id")
    model_name = body.get("model_name")

    if not session_id or not model_name:
        raise HTTPException(status_code=400, detail="session_id and model_name are required")

    # Validate the segmentation output from the chosen model exists
    seg_path = model_output_path(session_id, model_name)
    if not seg_path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Segmentation output not found for model '{model_name}'. Run segmentation first."
        )

    recipe = body.get("recipe")
    run_id = uuid.uuid4().hex[:12]
    payload = {
        "model_name": model_name,
        "recipe": recipe,
        "electrode_type": body.get("electrode_type"),
        "run_id": run_id,
    }

    set_simnibs_status(session_id, "queued", model_name, run_id)
    enqueue_simnibs_job(session_id, payload)
    session_log(session_id, f"[SimNIBS] Job enqueued for model={model_name} run_id={run_id}")

    from runtime.sse import push_event
    push_event(session_id, {"event": "simnibs_queued", "progress": 0, "model": model_name})

    return {"session_id": session_id, "status": "queued", "run_id": run_id}


# ============================================================
# GET /simulate/simnibs/results/{session_id}/{model_name}/{output_type}
# (legacy — no run_id; kept for backward compatibility)
# ============================================================
@app.get("/simulate/simnibs/results/{session_id}/{model_name}/{output_type}")
async def get_simnibs_result(session_id: str, model_name: str, output_type: str):
    if output_type not in ("magnJ", "wm_magnJ", "gm_magnJ", "wm_gm_magnJ"):
        raise HTTPException(status_code=400, detail="output_type must be: magnJ, wm_magnJ, gm_magnJ, or wm_gm_magnJ")

    try:
        out_path = simnibs_output_path(session_id, model_name, output_type)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if not out_path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"SimNIBS output '{output_type}' not found for model '{model_name}'. Run simulation first."
        )

    return FileResponse(
        path=str(out_path),
        filename=f"simnibs_{model_name}_{output_type}.nii.gz",
        media_type="application/gzip",
    )


# ============================================================
# GET /simulate/simnibs/results/{session_id}/{model_name}/{run_id}/{output_type}
# (new — includes run_id so each electrode configuration is isolated)
# ============================================================
@app.get("/simulate/simnibs/results/{session_id}/{model_name}/{run_id}/{output_type}")
async def get_simnibs_result_by_run(session_id: str, model_name: str, run_id: str, output_type: str):
    if output_type not in ("magnJ", "wm_magnJ", "gm_magnJ", "wm_gm_magnJ"):
        raise HTTPException(status_code=400, detail="output_type must be: magnJ, wm_magnJ, gm_magnJ, or wm_gm_magnJ")

    try:
        out_path = simnibs_output_path(session_id, model_name, output_type, run_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if not out_path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"SimNIBS output '{output_type}' not found for model '{model_name}' run '{run_id}'. Run simulation first."
        )

    return FileResponse(
        path=str(out_path),
        filename=f"simnibs_{model_name}_{output_type}.nii.gz",
        media_type="application/gzip",
    )


# ============================================================
# GET /simulate/simnibs/status/{session_id}/{model_name}
# ============================================================
@app.get("/simulate/simnibs/status/{session_id}/{model_name}")
async def get_simnibs_status_endpoint(session_id: str, model_name: str):
    status = get_simnibs_status(session_id, model_name) or "not_started"
    progress = get_simnibs_progress(session_id, model_name)
    return {"status": status, "progress": progress}


# ============================================================
# GET /stream/simnibs/{session_id}  — SSE for SimNIBS jobs
# ============================================================
@app.get("/stream/simnibs/{session_id}")
async def stream_simnibs(session_id: str):
    return StreamingResponse(
        sse_stream(session_id, terminate_on=("simnibs_complete", "simnibs_error")),
        media_type="text/event-stream"
    )


# ============================================================
# DELETE /session/{session_id}  — Immediately delete session data
# ============================================================
@app.delete("/session/{session_id}")
async def delete_session(session_id: str, token_payload: dict = Depends(require_jwt)):
    """Delete all data for a session. Admin JWT always allowed; user JWT only if they own the session."""
    _validate_session_id(session_id)

    # Ownership check for workspace users
    if token_payload.get("role") == "user":
        owner = redis_client.get(f"session_owner:{session_id}")
        if isinstance(owner, bytes):
            owner = owner.decode()
        if owner != str(token_payload.get("user_id", "")):
            raise HTTPException(status_code=403, detail="You do not own this session")
        # Remove from user's session set
        redis_client.srem(f"user_sessions:{token_payload['user_id']}", session_id)

    session_dir = SESSION_DIR / session_id
    deleted_dir = False
    if session_dir.exists():
        shutil.rmtree(str(session_dir), ignore_errors=True)
        deleted_dir = True

    # Best-effort Redis cleanup (don't fail if keys are already gone)
    try:
        for key in redis_client.scan_iter(f"*{session_id}*"):
            redis_client.delete(key)
    except Exception:
        pass

    return {"deleted": session_id, "directory_removed": deleted_dir}


# ============================================================
# POST /session/notify  — Request an email restore link
# ============================================================
@app.post("/session/notify")
async def session_notify(body: dict = Body(...)):
    """
    Store an email address for a session and send a time-limited restore link.
    The link is valid for NOTIFY_TOKEN_TTL seconds (default 6 h).
    """
    session_id = body.get("session_id", "").strip()
    email      = body.get("email", "").strip()
    filename   = body.get("filename")

    if not session_id or not email or "@" not in email:
        raise HTTPException(status_code=400, detail="session_id and a valid email are required")

    session_dir = SESSION_DIR / session_id
    if not session_dir.exists():
        raise HTTPException(status_code=404, detail="Session not found")

    token = str(uuid.uuid4())
    redis_client.setex(
        f"notify_token:{token}",
        NOTIFY_TOKEN_TTL,
        session_id,
    )

    restore_url = f"{FRONTEND_URL}/?restore={token}"

    # Send email in background thread so the API returns immediately
    from services.email import send_restore_email
    threading.Thread(
        target=send_restore_email,
        args=(email, restore_url, filename),
        daemon=True,
    ).start()

    return {"status": "sent", "token": token, "expires_in": NOTIFY_TOKEN_TTL}


# ============================================================
# GET /session/restore/{token}  — Resolve a restore token
# ============================================================
@app.get("/session/restore/{token}")
async def session_restore(token: str):
    """Return the session_id for a valid restore token."""
    session_id = redis_client.get(f"notify_token:{token}")
    if not session_id:
        raise HTTPException(status_code=404, detail="Restore token is invalid or has expired")

    session_dir = SESSION_DIR / session_id
    if not session_dir.exists():
        raise HTTPException(status_code=410, detail="Session data has been deleted")

    # Collect available models from completed output files
    models = [
        p.stem.replace(".nii", "")
        for p in session_dir.glob("outputs/*.nii.gz")
    ]

    return {"session_id": session_id, "models": models}


# ============================================================
# GET /logs  — Dev endpoint: list all sessions with logs (requires JWT)
# ============================================================
@app.get("/logs")
def list_sessions(_: dict = Depends(require_admin_jwt)):
    sessions_path = Path(SESSION_DIR)
    if not sessions_path.exists():
        return {"sessions": []}

    sessions = []
    for session_dir in sorted(sessions_path.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
        if session_dir.is_dir():
            log_file = session_dir / "logs.jsonl"
            sessions.append({
                "session_id": session_dir.name,
                "has_logs": log_file.exists(),
                "created": session_dir.stat().st_mtime,
            })
    return {"sessions": sessions}


# ============================================================
# GET /logs/{session_id}  — Dev endpoint (requires JWT)
# ============================================================
@app.get("/logs/{session_id}")
def get_session_logs(session_id: str, _: dict = Depends(require_admin_jwt)):
    lp = Path(SESSION_DIR) / session_id / "logs.jsonl"
    if not lp.exists():
        raise HTTPException(404, "No logs for session")
    return FileResponse(str(lp), media_type="text/plain")


# ============================================================
# GET /health
# ============================================================
@app.get("/health")
async def health():
    import os as _os

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

    # CPU info (container-visible cores via sched_getaffinity)
    try:
        cpu_count = len(_os.sched_getaffinity(0))
    except AttributeError:
        cpu_count = _os.cpu_count() or 0

    # RAM info from /proc/meminfo (in MB)
    mem_total_mb, mem_available_mb = 0, 0
    try:
        with open("/proc/meminfo") as f:
            for line in f:
                if line.startswith("MemTotal:"):
                    mem_total_mb = int(line.split()[1]) // 1024
                elif line.startswith("MemAvailable:"):
                    mem_available_mb = int(line.split()[1]) // 1024
    except Exception:
        pass

    return {
        "redis": redis_ok,
        "gpu_usage": gpu_usage,
        "queue_length": queue_len,
        "gpu_count": GPU_COUNT,
        "cpu_count": cpu_count,
        "mem_total_mb": mem_total_mb,
        "mem_available_mb": mem_available_mb,
    }


# ============================================================
# GET /admin/logs/{session_id}
# ============================================================
@app.get("/admin/logs/{session_id}")
def get_logs(session_id: str, _: dict = Depends(require_admin_jwt)):
    lp = Path(SESSION_DIR) / session_id / "logs.jsonl"
    if not lp.exists():
        raise HTTPException(404, "No logs for session")
    return FileResponse(str(lp), media_type="text/plain")


# ============================================================
# POST /admin/login
# ============================================================
@app.post("/admin/login")
async def admin_login(body: dict = Body(...)):
    password = body.get("password", "")
    if not password or password != ADMIN_PASSWORD:
        raise HTTPException(status_code=401, detail="Invalid password")
    token = create_jwt({"role": "admin"})
    return {"token": token}


# ============================================================
# GET /admin/jobs  — aggregate live jobs across all schedulers
# ============================================================
@app.get("/admin/jobs")
def get_admin_jobs(_: dict = Depends(require_admin_jwt)):
    # Read the active_jobs registry — O(n active jobs), no scanning needed.
    raw_jobs = redis_client.hgetall("active_jobs") or {}
    jobs = []
    for value in raw_jobs.values():
        try:
            jobs.append(json.loads(value))
        except Exception:
            continue

    queue_depths = {
        "gpu_seg": redis_client.llen("job_queue"),
        "roast":   redis_client.llen("roast_job_queue"),
        "simnibs": redis_client.llen("simnibs_job_queue"),
    }

    return {"jobs": jobs, "queue_depths": queue_depths}


# ============================================================
# GET /admin/audit
# ============================================================
@app.get("/admin/audit")
def get_audit(
    _: dict = Depends(require_admin_jwt),
    offset: int = 0,
    limit: int = 100,
):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute("SELECT COUNT(*) FROM audit")
    total = c.fetchone()[0]
    c.execute(
        "SELECT ts, session_id, model, event, detail FROM audit ORDER BY id DESC LIMIT ? OFFSET ?",
        (limit, offset),
    )
    rows = c.fetchall()
    conn.close()
    return {"events": rows, "total": total, "offset": offset, "limit": limit}


# ============================================================
# POST /cancel/{session_id}
# ============================================================
@app.post("/cancel/{session_id}")
async def cancel_job(session_id: str):
    from services.redis_client import cancel_session
    from runtime.sse import push_event
    cancel_session(session_id)
    push_event(session_id, {"event": "job_cancelled"})
    return {"status": "cancellation_requested"}


# ============================================================
# GET /results/{session_id}/{model_name}/stats  — tissue volume stats
# ============================================================
@app.get("/results/{session_id}/{model_name}/stats")
async def get_model_stats(session_id: str, model_name: str):
    """Return per-label tissue volume statistics (mm³) for a segmentation output."""
    _validate_session_id(session_id)
    _validate_model_name(model_name)
    out_path = model_output_path(session_id, model_name)
    if not out_path.exists():
        raise HTTPException(status_code=404, detail="Model output not found")

    cache_path = out_path.parent / "stats.json"
    result = get_or_compute_stats(out_path, cache_path)
    return {"session_id": session_id, "model_name": model_name, **result}


# ============================================================
# WORKSPACE endpoints
# ============================================================
import re as _email_re

_EMAIL_RE = _email_re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _validate_email(email: str) -> str:
    if not email or not _EMAIL_RE.match(email):
        raise HTTPException(status_code=400, detail="Valid email address required")
    return email.strip().lower()


@app.post("/workspace/request-magic-link")
async def workspace_request_magic_link(body: dict = Body(...)):
    """Send a magic sign-in link. Always returns {"status": "sent"} (no email enumeration)."""
    email = _validate_email(body.get("email", "").strip())

    if not check_rate_limit(email, MAGIC_LINK_RATE_LIMIT_MAX, MAGIC_LINK_RATE_LIMIT_WINDOW):
        raise HTTPException(
            status_code=429,
            detail=f"Too many requests. Try again in {MAGIC_LINK_RATE_LIMIT_WINDOW} minutes.",
        )

    record_magic_link_request(email)
    user_id, _ = get_or_create_user(email)
    token = create_magic_token(user_id, ttl_minutes=MAGIC_TOKEN_TTL_MINUTES)

    magic_url = f"{FRONTEND_URL}/workspace/verify?token={token}"

    from services.email import send_magic_link_email
    threading.Thread(target=send_magic_link_email, args=(email, magic_url), daemon=True).start()

    from services.audit import audit_event
    audit_event("SYSTEM", "", "magic_link_request", f"email={email}")

    return {"status": "sent"}


@app.get("/workspace/verify/{token}")
async def workspace_verify(token: str):
    """Consume a magic token and return a workspace JWT."""
    user_id = consume_magic_token(token)
    if user_id is None:
        raise HTTPException(status_code=401, detail="Invalid or expired sign-in link")

    user = get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=500, detail="User not found after token validation")

    jwt_token = create_jwt(
        {"role": "user", "user_id": user["id"], "email": user["email"]},
        expires_minutes=480,
    )

    from services.audit import audit_event
    audit_event("SYSTEM", "", "workspace_login", f"user_id={user_id} email={user['email']}")

    return {
        "token": jwt_token,
        "email": user["email"],
        "retention_days": user["retention_days"],
    }


@app.get("/workspace/me")
async def workspace_me(payload: dict = Depends(require_jwt)):
    if payload.get("role") != "user":
        raise HTTPException(status_code=403, detail="Workspace user account required")
    user = get_user_by_id(payload["user_id"])
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@app.get("/workspace/sessions")
async def workspace_sessions(payload: dict = Depends(require_jwt)):
    if payload.get("role") != "user":
        raise HTTPException(status_code=403, detail="Workspace user account required")
    user_id = payload["user_id"]
    raw = redis_client.smembers(f"user_sessions:{user_id}") or set()
    sessions = []
    for sid in raw:
        if isinstance(sid, bytes):
            sid = sid.decode()
        if (SESSION_DIR / sid).exists():
            sessions.append(sid)
        else:
            # Clean up stale entry
            redis_client.srem(f"user_sessions:{user_id}", sid)
    return {"sessions": sessions}


@app.delete("/workspace/account")
async def workspace_delete_account(payload: dict = Depends(require_jwt)):
    if payload.get("role") != "user":
        raise HTTPException(status_code=403, detail="Workspace user account required")
    user_id = payload["user_id"]

    # Collect and delete all owned sessions
    raw = redis_client.smembers(f"user_sessions:{user_id}") or set()
    sessions_removed = 0
    for sid in raw:
        if isinstance(sid, bytes):
            sid = sid.decode()
        session_dir = SESSION_DIR / sid
        if session_dir.exists():
            shutil.rmtree(str(session_dir), ignore_errors=True)
            sessions_removed += 1
        # Clean up Redis keys for this session
        try:
            for key in redis_client.scan_iter(f"*{sid}*"):
                redis_client.delete(key)
        except Exception:
            pass

    redis_client.delete(f"user_sessions:{user_id}")
    delete_user(user_id)

    from services.audit import audit_event
    audit_event("SYSTEM", "", "workspace_deleted", f"user_id={user_id} sessions_removed={sessions_removed}")

    return {"deleted": True, "sessions_removed": sessions_removed}


# ============================================================
# Root endpoint
# ============================================================
@app.get("/")
def root():
    return {"message": "WholeHead Segmentator v2 API running"}
