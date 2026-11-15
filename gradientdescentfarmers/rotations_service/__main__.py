"""Local and cloud entry points for the phase-2 MVP."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path


def main(argv=None):
    parser = argparse.ArgumentParser(description="WOFOST + SIAP + rotation selection")
    commands = parser.add_subparsers(dest="command", required=True)
    run = commands.add_parser("run")
    run.add_argument("--profile-dir", type=Path)
    run.add_argument("--profile-uri")
    run.add_argument("--source-uri")
    run.add_argument("--state-root", type=Path, default=Path("data/phase2"))
    run.add_argument("--reference-root", type=Path, default=Path("data/phase2/reference"))
    run.add_argument("--config", type=Path)
    run.add_argument("--publish", action="store_true")
    api = commands.add_parser("api")
    api.add_argument("--host", default="127.0.0.1")
    api.add_argument("--port", type=int, default=8081)
    commands.add_parser("worker")
    submit = commands.add_parser("submit")
    submit.add_argument("--profile-uri", required=True)
    submit.add_argument("--config", type=Path)
    submit.add_argument("--url", default="http://127.0.0.1:8081")
    submit.add_argument("--idempotency-key")
    status = commands.add_parser("status")
    status.add_argument("job_id")
    status.add_argument("--url", default="http://127.0.0.1:8081")
    args = parser.parse_args(argv)
    if args.command == "api":
        import uvicorn
        from .api import create_app
        uvicorn.run(create_app(), host=args.host, port=args.port)
    elif args.command == "worker":
        from .storage import RotationStorage
        from .worker import RotationWorker
        root = Path(os.environ.get("ROTATIONS_STATE", "/srv/farm-rotations"))
        reference = Path(os.environ.get("ROTATIONS_REFERENCE_ROOT", str(root / "reference")))
        storage = RotationStorage(os.environ.get("ROTATIONS_BUCKET", "gdfarming-farm-rotations"),
                                  os.environ.get("FARM_SOURCE_BUCKET", "gdfarming-farm-data"))
        RotationWorker(root, reference, storage).serve()
    elif args.command == "run":
        from .pipeline import build_rotations
        config = json.loads(args.config.read_text()) if args.config else {}
        source_uri = args.profile_uri or args.source_uri
        if args.profile_dir:
            profile = args.profile_dir
        elif args.profile_uri:
            from .storage import RotationStorage
            profile = RotationStorage().download_source(args.profile_uri, args.state_root / "profiles")
        else:
            parser.error("run requires --profile-dir or --profile-uri")
        def progress(**values):
            if values.get("stage") != "wofost" or values.get("completed", 0) % 10 == 0:
                print(json.dumps(values), flush=True)
        result = build_rotations(profile, args.state_root, args.reference_root,
                                 config.get("model", {}), config.get("optimizer", {}), source_uri, progress)
        if args.publish:
            from .storage import RotationStorage
            result["publication"] = RotationStorage().publish(Path(result["directory"]))
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        import requests
        if args.command == "submit":
            from .queue import RotationRequest
            config = json.loads(args.config.read_text()) if args.config else {}
            payload = RotationRequest(source_profile_uri=args.profile_uri,
                                      model=config.get("model", {}), optimizer=config.get("optimizer", {}),
                                      idempotency_key=args.idempotency_key)
            response = requests.post(args.url.rstrip("/") + "/jobs", json=payload.model_dump(mode="json"), timeout=30)
        else:
            response = requests.get(args.url.rstrip("/") + "/jobs/" + args.job_id, timeout=30)
        response.raise_for_status()
        print(json.dumps(response.json(), indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
