import time
import threading
from pathlib import Path

from services.redis_client import (
    redis_client,
    push_sse_event,
    set_job_status,
)
from services.logger import (
    log_info,
    log_error,
    log_event,
)

from runtime.runner import ModelRunner
from runtime.session import session_log
from config import GPU_COUNT


GPU_LOCK_KEY = "gpu_locks"
JOB_QUEUE_KEY = "job_queue"
JOB_DATA_PREFIX = "job_data:"


class GPUScheduler:
    """
    Multi-GPU job scheduler:
      - dequeues jobs
      - assigns GPUs
      - runs ModelRunner in threads
      - logs everything
    """

    def __init__(self, num_gpus: int = GPU_COUNT, poll_interval: float = 0.5):
        self.num_gpus = num_gpus
        self.poll_interval = poll_interval
        self._init_gpu_locks()

    def _init_gpu_locks(self):
        for gpu_id in range(self.num_gpus):
            redis_client.hset(GPU_LOCK_KEY, gpu_id, "free")

    # -------------------------------------------------------
    def enqueue(self, job_id: str, payload: dict):
        redis_client.set(JOB_DATA_PREFIX + job_id, payload)
        redis_client.rpush(JOB_QUEUE_KEY, job_id)

        log_info(job_id, f"Job enqueued. Models={payload['models']}")
        set_job_status(job_id, "queued")

        push_sse_event(job_id, {"event": "queued"})
        log_event(job_id, {"event": "queued"})

    # -------------------------------------------------------
    def find_free_gpu(self):
        for gpu_id in range(self.num_gpus):
            if redis_client.hget(GPU_LOCK_KEY, gpu_id) == b"free":
                return gpu_id
        return None

    def lock_gpu(self, gpu_id: int, job_id: str):
        redis_client.hset(GPU_LOCK_KEY, gpu_id, job_id)
        log_info(job_id, f"GPU {gpu_id} locked")

    def unlock_gpu(self, gpu_id: int, job_id: str = None):
        redis_client.hset(GPU_LOCK_KEY, gpu_id, "free")
        if job_id:
            log_info(job_id, f"GPU {gpu_id} freed")

    # -------------------------------------------------------
    def run_job(self, job_id: str):
        payload = redis_client.get(JOB_DATA_PREFIX + job_id)
        if not payload:
            log_error(job_id, "Missing job payload in Redis")
            return

        payload = eval(payload.decode("utf-8"))
        input_path = payload["input_path"]
        models = payload["models"]

        set_job_status(job_id, "running")
        session_log(job_id, "Job started.")
        push_sse_event(job_id, {"event": "job_start"})
        log_event(job_id, {"event": "job_start"})

        for model_name in models:
            gpu_id = None
            while gpu_id is None:
                gpu_id = self.find_free_gpu()
                if gpu_id is None:
                    time.sleep(0.2)

            self.lock_gpu(gpu_id, job_id)

            try:
                runner = ModelRunner(model_name, job_id, gpu_id)
                runner.run(Path(input_path))
            except Exception as e:
                log_error(job_id, f"Model {model_name} failed: {e}")
                push_sse_event(job_id, {"event": "job_failed", "error": str(e)})
                log_event(job_id, {"event": "job_failed", "error": str(e)})
                self.unlock_gpu(gpu_id, job_id)
                return

            self.unlock_gpu(gpu_id, job_id)

        push_sse_event(job_id, {"event": "job_complete"})
        log_event(job_id, {"event": "job_complete"})
        set_job_status(job_id, "complete")
        session_log(job_id, "Job complete.")

    # -------------------------------------------------------
    def scheduler_loop(self):
        log_info("SYSTEM", "Scheduler started.")

        while True:
            job_id = redis_client.lpop(JOB_QUEUE_KEY)
            if job_id:
                job_id = job_id.decode("utf-8")
                session_log(job_id, "Dequeued job for scheduling.")

                t = threading.Thread(target=self.run_job, args=(job_id,))
                t.start()

            time.sleep(self.poll_interval)


# export singleton
scheduler = GPUScheduler()
