from pathlib import Path
from typing import List

from runtime.session import (
    session_log,
    session_input_native,
    session_input_fs,
)
from runtime.freesurfer import convert_to_fs
from runtime.registry import get_model_config
from services.redis_client import push_sse_event, set_job_status


class InferenceOrchestrator:
    """
    Orchestrates each inference job BEFORE the scheduler runs ModelRunner.

    Responsibilities:
    - Determine which input (native or FS) to use for each model
    - Convert to FreeSurfer space ONCE if necessary
    - Produce a clean job definition for the scheduler
    - Top-level SSE announcements
    """

    def __init__(self, session_id: str, models: List[str], space: str):
        self.session_id = session_id
        self.models = models
        self.space = space

        # paths
        self.native_path = session_input_native(session_id)
        self.fs_path = session_input_fs(session_id)

    # -------------------------------------------------------
    def prepare_inputs(self):
        """
        Ensure correct input exists:
        - native always exists (uploaded)
        - FS input only exists if converted
        """

        session_log(self.session_id, "Preparing inputs...")

        if self.space == "native":
            session_log(self.session_id, "Using native T1 as input.")
            return self.native_path

        elif self.space == "freesurfer":
            # If FS already exists, skip conversion
            if self.fs_path.exists():
                session_log(self.session_id, "FS input already exists, skipping conversion.")
                return self.fs_path

            # Otherwise, convert
            session_log(self.session_id, "Converting native → FreeSurfer space...")
            ok = convert_to_fs(self.native_path, self.fs_path, self.session_id)

            if not ok:
                raise RuntimeError("FS conversion failed.")

            session_log(self.session_id, "FS conversion successful.")
            return self.fs_path

        else:
            raise ValueError(f"Unknown space: {self.space}")

    # -------------------------------------------------------
    def build_model_plan(self, input_path: Path):
        """
        Build a model execution plan with correct input_paths.
        Each model has:
            {
              "model": "grace-native",
              "input_path": "path/to/native_or_fs",
            }
        """

        plan = []

        for model_name in self.models:
            cfg = get_model_config(model_name)

            if cfg["space"] == "native":
                plan.append({
                    "model": model_name,
                    "input_path": str(self.native_path)
                })

            elif cfg["space"] == "freesurfer":
                plan.append({
                    "model": model_name,
                    "input_path": str(self.fs_path)
                })

        return plan

    # -------------------------------------------------------
    def start_job(self):
        """
        Main entrypoint for /predict:
        - run input preparation
        - build plan
        - announce job started
        - return clean job structure for scheduler
        """
        session_log(self.session_id, "Inference orchestrator: start job.")

        push_sse_event(self.session_id, {"event": "orchestrator_start"})

        # Prepare input (native or FS)
        self.prepare_inputs()

        # Build final model plan
        plan = self.build_model_plan(self.native_path)

        set_job_status(self.session_id, "prepared")
        push_sse_event(self.session_id, {"event": "input_ready"})

        return plan
