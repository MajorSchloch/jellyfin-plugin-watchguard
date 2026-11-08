"""The shared historical fixture is pinned once at setup and again in every consumer."""
import copy
import json
from pathlib import Path
import runpy
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import catalog
import enforcement_baseline as baseline
import previous_stable
from release_state import Blocked, digest, filename


class EnforcementBaselineTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        self.zip = self.folder / filename(baseline.VERSION)
        with zipfile.ZipFile(self.zip, 'w') as archive:
            archive.writestr(catalog.DLL, b'baseline DLL fixture')
            archive.writestr('LICENSE', b'fixture license')
        self.content = self.zip.read_bytes()
        self.sha = digest(self.content)
        self.name = self.zip.name
        self.sidecar = (self.sha + '  ' + self.name + '\n').encode()
        self.release = dict(id=123, tag_name='v0.4.8', draft=False, prerelease=False,
                            published_at='2026-10-15T16:21:22Z', assets=[])
        for id, (name, content) in enumerate(((self.name, self.content), (self.name + '.sha256', self.sidecar)), 1):
            self.release['assets'].append(dict(id=id, name=name, state='uploaded', size=len(content), digest='sha256:' + digest(content),
                url=f'https://api.github.com/repos/Fixture/WatchGuard/releases/assets/{id}',
                browser_download_url=f'https://github.com/Fixture/WatchGuard/releases/download/v0.4.8/{name}'))
        entry = catalog.entry(self.zip, self.release['assets'][0]['browser_download_url'], self.release['published_at'], '0.4.8.0')
        self.manifest = json.loads(Path('manifest.json').read_text())
        self.manifest[0]['versions'] = [entry]
        self.api = SimpleNamespace(repo='Fixture/WatchGuard', release=lambda version, public_only: copy.deepcopy(self.release))
        self.output = self.folder / 'output'

    def test_setup_reuses_transient_fallback_and_consumers_are_offline(self):
        calls = []
        def download(url, target, *, deadline, api=False):
            calls.append((url, deadline, api))
            if not api:
                raise subprocess.CalledProcessError(22, ['simulated-public-504'], output='504')
            target.write_bytes(self.content if target.name == self.name else self.sidecar)
        with patch.object(baseline, 'SHA256', self.sha), patch.object(previous_stable, 'download_once', side_effect=download):
            identity = baseline.fetch(self.api, self.manifest, self.output)
        self.assertEqual(len(calls), 4)
        self.assertEqual(len({call[1] for call in calls}), 1)
        self.assertEqual([call[2] for call in calls], [False, True, False, True])
        self.assertEqual(identity['zipSha256'], self.sha)
        # All four consumers (two sequential in platforms) re-read the shared ZIP.
        with patch.object(baseline, 'SHA256', self.sha), \
             patch.object(previous_stable, 'download_once', side_effect=AssertionError('No network in consumers')), \
             patch.object(baseline.GitHub, 'request', side_effect=AssertionError('No API in consumers')):
            for _ in range(4):
                dll, verified = baseline.load(self.output / self.name)
                self.assertEqual(dll, b'baseline DLL fixture')
                self.assertEqual(verified['zipSha256'], self.sha)
                self.assertTrue(verified['pinVerifiedBeforeExtraction'])

    def test_corruption_is_rejected_before_zip_open_or_any_network(self):
        corrupt = self.folder / 'corrupt.zip'
        corrupt.write_bytes(self.content + b'corruption')
        with patch.object(baseline, 'SHA256', self.sha), \
             patch.object(baseline.zipfile, 'ZipFile') as extract, \
             patch.object(previous_stable, 'download_once') as download, \
             patch.object(baseline.GitHub, 'request') as api:
            with self.assertRaisesRegex(Blocked, 'SHA-256 differs'):
                baseline.load(corrupt)
            extract.assert_not_called()
            download.assert_not_called()
            api.assert_not_called()

    def test_missing_local_input_fails_with_setup_instruction(self):
        with patch.object(previous_stable, 'download_once') as download:
            with self.assertRaisesRegex(Blocked, 'Run python3 scripts/enforcement_baseline.py'):
                baseline.load(self.folder / 'missing.zip')
            download.assert_not_called()

    def test_release_digest_conflict_fails_before_transfer(self):
        with patch.object(previous_stable, 'download_once') as download:
            with self.assertRaisesRegex(Blocked, 'digest differs from the fixed pin'):
                baseline.fetch(self.api, self.manifest, self.output)
            download.assert_not_called()
        self.assertFalse(self.output.exists())

    def test_corrupt_download_fails_without_producing_shared_artifact(self):
        def corrupt(url, target, **kwargs):
            target.write_bytes(b'X' + self.content[1:])
        with patch.object(baseline, 'SHA256', self.sha), patch.object(previous_stable, 'download_once', side_effect=corrupt) as download:
            with self.assertRaisesRegex(Blocked, 'digest differs'):
                baseline.fetch(self.api, self.manifest, self.output)
            self.assertEqual(download.call_count, 1)
        self.assertFalse(self.output.exists())

    def test_catalog_conflict_fails_before_shared_artifact_is_written(self):
        self.manifest[0]['versions'][0]['timestamp'] = '2026-10-16T00:00:00Z'
        def download(url, target, **kwargs):
            target.write_bytes(self.content if target.name == self.name else self.sidecar)
        with patch.object(baseline, 'SHA256', self.sha), patch.object(previous_stable, 'download_once', side_effect=download):
            with self.assertRaisesRegex(Blocked, 'catalog metadata differs'):
                baseline.fetch(self.api, self.manifest, self.output)
        self.assertFalse(self.output.exists())

    def test_actual_enforcement_entrypoint_rejects_corrupt_input_before_docker(self):
        scope = runpy.run_path('tests/server-enforcement.py')
        main = scope['main']
        # Run the actual preamble; no Docker/browser operation can precede the pin.
        with patch.dict(main.__globals__, ROOT=self.folder, load_baseline=lambda: baseline.load(self.zip)), \
             patch.object(sys, 'argv', ['server-enforcement.py']), \
             patch.object(subprocess, 'check_output', side_effect=AssertionError('No network/Docker before pin')):
            with self.assertRaisesRegex(Blocked, 'SHA-256 differs'):
                main()
        self.assertFalse((self.folder / 'artifacts/PublishedV048/Jellyfin.Plugin.WatchGuard.dll').exists())


if __name__ == '__main__':
    unittest.main()
