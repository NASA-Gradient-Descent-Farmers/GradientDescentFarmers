"""Automatically chain verified source deliveries into rotation jobs."""
from __future__ import annotations

import fcntl
import json
from pathlib import Path
import signal
import threading
import time

from .pipeline import build_rotations
from .queue import RotationQueue, RotationRequest, utc
from .storage import RotationStorage, source_identity


class RotationWorker:
    def __init__(self, root: Path, reference_root: Path, storage: RotationStorage, poll_seconds=30):
        self.root, self.reference_root = Path(root), Path(reference_root)
        self.storage = storage
        self.queue = RotationQueue(self.root, storage.source_bucket)
        self.poll_seconds = poll_seconds
        self.last_publish = {}

    def status(self, jid, **values):
        self.queue.update(jid, **values)
        status = self.queue.inspect(jid)
        now = time.monotonic()
        previous = self.last_publish.get(jid, (None, 0.))
        if status["stage"] != previous[0] or now - previous[1] > 3:
            try:
                self.storage.mirror_status(status["source_run_id"], status)
                self.last_publish[jid] = (status["stage"], now)
            except Exception as exc:
                print(f"Status mirror temporarily unavailable: {type(exc).__name__}", flush=True)

    def discover(self):
        for uri in self.storage.completed_sources():
            _, _, _, source_run = source_identity(uri, self.storage.source_bucket)
            if self.queue.source_status(source_run) is not None:
                continue
            try:
                directory = self.storage.download_source(uri, self.root / "profiles")
                model_config, optimizer_config = self.storage.source_preferences(directory)
                request = RotationRequest(source_profile_uri=uri, model=model_config, optimizer=optimizer_config)
                job = self.queue.submit(request)
                self.storage.mirror_status(source_run, job)
                print(f"Auto-enqueued source_run={source_run} rotation_job={job['job_id']}", flush=True)
            except Exception as exc:
                # One bad source or invalid config must not starve other farms.
                error = f"{type(exc).__name__}: {exc}"[:500]
                print(f"Source_run={source_run} preparation failed; will retry: {error}", flush=True)
                try:
                    self.storage.mirror_status(source_run, {"source_run_id": source_run, "status": "failed",
                                                          "stage": "source_preparation", "error": error})
                except Exception:
                    pass

    def run_item(self, item):
        jid = item["job_id"]
        try:
            request = RotationRequest.model_validate_json(item["request_json"])
            directory = self.storage.download_source(request.source_profile_uri, self.root / "profiles")
            output = self.root / "runs" / item["farm_id"] / item["source_run_id"] / item["rotation_run_id"]
            if not (output / "manifest.json").is_file():
                def progress(**values):
                    self.status(jid, **values)
                result = build_rotations(
                    directory, self.root, self.reference_root,
                    request.model.model_dump(mode="json"), request.optimizer.model_dump(mode="json"),
                    request.source_profile_uri, progress, item["rotation_run_id"])
                output = Path(result["directory"])
            self.status(jid, stage="publishing", completed=0, total=1)
            receipt = self.storage.publish(output)
            document = json.loads((output / "rotations.json").read_text())
            result = {**receipt, "options": len(document["options"]), "rotation_status": document["status"],
                      "confidence": document["confidence"]["overall"]}
            self.status(jid, status="succeeded", stage="completed", completed=1, total=1,
                        finished_at=utc(), result_json=json.dumps(result), error=None)
            print(f"Rotation job={jid} published {receipt['dataset_uri']}", flush=True)
        except Exception as exc:
            error = f"{type(exc).__name__}: {exc}"[:700]
            self.status(jid, status="failed", stage="failed", finished_at=utc(), error=error)
            print(f"Rotation job={jid} failed: {error}", flush=True)

    def serve(self):
        stop = threading.Event()
        for sig in (signal.SIGINT, signal.SIGTERM):
            signal.signal(sig, lambda *_: stop.set())
        with (self.root / "worker.lock").open("w") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.queue.recover()
            def heartbeat():
                while not stop.is_set():
                    (self.root / "worker.heartbeat").touch()
                    stop.wait(10)
            threading.Thread(target=heartbeat, daemon=True).start()
            next_poll = 0.
            while not stop.is_set():
                if time.monotonic() >= next_poll:
                    try:
                        self.discover()
                    except Exception as exc:
                        print(f"Source discovery retry pending: {type(exc).__name__}: {str(exc)[:300]}", flush=True)
                    next_poll = time.monotonic() + self.poll_seconds
                item = self.queue.claim()
                if item:
                    self.run_item(item)
                else:
                    stop.wait(2)
