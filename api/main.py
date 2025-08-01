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

def get_device():
    if torch.cuda.is_available():
        return torch.device("cuda")
    if torch.backends.mps.is_available():
        return torch.device("cpu")  # Replace with MPS if needed
    return torch.device("cpu")

@app.post("/predict_grace")
async def predict_grace(request: Request, file: UploadFile = File(...)):
    client_id = request.headers.get("x-signature")
    queue = clients.get(client_id)
    if not queue:
        return {"error": "Stream not established"}, 400

    input_path = save_uploaded_file(file)
    base_filename = os.path.splitext(os.path.basename(input_path))[0]

    # ✅ capture the event loop in the main thread
    loop = asyncio.get_event_loop()

    def run_and_stream():
        for progress in grace_predict_single_file(input_path=input_path, output_dir=OUTPUT_FOLDER):
            # ✅ use the captured loop
            asyncio.run_coroutine_threadsafe(queue.put(progress), loop)
        asyncio.run_coroutine_threadsafe(queue.put("__CLOSE__"), loop)

    # ✅ run sync function in thread and don't await it
    asyncio.create_task(asyncio.to_thread(run_and_stream))

    return {"status": "GRACE started"}



@app.post("/process/{client_id}")
async def process(client_id: str):
    queue = clients.get(client_id)
    if not queue:
        return {"error": "Stream not established"}

    # Simulated step-by-step updates
    await queue.put("Starting task...")
    await asyncio.sleep(1)

    await queue.put("Step 1 complete...")
    await asyncio.sleep(1)

    await queue.put("Step 2 complete...")
    await asyncio.sleep(1)

    await queue.put("Finalizing...")
    await asyncio.sleep(1)

    await queue.put("All done!")

    # Signal stream to close
    await queue.put("__CLOSE__")

    return {"status": "Completed"}
