"""Negative coverage for the deployed-package proof behind the narrow limitation."""
import hashlib
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile
import fixture_package_identity as identity


class FixturePackageIdentityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.archive = Path(self.temp.name)/'package.zip'
        with zipfile.ZipFile(self.archive, 'w') as archive:
            archive.writestr(identity.DLL, b'fixture dll')
        self.dll = hashlib.sha256(b'fixture dll').hexdigest()
        self.pin = {'version':'0.3.1', 'packageSha256':hashlib.sha256(self.archive.read_bytes()).hexdigest(), 'dllSha256':self.dll}
        self.plugins = [{'Id':identity.GUID, 'Status':'Active', 'Version':'0.3.1.0'}]

    def verify(self, **changes):
        args = {'archive':self.archive, 'deployed_sha256':self.dll, 'plugins':self.plugins,
                'reported_version':'0.3.1', 'expected_version':'0.3.1'}
        args.update(changes)
        return identity.verify(**args)

    def test_exact_package_deployed_bytes_and_active_version(self):
        with patch.object(identity, 'PUBLISHED', self.pin):
            proof = self.verify()
            self.assertEqual(proof['packageSha256'], self.pin['packageSha256'])
            self.assertEqual(proof['deployedDllSha256'], self.dll)

    def test_wrong_archive_cannot_use_published_exception(self):
        with self.assertRaisesRegex(AssertionError, 'Unknown historical ZIP'):
            self.verify()

    def test_changed_deployment_status_and_version_fail(self):
        with patch.object(identity, 'PUBLISHED', self.pin):
            for changes in [{'deployed_sha256':'0'*64}, {'plugins':[]}, {'plugins':self.plugins*2},
                            {'plugins':[dict(self.plugins[0],Status='Disabled')]},
                            {'plugins':[dict(self.plugins[0],Version='0.7.13.0')]},
                            {'reported_version':'0.7.13'}, {'expected_version':'99.0.0'}]:
                with self.subTest(changes=changes), self.assertRaises(AssertionError):
                    self.verify(**changes)

    def test_changed_pinned_dll_fails_even_if_deployed_matches_archive(self):
        with patch.object(identity, 'PUBLISHED', dict(self.pin,dllSha256='0'*64)):
            with self.assertRaisesRegex(AssertionError, 'Unknown historical DLL'):
                self.verify()

    def test_duplicate_runtime_is_rejected(self):
        with zipfile.ZipFile(self.archive,'a') as archive:
            import warnings
            with warnings.catch_warnings():
                warnings.simplefilter('ignore', UserWarning)
                archive.writestr(identity.DLL,b'other')
        with self.assertRaisesRegex(AssertionError,'Ambiguous'):
            self.verify()

    def test_current_package_requires_matching_deployment_and_native_identity(self):
        proof=self.verify(expected_version=identity.CANDIDATE,reported_version=identity.CANDIDATE,
                          plugins=[dict(self.plugins[0],Version=identity.CANDIDATE+'.0')])
        self.assertEqual(proof['version'],identity.CANDIDATE)
