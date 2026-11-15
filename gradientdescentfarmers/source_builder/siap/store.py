"""On-disk store: raw CSV (untouched bytes) + normalized Parquet + manifest.

Layout under ``root`` (default ``data/siap``, git-ignored; override with ``SIAP_DATA_DIR``)::

    raw/<dataset>/<original filename>.csv
    parquet/<dataset>/<year>.parquet
    dictionary/Diccionario_agricola.xlsx
    manifest.json

Writes are atomic (temp file + rename) and serialized by a lock file, so a scheduled sync can
run while a web app reads. Readers only ever see complete files.
"""
from __future__ import annotations

import contextlib
import hashlib
import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Iterator

import pandas as pd

from .catalog import DATASETS, SiapDataset, get_dataset
from .client import SiapClient, SiapYearNotAvailable
from .clean import CLEANING_VERSION, clean
from .schema import SiapFormatError, parse_csv

try:  # POSIX only; the deployment target is a Linux VM
    import fcntl
except ImportError:  # pragma: no cover
    fcntl = None  # type: ignore[assignment]


def default_root() -> Path:
    """``$SIAP_DATA_DIR``, else ``<repo root>/data/siap`` (independent of the working directory)."""
    if os.environ.get("SIAP_DATA_DIR"):
        return Path(os.environ["SIAP_DATA_DIR"])
    repo = Path(__file__).resolve().parents[3]
    return (repo if (repo / "pyproject.toml").is_file() else Path.cwd()) / "data" / "siap"


def _atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=path.name + ".", suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    except BaseException:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(tmp)
        raise


