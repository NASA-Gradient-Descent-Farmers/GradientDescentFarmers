"""NASA Earthdata Login configuration for GPM and SMAP.

Precedence: already-exported process environment > farmadapt_v2/.env >
repository-root .env > current-working-directory .env. No credentials are logged.
This module is intentionally separate from the acquisition providers so notebooks,
CLI jobs and future APIs share the same authentication policy.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

from dotenv import load_dotenv


def load_project_env() -> list[Path]:
    """Load existing .env files without overwriting environment variables.

    The project-local .env takes precedence over a repository-root .env; values
    already exported by the shell or deployment environment always win.
    Returns paths found for diagnostics, never values.
    """
    project_root = Path(__file__).resolve().parents[3]
    repo_root = project_root.parent
    paths = [project_root / ".env", repo_root / ".env", Path.cwd() / ".env"]
    loaded: list[Path] = []
    seen: set[Path] = set()
    for path in paths:
        resolved = path.resolve()
        if resolved in seen:
            continue
        seen.add(resolved)
        if path.is_file():
            load_dotenv(dotenv_path=path, override=False)
            loaded.append(path)
    return loaded


def login_earthdata():
    """Authenticate with NASA EDL, preferring credentials over prompts.

    EARTHDATA_TOKEN or an EARTHDATA_USERNAME/EARTHDATA_PASSWORD pair can come
    from the shell, container secrets or a .env file. If missing, earthaccess
    uses its normal netrc/interactive fallback in a terminal. A non-interactive
    worker must fail promptly rather than hanging on an unseen password prompt.

    Invalid configured credentials are errors and are NOT silently replaced by
    an interactive login.
    """
    import earthaccess

    load_project_env()
    token = bool(os.environ.get("EARTHDATA_TOKEN", "").strip())
    username = bool(os.environ.get("EARTHDATA_USERNAME", "").strip())
    password = bool(os.environ.get("EARTHDATA_PASSWORD", "").strip())

    if token or (username and password):
        auth = earthaccess.login(strategy="environment")
    elif sys.stdin.isatty():
        # Earthaccess checks ~/.netrc, then prompts if not already authenticated.
        auth = earthaccess.login()
    else:
        # Workers / notebooks without a terminal must not hang prompting.
        # This still permits credential-free .netrc authentication.
        try:
            auth = earthaccess.login(strategy="netrc")
        except Exception as exc:
            raise RuntimeError(
                "NASA Earthdata credentials not found. Set EARTHDATA_USERNAME and "
                "EARTHDATA_PASSWORD (or EARTHDATA_TOKEN) in farmadapt_v2/.env "
                "or the process environment. Interactive prompts require a terminal."
            ) from exc

    if not getattr(auth, "authenticated", False):
        raise PermissionError(
            "NASA Earthdata authentication failed; check Earthdata Login credentials."
        )
    return earthaccess
