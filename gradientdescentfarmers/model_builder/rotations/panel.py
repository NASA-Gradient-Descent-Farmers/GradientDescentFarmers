"""Where the engine reads its data: one district panel run from source_builder.district.

    from gradientdescentfarmers.model_builder.rotations import panel
    panel.use("data/processed/districts/runs/<run_id>")      # or the folder `latest.json` points to

Every table the engine reads comes from `<run>/tables/<name>.parquet`; see
source_builder/district/DISTRICT_PANEL_CONTRACT.md. This replaces field-shift's fixed `data/rotations/` and
`data/shared/` paths (src/rotations/siap_stats.read), so the engine never reads data it was not given.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

import numpy as np
import pandas as pd

_RUN: Path | None = None


def resolve(path) -> Path:
    """A run folder, a tables folder, or an output root with latest.json -> the run folder."""
    p = Path(path)
    if (p / "latest.json").is_file() and not (p / "tables").is_dir():
        p = Path(json.loads((p / "latest.json").read_text(encoding="utf-8"))["path"])
    if p.name == "tables" and not (p / "tables").is_dir():
        p = p.parent
    if not (p / "tables").is_dir():
        raise FileNotFoundError(f"{p} is not a district panel run (no tables/ folder)")
    return p


def use(path) -> Path:
    """Point the engine at a panel run. Clears every cached table."""
    global _RUN
    _RUN = resolve(path)
    _read.cache_clear()
    from . import places

    for f in (places._siap, places._districts, places._observed, places._climate):
        f.cache_clear()
    return _RUN


def current() -> Path:
    if _RUN is None:
        raise RuntimeError("No district panel selected: call rotations.panel.use(<run folder>) first")
    return _RUN


@lru_cache(maxsize=None)
def _read(run: str, name: str) -> pd.DataFrame:
    path = Path(run) / "tables" / f"{name}.parquet"
    if not path.is_file():
        raise FileNotFoundError(f"{name}: not in panel run {run}")
    return pd.read_parquet(path)


def read(name: str) -> pd.DataFrame:
    """A panel table. Raises FileNotFoundError when the run does not have it (e.g. built without Earthdata)."""
    return _read(str(current()), name)


def load_siap() -> pd.DataFrame:
    return add_outcomes(read("siap_crop_years"))


def load_districts() -> pd.DataFrame:
    return read("municipality_districts")


def add_outcomes(table: pd.DataFrame) -> pd.DataFrame:
    """Per-row production per sown hectare, failure share and price (MXN per tonne)."""
    t = table.copy()
    sown = t["sown_ha"].where(t["sown_ha"] > 0)
    t["prod_per_sown"] = t["production_t"] / sown           # counts lost area as zero production
    t["yield_t_ha"] = t["production_t"] / t["harvested_ha"].where(t["harvested_ha"] > 0)
    t["failure"] = (t["lost_ha"] / sown).clip(0, 1)
    t["price"] = t["value_mxn"] / t["production_t"].where(t["production_t"] > 0)
    return t


def climate(level: str = "district", yearly: bool = False) -> pd.DataFrame:
    return read(f"climate_{level}{'_years' if yearly else ''}")


def observed(level: str = "district") -> pd.DataFrame:
    return read(f"observed_{level}")


def finite(value) -> bool:
    try:
        return bool(np.isfinite(float(value)))
    except (TypeError, ValueError):
        return False
