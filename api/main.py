import os
from typing import Annotated

import asyncio
from fastapi import FastAPI, Request, BackgroundTasks, File, UploadFile, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from werkzeug.utils import secure_filename
from sse_starlette.sse import EventSourceResponse
from typing import AsyncGenerator
from grace import grace_predict_single_file
from domino import domino_predict_single_file
from dominopp import dominopp_predict_single_file
import uuid
import shutil
import torch
import gzip
import json

app = FastAPI()

UPLOAD_FOLDER = "uploads"
OUTPUT_FOLDER = "outputs"
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(OUTPUT_FOLDER, exist_ok=True)

clients = {}  # Dictionary to hold client queues

# CORS middleware setup
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# SSE stream setup
async def sse_stream(client_id: str, queue: asyncio.Queue):
    try:
        while True:
            data = await asyncio.wait_for(queue.get(), timeout=100)
            if data == "__CLOSE__":
                break

            # turn your dict into a JSON string
            payload = json.dumps(data)
            # **two newlines** mark the end of one event
            print(f"{payload} from sse_stream")
            yield payload
    except asyncio.TimeoutError:
        # keep‐alive
        yield "event: ping\ndata: keep-alive\n\n"
    finally:
        clients.pop(client_id, None)

@app.get("/")
async def root():
    return {"message": "Welcome to the SSE FastAPI server!"}

@app.get("/stream/{client_id}")
async def stream(client_id: str):
    queue = asyncio.Queue()
    clients[client_id] = queue
    return EventSourceResponse(sse_stream(client_id, queue))

def save_uploaded_file(file: UploadFile):
    filename = secure_filename(file.filename)
    path = os.path.join(UPLOAD_FOLDER, filename)
    with open(path, "wb") as buf:
        shutil.copyfileobj(file.file, buf)

    # if it’s labeled .gz, decompress it
    if filename.endswith(".nii.gz"):
        decompressed = path[:-3]  # drop ".gz"
        with gzip.open(path, "rb") as f_in, open(decompressed, "wb") as f_out:
            shutil.copyfileobj(f_in, f_out)
        os.remove(path)
        return decompressed

    return path

@app.route("/output/{model}", methods=["GET"])
def grace_output(model: str):
    token = request.headers.get('X-Signature')
    if check_signature(token) is False:
        return jsonify({"error": "Invalid signature"}), 403
    return send_output_file(f"_pred_{model.upper()}")

def cleanup_gpu():
    # This runs after every request, successful or not.
    # Delete any lingering tensors in local scope
    # (Flask should drop local variables anyway, but this is extra safe):
    for var in ['tensor', 'output']:
        if var in globals():
            del globals()[var]

    # 4) Clear PyTorch’s cache and python garbage
    torch.cuda.empty_cache()
    gc.collect()

def send_output_file(suffix):
    cleanup_gpu()
    try:
        for file in os.listdir(OUTPUT_FOLDER):
            if file.endswith(f"{suffix}.nii.gz"):
                return send_file(os.path.join(OUTPUT_FOLDER, file), as_attachment=True)
        return jsonify({"error": f"Output file for {suffix} not found"}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500

def get_device():
    if torch.cuda.is_available():
        return torch.device("cuda")
    if torch.backends.mps.is_available():
        return torch.device("cpu")  # Replace with MPS if needed
    return torch.device("cpu")

@app.post("/predict/{model}")
async def predict_grace(model: str, request: Request, file: UploadFile = File(...)):
    client_id = request.headers.get("x-signature")

    queue = clients.get(client_id)
    if not queue:
        return {"error": "Stream not established"}, 400

    input_path = save_uploaded_file(file)
    base_filename = os.path.splitext(os.path.basename(input_path))[0]

    # ✅ capture the event loop in the main thread
    loop = asyncio.get_event_loop()

    def run_and_stream(model: str):
        func = grace_predict_single_file
        if model == "domino":
            func = domino_predict_single_file
        elif model == "dominopp":
            func = dominopp_predict_single_file
        for progress in func(input_path=input_path, output_dir=OUTPUT_FOLDER):
            # ✅ use the captured loop
            asyncio.run_coroutine_threadsafe(queue.put(progress), loop)
        asyncio.run_coroutine_threadsafe(queue.put("__CLOSE__"), loop)

    # ✅ run sync function in thread and don't await it
    asyncio.create_task(asyncio.to_thread(run_and_stream))

    return {"status": f"{model} started"}


