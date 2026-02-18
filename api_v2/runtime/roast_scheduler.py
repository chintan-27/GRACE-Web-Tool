"""
ROASTScheduler — CPU-bound job queue for ROAST simulations.
No GPU locking; uses a simple ThreadPoolExecutor.
"""

import time
import threading
from concurrent.futures import ThreadPoolExecutor

from services.redis_client import (
    pop_roast_job,
    get_roast_job_data,
    set_roast_status,
)
from runtime.roast_runner import ROASTRunner
from runtime.sse import push_event
from runtime.session import session_log
from services.logger import log_info, log_error
from config import ROAST_MAX_WORKERS


class ROASTScheduler:
    def __init__(self, max_workers: int = ROAST_MAX_WORKERS, poll_interval: float = 1.0):
        self.max_workers = max_workers
        self.poll_interval = poll_interval
        self._executor = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="roast")

    def run_job(self, session_id: str):
        payload = get_roast_job_data(session_id)
        if not payload:
            log_error(session_id, "[ROAST] Missing job data in Redis")
            return

        model_name = payload.get("model_name")
        session_log(session_id, f"[ROAST] Dequeued job for model={model_name}")

        push_event(session_id, {"event": "roast_start", "progress": 2})

        try:
            runner = ROASTRunner(session_id, model_name, payload)
            runner.run()
        except Exception as e:
            log_error(session_id, f"[ROAST] Job failed: {e}")
            set_roast_status(session_id, "error")

    def scheduler_loop(self):
        log_info("SYSTEM", f"[ROAST] Scheduler started ({self.max_workers} workers)")
        while True:
            session_id = pop_roast_job()
            if session_id:
                self._executor.submit(self.run_job, session_id)
            time.sleep(self.poll_interval)


roast_scheduler = ROASTScheduler()
