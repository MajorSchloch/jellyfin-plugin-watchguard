"""Publication evidence must cover all three hosts using the exact same runtime."""
import copy
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('qualification', ROOT / 'scripts/qualification.py')
qualification = importlib.util.module_from_spec(spec)
spec.loader.exec_module(qualification)


class QualificationTests(unittest.TestCase):
    def reports(self):
        return [dict(schemaVersion=2, jellyfinVersion=version, suite=suite, status='PASS', commit='commit',
                     packageSha256='zip', runtimeSha256='dll', attempts=[dict(scenario=s['id'],command=s['command'],environment=s['env'],exitCode=0,retry=False) for s in qualification.PLAN[suite]])
                for version in qualification.VERSIONS for suite in qualification.SUITES]

    def verify(self, reports):
        return qualification.verify(reports, 'commit', 'zip', 'dll')

    def test_original_scenario_inventory_is_preserved(self):
        # Baseline 40557055801's command inventory, with only the activity
        # browser moved into a second fixture. Independent of plan iteration.
        expected = {'standalone-catalog-upgrades-preferences-caddy', 'injector-migration',
                    'basepath-full-browser', 'basepath-native-catalog',
                    'basepath-drawer-navigation', 'basepath-startup',
                    'legacy-catalog', 'legacy-browser', 'caddy-websocket-measure',
                    'activity-native-comparisons', 'activity-native-browser-polling',
                    'discovery-v045', 'verification-default', 'verification-policies',
                    'discovery-v047', 'enforcement-official-proxies',
                    'enforcement-basepath', 'enforcement-linuxserver'}
        actual = [s['id'] for suite in qualification.PLAN.values() for s in suite]
        self.assertEqual(expected, set(actual))
        self.assertEqual(len(expected), len(actual))

    def test_complete_identical_package_matrix(self):
        self.assertEqual(39, len(self.reports()))
        self.assertEqual('PASS', self.verify(self.reports())['result'])

    def test_one_host_or_missing_duplicate_or_extra_suite_cannot_publish(self):
        reports = self.reports()
        for invalid in (reports[:11], reports[:22], reports[:-1], reports + [reports[0]],
                        reports + [dict(reports[0], jellyfinVersion='12.5')]):
            with self.subTest(count=len(invalid)), self.assertRaises(ValueError):
                self.verify(invalid)

    def test_failed_incomplete_retried_or_mixed_runtime_cannot_publish(self):
        for change in ({'status': 'RUNNING'}, {'status': 'FAIL'}, {'attempts': []},
                       {'attempts': [dict(exitCode=1, retry=False)]},
                       {'attempts': [dict(exitCode=0, retry=True)]},
                       {'commit': 'other'}, {'packageSha256': 'other'}, {'runtimeSha256': 'other'}):
            reports = copy.deepcopy(self.reports()); reports[-1].update(change)
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.verify(reports)

    def test_missing_duplicate_reordered_or_mismatched_scenarios_cannot_publish(self):
        for change in ('missing', 'duplicate', 'order', 'command', 'environment', 'id', 'schema'):
            reports = copy.deepcopy(self.reports())
            report = next(r for r in reports if r['suite'] == 'basepath-navigation')
            attempts = report['attempts']
            if change == 'missing': attempts.pop()
            if change == 'duplicate': attempts.append(copy.deepcopy(attempts[0]))
            if change == 'order': attempts.reverse()
            if change == 'command': attempts[0]['command'] = ['tests/docker-smoke.py']
            if change == 'environment': attempts[0]['environment'] = {'skip': 'true'}
            if change == 'id': attempts[0]['scenario'] = 'unrelated'
            if change == 'schema': report.pop('schemaVersion')
            with self.subTest(change=change), self.assertRaises(ValueError): self.verify(reports)

    def test_requested_proxy_coverage_is_required_on_all_hosts(self):
        reports = self.reports()
        with self.assertRaises(ValueError):
            qualification.verify(reports, 'commit', 'zip', 'dll', True)
        for report in reports:
            report['proxyMatrix'] = report['suite'] == 'server-enforcement'
        self.assertEqual('PASS', qualification.verify(reports, 'commit', 'zip', 'dll', True)['result'])
        for version in qualification.VERSIONS:
            incomplete = copy.deepcopy(reports)
            next(r for r in incomplete if r['jellyfinVersion'] == version and r['suite'] == 'server-enforcement')['proxyMatrix'] = False
            with self.subTest(version=version), self.assertRaises(ValueError):
                qualification.verify(incomplete, 'commit', 'zip', 'dll', True)

    def test_workflow_requires_full_matrix_and_reuses_build_artifact(self):
        # Keep the gate's expected matrix synchronized with the dispatch workflow.
        import re
        source = (ROOT / '.github/workflows/release.yaml').read_text()
        matrix = source.split('      matrix:', 1)[1].split('    steps:', 1)[0]
        for field, expected in [('jellyfin_version', qualification.VERSIONS), ('suite', qualification.SUITES)]:
            values = re.search(rf'{field}: \[(.+)\]', matrix).group(1)
            actual = [v.strip().strip("'\"") for v in values.split(',')]
            self.assertEqual(list(expected), actual)
        publication = source.split('\n  publish:\n', 1)[1]
        self.assertIn('needs: [build, integration, qualification]', publication)
        self.assertIn('if: inputs.publish && github.ref_name == github.event.repository.default_branch', publication)
        self.assertNotIn('always()', publication)
        self.assertNotIn('build-release.py', publication)
        self.assertIn("(inputs.proxy_matrix || inputs.publish)", source)
        artifacts = re.findall(r'name: (WatchGuard-v[^\s]+-validated)', source)
        self.assertEqual(len(artifacts), 4)
        self.assertEqual(len(set(artifacts)), 1)
        self.assertIn('WatchGuard-evidence-${{ matrix.jellyfin_version }}-${{ matrix.suite }}', source)
