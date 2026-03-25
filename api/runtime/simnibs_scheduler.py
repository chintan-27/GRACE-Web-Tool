"""
SimNIBSScheduler — CPU-bound job queue for SimNIBS simulations.
No GPU locking; uses a simple ThreadPoolExecutor.
"""

import time
import threading
from concurrent.futures import ThreadPoolExecutor

from services.redis_client import (
    pop_simnibs_job,
    get_simnibs_job_data,
    set_simnibs_status,
)
from runtime.simnibs_runner import SimNIBSRunner
from runtime.sse import push_event
from runtime.session import session_log
from services.logger import log_info, log_error
from config import SIMNIBS_MAX_WORKERS


class SimNIBSScheduler:
    def __init__(self, max_workers: int = SIMNIBS_MAX_WORKERS, poll_interval: float = 1.0):
        self.max_workers = max_workers
        self.poll_interval = poll_interval
        self._executor = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="simnibs")

    def run_job(self, session_id: str):
        payload = get_simnibs_job_data(session_id)
        if not payload:
            log_error(session_id, "[SimNIBS] Missing job data in Redis")
            return

        session_log(session_id, "[SimNIBS] Dequeued job")
        push_event(session_id, {"event": "simnibs_start", "progress": 2})

        try:
            runner = SimNIBSRunner(session_id, payload)
            runner.run()
        except Exception as e:
            log_error(session_id, f"[SimNIBS] Job failed: {e}")
            set_simnibs_status(session_id, "error")

    def scheduler_loop(self):
        log_info("SYSTEM", f"[SimNIBS] Scheduler started ({self.max_workers} workers)")
        while True:
            session_id = pop_simnibs_job()
            if session_id:
                self._executor.submit(self.run_job, session_id)
            time.sleep(self.poll_interval)


simnibs_scheduler = SimNIBSScheduler()
