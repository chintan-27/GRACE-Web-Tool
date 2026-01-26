from pathlib import Path
from typing import List

from runtime.session import (
    session_log,
    session_input_native,
    session_input_fs,
)
from runtime.freesurfer import convert_to_fs
from runtime.registry import get_model_config
from services.redis_client import (
    set_job_status,
)
from runtime.sse import push_event   # <-- FIXED


class InferenceOrchestrator:
    """
    Orchestrates each inference job BEFORE the scheduler runs ModelRunner.

    Responsibilities:
      - Convert to FreeSurfer once if needed
      - Decide per-model input (native or fs)
      - Build execution plan for scheduler
      - Emit high-level SSE events
      - Log session lifecycle
    """

    def __init__(self, session_id: str, models: List[str], space: str):
        self.session_id = session_id
        self.models = models
        self.space = space   # "native" or "freesurfer"

        # Session input paths
        self.native_path = session_input_native(session_id)
        self.fs_path = session_input_fs(session_id)

    # --------------------------------------------------------------------
    def prepare_inputs(self) -> Path:
        """
        Ensure correct input files are ready:
          - Native NIfTI always exists
          - FS input created only once
        Returns path to whichever input is relevant for orchestrator-level operations.
        """

        session_log(self.session_id, "Preparing inputs…")

        if self.space == "native":
            session_log(self.session_id, "Using native T1 input.")
            return self.native_path

        if self.space == "freesurfer":
            # If FS already exists from previous job continuation
            if self.fs_path.exists():
                session_log(self.session_id, "FS input already present — skipping reconversion.")
                return self.fs_path

            session_log(self.session_id, "Converting native → FreeSurfer space…")
            # ok = convert_to_fs(self.native_path, self.fs_path, self.session_id)

            # if not ok:
            #     raise RuntimeError("FreeSurfer conversion failed.")

            # session_log(self.session_id, "FS conversion successful.")
            return self.native_path

        raise ValueError(f"Invalid space: {self.space}")

    # --------------------------------------------------------------------
    def build_model_plan(self, input_path: Path):
        """
        Construct scheduler model execution plan:
        [
           {"model": "grace-native",   "input_path": "/path/to/native"},
           {"model": "domino-fs",      "input_path": "/path/to/fs"},
           ...
        ]
        """

        plan = []
        session_log(self.session_id, "Building model execution plan…")

        for model_name in self.models:
            cfg = get_model_config(model_name)

            # Model requires native input
            if cfg["space"] == "native":
                plan.append({
                    "model": model_name,
                    "input_path": str(self.native_path),
                })
                # Update Redis job state
                set_job_status(self.session_id, model_name, "prepared")


            # Model requires FS input
            elif cfg["space"] == "freesurfer":
                plan.append({
                    "model": model_name,
                    "input_path": str(self.fs_path),
                })
                
                # Update Redis job state
                set_job_status(self.session_id, model_name, "prepared")

            else:
                set_job_status(self.session_id, model_name, "error: Unknown model space for the model")
                raise ValueError(f"Unknown model space for {model_name}: {cfg['space']}")

        session_log(self.session_id, f"Model plan built: {plan}")
        return plan

    # --------------------------------------------------------------------
    def start_job(self):
        """
        Main entry point called by `/predict`.

        Steps:
          1. Log & send SSE "orchestrator_start"
          2. Prepare input(s)
          3. Build model plan
          4. Mark job status = prepared
          5. SSE: input_ready
        """

        session_log(self.session_id, "InferenceOrchestrator: job start.")

        # High-level event
        push_event(self.session_id, {"event": "orchestrator_start"})

        # Prepare native/FS inputs
        selected_input = self.prepare_inputs()

        # Build the per-model plan
        plan = self.build_model_plan(selected_input)

        # Notify SSE
        push_event(self.session_id, {"event": "input_ready"})

        return plan

