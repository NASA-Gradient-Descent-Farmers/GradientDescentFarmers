"""Bounded, polite HTTP client for the SIAP open-data site (no credentials needed)."""
from __future__ import annotations

import time
from dataclasses import dataclass

import requests
from pydantic import BaseModel, ConfigDict, Field
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from .catalog import DICTIONARY_VIEW_ID, BASE_URL, DOWNLOAD_PATH, LISTING_URL, SiapDataset, parse_listing
from .schema import SiapFormatError, check_csv_payload


class SiapSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    connect_timeout_s: float = Field(default=15, gt=0, le=120)
    read_timeout_s: float = Field(default=90, gt=0, le=600)
    retries: int = Field(default=3, ge=0, le=8)
    delay_between_requests_s: float = Field(default=0.5, ge=0, le=30)
    max_bytes: int = Field(default=250_000_000, gt=0)  # largest real file seen is ~6 MB
    user_agent: str = "GradientDescentFarmers-SIAP/0.1"


class SiapYearNotAvailable(LookupError):
    """SIAP answered 404 (empty body) for this dataset/year."""


@dataclass(frozen=True)
class Download:
    content: bytes
    url: str
    filename: str | None
    status: int


class SiapClient:
    def __init__(self, settings: SiapSettings | None = None, session: requests.Session | None = None):
        self.settings = settings or SiapSettings()
        self._last_request = 0.0
        if session is not None:
            self.session = session
        else:
            self.session = requests.Session()
            retry = Retry(total=self.settings.retries, connect=self.settings.retries,
                          read=self.settings.retries, status=self.settings.retries, backoff_factor=1.0,
                          status_forcelist=[429, 500, 502, 503, 504], allowed_methods=["GET"],
                          respect_retry_after_header=True)
            self.session.mount("https://", HTTPAdapter(max_retries=retry))
            self.session.headers.update({"User-Agent": self.settings.user_agent})

    def _get(self, url: str) -> Download:
        wait = self.settings.delay_between_requests_s - (time.monotonic() - self._last_request)
        if wait > 0:
            time.sleep(wait)
        timeout = (self.settings.connect_timeout_s, self.settings.read_timeout_s)
        try:
            with self.session.get(url, timeout=timeout, stream=True) as resp:
                self._last_request = time.monotonic()
                if resp.status_code == 404:
                    raise SiapYearNotAvailable(url)
                resp.raise_for_status()
                chunks, total = [], 0
                for chunk in resp.iter_content(1 << 16):
                    total += len(chunk)
                    if total > self.settings.max_bytes:
                        raise SiapFormatError(f"response exceeds max_bytes={self.settings.max_bytes}")
                    chunks.append(chunk)
                declared = resp.headers.get("Content-Length")
                if declared and declared.isdigit() and int(declared) != total:
                    raise SiapFormatError(f"truncated download: got {total} of {declared} bytes")
                disp = resp.headers.get("Content-Disposition", "")
                filename = disp.split('filename="')[1].split('"')[0] if 'filename="' in disp else None
                return Download(b"".join(chunks), url, filename, resp.status_code)
        finally:
            self._last_request = time.monotonic()

    def fetch_year(self, dataset: SiapDataset, year: int) -> Download:
        """Download and validate one yearly CSV. Raises SiapYearNotAvailable / SiapFormatError."""
        dl = self._get(dataset.url(year))
        check_csv_payload(dl.content, dataset.required_columns)
        return dl

    def fetch_dictionary(self) -> Download:
        """Download the data-dictionary workbook (.xlsx)."""
        dl = self._get(f"{BASE_URL}{DOWNLOAD_PATH}?view={DICTIONARY_VIEW_ID}")
        if not dl.content.startswith(b"PK"):  # xlsx is a zip container
            raise SiapFormatError("dictionary download is not an .xlsx file")
        return dl

    def discover(self) -> dict[str, list[int]]:
        """Parse the public listing page: ``{view_id: [years]}``. Use to detect new years or changed ids."""
        resp = self.session.get(LISTING_URL, timeout=(self.settings.connect_timeout_s, self.settings.read_timeout_s))
        resp.raise_for_status()
        listing = parse_listing(resp.text)
        if not listing:
            raise SiapFormatError("no download links found on the SIAP listing page (layout changed?)")
        return listing
