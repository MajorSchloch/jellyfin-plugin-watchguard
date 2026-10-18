"""Exercise the shared integration-status gate without starting a server."""
import copy
from pathlib import Path
import runpy
import unittest
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
BACKEND = runpy.run_path(str(ROOT / 'tests/backend-smoke.py'))
CANDIDATE_VERSION = ET.parse(ROOT / 'Directory.Build.props').findtext('./PropertyGroup/Version')


class StatusAccepted(Exception):
    """Stop the fixture after its real status assertions, before CRUD begins."""


def status(version):
    return {
        'PluginVersion': version,
        'PluginLoaded': True,
        'BrowserExecutionVerified': False,
        'Standalone': {
            'Enabled': True,
            'LoaderActive': True,
            'AuthenticatedScriptResponsesCompleted': 1,
            'BrowserExecutionVerified': False,
        },
    }


def run_to_status(response, standalone=True):
    config = {'ActivityWindowDays': 30, 'ActivityLimit': 100, 'DiagnosticMode': False}

    def call(route, method='GET', body=None, token=None, **kwargs):
        if route.endswith('/Configuration'):
            if method == 'POST':
                config.clear()
                config.update(body)
            return dict(config)
        if route in ('/WatchGuard/Standalone/script.js', '/JavaScriptInjector/private.js'):
            return 'let diagnostic = ' + str(config['DiagnosticMode']).lower() + ';'
        if route == '/web/ConfigurationPage?name=WatchGuard':
            return 'WatchGuardSettings'
        if route == '/WatchGuard/IntegrationStatus':
            return copy.deepcopy(response)
        if route == '/WatchGuard/Preferences':
            raise StatusAccepted()
        raise AssertionError('Unexpected fixture request: ' + route)

    BACKEND['run'](call, 'synthetic-token', {
        'PoC Modern Movie': 'synthetic-movie', 'PoC Series Detail': 'synthetic-series',
    }, None, standalone=standalone)


class BackendSmokeStatusTests(unittest.TestCase):
    def test_current_candidate_passes_the_shared_status_gate(self):
        self.assertIsNotNone(CANDIDATE_VERSION)
        with self.assertRaises(StatusAccepted):
            run_to_status(status(CANDIDATE_VERSION))

    def test_legacy_fixture_keeps_its_published_version(self):
        with self.assertRaises(StatusAccepted):
            run_to_status(status('0.3.1'), standalone=False)

    def test_wrong_installed_versions_are_rejected(self):
        for standalone, version in [(True, '0.4.10'), (True, '0.3.1'),
                                    (True, '99.0.0'), (False, CANDIDATE_VERSION)]:
            with self.subTest(standalone=standalone, version=version):
                with self.assertRaises(AssertionError):
                    run_to_status(status(version), standalone=standalone)

    def test_correct_version_cannot_bypass_readiness_or_claim_browser_execution(self):
        for field, value in [('PluginLoaded', False), ('BrowserExecutionVerified', True)]:
            with self.subTest(field=field):
                response = status(CANDIDATE_VERSION)
                response[field] = value
                with self.assertRaises(AssertionError):
                    run_to_status(response)
        for field, value in [('Enabled', False), ('LoaderActive', False),
                             ('AuthenticatedScriptResponsesCompleted', 0), ('BrowserExecutionVerified', True)]:
            with self.subTest(field=field):
                response = status(CANDIDATE_VERSION)
                response['Standalone'][field] = value
                with self.assertRaises(AssertionError):
                    run_to_status(response)


if __name__ == '__main__':
    unittest.main()
