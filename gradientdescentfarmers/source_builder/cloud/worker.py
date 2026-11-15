"""Dedicated worker: acquire, audit and publish one profile at a time."""
from __future__ import annotations

import fcntl
import json
import logging
import os
from pathlib import Path
import signal
import threading

from ..core.audit import audit_profile
from ..core.builder import FarmProfileBuilder
from ..core.handoff import assess_run
from ..core.settings import BuilderSettings
from .contracts import BuildRequest, json_bytes
from .queue import CloudQueue, utc
from .storage import CloudStorage

LOG = logging.getLogger(__name__)


def load_earthdata_secret(resource: str):
    """Read the attached VM service account's secret directly into memory."""
    import base64
    import google.auth
    from google.auth.transport.requests import AuthorizedSession
    credentials, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
    response = AuthorizedSession(credentials).get(
        f"https://secretmanager.googleapis.com/v1/{resource}:access", timeout=30)
    response.raise_for_status()
    payload = json.loads(base64.b64decode(response.json()["payload"]["data"]))
    names = {"EARTHDATA_USERNAME", "EARTHDATA_PASSWORD", "EARTHDATA_TOKEN"}
    if not isinstance(payload, dict) or not set(payload).issubset(names):
        raise ValueError("invalid Earthdata secret structure")
    for name, value in payload.items():
        if not isinstance(value, str):
            raise ValueError("invalid Earthdata secret value")
        os.environ[name] = value


def safe_error(exc: Exception) -> str:
    value = f"{type(exc).__name__}: {exc}"
    for name, secret in os.environ.items():
        if any(part in name for part in ("PASSWORD", "TOKEN", "API_KEY", "EARTHDATA_USERNAME")) and secret:
            value = value.replace(secret, "[REDACTED]")
    return value[:500]


class CloudWorker:
    def __init__(self, state_dir: Path, storage: CloudStorage, builder_factory=FarmProfileBuilder):
        self.root = Path(state_dir).resolve()
        self.queue = CloudQueue(self.root)
        self.storage = storage
        self.builder_factory = builder_factory

    def status(self, job_id: str, **values):
        self.queue.update(job_id, **values)
        try:
            self.storage.publish_status(job_id, self.queue.inspect(job_id))
        except Exception as exc:
            # The durable SQLite queue remains authoritative during transient
            # GCS outages. Publication of the scientific bundle is mandatory.
            LOG.warning("Could not mirror status for %s: %s", job_id, safe_error(exc))

    def run_item(self, item: dict):
        jid = item["job_id"]
        request = BuildRequest.model_validate_json(item["request_json"])
        documents = request.documents()
        inputs = self.root / "inputs" / jid
        inputs.mkdir(parents=True, exist_ok=True)
        for key, filename in (("config", "config.json"), ("farmer_input", "farmer_input.json"), ("settings", "settings.json")):
            (inputs / filename).write_bytes(json_bytes(documents[key]))
        try:
            self.storage.publish_inputs(jid, documents)
            settings = request.settings.model_copy(update={
                "output_root": self.root / "profiles", "cache_root": self.root / "cache",
                "input_files_root": inputs / "optional_tables",
            })
            previous = Path(item["run_dir"]) if item.get("run_dir") else None
            if previous is not None and (previous / "farm_profile.json").is_file():
                directory = previous
                LOG.info("Resuming publication of %s", jid)
            else:
                builder = self.builder_factory(request.farmer_input, settings)
                directory = builder.run_dir
                self.status(jid, stage="retrieving", run_dir=str(directory))
                # Keep HTTP polling useful without changing the scientific core.
                for name, provider in list(builder.providers.items()):
                    def tracked(context, name=name, provider=provider):
                        LOG.info("job=%s source=%s started", jid, name)
                        self.status(jid, active_source=name)
                        result = provider(context)
                        LOG.info("job=%s source=%s downloaded", jid, name)
                        return result
                    builder.providers[name] = tracked
                builder.build(export=True)
            profile = json.loads((directory / "farm_profile.json").read_text())
            statuses = {name: rec["status"] for name, rec in profile["source_status"].items()}
            self.status(jid, stage="auditing", active_source=None, result_json=json.dumps({
                "run_id": profile["run_id"], "farm_id": request.farmer_input.farm_id,
                "build_state": profile["build_state"], "source_status": statuses,
            }))
            audit = audit_profile(directory, expected_farm_id=request.farmer_input.farm_id)
            if not audit["integrity_ok"]:
                raise ValueError("Run integrity audit failed; no dataset published")
            extras = {
                "audit_report.json": audit,
                "handoff_report.json": assess_run(
                    directory, weather_start=settings.weather_start, weather_end=settings.weather_end,
                    modis_start=settings.modis_start, modis_end=settings.modis_end),
                "cloud_execution.json": {
                    "job_id": jid, "request_sha256": request.digest(),
                    "source_revision": os.environ.get("SOURCE_REVISION", "unknown"),
                    "source_bundle_sha256": os.environ.get("SOURCE_BUNDLE_SHA256", "unknown"),
                    "source_release_uri": os.environ.get("SOURCE_RELEASE_URI", "unknown"),
                    "input_uri": f"gs://{self.storage.bucket_name}/inputs/{jid}/",
                    "effective_settings": settings.model_dump(mode="json"),
                    "scope": "environmental sources; SIAP and DENUE are not enabled",
                },
            }
            for name, value in extras.items():
                # Preserve already-published provenance after a worker restart.
                path = directory / name
                if not path.exists():
                    path.write_bytes(json_bytes(value))
            self.status(jid, stage="uploading")
            receipt = self.storage.publish_run(directory)
            result = {**receipt, "build_state": profile["build_state"], "source_status": statuses,
                      "integrity_ok": True, "baseline_qa_ok": audit["qa_ok"],
                      "weather_source_ready": extras["handoff_report.json"]["weather_source_ready"]}
            failed = profile["build_state"] == "failed"
            self.status(jid, status="failed" if failed else "succeeded", stage="completed",
                        finished_at=utc(), active_source=None, result_json=json.dumps(result),
                        error="No environmental source produced usable data" if failed else None)
            LOG.info("job=%s completed build_state=%s", jid, profile["build_state"])
        except Exception as exc:
            error = safe_error(exc)
            LOG.error("job=%s failed: %s", jid, error)
            self.status(jid, status="failed", stage="failed", finished_at=utc(), active_source=None, error=error)

    def serve(self):
        stop = threading.Event()
        for sig in (signal.SIGINT, signal.SIGTERM):
            signal.signal(sig, lambda *_: stop.set())
        with (self.root / "worker.lock").open("w") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.queue.recover_interrupted()
            def heartbeat():
                while not stop.is_set():
                    (self.root / "worker.heartbeat").touch()
                    stop.wait(10)
            threading.Thread(target=heartbeat, daemon=True).start()
            while not stop.is_set():
                item = self.queue.claim()
                if item:
                    self.run_item(item)
                else:
                    stop.wait(2)
