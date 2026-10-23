#!/usr/bin/env python3
"""Validate Jellyfin catalog data; add entries only from existing public release assets."""
import argparse
from datetime import datetime
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tempfile
from urllib.parse import urlparse
import zipfile

GUID = 'a3c6bc84-783d-4ba8-a0db-89bfb83ab486'
ABI = '12.2.0.0'
DLL = 'Jellyfin.Plugin.WatchGuard.dll'


def inspect_zip(path):
    content = Path(path).read_bytes()
    with zipfile.ZipFile(path) as archive:
        if archive.namelist() != [DLL, 'LICENSE'] or not archive.read(DLL):
            raise ValueError('ZIP must contain only the runtime DLL and LICENSE at its root')
    return hashlib.md5(content).hexdigest(), hashlib.sha256(content).hexdigest()


def entry(path, url, timestamp, version='0.7.3.0'):
    md5, _ = inspect_zip(path)
    return {'version': version, 'changelog': 'See the matching release notes.', 'targetAbi': ABI,
            'sourceUrl': url, 'checksum': md5, 'timestamp': timestamp}


def package(versions):
    return {'guid': GUID, 'name': 'WatchGuard', 'overview': 'Personal watchlists, Web warnings and opt-in HTTP deletion enforcement.',
            'description': 'Standalone Web loader. Server enforcement defaults off; opt-in protection covers only qualified native item deletion HTTP routes and requires administrator approval for protected media. External file changes are not protected.',
            'owner': 'MajorSchloch', 'category': 'General', 'versions': versions}


def validate(data, allow_local=False):
    if not isinstance(data, list) or len(data) > 1:
        raise ValueError('Expected a repository array with at most one WatchGuard package')
    if not data: return # No public release exists yet; do not advertise speculative assets.
    item = data[0]
    if item.get('guid') != GUID or item.get('name') != 'WatchGuard': raise ValueError('Plugin identity changed')
    for field in ['overview', 'description', 'owner', 'category']:
        if not isinstance(item.get(field), str) or not item[field]: raise ValueError('Missing package metadata')
    if not isinstance(item.get('versions'), list) or not item['versions']: raise ValueError('Missing versions')
    seen = set()
    for v in item['versions']:
        version = v.get('version', '')
        if not re.fullmatch(r'\d+\.\d+\.\d+\.\d+', version) or version in seen: raise ValueError('Invalid/duplicate version')
        seen.add(version)
        if v.get('targetAbi') != ABI: raise ValueError('Unsupported ABI')
        if not re.fullmatch(r'[a-fA-F0-9]{32}', v.get('checksum', '')): raise ValueError('Catalog checksum must be MD5')
        date = datetime.fromisoformat(v['timestamp'].replace('Z', '+00:00'))
        if date.tzinfo is None: raise ValueError('Timestamp requires timezone')
        url = urlparse(v['sourceUrl'])
        if url.username or url.password or url.query or url.fragment: raise ValueError('Unexpected URL credentials/query')
        public = url.scheme == 'https' and url.netloc == 'github.com' and '/releases/download/' in url.path
        local = allow_local and url.scheme == 'http' and url.hostname in ['127.0.0.1', 'host.docker.internal']
        if not (public or local) or not url.path.endswith('.zip'): raise ValueError('Expected a release ZIP URL')


def download(url, path):
    subprocess.run(['curl', '--fail', '--silent', '--show-error', '--location', '--retry', '2', '--output', str(path), url], check=True)


def add_release(manifest, repo, tag, archive):
    if not re.fullmatch(r'[\w.-]+/[\w.-]+', repo) or not re.fullmatch(r'v\d+\.\d+\.\d+', tag): raise ValueError('Invalid repository/tag')
    with tempfile.TemporaryDirectory(prefix='watchguard-catalog-') as temp:
        folder = Path(temp)
        # Anonymous requests deliberately reject private repositories and draft releases.
        download(f'https://api.github.com/repos/{repo}/releases/tags/{tag}', folder/'release.json')
        release = json.loads((folder/'release.json').read_text())
        if release['draft'] or release['prerelease'] or not release['published_at']: raise ValueError('Release must already be public and stable')
        expected = f'Jellyfin.Plugin.WatchGuard-{tag}.zip'
        asset = next(a for a in release['assets'] if a['name'] == expected)
        url = asset['browser_download_url']
        if not url.startswith(f'https://github.com/{repo}/releases/download/{tag}/'): raise ValueError('Asset repository mismatch')
        download(url, folder/expected)
        if (folder/expected).read_bytes() != Path(archive).read_bytes(): raise ValueError('Public ZIP differs from validated local ZIP')
        checksum_asset = next(a for a in release['assets'] if a['name'] == expected+'.sha256')
        checksum_url = checksum_asset['browser_download_url']
        if not checksum_url.startswith(f'https://github.com/{repo}/releases/download/{tag}/'): raise ValueError('Checksum repository mismatch')
        download(checksum_url, folder/'checksum')
        if (folder/'checksum').read_text().split() != [inspect_zip(archive)[1], expected]: raise ValueError('Public SHA-256 mismatch')
        data = json.loads(Path(manifest).read_text()); validate(data)
        versions = data[0]['versions'] if data else []
        new = entry(archive, url, release['published_at'], tag[1:]+'.0')
        previous = next((v for v in versions if v['version'] == new['version']), None)
        if previous and previous != new: raise ValueError('Published version is immutable')
        versions = [v for v in versions if v['version'] != new['version']] + [new]
        versions.sort(key=lambda v: tuple(map(int, v['version'].split('.'))), reverse=True)
        data = [package(versions)]; validate(data)
        Path(manifest).write_text(json.dumps(data, indent=2)+'\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', default='manifest.json')
    parser.add_argument('--zip', type=Path)
    parser.add_argument('--from-release', nargs=2, metavar=('REPOSITORY', 'TAG'))
    args = parser.parse_args()
    if args.from_release:
        if not args.zip: parser.error('--from-release requires --zip')
        add_release(args.manifest, *args.from_release, args.zip)
    validate(json.loads(Path(args.manifest).read_text()))
    if args.zip:
        md5, sha = inspect_zip(args.zip)
        if args.zip.with_suffix('.zip.sha256').read_text().split() != [sha, args.zip.name]: raise ValueError('SHA-256 sidecar mismatch')
        print('Validated ZIP: MD5='+md5+' SHA-256='+sha)
    print('Catalog valid; only existing published versions are advertised.')
