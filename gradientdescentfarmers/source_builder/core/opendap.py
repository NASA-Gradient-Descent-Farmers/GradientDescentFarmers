"""Box subsets from NASA Earthdata OPeNDAP (Hyrax, DAP4), CMR granule search, and protected downloads.

For gridded products where a run needs a small area over many dates (SMAP L4 daily, MODIS CMG monthly),
asking the server for only the box is far cheaper than downloading global granules: a SMAP L4 granule is
~140 MB, while one day's root-zone moisture over a 3 x 3 degree box is a few kilobytes.

Authentication: with EARTHDATA_TOKEN (shell or source_builder/.env, loaded by `auth.load_project_env`) every
request carries it as a bearer token, which OPeNDAP and the cloud data servers accept directly. That avoids
the Earthdata Login host on every session, which sometimes resets connections. Without a token, the
username/password path of `auth.login_earthdata` (earthaccess) is used, with retries.

CMR search is public and needs no login. This module is additive: `earthdata.py` and `auth.py` are unchanged.
"""
from __future__ import annotations

import io
import os
import time
from pathlib import Path

CMR = "https://cmr.earthdata.nasa.gov/search/granules.umm_json"
NO_CREDENTIALS = ("NASA Earthdata credentials not found. Set EARTHDATA_TOKEN (or EARTHDATA_USERNAME and "
                  "EARTHDATA_PASSWORD) in gradientdescentfarmers/source_builder/.env or the environment.")


def _token() -> str:
    from .auth import load_project_env

    load_project_env()
    return os.environ.get("EARTHDATA_TOKEN", "").strip()


def login(retries: int = 6):
    """earthaccess login (username/password path), retried on connection errors. Used only without a token."""
    import requests

    from .auth import login_earthdata

    last = None
    for attempt in range(retries):
        try:
            return login_earthdata()
        except (requests.exceptions.ConnectionError, requests.exceptions.Timeout) as exc:
            last = exc
            time.sleep(min(2 ** attempt, 30))
    raise RuntimeError(f"Earthdata Login unreachable after {retries} attempts: {last!r}")


def session():
    """A requests session authorised for Earthdata data servers. Raises if no credentials are configured."""
    import requests
    from requests.adapters import HTTPAdapter
    from urllib3.util.retry import Retry

    token = _token()
    if token:
        s = requests.Session()
        s.headers["Authorization"] = f"Bearer {token}"
        retry = Retry(total=4, backoff_factor=1.0, status_forcelist=[429, 500, 502, 503, 504], allowed_methods=["GET"])
        s.mount("https://", HTTPAdapter(max_retries=retry, pool_connections=16, pool_maxsize=16))
        return s
    if not (os.environ.get("EARTHDATA_USERNAME") and os.environ.get("EARTHDATA_PASSWORD")):
        raise RuntimeError(NO_CREDENTIALS)
    return login().get_requests_https_session()


def _cmr_time(value: str, end: bool) -> str:
    return value if "T" in value else value + ("T23:59:59Z" if end else "T00:00:00Z")


def search(short_name: str | None = None, version: str | None = None, temporal: tuple[str, str] | None = None,
           concept_id: str | None = None, retries: int = 4, page_size: int = 2000) -> list[dict]:
    """CMR granule records (dicts with a "umm" key), all pages. Public: no login."""
    import requests

    params = {"page_size": page_size}
    if short_name:
        params["short_name"] = short_name
    if version:
        params["version"] = version
    if concept_id:
        params["collection_concept_id"] = concept_id
    if temporal:
        params["temporal"] = f"{_cmr_time(temporal[0], False)},{_cmr_time(temporal[1], True)}"
    items, after = [], None
    while True:
        headers = {"CMR-Search-After": after} if after else {}
        last = None
        for attempt in range(retries):
            try:
                r = requests.get(CMR, params=params, headers=headers, timeout=120)
                r.raise_for_status()
                break
            except Exception as exc:
                last = exc
                time.sleep(2 ** attempt)
        else:
            raise RuntimeError(f"CMR search {short_name or concept_id} {temporal}: {last!r}")
        page = r.json().get("items", [])
        items += page
        after = r.headers.get("CMR-Search-After")
        if not page or not after or len(page) < page_size:
            return items


def opendap_link(granule) -> str:
    """The granule's OPeNDAP URL from its CMR record."""
    for link in granule["umm"].get("RelatedUrls", []):
        if "opendap.earthdata.nasa.gov" in link.get("URL", ""):
            return link["URL"]
    raise ValueError(f"No OPeNDAP link for {granule['umm'].get('GranuleUR')}")


def data_links(granule) -> list[str]:
    """Direct download URLs ("GET DATA") of a granule."""
    return [u["URL"] for u in granule["umm"].get("RelatedUrls", [])
            if u.get("Type") == "GET DATA" and u.get("URL", "").startswith("https://")]


def download(granule, folder: Path, sess, timeout: int = 600) -> Path:
    """Download a granule's first data file into `folder` (skipped if already there). Returns the path."""
    url = data_links(granule)[0]
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / url.rsplit("/", 1)[1]
    if path.is_file():
        return path
    tmp = path.with_suffix(path.suffix + ".part")
    with sess.get(url, stream=True, timeout=timeout, allow_redirects=True) as r:
        r.raise_for_status()
        with open(tmp, "wb") as f:
            for chunk in r.iter_content(1 << 22):
                f.write(chunk)
    tmp.replace(path)
    return path


def dap4(sess, url: str, variables: list[str], retries: int = 6, timeout: int = 300):
    """Fetch a DAP4 constraint (list of '/path[r0:1:r1][c0:1:c1]') as an in-memory h5py File.

    The caller closes the file (use it as a context manager). Retries with exponential backoff.
    """
    import h5py

    last = None
    for attempt in range(retries):
        try:
            r = sess.get(url + ".dap.nc4", params={"dap4.ce": ";".join(variables)}, timeout=timeout)
            r.raise_for_status()
            return h5py.File(io.BytesIO(r.content), "r")
        except Exception as exc:
            last = exc
            time.sleep(2 ** attempt)
    raise RuntimeError(f"OPeNDAP {url}: {last!r}")
