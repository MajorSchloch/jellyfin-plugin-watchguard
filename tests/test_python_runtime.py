"""Hosted cache selection and the suite's exact interpreter contract."""
import importlib.util
import json
import os
from pathlib import Path
import runpy
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
REQUIRED = (ROOT / '.python-version').read_text().strip()
spec = importlib.util.spec_from_file_location('python_cache', ROOT / 'scripts/ci/verify-python-cache.py')
cache = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cache)


class PythonRuntimeTests(unittest.TestCase):
    def test_cache_must_exist_and_report_the_required_version(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp) / 'Python' / REQUIRED
            executable = folder / 'x64/bin/python3'
            with self.assertRaisesRegex(RuntimeError, 'not preinstalled'):
                cache.cached_python(REQUIRED, Path(temp))
            executable.parent.mkdir(parents=True)
            executable.touch()
            with self.assertRaisesRegex(RuntimeError, 'not preinstalled'):
                cache.cached_python(REQUIRED, Path(temp))
            (folder / 'x64.complete').touch()
            with patch.object(subprocess, 'check_output', return_value=REQUIRED+'\n'):
                before = cache.cached_python(REQUIRED, Path(temp))
            cache.verify_selected(before, REQUIRED, executable)
            with self.assertRaises(RuntimeError):
                cache.verify_selected(before, REQUIRED, Path(temp) / 'other-python')
            with patch.object(subprocess, 'check_output', return_value='3.12.0\n'):
                with self.assertRaisesRegex(RuntimeError, 'Cached Python reports'):
                    cache.cached_python(REQUIRED, Path(temp))
            with self.assertRaises(RuntimeError):
                cache.verify_selected(before, '3.13.0', executable)

    def run_suite(self, version):
        # Run the real suite wrapper, but no server or external process. Its
        # report must contain the observed interpreter, and children must use it.
        with tempfile.TemporaryDirectory() as temp:
            previous = Path.cwd()
            try:
                os.chdir(temp)
                Path('artifacts/WatchGuard').mkdir(parents=True)
                Path('artifacts/WatchGuard/Jellyfin.Plugin.WatchGuard.dll').write_bytes(b'dll')
                Path('artifacts/Jellyfin.Plugin.WatchGuard-v0.0.0.zip').write_bytes(b'zip')
                Path('Directory.Build.props').write_text('<Project><PropertyGroup><Version>0.0.0</Version></PropertyGroup></Project>')
                Path('global.json').write_text((ROOT / 'global.json').read_text())
                Path('tests/browser/node_modules/playwright').mkdir(parents=True)
                Path('tests/browser/node_modules/playwright/package.json').write_text('{"version":"1.56.1"}')
                Path('tests/browser/node_modules/playwright-core').mkdir()
                Path('tests/browser/node_modules/playwright-core/browsers.json').write_text('{"browsers":[{"name":"chromium"}]}')
                sdk = json.loads((ROOT / 'global.json').read_text())['sdk']['version']
                with patch.object(sys, 'argv', ['run_suite.py', 'basepath']), \
                     patch('platform.python_version', return_value=version), \
                     patch('platform.platform', return_value='fixture-host'), \
                     patch.object(subprocess, 'check_output', side_effect=lambda args, **kw: {'node':'v24.22.0','git':'commit','dotnet':sdk}[args[0]]), \
                     patch.object(subprocess, 'run', return_value=subprocess.CompletedProcess([], 0)) as run:
                    try:
                        runpy.run_path(str(ROOT / 'tests/run_suite.py'))
                    finally:
                        if version != REQUIRED:
                            self.assertFalse(run.called, 'Unsupported Python must not start a scenario')
                    report = json.loads(next(Path('artifacts/testing').glob('*/**/suite.json')).read_text())
                    self.assertEqual(version, report['python'])
                    self.assertEqual('PASS', report['status'])
                    self.assertTrue(run.called)
                    for call in run.call_args_list:
                        self.assertEqual(sys.executable, call.args[0][0])
            finally:
                os.chdir(previous)

    def test_suite_records_exact_version_and_uses_same_interpreter_for_children(self):
        self.run_suite(REQUIRED)

    def test_suite_rejects_a_different_patch_or_minor(self):
        for version in ['3.12.0', '3.13.0']:
            with self.subTest(version=version), self.assertRaisesRegex(AssertionError, 'from .python-version'):
                self.run_suite(version)

    def test_workflows_share_the_version_file_and_prefer_local_cache(self):
        for name in ['release', 'browser-benchmark', 'build']:
            text = (ROOT / f'.github/workflows/{name}.yaml').read_text()
            blocks = text.split('uses: actions/setup-python@v6')[1:]
            self.assertTrue(blocks)
            for block in blocks:
                settings = block.split('\n      - ', 1)[0]
                self.assertIn('python-version-file: .python-version', settings)
                self.assertIn('check-latest: false', settings)
                self.assertNotIn('python-version:', settings)
