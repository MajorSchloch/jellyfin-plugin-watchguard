"""State transitions use disposable assets. No tests write to GitHub."""
import base64
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import catalog
import publish_release as publisher
import qualification
import release_provenance as provenance
import release_state as state
import release_plan
import previous_stable

REPO = 'Fixture/WatchGuard'
COMMIT = 'a' * 40
VERSION = state.candidate()


class FakeGitHub(state.GitHub):
    def __init__(self, archive, record):
        super().__init__(REPO, writable=True)
        self.archive, self.record = archive, record
        self.repository = {"id": 7, "default_branch": "master"}
        self.notes_permission = True
        self.probes = []
        self.extra_releases = []
        self.list_error = None
        self.current = None
        self.tag_commit = None
        self.manifest = b'[]\n'
        self.manifest_sha = 'original'
        self.writes = []
        self.asset_content = {}
        self.fail_catalog = False
        self.change_before_write = False
        self.downloads = {'api': 0, 'public': 0}

    def tag(self, tag):
        return self.tag_commit

    def file(self, path, ref):
        if path == 'manifest.json':
            return self.manifest, self.manifest_sha
        if path == 'Directory.Build.props':
            return Path(path).read_bytes(), 'metadata'
        return b'# Release notes\n', 'notes'

    def request(self, path, method='GET', data=None, binary=False, missing=False):
        state.require(method == 'GET' or self.writable, 'Read-only execution cannot write to GitHub.')
        if path == 'releases/generate-notes' and method == 'POST':
            self.probes.append(copy.deepcopy(data))
            if not self.notes_permission:
                raise state.Blocked('GitHub request failed: releases/generate-notes: HTTP 403')
            return {'name': 'Generated title', 'body': 'Generated notes (never saved)'}
        if method != 'GET':
            self.writes.append((method, path))
        if path == '':
            return copy.deepcopy(self.repository)
        if path.startswith('releases?') and method == 'GET':
            if self.list_error:
                raise state.Blocked(self.list_error)
            return copy.deepcopy(([self.current] if self.current else []) + self.extra_releases)
        if path == 'releases' and method == 'POST':
            self.current = dict(data, id=9, published_at=None, prerelease=False, assets=[])
            return copy.deepcopy(self.current)
        if path.startswith('releases/assets/'):
            ident = int(path.rsplit('/', 1)[1])
            asset = next(a for a in self.current['assets'] if a['id'] == ident)
            asset['download_count'] += 1
            self.downloads['api'] += 1
            return self.asset_content[ident]
        if path == 'releases/9' and method == 'GET':
            return copy.deepcopy(self.current)
        if method == 'PATCH':
            self.current.update(draft=False, published_at='2026-10-30T13:57:38Z')
            self.tag_commit = COMMIT
            return copy.deepcopy(self.current)
        if path == 'contents/manifest.json':
            if self.fail_catalog:
                raise state.Blocked('Simulated failure after publication')
            if self.change_before_write:
                self.manifest_sha = 'concurrent'
            state.require(data['sha'] == self.manifest_sha, 'Concurrent catalog change')
            self.manifest = base64.b64decode(data['content'])
            self.manifest_sha = 'updated'
            return {}
        raise AssertionError((path, method))

    def upload(self, release_id, path):
        assert release_id == self.current['id']
        self.writes.append(('UPLOAD', str(path)))
        ident = len(self.asset_content) + 1
        content = path.read_bytes()
        self.asset_content[ident] = content
        self.current['assets'].append(dict(id=ident, name=path.name, size=len(content), state='uploaded',
            digest='sha256:' + state.digest(content), download_count=0,
            browser_download_url=f'https://github.com/{REPO}/releases/download/v{VERSION}/{path.name}'))
        return copy.deepcopy(self.current['assets'][-1])

    def download(self, url, path, **kwargs):
        if '/releases/tags/' in url:
            content = json.dumps(self.current).encode()
        else:
            asset = next(a for a in self.current['assets'] if a['browser_download_url'] == url)
            asset['download_count'] += 1
            self.downloads['public'] += 1
            content = self.asset_content[asset['id']]
        Path(path).write_bytes(content)


class CandidatePlanTests(unittest.TestCase):
    def test_version_and_published_runtime_mistakes_stop_before_build(self):
        manifest=[{'versions':[{'version':'0.7.13.0'}]}]
        with self.assertRaisesRegex(state.Blocked,'older'): release_plan.validate_version('0.7.12',manifest,'pending')
        with self.assertRaisesRegex(state.Blocked,'Prepare a new version'):
            release_plan.validate_version('0.7.13',manifest,'complete',['Jellyfin.Plugin.WatchGuard/Web/watchguard.js'])
        release_plan.validate_version('0.7.13',manifest,'complete',['scripts/publish_release.py','docs/release-automation.md'])
        release_plan.validate_version('0.7.14',manifest,'unpublished',['Jellyfin.Plugin.WatchGuard/Web/watchguard.js'])
        self.assertEqual(previous_stable.previous(manifest,'0.7.14')['version'],'0.7.13.0')
        with self.assertRaises(state.Blocked): previous_stable.previous(manifest,'0.7.13')


class ReleaseStateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.archive = self.root / state.filename(VERSION)
        with zipfile.ZipFile(self.archive, 'w') as archive:
            archive.writestr(catalog.DLL, b'fixture runtime')
            archive.writestr('LICENSE', b'fixture license')
        sha = state.digest(self.archive.read_bytes())
        self.archive.with_suffix('.zip.sha256').write_text(f'{sha}  {self.archive.name}\n')
        self.record = dict(version=VERSION, sourceCommit=COMMIT, run=123, attempt=2,
                           qualification={'packageSha256': sha})
        self.api = FakeGitHub(self.archive, self.record)
        self.addCleanup(patch.stopall)
        patch.object(catalog, 'download', side_effect=self.api.download).start()

    def draft(self):
        self.api.current = dict(id=9, tag_name='v'+VERSION, target_commitish=COMMIT, draft=True, prerelease=False,
                                body=publisher.marker(self.record), published_at=None, assets=[])

    def upload(self, suffix=''):
        self.api.upload(self.api.current['id'], Path(str(self.archive)+suffix))

    def test_unpublished_inspection_and_read_only_plan_make_no_writes(self):
        self.api.writable = False
        self.api.repository['permissions'] = {'push': True}
        self.assertEqual('unpublished', state.inspect(self.api, VERSION, []))
        status, actions = publisher.resume(self.api, self.record, self.archive)
        self.assertEqual(status, 'awaiting approval')
        self.assertEqual(len(actions), 5)
        self.assertEqual(self.api.writes, [])
        self.assertEqual(self.api.probes, [])
        self.assertIsNone(self.api.current)

    def test_hidden_drafts_are_unknown_and_inspection_cannot_plan_draft_writes(self):
        self.api.writable = False
        self.assertEqual(state.inspect(self.api, VERSION, []), 'unpublished-or-draft')
        status, actions = publisher.resume(self.api, self.record, self.archive)
        self.assertEqual(status, 'awaiting approval')
        self.assertIn('incomplete release list', actions[0])
        with self.assertRaisesRegex(state.Blocked, 'explicit write authority'):
            publisher.resume(self.api, self.record, self.archive, True)
        self.assertEqual(self.api.writes, [])
        self.assertEqual(self.api.probes, [])

    def test_approved_installation_without_push_metadata_can_publish_and_recover(self):
        # All publication/recovery tests inherit the real detector and release
        # enumeration. Exercise explicit false/null metadata as well as absence.
        for permissions in (None, {}, {'push': False}, {'push': True}):
            with self.subTest(permissions=permissions):
                self.api = FakeGitHub(self.archive, self.record)
                self.api.repository['permissions'] = permissions
                with patch.object(catalog, 'download', side_effect=self.api.download):
                    self.assertEqual(publisher.resume(self.api, self.record, self.archive, True)[0], 'catalog updated')
                self.assertEqual(len(self.api.probes), 1)
                self.assertNotIn('Generated notes', self.api.current['body'])
                self.assertEqual(self.api.current['target_commitish'], COMMIT)

    def test_insufficient_authority_blocks_before_release_mutations(self):
        for permissions in (None, {'push': True}):
            with self.subTest(permissions=permissions):
                self.api.repository['permissions'] = permissions
                self.api.notes_permission = False
                with self.assertRaisesRegex(state.Blocked, 'Cannot establish Contents: write.*HTTP 403'):
                    publisher.resume(self.api, self.record, self.archive, True)
                self.assertIsNone(self.api._draft_visibility)
                self.assertEqual(self.api.writes, [])
                self.assertIsNone(self.api.current)

    def test_permission_probe_does_not_replace_complete_draft_enumeration(self):
        self.draft()
        self.api.extra_releases = [{**self.api.current, 'id': 10}]
        with self.assertRaisesRegex(state.Blocked, 'Multiple releases'):
            publisher.resume(self.api, self.record, self.archive, True)
        self.assertEqual(self.api.writes, [])
        self.api.extra_releases.clear()
        self.api.list_error = 'GitHub release enumeration failed: HTTP 403'
        with self.assertRaisesRegex(state.Blocked, 'enumeration failed'):
            publisher.resume(self.api, self.record, self.archive, True)
        self.assertEqual(self.api.writes, [])

    def test_partial_upload_resumes_only_missing_asset_then_repeat_is_noop(self):
        for suffix in ('', '.sha256'):
            with self.subTest(existing=suffix):
                self.api = FakeGitHub(self.archive, self.record)
                with patch.object(catalog, 'download', side_effect=self.api.download):
                    self.draft(); self.upload(suffix); self.api.writes.clear()
                    status, _ = publisher.resume(self.api, self.record, self.archive, True)
                    self.assertEqual(status, 'catalog updated')
                    self.assertEqual(sum(op == 'UPLOAD' for op, _ in self.api.writes), 1)
                    before = copy.deepcopy((self.api.current, self.api.manifest))
                    downloads = self.api.downloads.copy()
                    self.api.writes.clear()
                    self.assertEqual(publisher.resume(self.api, self.record, self.archive, True)[0], 'already published and verified')
                    self.assertEqual(self.api.writes, [])
                    after = copy.deepcopy(self.api.current)
                    for old, new in zip(before[0]['assets'], after['assets']):
                        self.assertGreater(new['download_count'], old['download_count'])
                        new['download_count'] = old['download_count']
                    self.assertEqual(before, (after, self.api.manifest))
                    for source in ('api', 'public'):
                        self.assertGreater(self.api.downloads[source], downloads[source])
                    self.assertEqual(state.inspect(self.api, VERSION, json.loads(self.api.manifest)), 'complete')

    def test_publication_before_catalog_failure_resumes_without_upload_or_publish(self):
        self.api.fail_catalog = True
        with self.assertRaisesRegex(state.Blocked, 'after publication'):
            publisher.resume(self.api, self.record, self.archive, True)
        self.assertFalse(self.api.current['draft'])
        self.assertEqual(self.api.manifest, b'[]\n')
        self.assertEqual(state.inspect(self.api, VERSION, []), 'catalog-missing')
        self.api.fail_catalog = False
        self.api.writes.clear()
        downloads = self.api.downloads.copy()
        publisher.resume(self.api, self.record, self.archive, True)
        self.assertEqual(self.api.writes, [('PUT', 'contents/manifest.json')])
        for source in ('api', 'public'):
            self.assertGreater(self.api.downloads[source], downloads[source])

    def test_new_publication_tolerates_api_and_public_download_counters(self):
        self.assertEqual(publisher.resume(self.api, self.record, self.archive, True)[0], 'catalog updated')
        self.assertEqual([op for op, _ in self.api.writes], ['POST', 'UPLOAD', 'UPLOAD', 'PATCH', 'PUT'])
        self.assertGreater(self.api.downloads['api'], 0)
        self.assertGreater(self.api.downloads['public'], 0)
        self.assertTrue(all(a['download_count'] > 0 for a in self.api.current['assets']))

    def test_asset_order_and_presentation_changes_do_not_block_recovery(self):
        self.draft(); self.upload(); self.upload('.sha256'); self.api.writes.clear()
        original = self.api.release
        calls = 0
        def reordered(version):
            nonlocal calls
            calls += 1
            self.api.current.update(name=f'Editorial title {calls}',
                                    body=f'Updated release notes {calls}\n' + publisher.marker(self.record))
            for asset in self.api.current['assets']:
                asset.update(label=f'Download {calls}', updated_at=str(calls), uploader={'login': f'editor{calls}'})
            result = original(version)
            if calls % 2:
                result['assets'].reverse()
            return result
        with patch.object(self.api, 'release', side_effect=reordered):
            self.assertEqual(publisher.resume(self.api, self.record, self.archive, True)[0], 'catalog updated')
        self.assertEqual(self.api.writes, [('PATCH', 'releases/9'), ('PUT', 'contents/manifest.json')])

    def test_integrity_and_provenance_changes_still_block_before_write(self):
        changes = [('asset', key, value) for key, value in (
            ('id', 999), ('name', 'other.zip'), ('digest', 'sha256:' + 'b'*64), ('size', 999),
            ('state', 'starter'), ('browser_download_url', 'https://example.invalid/other.zip'))]
        changes += [('release', key, value) for key, value in (
            ('id', 10), ('tag_name', 'v0.0.0'), ('target_commitish', 'b'*40), ('draft', False),
            ('prerelease', True), ('published_at', '2026-10-31T00:00:00Z'), ('body', 'marker removed'))]
        for key, value in (('run', 456), ('attempt', 3), ('sourceCommit', 'b'*40),
                           ('qualification', {'packageSha256': 'b'*64})):
            changes.append(('release', 'body', publisher.marker({**self.record, key: value})))
        changes.append(('release', 'body', publisher.marker(self.record) + '\n' +
                        publisher.marker({**self.record, 'run': 456})))
        for target, key, value in changes:
            with self.subTest(target=target, key=key, value=value):
                self.draft(); self.api.asset_content.clear(); self.upload(); self.upload('.sha256'); self.api.writes.clear()
                original = self.api.release
                calls = 0
                def changed(version):
                    nonlocal calls
                    calls += 1
                    if calls == 2:
                        obj = self.api.current['assets'][0] if target == 'asset' else self.api.current
                        obj[key] = value
                    return original(version)
                # Real enumeration rejects a prerelease before fingerprinting.
                message = 'Candidate tag belongs to a prerelease' if key == 'prerelease' else 'concurrently'
                with patch.object(self.api, 'release', side_effect=changed), self.assertRaisesRegex(state.Blocked, message):
                    publisher.resume(self.api, self.record, self.archive, True)
                self.assertEqual(self.api.writes, [])

    def test_public_download_changes_still_block_catalog_write(self):
        self.draft(); self.upload(); self.upload('.sha256')
        self.api.request('releases/9', 'PATCH', {'draft': False})
        self.api.writes.clear()
        original = self.api.download
        def changed(url, path, **kwargs):
            original(url, path, **kwargs)
            if url.endswith('.sha256'):
                self.api.current['assets'][0]['id'] = 999
        with patch.object(catalog, 'download', side_effect=changed), self.assertRaisesRegex(state.Blocked, 'concurrently'):
            publisher.resume(self.api, self.record, self.archive, True)
        self.assertEqual(self.api.writes, [])
        self.assertEqual(self.api.manifest, b'[]\n')

    def test_changed_public_bytes_block_catalog_recovery_even_with_unchanged_metadata(self):
        self.draft(); self.upload(); self.upload('.sha256')
        self.api.request('releases/9', 'PATCH', {'draft': False})
        self.api.writes.clear()
        original = self.api.download
        before = publisher.fingerprint(self.api.current)
        for suffix, message in (('.zip', 'Public ZIP differs'), ('.sha256', 'Public SHA-256 mismatch')):
            with self.subTest(asset=suffix):
                def corrupted(url, path, **kwargs):
                    original(url, path, **kwargs)
                    if url.endswith(suffix):
                        Path(path).write_bytes(b'corrupt')
                with patch.object(catalog, 'download', side_effect=corrupted), self.assertRaisesRegex(ValueError, message):
                    publisher.resume(self.api, self.record, self.archive, True)
                self.assertEqual(publisher.fingerprint(self.api.current), before)
                self.assertEqual(self.api.writes, [])
                self.assertEqual(self.api.manifest, b'[]\n')

    def test_draft_conflicts_and_ambiguous_provenance_stop_before_writes(self):
        for failure in ('bytes', 'digest', 'size', 'marker', 'target', 'tag', 'extra', 'partial'):
            with self.subTest(failure=failure):
                self.draft(); self.api.asset_content.clear(); self.upload(); self.api.writes.clear(); self.api.tag_commit = None
                if failure == 'bytes': self.api.asset_content[1] = b'conflict'
                if failure == 'digest': self.api.current['assets'][0]['digest'] = 'sha256:' + 'b'*64
                if failure == 'size': self.api.current['assets'][0]['size'] += 1
                if failure == 'marker': self.api.current['body'] = 'unrelated draft'
                if failure == 'target': self.api.current['target_commitish'] = 'master'
                if failure == 'tag': self.api.tag_commit = 'b'*40
                if failure == 'extra': self.api.current['assets'][0]['name'] = 'unrelated.zip'
                if failure == 'partial': self.api.current['assets'][0]['state'] = 'starter'
                with self.assertRaises(state.Blocked): publisher.resume(self.api, self.record, self.archive, True)
                self.assertEqual(self.api.writes, [])

    def test_concurrent_release_change_is_rejected_before_first_write(self):
        self.draft()
        original = self.api.release
        calls = [0]
        def changed(version):
            calls[0] += 1
            if calls[0] == 2:
                self.api.current['id'] = 10
            return original(version)
        with patch.object(self.api, 'release', side_effect=changed), self.assertRaisesRegex(state.Blocked, 'concurrently'):
            publisher.resume(self.api, self.record, self.archive, True)
        self.assertEqual(self.api.writes, [])

    def test_concurrent_catalog_change_does_not_overwrite(self):
        self.api.change_before_write = True
        with self.assertRaisesRegex(state.Blocked, 'Concurrent catalog'):
            publisher.resume(self.api, self.record, self.archive, True)
        self.assertEqual(self.api.manifest, b'[]\n')

    def test_completed_catalog_cannot_mask_corrupt_public_assets(self):
        publisher.resume(self.api, self.record, self.archive, True)
        self.api.asset_content[1] = b'corrupt'
        with self.assertRaises(state.Blocked):
            state.inspect(self.api, VERSION, json.loads(self.api.manifest))

    def test_post_response_survives_delayed_id_and_inventory_visibility(self):
        original = self.api.request
        reads = {'id': 0, 'list': 0}
        def delayed(path, *args, **kwargs):
            value = original(path, *args, **kwargs)
            if self.api.current and self.api.current['draft'] and not self.api.current['assets']:
                key = 'id' if path == 'releases/9' else 'list' if path.startswith('releases?') else None
                if key:
                    reads[key] += 1
                    if reads[key] <= 2: return None if key == 'id' else []
            return value
        with patch.object(self.api, 'request', side_effect=delayed), patch.object(publisher.time, 'sleep'):
            self.assertEqual(publisher.resume(self.api, self.record, self.archive, True)[0], 'catalog updated')
        self.assertEqual(self.api.writes.count(('POST', 'releases')), 1)

    def test_readback_exhaustion_retains_draft_for_explicit_retry(self):
        original = self.api.request
        def delayed(path, *args, **kwargs):
            value = original(path, *args, **kwargs)
            return None if path == 'releases/9' else value
        with patch.object(self.api, 'request', side_effect=delayed), patch.object(publisher.time, 'sleep'), self.assertRaisesRegex(state.Blocked, 'Re-run failed jobs'):
            publisher.resume(self.api, self.record, self.archive, True)
        self.assertEqual(self.api.writes, [('POST', 'releases')])
        self.api.writes.clear()
        publisher.resume(self.api, self.record, self.archive, True)
        self.assertNotIn(('POST', 'releases'), self.api.writes)

    def test_changed_post_response_readback_is_not_treated_as_visibility_delay(self):
        original = self.api.request
        def changed(path, *args, **kwargs):
            value = original(path, *args, **kwargs)
            if path == 'releases/9': value['body'] = 'another qualification'
            return value
        with patch.object(self.api, 'request', side_effect=changed), self.assertRaisesRegex(state.Blocked, 'concurrently'):
            publisher.resume(self.api, self.record, self.archive, True)
        self.assertEqual(self.api.writes, [('POST', 'releases')])

    def test_interrupted_draft_creation_can_resume_without_recreation(self):
        with patch.object(self.api, 'upload', side_effect=state.Blocked('upload interrupted')):
            with self.assertRaisesRegex(state.Blocked, 'upload interrupted'):
                publisher.resume(self.api, self.record, self.archive, True)
        self.assertEqual(self.api.current['id'], 9)
        self.assertTrue(self.api.current['draft'])
        self.api.writes.clear()
        publisher.resume(self.api, self.record, self.archive, True)
        self.assertNotIn(('POST', 'releases'), self.api.writes)

    def test_binary_download_headers_match_the_native_github_endpoints(self):
        api = state.GitHub(REPO)
        with patch.object(state.subprocess, 'run', return_value=subprocess.CompletedProcess([],0,stdout=b'bytes',stderr=b'')) as request:
            self.assertEqual(api.request('actions/artifacts/1/zip', binary=True), b'bytes')
            self.assertNotIn('Accept: application/octet-stream', request.call_args.args[0])
            self.assertEqual(api.request('releases/assets/1', binary=True), b'bytes')
            self.assertIn('Accept: application/octet-stream', request.call_args.args[0])

    def test_upload_targets_verified_release_id_and_requires_write_authority(self):
        api = state.GitHub(REPO)
        with self.assertRaises(state.Blocked): api.upload(9, self.archive)
        api.writable = True
        with patch.object(state.subprocess, 'run', return_value=subprocess.CompletedProcess([],0,stdout=b'{}')) as request:
            api.upload(9, self.archive)
            command = request.call_args.args[0]
            self.assertIn(f'https://uploads.github.com/repos/{REPO}/releases/9/assets?name={self.archive.name}', command)
            self.assertNotIn('--clobber', command)

    def test_unique_public_release_can_be_checked_without_changing_other_draft(self):
        api = state.GitHub(REPO)
        public = dict(id=9, tag_name='v'+VERSION, draft=False, prerelease=False)
        draft = dict(id=10, tag_name='v'+VERSION, draft=True, prerelease=False)
        with patch.object(api, 'pages', return_value=[draft,public]):
            self.assertEqual(api.release(VERSION, public_only=True), public)
            self.assertEqual(api.preserved_drafts,[10])
            with self.assertRaises(state.Blocked): api.release(VERSION)

    def test_tag_alone_and_duplicate_releases_do_not_establish_success(self):
        api = state.GitHub(REPO)
        with patch.object(api, 'pages', return_value=[]), patch.object(api, 'tag', return_value=COMMIT):
            with self.assertRaisesRegex(state.Blocked, 'Tag exists without'):
                api.release(VERSION)
        with patch.object(api, 'pages', return_value=[{'tag_name':'v'+VERSION, 'draft': True}]*2):
            with self.assertRaisesRegex(state.Blocked, 'Multiple releases'):
                api.release(VERSION)


