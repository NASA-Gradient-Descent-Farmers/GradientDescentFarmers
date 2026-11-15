"""Private phase-2 HTTP interface for re-optimization without NASA downloads."""
from __future__ import annotations

import os
from pathlib import Path
import time

from fastapi import FastAPI, HTTPException, Request
from starlette.responses import JSONResponse

from .queue import RotationRequest, RotationQueue


def create_app(state_root=None):
    root = Path(state_root or os.environ.get("ROTATIONS_STATE", "/srv/farm-rotations"))
    queue = RotationQueue(root, os.environ.get("FARM_SOURCE_BUCKET", "gdfarming-farm-data"))
    app = FastAPI(title="Farm Rotations MVP", version="1.0")

    @app.middleware("http")
    async def bounded_body(request: Request, call_next):
        size, chunks = 0, []
        async for chunk in request.stream():
            size += len(chunk)
            if size > 1024 * 1024:
                return JSONResponse({"detail": "request exceeds 1 MiB"}, status_code=413)
            chunks.append(chunk)
        request._body = b"".join(chunks)
        return await call_next(request)

    @app.get("/healthz")
    def health():
        heartbeat = root / "worker.heartbeat"
        alive = heartbeat.exists() and time.time() - heartbeat.stat().st_mtime < 90
        return {"api": "ok", "worker_alive": alive, "source_bucket": queue.source_bucket,
                "rotation_bucket": os.environ.get("ROTATIONS_BUCKET", "gdfarming-farm-rotations")}

    @app.post("/jobs", status_code=202)
    def submit(request: RotationRequest):
        try:
            return queue.submit(request)
        except ValueError as exc:
            raise HTTPException(status_code=409 if "idempotency" in str(exc) else 422, detail=str(exc)) from exc

    @app.get("/jobs/{job_id}")
    def inspect(job_id: str):
        result = queue.inspect(job_id)
        if result is None:
            raise HTTPException(status_code=404, detail="rotation job not found")
        return result

    @app.get("/source-runs/{source_run_id}")
    def inspect_source(source_run_id: str):
        result = queue.source_status(source_run_id)
        if result is None:
            raise HTTPException(status_code=404, detail="profile not yet picked up by the rotation worker")
        return result

    return app
