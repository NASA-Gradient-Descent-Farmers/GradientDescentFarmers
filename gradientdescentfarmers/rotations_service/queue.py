"""Single-VM durable rotation requests and restart recovery."""
from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3
import uuid

from pydantic import BaseModel, ConfigDict, Field

from ..model_builder.wofost_mvp.settings import ModelSettings
from ..model_builder.wofost_mvp.utils import digest
from ..optimizer_builder.rotation_mvp.builder import OptimizerSettings
from .storage import source_identity


def utc():
    return datetime.now(timezone.utc).isoformat()


class RotationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source_profile_uri: str
    model: ModelSettings = Field(default_factory=ModelSettings)
    optimizer: OptimizerSettings = Field(default_factory=OptimizerSettings)
    idempotency_key: str | None = Field(default=None, min_length=1, max_length=128)

    def document(self):
        return self.model_dump(mode="json", exclude={"idempotency_key"})


class RotationQueue:
    def __init__(self, root: Path, source_bucket="gdfarming-farm-data"):
        self.root, self.source_bucket = Path(root), source_bucket
        self.root.mkdir(parents=True, exist_ok=True)
        self.path = self.root / "jobs.sqlite"
        with self.connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("""CREATE TABLE IF NOT EXISTS rotation_jobs (
                job_id TEXT PRIMARY KEY, request_key TEXT UNIQUE NOT NULL,
                request_hash TEXT NOT NULL, request_json TEXT NOT NULL,
                farm_id TEXT NOT NULL, source_run_id TEXT NOT NULL,
                rotation_run_id TEXT NOT NULL, status TEXT NOT NULL, stage TEXT NOT NULL,
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL, finished_at TEXT,
                completed INTEGER DEFAULT 0, total INTEGER DEFAULT 0, result_json TEXT, error TEXT)""")

    def connect(self):
        db = sqlite3.connect(self.path, timeout=30)
        db.row_factory = sqlite3.Row
        return db

    @staticmethod
    def public(row):
        row = dict(row)
        row.pop("request_key", None)
        row.pop("request_json", None)
        row["result"] = json.loads(row.pop("result_json") or "null")
        return row

    def submit(self, request: RotationRequest):
        bucket, prefix, farm, source_run = source_identity(request.source_profile_uri, self.source_bucket)
        request.model.validated_catalog()
        document = request.document()
        document["source_profile_uri"] = f"gs://{bucket}/{prefix}"
        hashed = digest(document)
        key = request.idempotency_key or hashed
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            existing = db.execute("SELECT * FROM rotation_jobs WHERE request_key=?", (key,)).fetchone()
            if existing:
                if existing["request_hash"] != hashed:
                    raise ValueError("idempotency key belongs to a different rotation request")
                return self.public(existing)
            jid, run, now = uuid.uuid4().hex, uuid.uuid4().hex[:16], utc()
            db.execute("""INSERT INTO rotation_jobs
                (job_id,request_key,request_hash,request_json,farm_id,source_run_id,rotation_run_id,status,stage,created_at,updated_at)
                VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
                (jid, key, hashed, json.dumps(document), farm, source_run, run, "queued", "queued", now, now))
        return self.inspect(jid)

    def inspect(self, jid):
        with self.connect() as db:
            row = db.execute("SELECT * FROM rotation_jobs WHERE job_id=?", (jid,)).fetchone()
        return self.public(row) if row else None

    def source_status(self, source_run):
        with self.connect() as db:
            row = db.execute("SELECT * FROM rotation_jobs WHERE source_run_id=? ORDER BY created_at DESC LIMIT 1", (source_run,)).fetchone()
        return self.public(row) if row else None

    def claim(self):
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT * FROM rotation_jobs WHERE status='queued' ORDER BY created_at LIMIT 1").fetchone()
            if row:
                db.execute("UPDATE rotation_jobs SET status='running',stage='downloading_source',updated_at=? WHERE job_id=?", (utc(), row["job_id"]))
        return dict(row) if row else None

    def update(self, jid, **values):
        allowed = {"status", "stage", "completed", "total", "result_json", "error", "finished_at"}
        if not values or not set(values).issubset(allowed):
            raise ValueError("Invalid rotation queue update")
        values["updated_at"] = utc()
        assignments = ",".join(f"{key}=?" for key in values)
        with self.connect() as db:
            db.execute(f"UPDATE rotation_jobs SET {assignments} WHERE job_id=?", (*values.values(), jid))

    def recover(self):
        with self.connect() as db:
            db.execute("UPDATE rotation_jobs SET status='queued',stage='queued',updated_at=? WHERE status='running'", (utc(),))
