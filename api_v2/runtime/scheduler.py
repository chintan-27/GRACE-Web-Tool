import time
import json
import threading
from pathlib import Path

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
        for gpu_id in range(self.num_gpus):
            if redis_client.hget(GPU_LOCK_KEY, gpu_id) == "free":  
                return gpu_id
        return None

    def lock_gpu(self, gpu_id: int, job_id: str):
        redis_client.hset(GPU_LOCK_KEY, gpu_id, job_id)
        log_info(job_id, f"GPU {gpu_id} locked")

    def unlock_gpu(self, gpu_id: int, job_id: str = None):
        redis_client.hset(GPU_LOCK_KEY, gpu_id, "free")
        if job_id:
            log_info(job_id, f"GPU {gpu_id} freed")

    def run_job(self, job_id: str):
        payload_raw = redis_client.get(JOB_DATA_PREFIX + job_id)
        if not payload_raw:
            log_error(job_id, "Missing job payload in Redis")
            return

        payload = json.loads(payload_raw)

        steps = payload.get("plan")
        if steps is None:
            steps = [{"model": m, "input_path": payload["input_path"]} for m in payload["models"]]

        session_log(job_id, "Job started.")
        push_event(job_id, {"event": "job_start"})
        log_event(job_id, {"event": "job_start"})

        for step in steps:
            model_name = step["model"]
            input_path = step["input_path"]

            set_job_status(job_id, model_name, "running")

            gpu_id = None
            while gpu_id is None:
                gpu_id = self.find_free_gpu()
                if gpu_id is None:
                    time.sleep(0.2)

            self.lock_gpu(gpu_id, job_id)

            try:
                runner = ModelRunner(model_name, job_id, gpu_id)
                runner.run(Path(input_path))
                set_job_status(job_id, model_name, "complete")
            except Exception as e:
                log_error(job_id, f"Model {model_name} failed: {e}")
                push_event(job_id, {"event": "job_failed", "model": model_name, "error": str(e)})
                log_event(job_id, {"event": "job_failed", "model": model_name, "error": str(e)})
                set_job_status(job_id, model_name, "error")
                self.unlock_gpu(gpu_id, job_id)
                return
            finally:
                self.unlock_gpu(gpu_id, job_id)

        push_event(job_id, {"event": "job_complete"})
        log_event(job_id, {"event": "job_complete"})
        session_log(job_id, "Job complete.")

    def scheduler_loop(self):
        log_info("SYSTEM", "Scheduler started.")
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

