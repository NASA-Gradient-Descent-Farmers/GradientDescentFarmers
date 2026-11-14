"""CLI: ``python -m gradientdescentfarmers.source_builder.siap {sync,rebuild,status,discover} ...``"""
from __future__ import annotations

import argparse
import json
import sys

from .catalog import DATASETS
from .client import SiapClient, SiapSettings
from .store import SiapStore


def _years(text: str | None) -> list[int] | None:
    if not text:
        return None
    out: list[int] = []
    for part in text.split(","):
        a, _, b = part.partition("-")
        out.extend(range(int(a), int(b or a) + 1))
    return out


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="siap", description=__doc__)
    p.add_argument("--root", help="data directory (default: $SIAP_DATA_DIR or data/siap)")
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("sync", help="download missing years")
    s.add_argument("--dataset", action="append", choices=sorted(DATASETS), help="repeatable; default municipal")
    s.add_argument("--years", help="e.g. 2019-2025 or 2023,2025; default: all years of the dataset")
    s.add_argument("--refresh", action="store_true", help="re-download and replace years whose content changed")
    s.add_argument("--dictionary", action="store_true", help="also fetch the data dictionary .xlsx")
    r = sub.add_parser("rebuild", help="re-clean stored raw CSVs without downloading")
    r.add_argument("--dataset", action="append", choices=sorted(DATASETS))
    r.add_argument("--years")
    sub.add_parser("status", help="show what is stored locally")
    sub.add_parser("discover", help="compare the live listing page with the built-in catalog")
    args = p.parse_args(argv)
    store = SiapStore(args.root)

    if args.cmd == "status":
        print(json.dumps({d: store.available_years(d) for d in DATASETS}, indent=2))
        return 0
    if args.cmd == "rebuild":
        report = store.rebuild(args.dataset, _years(args.years))
        for key, years in report.items():
            for year, status in years.items():
                print(f"{key} {year}: {status}")
        return 1 if any(s.startswith("failed") for y in report.values() for s in y.values()) else 0
    client = SiapClient(SiapSettings())
    if args.cmd == "discover":
        live = client.discover()
        drift = False
        for ds in DATASETS.values():
            years = live.get(ds.view_id)
            if years is None:
                print(f"{ds.key}: view id {ds.view_id} NOT FOUND on page")
                drift = True
            elif years != list(ds.years()):
                print(f"{ds.key}: live years {years[0]}-{years[-1]} differ from catalog {ds.first_year}-{ds.last_year}")
                drift = True
            else:
                print(f"{ds.key}: ok ({ds.first_year}-{ds.last_year})")
        return 1 if drift else 0

    report = store.sync(client, args.dataset or ["municipal"], _years(args.years), refresh=args.refresh)
    if args.dictionary:
        print("dictionary:", store.sync_dictionary(client))
    failed = 0
    for key, years in report.items():
        for year, status in years.items():
            print(f"{key} {year}: {status}")
            failed += status.startswith("failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
