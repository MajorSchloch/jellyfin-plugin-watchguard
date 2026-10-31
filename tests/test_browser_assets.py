"""Negative checks for the delivered-resource gate, independent of a Jellyfin fixture."""
from pathlib import Path
import runpy
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parents[1]
CHECK = ROOT / 'scripts/browser/check.cjs'
RESOURCES = {
    'Web.navigation.js': 'var navigation = {};',
    'Web.watchguard.js': 'var diagnostics = /*WATCHGUARD_DIAGNOSTICS*/false; var enforcement = /*WATCHGUARD_SERVER_EXPECTED*/false;',
    'Web.settings.html': '<script>var settings = {};</script>',
    'Standalone.bootstrap.js': 'var build = "WATCHGUARD_BUILD_ID";',
    'Standalone.startup.js': 'var startup = {};',
}


def assets(folder, omit=None):
    folder.mkdir(parents=True, exist_ok=True)
    for name, source in RESOURCES.items():
        if name != omit:
            (folder / ('Jellyfin.Plugin.WatchGuard.' + name)).write_text(source)


class BrowserAssetGateTests(unittest.TestCase):
    def check(self, folder):
        return subprocess.run(['node', str(CHECK), str(folder)], capture_output=True).returncode

    def test_inventory_and_syntax_cover_each_delivered_resource(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            assets(folder)
            self.assertEqual(self.check(folder), 0)
            for name, source in RESOURCES.items():
                with self.subTest(resource=name):
                    resource = folder / ('Jellyfin.Plugin.WatchGuard.' + name)
                    resource.unlink()
                    self.assertNotEqual(self.check(folder), 0)
                    resource.write_text(source.replace('</script>', 'var unsupported = settings?.value;</script>')
                                        if name.endswith('.html') else source + '\nvar unsupported = value?.field;')
                    self.assertNotEqual(self.check(folder), 0)
                    resource.write_text(source)

    def test_unsupported_apis_and_lost_server_switches_are_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            assets(folder)
            runtime = folder / 'Jellyfin.Plugin.WatchGuard.Web.watchguard.js'
            source = runtime.read_text()
            for statement in ['value.replaceAll("-", "");', 'node.replaceChildren();', 'Object.hasOwn(value, "key");']:
                with self.subTest(statement=statement):
                    runtime.write_text(source + statement)
                    self.assertNotEqual(self.check(folder), 0)
            runtime.write_text(source.replace('/*WATCHGUARD_SERVER_EXPECTED*/', ''))
            self.assertNotEqual(self.check(folder), 0)

    def test_previous_extraction_cannot_hide_a_missing_packaged_resource(self):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            output = folder / 'previous'
            assets(output)  # A valid, older extraction already exists.
            archive = folder / 'candidate.zip'
            with zipfile.ZipFile(archive, 'w') as package:
                package.writestr('Jellyfin.Plugin.WatchGuard.dll', b'extraction stub')
            real_run = subprocess.run

            def extract_or_check(command, **kwargs):
                if command[0] == 'dotnet':
                    assets(Path(command[-1]), omit='Web.watchguard.js')
                    return subprocess.CompletedProcess(command, 0)
                return real_run(command, **kwargs, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

            with patch.object(sys, 'argv', ['check-browser-assets.py', str(archive), '--output', str(output)]), patch('subprocess.run', side_effect=extract_or_check):
                with self.assertRaises(subprocess.CalledProcessError):
                    runpy.run_path(str(ROOT / 'scripts/check-browser-assets.py'), run_name='__main__')


if __name__ == '__main__':
    unittest.main()
