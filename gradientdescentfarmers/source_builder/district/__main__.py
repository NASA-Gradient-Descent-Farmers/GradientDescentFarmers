"""python -m gradientdescentfarmers.source_builder.district --config resources/district_three_sites.json [--run]"""
import argparse
import json

from . import DistrictPanelSourceBuilder, load_config


def main(argv=None):
    parser = argparse.ArgumentParser(description="Build the district panel for the rotation engine")
    parser.add_argument("--config", required=True, help="JSON file with a 'source' object")
    parser.add_argument("--run", action="store_true", help="Download data and build (default: preview only)")
    parser.add_argument("--only", nargs="+", help="Enable only these sources (siap and power always run)")
    args = parser.parse_args(argv)
    config = load_config(args.config)
    config["run"] = args.run
    if args.only:
        from .common import SOURCES
        config["sources"] = {k: k in args.only for k in SOURCES}
    result = DistrictPanelSourceBuilder().build(config)
    print(json.dumps(result, ensure_ascii=False, indent=2, default=str))
    return 1 if args.run and result.get("build_state") == "failed" else 0


if __name__ == "__main__":
    raise SystemExit(main())
