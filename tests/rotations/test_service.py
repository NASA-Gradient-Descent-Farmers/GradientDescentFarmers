"""Request durability, URI isolation and immutable publication faults."""
import hashlib
import json
from pathlib import Path

import pytest
pytest.importorskip("fastapi")
pytest.importorskip("google.cloud.storage")

from fastapi.testclient import TestClient
from google.api_core.exceptions import PreconditionFailed
from gradientdescentfarmers.rotations_service.api import create_app
from gradientdescentfarmers.rotations_service.queue import RotationQueue, RotationRequest
from gradientdescentfarmers.rotations_service.storage import RotationStorage, source_identity
from gradientdescentfarmers.rotations_service.worker import RotationWorker


URI = "gs://gdfarming-farm-data/farm_profiles/example/runs/abc123"


class Blob:
    def __init__(self, storage, name): self.storage, self.name = storage, name
    def upload_from_string(self, value, if_generation_match=None, **kwargs):
        if if_generation_match == 0 and self.name in self.storage: raise PreconditionFailed("exists")
        self.storage[self.name] = value
    def download_as_bytes(self): return self.storage[self.name]


class Bucket:
    def __init__(self): self.objects = {}
    def blob(self, name): return Blob(self.objects, name)


class Client:
    def __init__(self): self.buckets = {}
    def bucket(self, name): return self.buckets.setdefault(name, Bucket())


def test_http_queue_persists_idempotence_and_conflicts(tmp_path):
    client = TestClient(create_app(tmp_path))
    body = {"source_profile_uri": URI, "idempotency_key": "same"}
    first = client.post("/jobs", json=body)
    assert first.status_code == 202
    jid = first.json()["job_id"]
    assert client.post("/jobs", json=body).json()["job_id"] == jid
    body["optimizer"] = {"max_total_irrigation_mm": 10}
    assert client.post("/jobs", json=body).status_code == 409
    assert TestClient(create_app(tmp_path)).get(f"/jobs/{jid}").json()["status"] == "queued"
    assert client.get("/source-runs/abc123").json()["job_id"] == jid
    assert client.post("/jobs", json={"source_profile_uri": "gs://other/secret"}).status_code == 422


def test_atomic_claim_and_restart_recovery(tmp_path):
    queue = RotationQueue(tmp_path)
    first = queue.submit(RotationRequest(source_profile_uri=URI))
    assert queue.claim()["job_id"] == first["job_id"]
    assert RotationQueue(tmp_path).claim() is None
    queue.recover()
    assert queue.claim()["rotation_run_id"] == first["rotation_run_id"]


def test_equivalent_source_uris_share_the_default_idempotency_key(tmp_path):
    queue = RotationQueue(tmp_path)
    first = queue.submit(RotationRequest(source_profile_uri=URI))
    assert queue.submit(RotationRequest(source_profile_uri=URI + "/farm_profile.json"))["job_id"] == first["job_id"]


def test_one_bad_source_does_not_block_another_farm(tmp_path):
    class Store:
        source_bucket = "gdfarming-farm-data"
        def completed_sources(self): return [URI.replace("abc123", "bad"), URI]
        def download_source(self, uri, root):
            if uri.endswith("/bad"): raise ValueError("corrupt")
            return root
        def source_preferences(self, path): return {}, {}
        def mirror_status(self, run_id, status): pass
    worker = RotationWorker(tmp_path, tmp_path, Store())
    worker.discover()
    assert worker.queue.source_status("abc123")["status"] == "queued"


@pytest.mark.parametrize("uri", ["file:///etc/passwd", "https://example.com", "gs://wrong/farm_profiles/f/runs/r", "gs://gdfarming-farm-data/farm_profiles/../runs/a"])
def test_source_uri_rejects_external_buckets_and_path_traversal(uri):
    with pytest.raises(ValueError): source_identity(uri)


def bundle(tmp_path):
    payload = b'{"options": []}\n'
    (tmp_path / "rotations.json").write_bytes(payload)
    manifest = {"farm_id": "example", "source_run_id": "abc123", "rotation_run_id": "rot123",
                "files": {"rotations.json": {"sha256": hashlib.sha256(payload).hexdigest(), "bytes": len(payload)}}}
    (tmp_path / "manifest.json").write_text(json.dumps(manifest))


def test_publication_verifies_all_bytes_and_retries_without_overwrite(tmp_path):
    bundle(tmp_path)
    client = Client()
    storage = RotationStorage(client=client)
    result = storage.publish(tmp_path)
    assert result["sha256_readback_verified"]
    assert result == storage.publish(tmp_path)
    assert result["dataset_uri"].endswith("/source_runs/abc123/runs/rot123")
    assert "latest/example.json" in client.bucket(storage.output_bucket).objects
    (tmp_path / "rotations.json").write_text("tampered")
    with pytest.raises(ValueError, match="checksum mismatch"): storage.publish(tmp_path)
