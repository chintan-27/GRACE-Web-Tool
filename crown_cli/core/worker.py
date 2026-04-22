"""
Detached subprocess entrypoint.

Called as: python -m crown_cli.core.worker <job_id> <job_type>

Reads job from DuckDB, runs inference, updates status.
"""
import os
import sys
from pathlib import Path

from crown_cli.core.config import load_config
from crown_cli.core.jobs import JobStatus, JobStore
from crown_cli.core.runner import CLIModelRunner
from crown_cli.core.progress import ProgressWriter


def run_segment_job(job_id: str, store, cfg) -> None:

    job = store.get_job(job_id)
    job_dir = Path(cfg.jobs_dir) / job_id
    job_dir.mkdir(parents=True, exist_ok=True)

    store.update_status(job_id, JobStatus.RUNNING, pid=os.getpid())

    try:
        out_dir = Path(job["out_dir"])
        input_paths = job["input_paths"]
        models = job["models"]
        gpu = job["gpu"] or 0

        for input_path in input_paths:
            input_path = Path(input_path)
            file_out_dir = out_dir / input_path.stem.replace(".nii", "")
            for model_name in models:
                runner = CLIModelRunner(
                    model_name=model_name,
                    job_dir=job_dir,
                    gpu_id=gpu,
                    cfg=cfg,
                )
                runner.run(input_path, file_out_dir)

        store.update_status(job_id, JobStatus.DONE)

    except Exception as e:
        store.update_status(job_id, JobStatus.FAILED)
        writer = ProgressWriter(job_dir)
        writer.emit("worker_error", message=str(e))
        raise


def run_pipeline_job(job_id: str, store, cfg) -> None:
    """Full pipeline: segment then simulate."""
    job = store.get_job(job_id)
    job_dir = Path(cfg.jobs_dir) / job_id

    run_segment_job(job_id, store, cfg)

    job = store.get_job(job_id)
    if job["status"] != JobStatus.DONE:
        return

    meta = store.get_meta(job_id)
    simulate = meta.get("simulate")

    if simulate == "roast":
        from crown_cli.core.roast_runner import CLIRoastRunner
        store.update_status(job_id, JobStatus.RUNNING, pid=os.getpid())
        try:
            input_path = Path(job["input_paths"][0])
            # session_dir mirrors how run_segment_job computes file_out_dir
            session_dir = Path(job["out_dir"]) / input_path.stem.replace(".nii", "")
            model_name = job["models"][0]
            runner = CLIRoastRunner(
                job_dir=job_dir,
                session_dir=session_dir,
                t1_path=input_path,
                model_name=model_name,
                payload=meta,
                cfg=cfg,
            )
            runner.run()
            store.update_status(job_id, JobStatus.DONE)
        except Exception as e:
            store.update_status(job_id, JobStatus.FAILED)
            ProgressWriter(job_dir).emit("worker_error", message=str(e))
            raise


def run_roast_job(job_id: str, store, cfg) -> None:
    from crown_cli.core.roast_runner import CLIRoastRunner

    job = store.get_job(job_id)
    job_dir = Path(cfg.jobs_dir) / job_id
    job_dir.mkdir(parents=True, exist_ok=True)

    store.update_status(job_id, JobStatus.RUNNING, pid=os.getpid())

    try:
        meta = store.get_meta(job_id)
        t1_path = Path(job["input_paths"][0])
        session_dir = Path(job["out_dir"])
        model_name = job["models"][0]
        gpu = job["gpu"] or 0

        runner = CLIRoastRunner(
            job_dir=job_dir,
            session_dir=session_dir,
            t1_path=t1_path,
            model_name=model_name,
            payload=meta,
            cfg=cfg,
        )
        runner.run()
        store.update_status(job_id, JobStatus.DONE)

    except Exception as e:
        store.update_status(job_id, JobStatus.FAILED)
        ProgressWriter(job_dir).emit("worker_error", message=str(e))
        raise


def main():
    if len(sys.argv) < 3:
        print("Usage: python -m crown_cli.core.worker <job_id> <job_type>")
        sys.exit(1)

    job_id = sys.argv[1]
    job_type = sys.argv[2]   # "segment" | "pipeline" | "roast"

    cfg = load_config()
    store = JobStore(cfg.jobs_db)

    if job_type == "segment":
        run_segment_job(job_id, store, cfg)
    elif job_type == "pipeline":
        run_pipeline_job(job_id, store, cfg)
    elif job_type == "roast":
        run_roast_job(job_id, store, cfg)
    else:
        print(f"Unknown job type: {job_type}")
        sys.exit(1)


if __name__ == "__main__":
    main()
