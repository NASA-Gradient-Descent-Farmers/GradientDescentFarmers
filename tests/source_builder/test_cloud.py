"""HTTP -> durable queue -> scientific build -> verified GCS publication."""
import json
from pathlib import Path

import pytest

pytest.importorskip("fastapi")
pytest.importorskip("google.cloud.storage")
pytest.importorskip("httpx")

from fastapi.testclient import TestClient
from google.api_core.exceptions import PreconditionFailed
import pandas as pd

from gradientdescentfarmers.source_builder.cloud.api import create_app
from gradientdescentfarmers.source_builder.cloud.contracts import BuildRequest
from gradientdescentfarmers.source_builder.cloud.queue import CloudQueue
from gradientdescentfarmers.source_builder.cloud.storage import CloudStorage
from gradientdescentfarmers.source_builder.cloud.worker import CloudWorker
from gradientdescentfarmers.source_builder.core.builder import FarmProfileBuilder
from gradientdescentfarmers.source_builder.core.providers import ProviderPayload


class Blob:
    def __init__(self, objects, name):
        self.objects, self.name = objects, name

    def upload_from_string(self, value, if_generation_match=None, **kwargs):
        if if_generation_match == 0 and self.name in self.objects:
            raise PreconditionFailed("exists")
        self.objects[self.name] = value

    def download_as_bytes(self):
        return self.objects[self.name]


class Bucket:
    def __init__(self):
        self.objects = {}

    def blob(self, name):
        return Blob(self.objects, name)


class Client:
    def __init__(self):
        self.memory = Bucket()

    def bucket(self, _name):
        return self.memory


@pytest.fixture
def request_payload(farmer, offline_settings):
    cfg = offline_settings.model_dump(mode="json")
    cfg.update(weather_start="2024-01-01", weather_end="2024-01-03")
    cfg["source_overrides"]["nasa_power"] = True
    return {"config": {"source": {"output_root": "/must/not/be/used", "cache_root": "../../unsafe"}},
            "farmer_input": farmer.model_dump(mode="json"), "settings": cfg}


def good_power(ctx):
    return ProviderPayload(tables={"weather_daily": pd.DataFrame({
        "date": pd.date_range("2024-01-01", periods=3), "farm_id": [ctx.farmer.farm_id] * 3,
        "tmean_c": [15.] * 3, "tmin_c": [10.] * 3, "tmax_c": [20.] * 3,
        "precip_mm": [1.] * 3, "solar_mj_m2_day": [20.] * 3,
        "rh_pct": [65.] * 3, "wind_m_s": [2.] * 3,
    })}, source_url="offline-fixture://power")


def factory(farmer, settings):
    return FarmProfileBuilder(farmer, settings, providers={"nasa_power": good_power})


def test_http_validation_idempotency_and_persistence(tmp_path, request_payload):
    client = TestClient(create_app(tmp_path))
    first = client.post("/jobs", json=request_payload)
    assert first.status_code == 202
    jid = first.json()["job_id"]
    assert client.post("/jobs", json=request_payload).json()["job_id"] == jid
    # API restarts leave requests intact and keep private filesystem paths out.
    result = TestClient(create_app(tmp_path)).get(f"/jobs/{jid}").json()
    assert result["status"] == "queued"
    assert "request_json" not in result and "run_dir" not in result
    assert client.get("/jobs/missing").status_code == 404
    request_payload["farmer_input"]["latitude"] = 100
    assert client.post("/jobs", json=request_payload).status_code == 422


def test_conflicting_idempotency_key_is_rejected(tmp_path, request_payload):
    client = TestClient(create_app(tmp_path))
    request_payload["idempotency_key"] = "same-key"
    assert client.post("/jobs", json=request_payload).status_code == 202
    request_payload["farmer_input"]["latitude"] = 25
    assert client.post("/jobs", json=request_payload).status_code == 409


