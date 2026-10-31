"""Read-only release inspection and bounded GitHub API operations."""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time
import xml.etree.ElementTree as ET

import catalog


class Blocked(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise Blocked(message)


def candidate(content=None):
    root = ET.fromstring(content) if content is not None else ET.parse('Directory.Build.props').getroot()
    version = root.findtext('./PropertyGroup/Version')
    require(bool(re.fullmatch(r'\d+\.\d+\.\d+', version or '')), 'Invalid candidate Version.')
    for field in ('AssemblyVersion', 'FileVersion'):
        require(root.findtext('./PropertyGroup/' + field) == version + '.0', 'Version metadata disagrees: ' + field)
    return version


def filename(version):
    return f'Jellyfin.Plugin.WatchGuard-v{version}.zip'


def digest(content):
    return hashlib.sha256(content).hexdigest()


class GitHub:
    def __init__(self, repo, writable=False):
        require(bool(re.fullmatch(r'[\w.-]+/[\w.-]+', repo)), 'Invalid repository.')
        self.repo, self.writable = repo, writable
        self.base = 'repos/' + repo
        self._draft_visibility = None

    def request(self, path, method='GET', data=None, binary=False, missing=False):
        require(method == 'GET' or self.writable, 'Read-only execution cannot write to GitHub.')
        args = ['gh', 'api', self.base + ('/' + path if path else ''), '--method', method]
        if binary and path.startswith('releases/assets/'):
            args += ['-H', 'Accept: application/octet-stream']
        if data is not None:
            args += ['--input', '-']
        result = subprocess.run(args, input=json.dumps(data).encode() if data is not None else None,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60)
        if result.returncode:
            if missing and b'HTTP 404' in result.stderr:
                return None
            raise Blocked('GitHub request failed: ' + path + ': ' + result.stderr.decode().strip())
        return result.stdout if binary else json.loads(result.stdout or b'null')

    def upload(self, release_id, path):
        require(self.writable, 'Read-only execution cannot upload assets.')
        require(isinstance(release_id, int), 'Invalid release ID.')
        require(bool(re.fullmatch(r'Jellyfin\.Plugin\.WatchGuard-v\d+\.\d+\.\d+\.zip(?:\.sha256)?', path.name)), 'Invalid asset name.')
        # Address the verified release ID. A tag lookup could select a different
        # draft if an external writer creates one after the state check.
        url = f'https://uploads.github.com/repos/{self.repo}/releases/{release_id}/assets?name={path.name}'
        subprocess.run(['gh', 'api', url, '--method', 'POST', '-H', 'Content-Type: application/octet-stream',
                        '--input', str(path)], check=True, stdout=subprocess.PIPE, timeout=60)

    def can_see_drafts(self):
        if self._draft_visibility is None:
            # GitHub's release list omits drafts without push permission. Never
            # treat an incomplete list as proof that no draft exists.
            self._draft_visibility = self.request('').get('permissions', {}).get('push') is True
        return self._draft_visibility

    def pages(self, path, key=None):
        rows = []
        for page in range(1, 101):
            batch = self.request(path + ('&' if '?' in path else '?') + f'per_page=100&page={page}')
            batch = batch[key] if key else batch
            rows += batch
            if len(batch) < 100:
                return rows
        raise Blocked('API inventory exceeds the bounded page limit: ' + path)

    def file(self, path, ref):
        value = self.request(f'contents/{path}?ref={ref}')
        return base64.b64decode(value['content']), value['sha']

    def tag(self, tag):
        value = self.request('git/ref/tags/' + tag, missing=True)
        if value is None:
            return None
        obj = value['object']
        for _ in range(5):
            if obj['type'] == 'commit':
                return obj['sha']
            require(obj['type'] == 'tag', 'Unsupported tag object.')
            obj = self.request('git/tags/' + obj['sha'])['object']
        raise Blocked('Tag indirection exceeds the limit.')

    def release(self, version, public_only=False):
        # Listing includes drafts for the authenticated operator. Reject ambiguity.
        matches = [r for r in self.pages('releases') if r['tag_name'] == 'v' + version]
        published = [r for r in matches if not r['draft']]
        if public_only and len(published) == 1:
            self.preserved_drafts = [r['id'] for r in matches if r['draft']]
            matches = published
        require(len(matches) <= 1, 'Multiple releases use this tag. Inspect them manually.')
        if not matches:
            require(self.tag('v' + version) is None, 'Tag exists without a visible release. Check for a hidden draft; no overwrite is permitted.')
            return None
        release = matches[0]
        require(not release['prerelease'], 'Candidate tag belongs to a prerelease. Inspect it manually.')
        return release


def assets(release, version):
    expected = {filename(version), filename(version) + '.sha256'}
    result = {}
    for asset in release['assets']:
        require(asset['name'] in expected and asset['name'] not in result, 'Unexpected or duplicate release assets. Inspect them manually.')
        require(asset.get('state') == 'uploaded', 'Incomplete asset state. Inspect it manually; no replacement is permitted.')
        result[asset['name']] = asset
    return result


def public_package(api, release, version, folder):
    folder.mkdir(parents=True, exist_ok=True)
    files = assets(release, version)
    name = filename(version)
    require(set(files) == {name, name + '.sha256'}, 'Published release has missing assets. Resume with its explicit qualification run.')
    deadline = time.monotonic() + catalog.DOWNLOAD_BUDGET
    for asset in files.values():
        url = f'https://github.com/{api.repo}/releases/download/v{version}/' + asset['name']
        require(asset['browser_download_url'] == url, 'Unexpected asset URL.')
        target = folder / asset['name']
        catalog.download(url, target, deadline=deadline)
        content = target.read_bytes()
        require(len(content) == asset['size'], 'Public asset size differs: ' + asset['name'])
        require(asset.get('digest') == 'sha256:' + digest(content), 'Public asset digest differs: ' + asset['name'])
    archive = folder / name
    _, sha = catalog.inspect_zip(archive)
    require((folder / (name + '.sha256')).read_text().split() == [sha, name], 'Public SHA-256 sidecar mismatch.')
    return archive


def inspect(api, version, manifest):
    catalog.validate(manifest)
    release = api.release(version, public_only=True)
    entries = [v for p in manifest for v in p['versions'] if v['version'] == version + '.0']
    require(len(entries) <= 1, 'Duplicate catalog version.')
    if release is None:
        require(not entries, 'Catalog advertises a missing release.')
        return 'unpublished' if api.can_see_drafts() else 'unpublished-or-draft'
    if release['draft']:
        require(not entries, 'Catalog advertises a draft release.')
        assets(release, version)
        return 'draft'
    require(release['published_at'] and api.tag('v' + version), 'Published release has no timestamp or commit tag.')
    with tempfile.TemporaryDirectory() as temp:
        archive = public_package(api, release, version, Path(temp))
        if not entries:
            return 'catalog-missing'
        expected = catalog.entry(archive, release['assets'][0]['browser_download_url'], release['published_at'], version + '.0')
        expected['sourceUrl'] = f'https://github.com/{api.repo}/releases/download/v{version}/{filename(version)}'
        require(catalog.installation(entries[0]) == catalog.installation(expected), 'Catalog installation metadata conflicts with public release bytes or metadata.')
        require(entries[0]['changelog'] == expected['changelog'], 'Catalog release summary differs from its maintained source.')
    return 'complete'


def summary(state, action, **details):
    text = f'## {state}\n\n{action}\n'
    text += ''.join(f'\n- {key}: `{value}`' for key, value in details.items()) + '\n'
    print(text)
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as stream:
            stream.write(text)


def outputs(**values):
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a') as stream:
            for key, value in values.items():
                stream.write(f'{key}={str(value).lower() if isinstance(value, bool) else value}\n')
