"""Hosted read-only proof: inject public 504s, fetch real anonymous API bytes."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
from unittest.mock import patch
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import catalog
import previous_stable as stable
from release_state import GitHub, candidate, digest, require


def main():
    api = GitHub('MajorSchloch/jellyfin-plugin-watchguard')
    manifest = json.loads(Path('manifest.json').read_text())
    version = candidate()
    original = stable.download_once
    transfers = []
    started = time.monotonic()

    def controlled(url, path, *, deadline, api=False):
        begin = time.monotonic()
        if not api:
            transfers.append(dict(route='public', asset=path.name, status=504, controlled=True))
            raise subprocess.CalledProcessError(22, ['controlled-public-504'], output='504')
        original(url, path, deadline=deadline, api=True)
        transfers.append(dict(route='anonymous-api', asset=path.name, assetId=int(url.rsplit('/', 1)[1]),
                              bytes=path.stat().st_size, sha256=digest(path.read_bytes()),
                              seconds=round(time.monotonic() - begin, 3), controlled=False))

    with tempfile.TemporaryDirectory(prefix='watchguard-previous-probe-') as temp:
        with patch.object(stable, 'download_once', side_effect=controlled):
            identity = stable.retrieve(api, manifest, version, Path(temp))
        require(len(transfers) == 4 and sum(t['controlled'] for t in transfers) == 2,
                'Expected one controlled 504 and one real API transfer for each asset.')
        with zipfile.ZipFile(Path(temp) / identity['filename']) as package:
            dll_sha = digest(package.read(catalog.DLL))
    record = dict(commit=os.environ.get('GITHUB_SHA'), run=os.environ.get('GITHUB_RUN_ID'),
                  attempt=os.environ.get('GITHUB_RUN_ATTEMPT'), image=os.environ.get('ImageVersion'),
                  candidate=version, previous=identity, dllSha256=dll_sha, transfers=transfers,
                  seconds=round(time.monotonic() - started, 3),
                  limitation='Public 504s are injected. API asset bytes and all release/package/catalog checks are real. No native compatibility tests.')
    output = Path('artifacts/previous-stable-download-probe.json')
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(record, indent=2) + '\n')
    print(output.read_text())
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as summary:
            summary.write(f"## Previous-stable fallback verified\n\nInjected public HTTP 504; real anonymous API downloads.\n\n"
                          f"- Version: {identity['version']}\n- ZIP SHA-256: `{identity['sha256']}`\n"
                          f"- DLL SHA-256: `{dll_sha}`\n- Elapsed: {record['seconds']}s\n")


if __name__ == '__main__':
    main()
