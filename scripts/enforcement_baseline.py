"""Fetch the pinned enforcement baseline once; consumers verify and read it offline."""
import io
import json
from pathlib import Path
import shutil
import tempfile
import zipfile

import catalog
from previous_stable import previous_download
from release_state import GitHub, digest, filename, public_package, require

ROOT = Path(__file__).resolve().parents[1]
VERSION = '0.4.8'
SHA256 = '06f33f62d06d864b63c879213ec1b3536d81c8ebb0ab7ac186b6820580aa24d5'
FOLDER = ROOT / 'artifacts/enforcement-baseline'
ARCHIVE = FOLDER / filename(VERSION)


def load(path=ARCHIVE):
    """No network fallback. Check the fixed ZIP pin before opening or extracting it."""
    require(path.is_file(), 'Shared enforcement baseline is missing. Run python3 scripts/enforcement_baseline.py '
            'during setup, or download this run/attempt\'s enforcement-baseline artifact.')
    content = path.read_bytes()
    require(digest(content) == SHA256, 'Shared enforcement baseline ZIP SHA-256 differs from the v0.4.8 pin.')
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        require(archive.namelist() == [catalog.DLL, 'LICENSE'], 'Unexpected enforcement baseline package contents.')
        dll = archive.read(catalog.DLL)
    require(bool(dll), 'Empty enforcement baseline DLL.')
    return dll, dict(version=VERSION, filename=filename(VERSION), zipSha256=SHA256,
                     dllSha256=digest(dll), source='shared-local-zip', pinVerifiedBeforeExtraction=True)


def fetch(api, manifest, folder=FOLDER):
    catalog.validate(manifest)
    entries = [v for p in manifest for v in p['versions'] if v['version'] == VERSION + '.0']
    require(len(entries) == 1, 'Missing or duplicate published enforcement baseline catalog entry.')
    release = api.release(VERSION, public_only=True)
    # Reuse PR #72's one-public/three-API transport with one shared deadline.
    download = previous_download(api, release, VERSION)
    matches = [a for a in release['assets'] if a['name'] == filename(VERSION)]
    require(len(matches) == 1, 'Missing enforcement baseline ZIP asset.')
    asset = matches[0]
    require(asset.get('digest') == 'sha256:' + SHA256, 'Published enforcement baseline digest differs from the fixed pin.')
    with tempfile.TemporaryDirectory(prefix='watchguard-enforcement-baseline-') as temp:
        path = public_package(api, release, VERSION, Path(temp), download=download)
        _, identity = load(path)
        expected = catalog.entry(path, asset['browser_download_url'], release['published_at'], VERSION + '.0')
        require(catalog.installation(entries[0]) == catalog.installation(expected),
                'Enforcement baseline catalog metadata differs from public release.')
        identity.update(releaseId=release['id'], assets=[dict(id=a['id'], name=a['name'], digest=a['digest'])
                                                      for a in release['assets']], catalog=entries[0])
        folder.mkdir(parents=True, exist_ok=True)
        for source in (path, path.with_suffix('.zip.sha256')):
            shutil.copyfile(source, folder / source.name)
        (folder / 'identity.json').write_text(json.dumps(identity, indent=2) + '\n')
    print('Verified shared enforcement baseline v' + VERSION + ': ' + SHA256)
    return identity


def main():
    fetch(GitHub('MajorSchloch/jellyfin-plugin-watchguard'), json.loads((ROOT / 'manifest.json').read_text()))


if __name__ == '__main__':
    main()
