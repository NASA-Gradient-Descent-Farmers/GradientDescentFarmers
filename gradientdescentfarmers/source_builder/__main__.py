"""Command-line entry point for the team's scientific source builder."""
import argparse
import json
from .adapter import NASAProfileSourceBuilder,load_source_config

def main(argv=None):
    parser=argparse.ArgumentParser()
    parser.add_argument("--config",required=True,help="Pipeline JSON config with source/model/optimizer")
    parser.add_argument("--run",action="store_true",help="Explicitly enable external data acquisition")
    args=parser.parse_args(argv)
    config=load_source_config(args.config)
    config["run"]=args.run
    result=NASAProfileSourceBuilder().build(config)
    summary={key:value for key,value in result.items() if key!="tables"}
    print(json.dumps(summary,ensure_ascii=False,indent=2))
    return 1 if args.run and result["build_state"]=="failed" else 0

if __name__ == "__main__":
    raise SystemExit(main())