def test_credentials_and_oversized_requests_rejected(tmp_path, request_payload):
    client = TestClient(create_app(tmp_path))
    request_payload["config"]["source"]["EARTHDATA_PASSWORD"] = "should-not-be-persisted"
    assert client.post("/jobs", json=request_payload).status_code == 422
    assert client.post("/jobs", content=b"x" * (2 * 1024 * 1024 + 1)).status_code == 413
    assert CloudQueue(tmp_path).claim() is None


def test_atomic_claim_and_interrupted_recovery(tmp_path, request_payload):
    queue = CloudQueue(tmp_path)
    request = BuildRequest.model_validate(request_payload)
    jid = queue.submit(request)["job_id"]
    assert queue.claim()["job_id"] == jid
    assert CloudQueue(tmp_path).claim() is None
    assert queue.recover_interrupted() == 1
    assert queue.claim()["job_id"] == jid


def test_worker_build_audit_upload_and_retry(tmp_path, request_payload):
    queue = CloudQueue(tmp_path)
    jid = queue.submit(BuildRequest.model_validate(request_payload))["job_id"]
    client = Client()
    storage = CloudStorage("test-bucket", client)
    worker = CloudWorker(tmp_path, storage, factory)
    worker.run_item(queue.claim())
    done = queue.inspect(jid)
    assert done["status"] == "succeeded"
    assert done["result"]["weather_source_ready"] is True  # honors this request's dates
    assert done["result"]["sha256_readback_verified"] is True
    assert done["result"]["manifest_uri"].startswith("gs://test-bucket/farm_profiles/")
    assert "/runs/" in done["result"]["dataset_uri"]
    objects = client.memory.objects
    assert f"inputs/{jid}/farmer_input.json" in objects
    assert not any("cache/" in key for key in objects)
    last = list(objects)[-1]  # updating status does not change insertion order
    assert last.endswith("upload_receipt.json")
    # Simulate worker loss after upload but before recording success. A second
    # build would fail this test; the finished run must be reused as-is.
    worker.queue.update(jid, status="running")
    assert worker.queue.recover_interrupted() == 1
    retry = worker.queue.claim()
    worker.builder_factory = lambda *_: pytest.fail("completed run rebuilt")
    before = {key: value for key, value in objects.items() if "/runs/" in key}
    worker.run_item(retry)
    assert queue.inspect(jid)["status"] == "succeeded"
    assert {key: value for key, value in objects.items() if "/runs/" in key} == before


def test_existing_object_conflict_never_overwritten():
    client = Client()
    storage = CloudStorage("test-bucket", client)
    storage.immutable_bytes("inputs/a/config.json", b"original")
    storage.immutable_bytes("inputs/a/config.json", b"original")
    with pytest.raises(ValueError, match="differs"):
        storage.immutable_bytes("inputs/a/config.json", b"changed")
    assert client.memory.objects["inputs/a/config.json"] == b"original"


def test_tampered_local_table_blocks_publication(tmp_path, request_payload):
    queue = CloudQueue(tmp_path)
    jid = queue.submit(BuildRequest.model_validate(request_payload))["job_id"]
    worker = CloudWorker(tmp_path, CloudStorage("test-bucket", Client()), factory)
    item = queue.claim()
    worker.run_item(item)
    with queue.connect() as db:
        directory = Path(db.execute("SELECT run_dir FROM cloud_jobs WHERE job_id=?", (jid,)).fetchone()[0])
    manifest = json.loads((directory / "farm_profile.json").read_text())
    target = directory / manifest["tables"]["weather_daily"]["relative_path"]
    target.write_text("tampered")
    queue.update(jid, status="running")
    queue.recover_interrupted()
    clean_client = Client()
    worker.storage = CloudStorage("test-bucket", clean_client)
    worker.run_item(queue.claim())
    assert queue.inspect(jid)["status"] == "failed"
    assert not any("/runs/" in key for key in clean_client.memory.objects)
