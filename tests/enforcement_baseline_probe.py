"""Hosted proof: injected public 504, real pinned API bytes, offline/corrupt consumers."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import enforcement_baseline as baseline
import previous_stable
from release_state import Blocked, GitHub, digest, require


def main():
    original = previous_stable.download_once
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

    with tempfile.TemporaryDirectory(prefix='watchguard-baseline-probe-') as temp:
        folder = Path(temp)
        with patch.object(previous_stable, 'download_once', side_effect=controlled):
            identity = baseline.fetch(GitHub('MajorSchloch/jellyfin-plugin-watchguard'),
                                      json.loads(Path('manifest.json').read_text()), folder)
        require(len(transfers) == 4 and sum(t['controlled'] for t in transfers) == 2,
                'Expected one controlled 504 and one real API transfer for each asset.')
        archive = folder / identity['filename']
        with patch.object(previous_stable, 'download_once', side_effect=AssertionError('Consumer attempted a download')), \
             patch.object(GitHub, 'request', side_effect=AssertionError('Consumer attempted an API request')):
            for _ in range(4):
                dll, verified = baseline.load(archive)
                require(verified['zipSha256'] == baseline.SHA256 and digest(dll) == identity['dllSha256'],
                        'Offline consumer identity differs.')
            archive.write_bytes(archive.read_bytes() + b'controlled corruption')
            with patch.object(baseline.zipfile, 'ZipFile', side_effect=AssertionError('Corrupt ZIP opened before pin check')):
                try:
                    baseline.load(archive)
                except Blocked as error:
                    require('SHA-256 differs' in str(error), 'Unexpected corruption failure.')
                else:
                    raise AssertionError('Consumer accepted corrupt ZIP')
    record = dict(commit=os.environ.get('GITHUB_SHA'), run=os.environ.get('GITHUB_RUN_ID'),
                  attempt=os.environ.get('GITHUB_RUN_ATTEMPT'), image=os.environ.get('ImageVersion'),
                  baseline=identity, transfers=transfers, offlineConsumerReads=4,
                  corruptInputRejectedBeforeExtraction=True, seconds=round(time.monotonic() - started, 3),
                  limitation='Public 504s and corruption are injected. API bytes, pin and package/catalog checks are real. Native suite evidence is separate.')
    output = Path('artifacts/enforcement-baseline-probe.json')
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(record, indent=2) + '\n')
    print(output.read_text())


if __name__ == '__main__':
    main()
