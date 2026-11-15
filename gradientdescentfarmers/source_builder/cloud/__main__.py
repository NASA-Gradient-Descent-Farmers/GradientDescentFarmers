"""Server, worker and local HTTP client for the VM runner."""
from __future__ import annotations

import argparse
import json
import logging
import os
from pathlib import Path


def main(argv=None):
    parser = argparse.ArgumentParser(description="FarmProfileBuilder GCP VM runner")
    commands = parser.add_subparsers(dest="command", required=True)
    api = commands.add_parser("api")
    api.add_argument("--host", default="127.0.0.1")
    api.add_argument("--port", type=int, default=8080)
    worker = commands.add_parser("worker")
    worker.add_argument("--bucket", default=os.environ.get("FARM_BUILDER_BUCKET"))
    worker.add_argument("--earthdata-secret", default=os.environ.get("EARTHDATA_SECRET_VERSION"))
    submit = commands.add_parser("submit")
    submit.add_argument("--url", default="http://127.0.0.1:8080")
    submit.add_argument("--config", type=Path, required=True)
    submit.add_argument("--farmer-input", type=Path)
    submit.add_argument("--settings", type=Path)
    submit.add_argument("--idempotency-key")
    status = commands.add_parser("status")
    status.add_argument("job_id")
    status.add_argument("--url", default="http://127.0.0.1:8080")
    args = parser.parse_args(argv)
    if args.command == "api":
        import uvicorn
        from .api import create_app
        uvicorn.run(create_app(), host=args.host, port=args.port)
    elif args.command == "worker":
        from .storage import CloudStorage
        from .worker import CloudWorker, load_earthdata_secret
        if not args.bucket:
            parser.error("worker requires --bucket or FARM_BUILDER_BUCKET")
        logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
        if args.earthdata_secret:
            load_earthdata_secret(args.earthdata_secret)
        root = Path(os.environ.get("FARM_BUILDER_STATE", "/srv/farm-profile-builder"))
        CloudWorker(root, CloudStorage(args.bucket)).serve()
    else:
        import requests
        url = args.url.rstrip("/")
        if args.command == "submit":
            from ..adapter import REPO_ROOT
            from .contracts import BuildRequest
            config = json.loads(args.config.read_text())
            source = config.get("source", {})
            def document(explicit, inline, filename):
                if explicit is not None:
                    return json.loads(explicit.read_text())
                if inline in source:
                    return source[inline]
                path = Path(source[filename])
                if not path.is_absolute():
                    path = REPO_ROOT / path
                return json.loads(path.read_text())
            payload = BuildRequest.model_validate({
                "config": config,
                "farmer_input": document(args.farmer_input, "farmer_input", "farmer_input_file"),
                "settings": document(args.settings, "settings", "settings_file"),
                "idempotency_key": args.idempotency_key,
            })
            response = requests.post(f"{url}/jobs", json=payload.model_dump(mode="json"), timeout=30)
        else:
            response = requests.get(f"{url}/jobs/{args.job_id}", timeout=30)
        response.raise_for_status()
        print(json.dumps(response.json(), indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
