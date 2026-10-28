"""Run balanced suites sequentially, preserving separate fixture/evidence ownership."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess

ROOT=Path(__file__).resolve().parents[1]
SHARDS=json.loads((ROOT/'scripts/qualification-shards.json').read_text())


def archive_suite(artifacts, suite):
    destination=artifacts/'suites'/suite
    destination.mkdir(parents=True,exist_ok=False)
    # Candidate/historical input ZIPs and the extracted Injector rollback DLL
    # remain available. Everything else belongs to this suite's evidence.
    for path in list(artifacts.iterdir()):
        if path.name in ('suites','WatchGuard','RollbackV031') or path.name.endswith(('.zip','.sha256')):
            continue
        shutil.move(str(path),str(destination/path.name))


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('shard',choices=SHARDS)
    args=parser.parse_args()
    for suite in SHARDS[args.shard]:
        result=subprocess.run(['python3','tests/run_suite.py',suite],env={**os.environ,
            'WATCHGUARD_SHARD':args.shard,
            'WATCHGUARD_PROXY_MATRIX':'1' if suite=='server-enforcement' and os.environ.get('WATCHGUARD_REQUIRE_PROXY_MATRIX')=='1' else '0'})
        # Keep the original paths while rendering diagnostics, then move all
        # results before another fixture can overwrite common report filenames.
        try:
            subprocess.run(['python3','tests/summarize_qualification.py'],check=True)
        finally:
            archive_suite(ROOT/'artifacts',suite)
        if result.returncode: raise SystemExit(result.returncode)

if __name__=='__main__': main()
