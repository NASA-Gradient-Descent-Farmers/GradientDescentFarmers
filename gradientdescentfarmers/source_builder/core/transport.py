"""Cached, bounded HTTP transport. Credentials are NEVER logged or persisted in URLs.

Cache is content-addressed by URL and parameters. Atomic writes avoid partial JSON.
Network clients are injected into providers in tests.
"""
from __future__ import annotations
from datetime import datetime, timezone, timedelta
from pathlib import Path
import hashlib
import json
import os
import threading
import time

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

_SECRET_PARTS = ("key", "token", "password", "secret", "authorization", "credential")


def _cache_key(url: str, params: dict | None):
    return hashlib.sha256(json.dumps({"url": url, "params": params or {}}, sort_keys=True, default=str).encode()).hexdigest()


class CachedHTTP:
    def __init__(self, root: Path, timeout: int = 45, retries: int = 2, enabled: bool = True, ttl_hours: int = 168):
        self.root = Path(root) / "http"
        self.root.mkdir(parents=True, exist_ok=True)
        self.timeout = timeout
        self.enabled = enabled
        self.ttl = ttl_hours
        self.cache_hits = 0
        self._lock = threading.RLock()
        self.session = requests.Session()
        retry = Retry(total=retries, connect=retries, read=retries, status=retries, backoff_factor=0.5,
                      status_forcelist=[429, 500, 502, 503, 504], allowed_methods=["GET"],
                      respect_retry_after_header=True)
        self.session.mount("https://", HTTPAdapter(max_retries=retry, pool_connections=10, pool_maxsize=10))
        self.session.headers.update({"User-Agent": "FarmAdapt-V2-FarmProfileBuilder/0.1"})

    def json(self, url: str, params: dict | None = None, timeout: int | None = None):
        path = self.root / (_cache_key(url, params) + ".json")
        with self._lock:
            if self.enabled and path.is_file():
                age = (time.time() - path.stat().st_mtime) / 3600
                if age <= self.ttl:
                    self.cache_hits += 1
                    return json.loads(path.read_text(encoding="utf-8"))
        r = self.session.get(url, params=params, timeout=timeout or self.timeout)
        r.raise_for_status()
        payload = r.json()
        if self.enabled:
            # Atomic rename after fully writing response.
            temp = path.with_name(path.name + f".{os.getpid()}.{threading.get_ident()}.tmp")
            temp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
            temp.replace(path)
        return payload


def validate_local_hdf5(paths, required_groups=("Geophysical_Data",)):
    """Return only valid HDF5 scientific files; .qa and .xml are never HDF5.

    Source files may be large: do not scan entire arrays. Errors are explicit.
    """
    import h5py
    valid = []
    for file in paths:
        p = Path(file)
        if p.suffix.lower() not in {".h5", ".hdf5"}:
            continue
        if not p.is_file() or not h5py.is_hdf5(str(p)):
            raise ValueError(f"invalid HDF5 file: {p.name}")
        with h5py.File(p, "r") as h:
            for group in required_groups:
                if group not in h:
                    raise ValueError(f"missing HDF5 group {group} in {p.name}")
        valid.append(p)
    if not valid:
        raise ValueError("no valid scientific HDF5 files in downloaded assets")
    return valid