class PermissionDetectionTests(unittest.TestCase):
    def transport(self, result, metadata=None):
        repo = metadata if metadata is not None else {'default_branch': 'master'}
        return patch.object(state.subprocess, 'run', side_effect=[
            subprocess.CompletedProcess([], 0, stdout=json.dumps(repo).encode(), stderr=b''), result])

    def test_installation_probe_uses_real_transport_without_persisting_objects(self):
        api = state.GitHub(REPO, writable=True)
        response = subprocess.CompletedProcess([], 0, stdout=b'{"name":"notes","body":""}', stderr=b'')
        with self.transport(response) as request:
            self.assertTrue(api.can_see_drafts())
            self.assertTrue(api.can_see_drafts())
        self.assertEqual(request.call_count, 2)  # Metadata and one cached probe.
        command = request.call_args.args[0]
        self.assertEqual(command, ['gh', 'api', f'repos/{REPO}/releases/generate-notes',
                                   '--method', 'POST', '--input', '-'])
        self.assertEqual(json.loads(request.call_args.kwargs['input']), {
            'tag_name': 'watchguard-permission-check', 'target_commitish': 'master'})
        self.assertEqual(request.call_args.kwargs['timeout'], 60)

    def test_read_only_missing_or_negative_metadata_never_probes(self):
        for permissions in ({}, {'permissions': None}, {'permissions': {}}, {'permissions': {'push': False}}):
            api = state.GitHub(REPO)
            response = subprocess.CompletedProcess([], 0, stdout=json.dumps(permissions).encode(), stderr=b'')
            with self.subTest(metadata=permissions), patch.object(state.subprocess, 'run', return_value=response) as request:
                self.assertFalse(api.can_see_drafts())
                self.assertFalse(api.can_see_drafts())
                with self.assertRaisesRegex(state.Blocked, 'Read-only execution'):
                    api.request('releases/generate-notes', 'POST', {})
                self.assertEqual(request.call_count, 1)
                self.assertEqual(request.call_args.args[0][-1], 'GET')

    def test_api_denials_errors_and_invalid_responses_never_prove_authority(self):
        responses = [subprocess.CompletedProcess([], 1, stdout=b'', stderr=f'HTTP {code}'.encode())
                     for code in (401, 403, 404, 429, 500)]
        responses += [subprocess.CompletedProcess([], 0, stdout=body, stderr=b'')
                      for body in (b'null', b'{}', b'[]', b'{"name":"title","body":null}', b'not JSON')]
        responses.append(subprocess.TimeoutExpired(['gh', 'api'], 60))
        for response in responses:
            api = state.GitHub(REPO, writable=True)
            # Even push:true cannot override a failed installation-token probe.
            with self.subTest(response=response), self.transport(response, {'default_branch': 'master', 'permissions': {'push': True}}), \
                 self.assertRaisesRegex(state.Blocked, 'Cannot establish Contents: write'):
                api.can_see_drafts()
            self.assertIsNone(api._draft_visibility)

    def test_repository_failure_never_falls_back_to_assumed_authority(self):
        api = state.GitHub(REPO, writable=True)
        response = subprocess.CompletedProcess([], 1, stdout=b'', stderr=b'HTTP 403')
        with patch.object(state.subprocess, 'run', return_value=response) as request, \
             self.assertRaisesRegex(state.Blocked, 'GitHub request failed'):
            api.can_see_drafts()
        self.assertEqual(request.call_count, 1)
        self.assertIsNone(api._draft_visibility)

    def test_missing_default_branch_stops_before_probe(self):
        api = state.GitHub(REPO, writable=True)
        with patch.object(api, 'request', return_value={}) as request, \
             self.assertRaisesRegex(state.Blocked, 'default branch is unavailable'):
            api.can_see_drafts()
        request.assert_called_once_with('')
        self.assertIsNone(api._draft_visibility)

    def test_later_inventory_page_failure_or_ambiguity_blocks_enumeration(self):
        # A successful probe is not an inventory, including when page one fills.
        for last in (state.Blocked('HTTP 403 on page two'),
                     [dict(tag_name='v'+VERSION, draft=True, prerelease=False)]):
            api = state.GitHub(REPO, writable=True)
            first = [dict(tag_name='v'+VERSION, draft=True, prerelease=False)]
            first += [dict(tag_name=f'other-{n}') for n in range(99)]
            with self.subTest(last=last), patch.object(api, 'request', side_effect=[first, last]) as request, \
                 self.assertRaises(state.Blocked):
                api.release(VERSION)
            self.assertEqual(request.call_args.args[0], 'releases?per_page=100&page=2')


