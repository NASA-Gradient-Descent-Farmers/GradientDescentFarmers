"""The monthly refresh's storage steps with an in-memory bucket: the cache round-trips through its own index (no listing),
only changed files are re-sent, and a run is published manifest-last with latest.json pointing at it."""

import json
from pathlib import Path

import pytest

from gradientdescentfarmers.model_builder.rotations import monthly

FIXTURE = Path(__file__).parent / "fixtures" / "three_districts"


class Blob:
    def __init__(self, store, name):
        self.store, self.name = store, name

    def exists(self):
        return self.name in self.store

    def download_as_text(self):
        return self.store[self.name].decode()

    def download_to_filename(self, path):
        Path(path).write_bytes(self.store[self.name])

    def upload_from_filename(self, path):
        self.store[self.name] = Path(path).read_bytes()
        self.store.setdefault("_order", []).append(self.name)

    def upload_from_string(self, text, content_type=None):
        self.store[self.name] = text.encode()


class Bucket:
    name = "b"

    def __init__(self):
        self.store = {}

    def blob(self, name):
        return Blob(self.store, name)


def test_cache_round_trip_sends_only_changes(tmp_path):
    bucket, cache = Bucket(), tmp_path / "cache"
    (cache / "smap").mkdir(parents=True)
    (cache / "smap" / "2024.h5").write_bytes(b"x" * 10)
    (cache / "siap.csv").write_text("a")
    assert monthly.cache_push(bucket, cache) == 2
    assert monthly.cache_push(bucket, cache) == 0
    restored = tmp_path / "restored"
    assert monthly.cache_pull(bucket, restored) == 2
    assert (restored / "smap" / "2024.h5").read_bytes() == b"x" * 10


def test_push_run_writes_manifest_last_and_latest(tmp_path):
    bucket = Bucket()
    url = monthly.push_run(bucket, FIXTURE)
    run_id = json.loads((FIXTURE / "manifest.json").read_text())["run_id"]
    assert url == f"gs://b/district_panel/runs/{run_id}"
    assert bucket.store["_order"][-1].endswith("/manifest.json")
    assert json.loads(bucket.store["district_panel/latest.json"])["run_id"] == run_id
    assert any(k.endswith("tables/siap_crop_years.parquet") for k in bucket.store)
    with pytest.raises(FileExistsError):
        monthly.push_run(bucket, FIXTURE)
