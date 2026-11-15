"""Box subsets from NASA Earthdata OPeNDAP (Hyrax, DAP4).

For gridded products where a run needs a small area over many dates (SMAP L4 daily, MODIS CMG monthly),
asking the server for only the box is far cheaper than downloading global granules: a SMAP L4 granule is
~140 MB, while one day's root-zone moisture over a 3 x 3 degree box is a few kilobytes.

This module is additive: `earthdata.py` and its download path are unchanged. It reuses
`auth.login_earthdata` for credentials (EARTHDATA_TOKEN or EARTHDATA_USERNAME/EARTHDATA_PASSWORD).
"""
from __future__ import annotations

import io
import time


def session():
    """An authenticated requests session for Earthdata (raises if no credentials are configured)."""
    from .auth import login_earthdata

    earthaccess = login_earthdata()
    return earthaccess.get_requests_https_session()


def search(short_name: str, version: str, temporal: tuple[str, str], **kwargs):
    from .auth import login_earthdata

    earthaccess = login_earthdata()
    return earthaccess.search_data(short_name=short_name, version=version, temporal=temporal, **kwargs)


def opendap_link(granule) -> str:
    """The granule's OPeNDAP URL from its CMR record."""
    for link in granule["umm"].get("RelatedUrls", []):
        if "opendap.earthdata.nasa.gov" in link.get("URL", ""):
            return link["URL"]
    raise ValueError(f"No OPeNDAP link for {granule['umm'].get('GranuleUR')}")


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