class ProvenanceTests(unittest.TestCase):
    def setUp(self):
        self.run = dict(id=123, run_attempt=2, head_sha=COMMIT, head_branch='master', event='push', path=provenance.WORKFLOW,
                        repository={'full_name':REPO}, head_repository={'full_name':REPO}, pull_requests=[])
        self.api = state.GitHub(REPO)
        self.asset = dict(id=42, name=provenance.artifact_name('package',2), expired=False, digest='sha256:'+'a'*64,
                          workflow_run=dict(id=123,head_sha=COMMIT,repository_id=7,head_repository_id=7))

    def test_untrusted_event_branch_repository_and_attempt_are_rejected(self):
        for change in ({'event':'pull_request'}, {'head_branch':'feature'}, {'head_repository':{'full_name':'Fork/WatchGuard'}},
                       {'path':'.github/workflows/build.yaml'}, {'run_attempt':1}, {'head_sha':'unmerged'}):
            run = {**self.run, **change}
            def api(path):
                return {'default_branch':'master'} if path == '' else {'status':'diverged' if run['head_sha']=='unmerged' else 'ahead'}
            with self.subTest(change=change), patch.object(self.api, 'request', side_effect=api), self.assertRaises(state.Blocked):
                provenance.check_run(self.api, run, 2)

    def test_pr_association_is_not_a_pr_event_or_publication_authority(self):
        associated = {**self.run, 'pull_requests':[{'number':57}]}
        def api(path):
            return {'default_branch':'master'} if path == '' else {'status':'ahead'}
        with patch.object(self.api,'request',side_effect=api):
            provenance.check_run(self.api,associated,2)
            branch = {**associated,'event':'workflow_dispatch','head_branch':'feature'}
            provenance.check_run(self.api,branch,2,allow_branch=True)
            with self.assertRaises(state.Blocked): provenance.check_run(self.api,branch,2)
            for event in ('pull_request','pull_request_target'):
                with self.subTest(event=event), self.assertRaises(state.Blocked):
                    provenance.check_run(self.api,{**associated,'event':event},2,allow_branch=True)

    def test_missing_expired_duplicate_and_cross_run_artifacts_block(self):
        inventories = [[], [self.asset,self.asset], [{**self.asset,'expired':True}],
                       [{**self.asset,'workflow_run':{**self.asset['workflow_run'],'id':999}}],
                       [{**self.asset,'workflow_run':{**self.asset['workflow_run'],'head_sha':'b'*40}}],
                       [{**self.asset,'digest':None}]]
        for inventory in inventories:
            with self.subTest(inventory=inventory), self.assertRaises(state.Blocked):
                provenance.one_artifact(inventory, self.asset['name'], self.run, 7)

    def test_artifact_archive_digest_and_allowlist_are_verified(self):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w') as archive: archive.writestr('package.zip', b'fixture')
        data = buffer.getvalue()
        asset = {**self.asset, 'digest':'sha256:'+state.digest(data)}
        with patch.object(self.api, 'request', return_value=data):
            self.assertEqual(provenance.extract(self.api,asset,['package.zip']), {'package.zip':b'fixture'})
            with self.assertRaises(state.Blocked): provenance.extract(self.api,asset,['other.zip'])
            with self.assertRaises(state.Blocked): provenance.extract(self.api,self.asset,['package.zip'])

    def test_publisher_retry_resolves_only_the_original_sealed_attempt(self):
        asset={'id':99,'name':'WatchGuard-qualification-attempt-2','expired':False}
        with patch.object(self.api,'pages',return_value=[asset]):
            with patch.dict(os.environ,{'GITHUB_RUN_ATTEMPT':'7'}):
                self.assertEqual(provenance.sealed_attempt(self.api,123),(2,99))
        for rows in ([],[dict(asset,expired=True)],[asset,dict(asset,id=100,name='WatchGuard-qualification-attempt-3')],[asset,asset]):
            with patch.object(self.api,'pages',return_value=rows),self.assertRaises(state.Blocked):
                provenance.sealed_attempt(self.api,123)

    def test_failed_or_previous_attempt_job_is_not_reused(self):
        names = ['build','Verify complete compatibility evidence'] + [f'Integration / {v} / {s}' for row in qualification.MATRIX for v,s in [(row['jellyfin_version'],row['shard'])]]
        jobs = [dict(name=n,conclusion='success',run_attempt=2) for n in names]
        with patch.object(self.api, 'pages', return_value=jobs): provenance.verify_jobs(self.api,self.run,2,True)
        for change in ({'conclusion':'failure'}, {'run_attempt':1}):
            broken=copy.deepcopy(jobs); broken[-1].update(change)
            with patch.object(self.api, 'pages', return_value=broken), self.assertRaises(state.Blocked):
                provenance.verify_jobs(self.api,self.run,2,True)


class QualificationRecordTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        self.api = state.GitHub(REPO)
        self.run = dict(id=123,run_attempt=2,head_sha=COMMIT,head_branch='master',event='push',path=provenance.WORKFLOW,
                        repository={'full_name':REPO},head_repository={'full_name':REPO},pull_requests=[])
        name = state.filename(VERSION)
        runtime = b'qualified fixture'
        package = self.zip({catalog.DLL:runtime,'LICENSE':b'license'})
        self.package = package
        self.package_files = {name:package, name+'.sha256':f'{state.digest(package)}  {name}\n'.encode()}
        self.blobs = {10:self.zip(self.package_files)}
        self.inventory = [self.asset(10,provenance.artifact_name('package',2),self.blobs[10])]
        self.inventory += [self.asset(i,n,b'evidence') for i,n in enumerate(provenance.expected_evidence(2),20)]
        reports = [dict(schemaVersion=2,jellyfinVersion=v,suite=s,shard=qualification.SUITE_SHARD[s],status='PASS',commit=COMMIT,
                       packageSha256=state.digest(package),runtimeSha256=state.digest(runtime),upgradeBaseline=dict(result='PASS',candidateSha256=state.digest(package),previous={'sha256':'baseline'},previousDllSha256='old-dll'),proxyMatrix=s=='server-enforcement',
                       origin={'repository':REPO,'run':123,'attempt':2},
                       attempts=[dict(scenario=c['id'],command=c['command'],environment=c['env'],exitCode=0,retry=False) for c in qualification.PLAN[s]])
                   for v,s in qualification.PAIRS]
        result=qualification.verify(reports,COMMIT,state.digest(package),state.digest(runtime),True)
        self.record=dict(schemaVersion=1,repository=REPO,sourceCommit=COMMIT,run=123,attempt=2,workflow=provenance.WORKFLOW,
                         version=VERSION,publishRequested=True,supportedHosts=list(qualification.VERSIONS),suiteInventory=qualification.PLAN,qualificationPolicy=qualification.POLICY,
                         proxyMatrix=True,packageArtifact=copy.deepcopy(self.inventory[0]),evidenceArtifacts=copy.deepcopy(self.inventory[1:]),qualification=result)
        names=['build','Verify complete compatibility evidence']+[f'Integration / {v} / {s}' for row in qualification.MATRIX for v,s in [(row['jellyfin_version'],row['shard'])]]
        self.jobs=[dict(name=n,conclusion='success',run_attempt=2) for n in names]

    @staticmethod
    def zip(files):
        buffer=io.BytesIO()
        with zipfile.ZipFile(buffer,'w') as archive:
            for name,content in files.items(): archive.writestr(name,content)
        return buffer.getvalue()

    def asset(self, ident, name, content):
        return dict(id=ident,name=name,expired=False,digest='sha256:'+state.digest(content),size_in_bytes=len(content),
                    workflow_run=dict(id=123,head_sha=COMMIT,repository_id=7,head_repository_id=7))

    def load(self, allow_validation=False):
        self.blobs[99]=self.zip({'qualification-record.json':json.dumps(self.record).encode()})
        inventory=self.inventory+[self.asset(99,provenance.artifact_name('qualification',2),self.blobs[99])]
        def request(path, **kwargs):
            if path=='': return {'id':7,'default_branch':'master'}
            if path.startswith('compare/'): return {'status':'ahead'}
            if path.endswith('/attempts/2'): return self.run
            if path.startswith('actions/artifacts/'): return self.blobs[int(path.split('/')[2])]
            raise AssertionError(path)
        def pages(path,key): return self.jobs if '/jobs' in path else inventory
        with patch.object(self.api,'request',side_effect=request), patch.object(self.api,'pages',side_effect=pages), \
             patch.object(self.api,'file',return_value=(Path('Directory.Build.props').read_bytes(),'metadata')):
            return provenance.load(self.api,123,2,self.folder,allow_validation=allow_validation)

    def test_full_record_consumes_exact_zip_and_rechecks_all_required_suites(self):
        record, archive=self.load()
        self.assertEqual(record['recordArtifactId'],99)
        self.assertEqual(archive.read_bytes(),self.package)
        self.assertEqual(len(record['qualification']['suites']),len(qualification.PAIRS))

    def test_record_missing_or_mixed_evidence_is_rejected(self):
        original=copy.deepcopy(self.record)
        for scenario in ('commit','run','attempt','repository','hosts','proxy','inventory','artifact','suite','suite-origin','suite-proxy','package-hash','runtime-hash'):
            self.record=copy.deepcopy(original)
            if scenario=='commit': self.record['sourceCommit']='b'*40
            if scenario=='run': self.record['run']=321
            if scenario=='attempt': self.record['attempt']=1
            if scenario=='repository': self.record['repository']='Fork/WatchGuard'
            if scenario=='hosts': self.record['supportedHosts'].pop()
            if scenario=='proxy': self.record['proxyMatrix']=False
            if scenario=='inventory': self.record['evidenceArtifacts'].pop()
            if scenario=='artifact': self.record['packageArtifact']['id']=999
            if scenario=='suite': self.record['qualification']['suites'].pop()
            if scenario=='suite-origin': self.record['qualification']['suites'][0]['origin']['attempt']=1
            if scenario=='suite-proxy': next(r for r in self.record['qualification']['suites'] if r['suite']=='server-enforcement')['proxyMatrix']=False
            if scenario=='package-hash': self.record['qualification']['packageSha256']='b'*64
            if scenario=='runtime-hash': self.record['qualification']['runtimeSha256']='b'*64
            with self.subTest(scenario=scenario), self.assertRaises(state.Blocked if scenario not in ('suite','suite-proxy') else ValueError):
                self.load()

    def test_validation_without_proxies_never_becomes_publication_authority(self):
        self.record['publishRequested']=False
        self.record['proxyMatrix']=False
        for report in self.record['qualification']['suites']: report['proxyMatrix']=False
        self.load(allow_validation=True)
        with self.assertRaises(state.Blocked): self.load()
        self.record['publishRequested']=True
        with self.assertRaises(state.Blocked): self.load(allow_validation=True)

    def test_package_or_evidence_missing_expired_or_replaced_blocks_load(self):
        original=copy.deepcopy(self.inventory)
        for scenario in ('missing-package','missing-evidence','expired-package','expired-evidence','replaced'):
            self.inventory=copy.deepcopy(original)
            if scenario=='missing-package': self.inventory.pop(0)
            if scenario=='missing-evidence': self.inventory.pop()
            if scenario=='expired-package': self.inventory[0]['expired']=True
            if scenario=='expired-evidence': self.inventory[-1]['expired']=True
            if scenario=='replaced': self.inventory[0]['id']=777
            with self.subTest(scenario=scenario), self.assertRaises(state.Blocked): self.load()

    def test_conflicting_zip_bytes_and_wrong_sidecar_fail_before_publication(self):
        for which in ('zip','sidecar'):
            files=copy.deepcopy(self.package_files)
            name=state.filename(VERSION)
            if which=='zip': files[name]=self.zip({catalog.DLL:b'other runtime','LICENSE':b'license'})
            else: files[name+'.sha256']=b'bad sidecar'
            self.blobs[10]=self.zip(files)
            self.inventory[0]=self.asset(10,provenance.artifact_name('package',2),self.blobs[10])
            self.record['packageArtifact']=copy.deepcopy(self.inventory[0])
            with self.subTest(which=which), self.assertRaises(state.Blocked): self.load()

if __name__ == '__main__': unittest.main()
