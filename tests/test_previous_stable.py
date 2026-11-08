"""Previous-stable fallback: real curl/HTTP, deterministic failures, no GitHub writes."""
from contextlib import contextmanager
import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import catalog
import previous_stable as stable
from release_state import Blocked, digest, public_package
from test_catalog_downloads import release_server


class PreviousStableTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        self.name = 'Jellyfin.Plugin.WatchGuard-v0.7.16.zip'
        archive = self.folder / self.name
        with zipfile.ZipFile(archive, 'w') as package:
            package.writestr(catalog.DLL, b'test runtime')
            package.writestr('LICENSE', b'test license')
        self.contents = {self.name: archive.read_bytes()}
        self.contents[self.name + '.sha256'] = (digest(archive.read_bytes()) + '  ' + self.name + '\n').encode()
        self.api = SimpleNamespace(repo='Fixture/WatchGuard')
        self.release = dict(id=123, tag_name='v0.7.16', draft=False, prerelease=False,
                            published_at='2026-11-01T00:00:00Z', assets=[])
        for asset_id, (name, content) in enumerate(self.contents.items(), 1):
            self.release['assets'].append(dict(id=asset_id, name=name, state='uploaded', size=len(content),
                digest='sha256:' + digest(content),
                url=f'https://api.github.com/repos/{self.api.repo}/releases/assets/{asset_id}',
                browser_download_url=f'https://github.com/{self.api.repo}/releases/download/v0.7.16/{name}'))
        self.api.release = lambda version, public_only: copy.deepcopy(self.release)
        entry = catalog.entry(archive, self.release['assets'][0]['browser_download_url'], self.release['published_at'], '0.7.16.0')
        self.manifest = json.loads(Path('manifest.json').read_text())
        self.manifest[0]['versions'] = [entry]
        self.output = self.folder / 'download'

    def content(self, path):
        if path.startswith('/api/'):
            return self.contents[self.release['assets'][int(path.rsplit('/', 1)[1]) - 1]['name']]
        return self.contents[path.rsplit('/', 1)[1]]

    @contextmanager
    def transfers(self, respond):
        run = subprocess.run
        self.commands = []
        with release_server(respond) as (base, calls, headers):
            def redirect(command, **kwargs):
                self.commands.append(command.copy())
                url = command[-1]
                path = ('/api/' if 'api.github.com' in url else '/public/') + url.rsplit('/', 1)[1]
                return run(command[:-1] + [base + path], **kwargs)
            with patch.object(stable.subprocess, 'run', side_effect=redirect), patch.object(stable.time, 'sleep'):
                yield calls, headers

    def retrieve(self):
        return stable.retrieve(self.api, self.manifest, '0.7.17', self.output)

    def test_504_fallback_for_both_assets_is_anonymous_and_exact(self):
        with self.transfers(lambda path, n: (504, b'temporary') if path.startswith('/public/') else (200, self.content(path))) as (calls, headers):
            identity = self.retrieve()
        self.assertEqual(identity['sha256'], digest(self.contents[self.name]))
        self.assertEqual(list(calls.values()), [1, 1, 1, 1])
        for command, header in zip(self.commands, headers):
            self.assertEqual(command[:2], ['curl', '--disable'])
            self.assertIsNone(header.get('Authorization'))
            self.assertIsNone(header.get('Cookie'))
            if 'api.github.com' in command[-1]:
                self.assertEqual(header['Accept'], 'application/octet-stream')
        self.assertTrue((self.output / 'identity.json').exists())

    def test_successful_public_route_never_uses_api(self):
        with self.transfers(lambda path, n: (200, self.content(path))) as (calls, _):
            self.retrieve()
        self.assertEqual(len(calls), 2)
        self.assertTrue(all(path.startswith('/public/') for path in calls))

    def test_mismatched_bytes_on_either_route_fail_without_more_requests(self):
        for fallback in (False, True):
            for target in (self.name, self.name + '.sha256'):
                with self.subTest(fallback=fallback, target=target):
                    def respond(path, n):
                        if fallback and path.startswith('/public/'):
                            return 504, b'temporary'
                        content = self.content(path)
                        if content == self.contents[target]:
                            content = b'X' + content[1:]  # Same size, different digest.
                        return 200, content
                    self.output.mkdir(exist_ok=True)
                    (self.output / 'identity.json').write_text('stale success')
                    with self.transfers(respond) as (calls, _):
                        with self.assertRaisesRegex(Blocked, 'digest differs'):
                            self.retrieve()
                    self.assertTrue(all(n == 1 for n in calls.values()))
                    self.assertFalse((self.output / 'identity.json').exists())
                    self.assertEqual(len(calls), (1 if target == self.name else 2) * (2 if fallback else 1))

    def test_both_routes_fail_with_bounded_attempts(self):
        with self.transfers(lambda path, n: (504, b'temporary')) as (calls, _):
            with self.assertRaisesRegex(Blocked, 'public and API routes'):
                self.retrieve()
        self.assertEqual(list(calls.values()), [1, stable.API_ATTEMPTS])
        self.assertFalse((self.output / 'identity.json').exists())

    def test_api_transient_retry_then_success(self):
        with self.transfers(lambda path, n: (504, b'temporary') if path.startswith('/public/') or n == 1 else (200, self.content(path))) as (calls, _):
            self.retrieve()
        self.assertEqual(list(calls.values()), [1, 2, 1, 2])

    def test_permanent_denial_never_retries(self):
        for fallback in (False, True):
            with self.subTest(fallback=fallback):
                with self.transfers(lambda path, n: (504 if fallback and path.startswith('/public/') else 403, b'denied')) as (calls, _):
                    with self.assertRaises((Blocked, subprocess.CalledProcessError)):
                        self.retrieve()
                self.assertEqual(list(calls.values()), [1, 1] if fallback else [1])

    def test_identity_conflicts_precede_all_downloads(self):
        mutations = [lambda r: r.update(tag_name='v0.7.15'), lambda r: r.update(draft=True),
                     lambda r: r.update(prerelease=True), lambda r: r.update(published_at=None),
                     lambda r: r['assets'][1].update(id=1), lambda r: r['assets'][0].update(id=None),
                     lambda r: r['assets'][1].update(url='https://api.github.com/repos/other/repo/releases/assets/2'),
                     lambda r: r['assets'][0].update(state='new'), lambda r: r['assets'].pop()]
        original = copy.deepcopy(self.release)
        for mutate in mutations:
            self.release = copy.deepcopy(original)
            mutate(self.release)
            with patch.object(stable, 'download_once') as download:
                with self.assertRaises(Blocked):
                    self.retrieve()
                download.assert_not_called()

    def test_sidecar_and_catalog_checks_remain_strict(self):
        for mismatch in ('sidecar', 'catalog'):
            with self.subTest(mismatch=mismatch):
                if mismatch == 'sidecar':
                    body = ('0' * 64 + '  ' + self.name + '\n').encode()
                    self.contents[self.name + '.sha256'] = body
                    self.release['assets'][1]['digest'] = 'sha256:' + digest(body)
                else:
                    self.contents[self.name + '.sha256'] = (digest(self.contents[self.name]) + '  ' + self.name + '\n').encode()
                    self.release['assets'][1]['digest'] = 'sha256:' + digest(self.contents[self.name + '.sha256'])
                    self.manifest[0]['versions'][0]['checksum'] = '0' * 32
                with self.transfers(lambda path, n: (200, self.content(path))) as (calls, _):
                    with self.assertRaisesRegex(Blocked, 'sidecar mismatch|catalog metadata differs'):
                        self.retrieve()
                self.assertEqual(list(calls.values()), [1, 1])
                self.assertFalse((self.output / 'identity.json').exists())

    def test_shared_budget_bounds_stalled_routes_and_both_assets(self):
        elapsed, limits = [0.0], []
        def stalled(command, **kwargs):
            limit = kwargs['timeout']
            self.assertLessEqual(limit, 30)
            self.assertEqual(float(command[command.index('--max-time') + 1]), limit)
            self.assertLessEqual(float(command[command.index('--connect-timeout') + 1]), 10)
            limits.append(limit)
            elapsed[0] += limit
            raise subprocess.TimeoutExpired(command, limit)
        with patch.object(stable.time, 'monotonic', side_effect=lambda: elapsed[0]), \
             patch.object(stable.time, 'sleep', side_effect=lambda delay: elapsed.__setitem__(0, elapsed[0] + delay)), \
             patch.object(stable.subprocess, 'run', side_effect=stalled):
            with self.assertRaises(Blocked):
                self.retrieve()
        self.assertEqual(limits, [30, 30, 30, 24])
        self.assertEqual(elapsed[0], catalog.DOWNLOAD_BUDGET)

    def test_other_callers_keep_original_public_downloader(self):
        with patch.object(catalog, 'download', side_effect=RuntimeError('original public downloader')) as download, \
             patch.object(stable, 'download_once') as fallback:
            with self.assertRaisesRegex(RuntimeError, 'original public downloader'):
                public_package(self.api, self.release, '0.7.16', self.output)
            download.assert_called_once()
            fallback.assert_not_called()


if __name__ == '__main__':
    unittest.main()
