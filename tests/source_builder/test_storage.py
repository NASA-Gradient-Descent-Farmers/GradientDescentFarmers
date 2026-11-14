"""GCS bundle contract tests using in-memory fake blobs; no cloud access."""
import hashlib
import json
from pathlib import Path

import pytest

from gradientdescentfarmers.source_builder.core.storage import GCSStorage


class FakeBlob:
    def __init__(self, key, memory):
        self.key, self.memory = key, memory

    def upload_from_filename(self, filename, if_generation_match=None):
        assert if_generation_match == 0
        if self.key in self.memory:
            raise ValueError("object already exists")
        self.memory[self.key] = Path(filename).read_bytes()

    def download_to_filename(self, filename):
        Path(filename).write_bytes(self.memory[self.key])


class FakeBucket:
    def __init__(self):
        self.objects = {}

    def blob(self, name):
        return FakeBlob(name, self.objects)


class FakeClient:
    def __init__(self, bucket):
        self.fake_bucket = bucket

    def bucket(self, name):
        return self.fake_bucket


def fixture_bundle(tmp_path):
    base = tmp_path / "export"
    (base / "standardized").mkdir(parents=True)
    table = base / "standardized" / "fields.csv"
    table.write_bytes(b"field_id,area_ha\nparcel_01,1.5\n")
    digest = hashlib.sha256(table.read_bytes()).hexdigest()
    manifest = {
        "farmer_inputs": {"farm_id": "texcoco_demo"},
        "run_id": "abc123",
        "tables": {"fields": {
            "relative_path": "standardized/fields.csv", "sha256": digest
        }},
    }
    (base / "farm_profile.json").write_text(json.dumps(manifest))
    for name in ("availability.json", "validation.json",
                 "model_readiness.json", "provenance.json"):
        (base / name).write_text("{}")
    (base / "feature_catalog.csv").write_text("source,status\n")
    return base


def test_upload_download_and_versioned_uris(tmp_path):
    base = fixture_bundle(tmp_path)
    bucket = FakeBucket()
    storage = GCSStorage("my-bucket", "profiles", FakeClient(bucket))
    result = storage.upload_profile(base)
    assert result["files_uploaded"] == 7
    assert result["manifest_uri"] == "gs://my-bucket/profiles/texcoco_demo/abc123/farm_profile.json"
    assert list(bucket.objects)[-1].endswith("/farm_profile.json")
    restored = storage.download_profile("texcoco_demo", "abc123", tmp_path / "restore")
    assert (restored / "standardized" / "fields.csv").read_bytes() == (
        base / "standardized" / "fields.csv"
    ).read_bytes()


def test_reupload_refuses_overwrite(tmp_path):
    base = fixture_bundle(tmp_path)
    storage = GCSStorage("my-bucket", client=FakeClient(FakeBucket()))
    storage.upload_profile(base)
    with pytest.raises(ValueError, match="already exists"):
        storage.upload_profile(base)


def test_checksum_mismatch_blocks_upload(tmp_path):
    base = fixture_bundle(tmp_path)
    (base / "standardized" / "fields.csv").write_text("tampered")
    bucket = FakeBucket()
    storage = GCSStorage("my-bucket", client=FakeClient(bucket))
    with pytest.raises(ValueError, match="checksum mismatch"):
        storage.upload_profile(base)
    assert not bucket.objects


def test_manifest_path_traversal_rejected(tmp_path):
    base = fixture_bundle(tmp_path)
    manifest_path = base / "farm_profile.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["tables"]["fields"]["relative_path"] = "../unsafe.csv"
    manifest_path.write_text(json.dumps(manifest))
    bucket = FakeBucket()
    storage = GCSStorage("my-bucket", client=FakeClient(bucket))
    with pytest.raises(ValueError, match="Invalid relative path"):
        storage.upload_profile(base)
    assert not bucket.objects


def test_bad_bucket_or_prefix():
    with pytest.raises(ValueError):
        GCSStorage("gs://bad", client=FakeClient(FakeBucket()))
    with pytest.raises(ValueError):
        GCSStorage("good-bucket", prefix="../bad", client=FakeClient(FakeBucket()))
