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

    def find_free_gpu(self):
        """Thread-safe GPU allocation."""
        with self._gpu_lock:
            for gpu_id in range(self.num_gpus):
                status = redis_client.hget(GPU_LOCK_KEY, gpu_id)
                if status == "free":
                    return gpu_id
        return None

    def lock_gpu(self, gpu_id: int, job_id: str):
        with self._gpu_lock:
            redis_client.hset(GPU_LOCK_KEY, gpu_id, job_id)
        log_info(job_id, f"GPU {gpu_id} locked")

    def unlock_gpu(self, gpu_id: int, job_id: str = None):
        with self._gpu_lock:
            redis_client.hset(GPU_LOCK_KEY, gpu_id, "free")
        if job_id:
            log_info(job_id, f"GPU {gpu_id} freed")

    def _run_single_model(self, job_id: str, model_name: str, input_path: str):
        """
        Run a single model on an available GPU.
        Waits for a GPU to become free, locks it, runs inference, unlocks.
        Returns (model_name, success, error_msg)
        """
        set_job_status(job_id, model_name, "waiting_gpu")

        # Wait for a free GPU
        gpu_id = None
        while gpu_id is None:
            gpu_id = self.find_free_gpu()
            if gpu_id is None:
                time.sleep(0.1)

        self.lock_gpu(gpu_id, f"{job_id}:{model_name}")
        set_job_status(job_id, model_name, "running")

        try:
            runner = ModelRunner(model_name, job_id, gpu_id)
            runner.run(Path(input_path))
            set_job_status(job_id, model_name, "complete")
            return (model_name, True, None)
        except Exception as e:
            log_error(job_id, f"Model {model_name} failed: {e}")
            push_event(job_id, {"event": "model_error", "model": model_name, "error": str(e)})
            log_event(job_id, {"event": "model_error", "model": model_name, "error": str(e)})
            set_job_status(job_id, model_name, "error")
            return (model_name, False, str(e))
        finally:
            self.unlock_gpu(gpu_id, job_id)

    def run_job(self, job_id: str):
        """
        Run all models for a job IN PARALLEL across available GPUs.
        """
        payload_raw = redis_client.get(JOB_DATA_PREFIX + job_id)
        if not payload_raw:
            log_error(job_id, "Missing job payload in Redis")
            return

        payload = json.loads(payload_raw)

        steps = payload.get("plan")
        if steps is None:
            steps = [{"model": m, "input_path": payload["input_path"]} for m in payload["models"]]

        session_log(job_id, f"Job started with {len(steps)} models (parallel execution on {self.num_gpus} GPUs).")
        push_event(job_id, {"event": "job_start"})
        log_event(job_id, {"event": "job_start"})

        # Run all models in parallel using ThreadPoolExecutor
        # Max workers = number of GPUs (each model gets its own GPU)
        errors = []
        with ThreadPoolExecutor(max_workers=self.num_gpus) as executor:
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
                t = threading.Thread(target=self.run_job, args=(job_id,))
                t.start()
            time.sleep(self.poll_interval)


scheduler = GPUScheduler()
