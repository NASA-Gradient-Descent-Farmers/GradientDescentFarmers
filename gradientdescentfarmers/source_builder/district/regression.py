"""Compare a district panel run with field-shift's published tables (NASA-warm-up `data/shared/rotations_*`).

    python -m gradientdescentfarmers.source_builder.district.regression \
        --run data/processed/districts_regression/runs/<run_id> --fieldshift ../NASA-warm-up/data/shared

To reproduce field-shift exactly, build the run with `district_membership: "primary"` and
`et0_wind: "fao_default"`; any remaining difference is a bug until explained. With the defaults
("shared", "power") the differences show the effect of those two changes.
"""
from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import pandas as pd

from .builder import KEYS

PAIRS = ["siap_crop_years", "municipality_districts", "climate_municipal", "climate_municipal_years",
         "climate_district", "climate_district_years", "observed_municipal", "observed_district",
         "grace_municipal", "grace_district", "grace_years", "soil_municipal"]


def compare(run_dir: Path, fieldshift: Path) -> pd.DataFrame:
    run_dir, fieldshift = Path(run_dir), Path(fieldshift)
    rows = []
    for name in PAIRS:
        ours_path, theirs_path = run_dir / "tables" / f"{name}.parquet", fieldshift / f"rotations_{name}.parquet"
        if not ours_path.is_file() or not theirs_path.is_file():
            rows.append({"table": name, "column": "", "status": "skipped (table missing)"})
            continue
        ours, theirs = pd.read_parquet(ours_path), pd.read_parquet(theirs_path)
        keys = [k for k in KEYS[name] if k in ours and k in theirs]
        theirs = theirs.astype({k: ours[k].dtype for k in keys})
        if name == "municipality_districts":
            m = ours.merge(theirs, on=keys, suffixes=("", "_fs"))
            agree = (m["ddr"] == m["ddr_fs"]).mean()
            rows.append({"table": name, "column": "ddr", "rows_compared": len(m), "share_equal": round(float(agree), 4),
                         "status": "ok" if agree == 1 else "differs"})
            continue
        m = ours.merge(theirs, on=keys, suffixes=("", "_fs"))
        if m.empty:
            rows.append({"table": name, "column": "", "status": "no common keys"})
            continue
        for col in [c for c in ours.columns if c not in keys and f"{c}_fs" in m and ours[c].dtype.kind in "fib"]:
            a, b = m[col].astype(float), m[f"{col}_fs"].astype(float)
            ok = a.notna() & b.notna()
            diff = (a - b).abs()[ok]
            scale = b.abs()[ok].replace(0, np.nan)
            rel = (diff / scale).replace([np.inf], np.nan)
            rows.append({"table": name, "column": col, "rows_compared": int(ok.sum()),
                         "max_abs_diff": float(diff.max()) if len(diff) else np.nan,
                         "median_rel_diff": float(rel.median()) if rel.notna().any() else 0.0,
                         "max_rel_diff": float(rel.max()) if rel.notna().any() else 0.0,
                         "missing_mismatch": int((a.isna() != b.isna()).sum()),
                         "status": "ok" if (len(diff) == 0 or diff.max() <= 1e-6 * max(1.0, float(b.abs().max())))
                         and (a.isna() == b.isna()).all() else "differs"})
    return pd.DataFrame(rows)


def main(argv=None):
    p = argparse.ArgumentParser()
    p.add_argument("--run", required=True)
    p.add_argument("--fieldshift", required=True, help="NASA-warm-up data/shared folder")
    p.add_argument("--out", help="CSV path for the report")
    args = p.parse_args(argv)
    report = compare(Path(args.run), Path(args.fieldshift))
    with pd.option_context("display.max_rows", 200, "display.width", 200):
        print(report.to_string(index=False))
    if args.out:
        report.to_csv(args.out, index=False)


if __name__ == "__main__":
    main()
