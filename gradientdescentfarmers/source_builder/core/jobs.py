"""Durable local SQLite queue for on-demand profile creation.

This is a single-host reference worker, NOT a distributed cloud queue.
Node.js can enqueue/poll through a restricted Python API/CLI later. Database
transactions make claims atomic; stale running jobs can be recovered explicitly.
"""
from __future__ import annotations
from datetime import datetime,timezone,timedelta
from pathlib import Path
from typing import Any
import hashlib
import json
import sqlite3
import uuid

from .builder import FarmProfileBuilder
from .schema import FarmerInput
from .settings import BuilderSettings


def utc():return datetime.now(timezone.utc).isoformat()

class ProfileJobQueue:
    def __init__(self,database_path:Path):
        self.path=Path(database_path)
        self.path.parent.mkdir(parents=True,exist_ok=True)
        with self._connect() as db:
            db.execute("""CREATE TABLE IF NOT EXISTS jobs (
             job_id TEXT PRIMARY KEY, idempotency_key TEXT UNIQUE NOT NULL,
             farmer_json TEXT NOT NULL, settings_json TEXT NOT NULL,
             status TEXT NOT NULL CHECK(status IN ('queued','running','succeeded','failed')),
             created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT,
             output_path TEXT, error TEXT)""")

    def _connect(self):
        db=sqlite3.connect(self.path,timeout=30)
        db.row_factory=sqlite3.Row
        return db

    def submit(self, farmer:FarmerInput|dict,settings:BuilderSettings|dict|None=None,
               idempotency_key:str|None=None):
        f=farmer if isinstance(farmer,FarmerInput) else FarmerInput.model_validate(farmer)
        s=settings if isinstance(settings,BuilderSettings) else BuilderSettings.model_validate(settings or {})
        fj=json.dumps(f.model_dump(mode="json"),sort_keys=True)
        sj=json.dumps(s.model_dump(mode="json"),sort_keys=True)
        # Idempotent by identical request; explicit unique key permits re-runs by user.
        key=idempotency_key or hashlib.sha256((fj+sj).encode()).hexdigest()
        if not key or len(key)>128:raise ValueError("invalid idempotency key")
        with self._connect() as db:
            db.execute("INSERT OR IGNORE INTO jobs(job_id,idempotency_key,farmer_json,settings_json,status,created_at) VALUES(?,?,?,?,?,?)",
              (uuid.uuid4().hex,key,fj,sj,"queued",utc()))
            row=db.execute("SELECT job_id FROM jobs WHERE idempotency_key=?",(key,)).fetchone()
        return row["job_id"]

    def inspect(self,job_id):
        with self._connect() as db:
            row=db.execute("SELECT job_id,status,created_at,started_at,finished_at,output_path,error FROM jobs WHERE job_id=?",(job_id,)).fetchone()
        return dict(row) if row else None

    def claim_next(self):
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row=db.execute("SELECT * FROM jobs WHERE status='queued' ORDER BY created_at LIMIT 1").fetchone()
            if row:
                db.execute("UPDATE jobs SET status='running',started_at=? WHERE job_id=? AND status='queued'",(utc(),row["job_id"]))
        return dict(row) if row else None

    def run_next(self,provider_overrides=None):
        """Called by a dedicated worker process. Executes one bounded logical job."""
        item=self.claim_next()
        if not item:return None
        jid=item["job_id"]
        try:
            builder=FarmProfileBuilder(json.loads(item["farmer_json"]),json.loads(item["settings_json"]),
                                       providers=provider_overrides)
            profile=builder.build(export=True)
            status="succeeded" if profile.build_state!="failed" else "failed"
            err=None if status=="succeeded" else "no enabled source produced usable environmental data"
            out=str(builder.run_dir)
        except Exception as exc:
            status="failed";err=f"{type(exc).__name__}: {str(exc)[:300]}";out=None
        with self._connect() as db:
            db.execute("UPDATE jobs SET status=?,finished_at=?,output_path=?,error=? WHERE job_id=?",
                       (status,utc(),out,err,jid))
        return self.inspect(jid)

    def recover_stale(self,older_than_minutes:int=180):
        """Operator action: requeue jobs whose worker may have crashed."""
        if older_than_minutes<5:raise ValueError("minimum recovery age is 5 minutes")
        threshold=(datetime.now(timezone.utc)-timedelta(minutes=older_than_minutes)).isoformat()
        with self._connect() as db:
            updated=db.execute("UPDATE jobs SET status='queued',started_at=NULL WHERE status='running' AND started_at<?",
                               (threshold,)).rowcount
        return updated