class SiapStore:
    def __init__(self, root: str | Path | None = None):
        self.root = Path(root) if root is not None else default_root()

    # ---- paths / manifest -------------------------------------------------
    @property
    def manifest_path(self) -> Path:
        return self.root / "manifest.json"

    def parquet_path(self, dataset: str, year: int) -> Path:
        return self.root / "parquet" / dataset / f"{int(year)}.parquet"

    def manifest(self) -> dict:
        if not self.manifest_path.is_file():
            return {"datasets": {}}
        return json.loads(self.manifest_path.read_text(encoding="utf-8"))

    def available_years(self, dataset: str) -> list[int]:
        return sorted(int(y) for y in self.manifest().get("datasets", {}).get(dataset, {}))

    @contextlib.contextmanager
    def _lock(self) -> Iterator[None]:
        self.root.mkdir(parents=True, exist_ok=True)
        with open(self.root / ".lock", "w") as fh:
            if fcntl is not None:
                fcntl.flock(fh, fcntl.LOCK_EX)  # blocks until a concurrent sync finishes
            try:
                yield
            finally:
                if fcntl is not None:
                    fcntl.flock(fh, fcntl.LOCK_UN)

    # ---- sync ---------------------------------------------------------------
    def sync(self, client: SiapClient, datasets: Iterable[str] = ("municipal",),
             years: Iterable[int] | None = None, refresh: bool = False) -> dict[str, dict[int, str]]:
        """Download missing years. ``refresh`` re-downloads and replaces a year only if its bytes changed.

        Returns ``{dataset: {year: status}}`` with status in
        ``downloaded | updated | unchanged | skipped | unavailable | failed: <reason>``.
        One bad year never aborts the rest.
        """
        wanted = None if years is None else sorted({int(y) for y in years})
        report: dict[str, dict[int, str]] = {}
        with self._lock():
            for key in datasets:
                ds = get_dataset(key)
                report[key] = {}
                for year in (wanted if wanted is not None else list(ds.years())):
                    if wanted is not None and year not in ds.years():
                        report[key][year] = "unavailable"
                        continue
                    report[key][year] = self._sync_year(client, ds, year, refresh)
        return report

    def _sync_year(self, client: SiapClient, ds: SiapDataset, year: int, refresh: bool) -> str:
        entry = self.manifest().get("datasets", {}).get(ds.key, {}).get(str(year))
        if entry and not refresh and self.parquet_path(ds.key, year).is_file():
            return "skipped"
        try:
            dl = client.fetch_year(ds, year)
            sha = hashlib.sha256(dl.content).hexdigest()
            if entry and entry["sha256"] == sha and self.parquet_path(ds.key, year).is_file():
                return "unchanged"
            df, cleaning = clean(parse_csv(dl.content, ds.required_columns))
            if (df["year"].dropna() != year).any():
                raise SiapFormatError(f"file for {year} contains other years: {sorted(df['year'].dropna().unique())[:5]}")
        except SiapYearNotAvailable:
            return "unavailable"
        except Exception as exc:  # SiapFormatError, requests/network errors: record and continue
            return f"failed: {type(exc).__name__}: {str(exc)[:160]}"
        raw_name = dl.filename or f"{ds.key}_{year}.csv"
        _atomic_write(self.root / "raw" / ds.key / os.path.basename(raw_name), dl.content)
        pq = self.parquet_path(ds.key, year)
        pq.parent.mkdir(parents=True, exist_ok=True)
        tmp = pq.with_suffix(".parquet.tmp")
        df.to_parquet(tmp, index=False)
        os.replace(tmp, pq)
        self._record(ds, year, dl.url, len(dl.content), sha, cleaning, raw_name)
        return "updated" if entry else "downloaded"

    def _record(self, ds: SiapDataset, year: int, url: str, nbytes: int, sha: str, cleaning: dict,
                raw_name: str, fetched_at: str | None = None) -> None:
        now = datetime.now(timezone.utc).isoformat(timespec="seconds")
        manifest = self.manifest()
        manifest.setdefault("datasets", {}).setdefault(ds.key, {})[str(year)] = {
            "sha256": sha, "bytes": nbytes, "source_url": url, "raw_file": os.path.basename(raw_name),
            "fetched_at": fetched_at or now, "cleaned_at": now, "cleaning": cleaning,
        }
        manifest["schema_version"] = 1
        _atomic_write(self.manifest_path, json.dumps(manifest, indent=2, sort_keys=True).encode("utf-8"))

    def rebuild(self, datasets: Iterable[str] | None = None, years: Iterable[int] | None = None) -> dict[str, dict[int, str]]:
        """Re-parse and re-clean the stored raw CSVs (no network). Use after the cleaning rules change."""
        report: dict[str, dict[int, str]] = {}
        wanted = None if years is None else {int(y) for y in years}
        with self._lock():
            for key in (list(datasets) if datasets else list(DATASETS)):
                ds = get_dataset(key)
                report[key] = {}
                for year in self.available_years(key):
                    if wanted is not None and year not in wanted:
                        continue
                    entry = self.manifest()["datasets"][key][str(year)]
                    try:
                        raw = (self.root / "raw" / key / entry["raw_file"]).read_bytes()
                        df, cleaning = clean(parse_csv(raw, ds.required_columns))
                        pq = self.parquet_path(key, year)
                        tmp = pq.with_suffix(".parquet.tmp")
                        df.to_parquet(tmp, index=False)
                        os.replace(tmp, pq)
                        self._record(ds, year, entry["source_url"], entry["bytes"], entry["sha256"], cleaning,
                                     entry["raw_file"], fetched_at=entry["fetched_at"])
                        report[key][year] = "rebuilt"
                    except Exception as exc:
                        report[key][year] = f"failed: {type(exc).__name__}: {str(exc)[:160]}"
        return report

    def sync_dictionary(self, client: SiapClient) -> Path:
        dl = client.fetch_dictionary()
        path = self.root / "dictionary" / "Diccionario_agricola.xlsx"
        with self._lock():
            _atomic_write(path, dl.content)
        return path

    # ---- read ---------------------------------------------------------------
    def load(self, dataset: str = "municipal", years: Iterable[int] | None = None,
             state: str | None = None, crop: str | None = None, columns: list[str] | None = None) -> pd.DataFrame:
        """Load normalized rows from local Parquet (never touches the network).

        ``state``/``crop`` are case-insensitive exact matches on the Spanish names, e.g. ``"Guanajuato"``.
        """
        get_dataset(dataset)
        have = self.available_years(dataset)
        use = have if years is None else [y for y in sorted({int(y) for y in years}) if y in have]
        if not use:
            raise FileNotFoundError(f"no local SIAP data for {dataset!r} (years={years}); run sync first")
        read_cols = columns
        if columns is not None:
            read_cols = list(dict.fromkeys([*columns, *(["state"] if state else []), *(["crop"] if crop else [])]))
        frames = [pd.read_parquet(self.parquet_path(dataset, y), columns=read_cols) for y in use]
        df = pd.concat(frames, ignore_index=True)
        if state is not None:
            df = df[df["state"].str.casefold() == state.casefold()]
        if crop is not None:
            df = df[df["crop"].str.casefold() == crop.casefold()]
        if columns is not None:
            df = df[columns]
        return df.reset_index(drop=True)


__all__ = ["SiapStore", "default_root", "DATASETS", "CLEANING_VERSION"]
