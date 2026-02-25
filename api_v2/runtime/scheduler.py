import time
import json
import threading
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

from services.redis_client import redis_client, set_job_status
from services.logger import log_info, log_error, log_event

from runtime.runner import ModelRunner
from runtime.session import session_log
from runtime.sse import push_event
from config import GPU_COUNT

GPU_LOCK_KEY = "gpu_locks"
JOB_QUEUE_KEY = "job_queue"
JOB_DATA_PREFIX = "job_data:"


class GPUScheduler:
    def __init__(self, num_gpus: int = GPU_COUNT, poll_interval: float = 0.5):
        self.num_gpus = num_gpus
        self.poll_interval = poll_interval
        self._gpu_lock = threading.Lock()
        self._init_gpu_locks()

    def _init_gpu_locks(self):
        for gpu_id in range(self.num_gpus):
            redis_client.hset(GPU_LOCK_KEY, gpu_id, "free")

    def enqueue(self, job_id: str, payload: dict):
        redis_client.set(JOB_DATA_PREFIX + job_id, json.dumps(payload))
        redis_client.rpush(JOB_QUEUE_KEY, json.dumps({"session_id": job_id}))

        log_info(job_id, f"Job enqueued. Models={payload['models']}")

        for model_name in payload["models"]:
            set_job_status(job_id, model_name, "queued")

        push_event(job_id, {"event": "queued"})
        log_event(job_id, {"event": "queued"})

    def _gpu_free_memory_mib(self, gpu_id: int) -> float:
        """Return actual free memory (MiB) for a GPU via nvidia-smi."""
        try:
            import subprocess
            result = subprocess.check_output(
                ["nvidia-smi", f"--id={gpu_id}",
                 "--query-gpu=memory.free", "--format=csv,noheader,nounits"],
                timeout=5
            ).decode().strip()
            return float(result.split("\n")[0])
        except Exception:
            return float("inf")  # can't check → don't block

    def acquire_gpu(self, job_id: str, model_name: str, min_free_mib: float = 4096):
        """
        Atomically find and lock a free GPU that also has enough actual VRAM.
        Returns gpu_id if successful, None if no GPU available.
        """
        with self._gpu_lock:
            for gpu_id in range(self.num_gpus):
                status = redis_client.hget(GPU_LOCK_KEY, gpu_id)
                if status != "free":
                    continue
                free_mib = self._gpu_free_memory_mib(gpu_id)
                if free_mib < min_free_mib:
                    log_info(job_id, f"GPU {gpu_id} skipped — only {free_mib:.0f} MiB free")
                    continue
                redis_client.hset(GPU_LOCK_KEY, gpu_id, f"{job_id}:{model_name}")
                log_info(job_id, f"GPU {gpu_id} acquired for {model_name} ({free_mib:.0f} MiB free)")
                return gpu_id
        return None

    def release_gpu(self, gpu_id: int, job_id: str = None):
        """Release a GPU back to the pool."""
        with self._gpu_lock:
            redis_client.hset(GPU_LOCK_KEY, gpu_id, "free")
        if job_id:
            log_info(job_id, f"GPU {gpu_id} released")

    def _run_single_model(self, job_id: str, model_name: str, input_path: str):
        """
        Run a single model on an available GPU.
        Waits for a GPU, runs inference, releases GPU.
        Returns (model_name, success, error_msg)
        """
        set_job_status(job_id, model_name, "waiting_gpu")

        # Wait for a free GPU (with atomic acquisition)
        gpu_id = None
        while gpu_id is None:
            gpu_id = self.acquire_gpu(job_id, model_name)
            if gpu_id is None:
                time.sleep(0.2)

        set_job_status(job_id, model_name, "running")

        try:
            runner = ModelRunner(model_name, job_id, gpu_id)
            runner.run(Path(input_path))
            set_job_status(job_id, model_name, "complete")
            return (model_name, True, None)
        except Exception as e:
            import traceback
            tb = traceback.format_exc()
            log_error(job_id, f"Model {model_name} failed: {e}\n{tb}")
            push_event(job_id, {"event": "model_error", "model": model_name, "error": str(e)})
            log_event(job_id, {"event": "model_error", "model": model_name, "error": str(e)})
            set_job_status(job_id, model_name, "error")
            return (model_name, False, str(e))
        finally:
            self.release_gpu(gpu_id, job_id)

    def run_job(self, job_id: str):
        """
        Run all models for a job in parallel across available GPUs.
        """
        payload_raw = redis_client.get(JOB_DATA_PREFIX + job_id)
        if not payload_raw:
            log_error(job_id, "Missing job payload in Redis")
            return

        payload = json.loads(payload_raw)

        steps = payload.get("plan")
        if steps is None:
            steps = [{"model": m, "input_path": payload["input_path"]} for m in payload["models"]]

        session_log(job_id, f"Job started with {len(steps)} models (using up to {self.num_gpus} GPUs).")
        push_event(job_id, {"event": "job_start"})
        log_event(job_id, {"event": "job_start"})

        # Run models in parallel - ThreadPoolExecutor handles thread safety
        # Each thread will wait for its own GPU
        errors = []

        with ThreadPoolExecutor(max_workers=min(len(steps), self.num_gpus)) as executor:
            futures = {
                executor.submit(
                    self._run_single_model,
                    job_id,
                    step["model"],
                    step["input_path"]
                ): step["model"]
                for step in steps
            }

            for future in as_completed(futures):
                model_name = futures[future]
                try:
                    name, success, error_msg = future.result()
                    if not success:
                        errors.append((name, error_msg))
                except Exception as e:
                    errors.append((model_name, str(e)))
                    log_error(job_id, f"Future exception for {model_name}: {e}")

        if errors:
            error_summary = "; ".join([f"{m}: {e}" for m, e in errors])
            push_event(job_id, {"event": "job_failed", "error": error_summary})
            log_event(job_id, {"event": "job_failed", "error": error_summary})
            session_log(job_id, f"Job completed with errors: {error_summary}")
        else:
            push_event(job_id, {"event": "job_complete"})
            log_event(job_id, {"event": "job_complete"})
            session_log(job_id, "Job complete.")

    def scheduler_loop(self):
        log_info("SYSTEM", f"Scheduler started with {self.num_gpus} GPUs.")
        while True:
            raw = redis_client.lpop(JOB_QUEUE_KEY)
            if raw:
                job = json.loads(raw)
                job_id = job["session_id"]
                session_log(job_id, "Dequeued job for scheduling.")
                # Run job in a separate thread so scheduler can continue
                t = threading.Thread(target=self.run_job, args=(job_id,))
                t.start()
            time.sleep(self.poll_interval)


scheduler = GPUScheduler()
