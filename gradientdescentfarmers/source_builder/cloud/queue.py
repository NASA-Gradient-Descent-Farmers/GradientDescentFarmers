"""Durable queue for one VM; one worker owns the shared satellite cache."""
from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3
import uuid

from .contracts import BuildRequest


def utc() -> str:
    return datetime.now(timezone.utc).isoformat()


class CloudQueue:
    def __init__(self, state_dir: Path):
        self.root = Path(state_dir)
        self.root.mkdir(parents=True, exist_ok=True)
        self.path = self.root / "jobs.sqlite"
        with self.connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("""CREATE TABLE IF NOT EXISTS cloud_jobs (
                job_id TEXT PRIMARY KEY, idempotency_key TEXT UNIQUE NOT NULL,
                request_sha256 TEXT NOT NULL, request_json TEXT NOT NULL,
                status TEXT NOT NULL, stage TEXT NOT NULL,
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                started_at TEXT, finished_at TEXT, run_dir TEXT,
                active_source TEXT, result_json TEXT, error TEXT)""")

    def connect(self):
        db = sqlite3.connect(self.path, timeout=30)
        db.row_factory = sqlite3.Row
        return db

    def submit(self, request: BuildRequest) -> dict:
        digest = request.digest()
        key = request.idempotency_key or digest
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT * FROM cloud_jobs WHERE idempotency_key=?", (key,)).fetchone()
            if row is not None:
                if row["request_sha256"] != digest:
                    raise ValueError("idempotency_key already belongs to a different request")
                return self._public(dict(row))
            jid, now = uuid.uuid4().hex, utc()
            db.execute("""INSERT INTO cloud_jobs
                (job_id,idempotency_key,request_sha256,request_json,status,stage,created_at,updated_at)
                VALUES(?,?,?,?,?,?,?,?)""",
                (jid, key, digest, json.dumps(request.documents()), "queued", "queued", now, now))
        return self.inspect(jid)

    @staticmethod
    def _public(row: dict) -> dict:
        row.pop("request_json", None)
        row.pop("idempotency_key", None)
        row.pop("run_dir", None)
        row["result"] = json.loads(row.pop("result_json") or "null")
        return row

    def inspect(self, job_id: str) -> dict | None:
        with self.connect() as db:
            row = db.execute("SELECT * FROM cloud_jobs WHERE job_id=?", (job_id,)).fetchone()
        return self._public(dict(row)) if row else None

    def claim(self) -> dict | None:
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT * FROM cloud_jobs WHERE status='queued' ORDER BY created_at LIMIT 1").fetchone()
            if row is None:
                return None
            now = utc()
            db.execute("UPDATE cloud_jobs SET status='running',stage='preparing',started_at=?,updated_at=? WHERE job_id=?",
                       (now, now, row["job_id"]))
        return dict(row)

    def update(self, job_id: str, **values):
        allowed = {"status", "stage", "finished_at", "run_dir", "active_source", "result_json", "error"}
        if not values or not set(values).issubset(allowed):
            raise ValueError("invalid queue update")
        values["updated_at"] = utc()
        assignments = ",".join(f"{name}=?" for name in values)
        with self.connect() as db:
            db.execute(f"UPDATE cloud_jobs SET {assignments} WHERE job_id=?", (*values.values(), job_id))

    def recover_interrupted(self) -> int:
        # Only call after acquiring the exclusive worker flock. Completed local
        # profiles are reused by the worker; incomplete builds reuse the cache.
        with self.connect() as db:
            count = db.execute("""UPDATE cloud_jobs SET status='queued',stage='queued',
                active_source=NULL,updated_at=? WHERE status='running'""", (utc(),)).rowcount
        return count
