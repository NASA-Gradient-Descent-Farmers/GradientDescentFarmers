"""Non-destructive, resumable Earthdata HDF5 recovery.

Original cache files are NEVER replaced/deleted. Replacements are written in
fresh recovery/attempt-N folders; existing valid files are reused. A timeout on
a local file is treated as UNREADABLE (not proof of corruption).
"""
from __future__ import annotations

import re
from pathlib import Path
from urllib.parse import unquote, urlparse


class GranuleRecovery:
    def __init__(self, directory: str | Path, required_groups: tuple[str, ...], retries: int = 1, recovery_root: str | Path | None = None):
        self.directory = Path(directory)
        self.recovery_root = Path(recovery_root) if recovery_root is not None else self.directory / "recovery"
        self.required_groups = required_groups
        self.retries = max(0, min(int(retries), 3))
        self.last_report: dict = {}

    @staticmethod
    def filename(granule) -> str:
        links = granule.data_links(access="external")
        candidates = []
        for link in links:
            parsed = urlparse(link)
            name = unquote(parsed.path.rsplit("/", 1)[-1])
            if parsed.scheme == "https" and name.lower().endswith((".h5", ".hdf5")):
                if name != Path(name).name or "/" in name or "\\" in name:
                    raise ValueError("Unsafe CMR filename")
                candidates.append(name)
        names = list(dict.fromkeys(candidates))
        if len(names) != 1:
            raise ValueError("Expected exactly one HDF5 science file link per CMR granule")
        return names[0]

    def check(self, path: Path) -> str:
        """valid, unreadable or invalid; never mutate path.

        A local OS timeout is NOT classified as permanent HDF5 corruption.
        """
        import h5py
        try:
            if not path.is_file() or path.stat().st_size < 4096:
                return "invalid"
            if not h5py.is_hdf5(str(path)):
                return "invalid"
            with h5py.File(path, "r") as src:
                for group in self.required_groups:
                    if group not in src:
                        return "invalid"
                if "Grid" in self.required_groups:
                    grid = src["Grid"]
                    if not all(key in grid for key in ("lat", "lon")):
                        return "invalid"
                    if "precipitation" not in grid and "precipitationCal" not in grid:
                        return "invalid"
                if "Geophysical_Data" in self.required_groups:
                    grid = src["Geophysical_Data"]
                    if not all(key in grid for key in ("sm_surface", "sm_rootzone", "sm_rootzone_pctl")):
                        return "invalid"
            return "valid"
        except (TimeoutError, OSError) as exc:
            if isinstance(exc, TimeoutError) or "timed out" in str(exc).lower():
                return "unreadable"
            return "invalid"
        except (ValueError, KeyError):
            return "invalid"

    def _copies(self, filename: str) -> list[Path]:
        """Prefer successful recovery, then inspect original."""
        recovery = self.recovery_root
        copies = sorted(
            recovery.glob(f"attempt-*/{filename}"),
            key=lambda path: path.stat().st_mtime,
            reverse=True,
        ) if recovery.is_dir() else []
        return copies + [self.directory / filename]

    def _cached(self, name: str) -> tuple[Path | None, bool]:
        unreadable = False
        for path in self._copies(name):
            state = self.check(path)
            if state == "valid":
                return path, unreadable
            if state == "unreadable":
                unreadable = True
        return None, unreadable

    def inspect(self, granules) -> dict:
        """Read-only inspection. No automatic redownload of unreadable files."""
        names = [self.filename(g) for g in granules]
        if len(set(names)) != len(names):
            raise ValueError("CMR contains duplicate granules")
        present, invalid, unreadable = {}, [], []
        for name in names:
            hit, timed_out = self._cached(name)
            if hit is not None:
                present[name] = str(hit)
            elif timed_out:
                unreadable.append(name)
            else:
                invalid.append(name)
        return {"expected": len(names), "valid": present,
                "invalid": invalid, "unreadable": unreadable}

    def _new_attempt(self) -> Path:
        root = self.recovery_root
        root.mkdir(parents=True, exist_ok=True)
        index = 1
        while (root / f"attempt-{index:04d}").exists():
            index += 1
        path = root / f"attempt-{index:04d}"
        path.mkdir(parents=True, exist_ok=False)
        return path

    def acquire(self, earthaccess, granules, *, retry_unreadable: bool = False) -> list[Path]:
        """Download only missing/invalid; opt in to replacing inaccessible local copies.

        Each download gets a NEW destination so earthaccess never silently
        skips or overwrites a truncated original. Saves progress if a later
        granule fails, and returns paths in CMR order.
        """
        granules = list(granules)
        names = [self.filename(g) for g in granules]
        if len(set(names)) != len(names):
            raise ValueError("CMR contains duplicate science file names")
        selected = {}
        failures = {}
        reused = downloaded = 0
        unreadable_names = []
        for granule, name in zip(granules, names):
            previous, is_unreadable = self._cached(name)
            if previous is not None:
                selected[name] = previous
                reused += 1
                continue
            if is_unreadable and not retry_unreadable:
                unreadable_names.append(name)
                continue
            error = "missing or invalid HDF5"
            for _ in range(self.retries + 1):
                target_dir = self._new_attempt()
                try:
                    paths = earthaccess.download(
                        [granule], local_path=str(target_dir),
                        threads=1, show_progress=False,
                    )
                    target = target_dir / name
                    if target not in [Path(p) for p in paths]:
                        error = "expected HDF5 not returned by earthaccess"
                    elif self.check(target) != "valid":
                        error = "downloaded HDF5 is invalid or unreadable"
                    else:
                        selected[name] = target
                        downloaded += 1
                        break
                except (OSError, ConnectionError, TimeoutError, ValueError) as exc:
                    error = type(exc).__name__
            if name not in selected:
                failures[name] = error
        self.last_report = {
            "requested":len(names),"reused":reused,"recovered":downloaded,
            "unreadable":unreadable_names,"failed":failures,
        }
        if unreadable_names or failures:
            raise RuntimeError(
                f"Earthdata recovery incomplete: reused={reused}, recovered={downloaded}, "
                f"unreadable={len(unreadable_names)}, failed={len(failures)}. "
                "Originals and prior recovery attempts preserved. "
                "For unreadable files, use a non-synced cache and opt in to "
                "retry_unreadable only after confirming local storage issues."
            )
        return [selected[name] for name in names]
