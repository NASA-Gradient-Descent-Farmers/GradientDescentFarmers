"""Private asynchronous HTTP interface. Deploy behind IAP/VPC access."""
from __future__ import annotations

import os
from pathlib import Path
import time

from fastapi import FastAPI, HTTPException, Request

from .contracts import BuildRequest
from .queue import CloudQueue


def create_app(state_dir: Path | None = None) -> FastAPI:
    root = Path(state_dir or os.environ.get("FARM_BUILDER_STATE", "/srv/farm-profile-builder"))
    queue = CloudQueue(root)
    app = FastAPI(title="FarmProfileBuilder", version="1", docs_url="/docs")

    @app.middleware("http")
    async def bound_request_size(request: Request, call_next):
        from starlette.responses import JSONResponse
        limit = 2 * 1024 * 1024
        try:
            if int(request.headers.get("content-length", "0")) > limit:
                return JSONResponse({"detail": "request exceeds 2 MiB"}, status_code=413)
        except ValueError:
            return JSONResponse({"detail": "invalid content-length"}, status_code=400)
        size, chunks = 0, []
        async for chunk in request.stream():
            size += len(chunk)
            if size > limit:
                return JSONResponse({"detail": "request exceeds 2 MiB"}, status_code=413)
            chunks.append(chunk)
        request._body = b"".join(chunks)
        return await call_next(request)

    @app.get("/healthz")
    def health():
        heartbeat = root / "worker.heartbeat"
        age = time.time() - heartbeat.stat().st_mtime if heartbeat.exists() else None
        return {"api": "ok", "worker_alive": age is not None and age < 90,
                "source_revision": os.environ.get("SOURCE_REVISION", "unknown")}

    @app.post("/jobs", status_code=202)
    def submit(payload: BuildRequest):
        try:
            return queue.submit(payload)
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

    @app.get("/jobs/{job_id}")
    def inspect(job_id: str):
        result = queue.inspect(job_id)
        if result is None:
            raise HTTPException(status_code=404, detail="job not found")
        return result

    return app
