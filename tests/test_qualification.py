"""Publication evidence must cover both hosts using the exact same runtime."""
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
        return [dict(jellyfinVersion=version, suite=suite, status='PASS', commit='commit',
                     packageSha256='zip', runtimeSha256='dll', attempts=[dict(exitCode=0, retry=False)])
                for version in qualification.VERSIONS for suite in qualification.SUITES]

    def verify(self, reports):
        return qualification.verify(reports, 'commit', 'zip', 'dll')

    def test_complete_identical_package_matrix(self):
        self.assertEqual('PASS', self.verify(self.reports())['result'])

    def test_one_host_or_missing_duplicate_or_extra_suite_cannot_publish(self):
        reports = self.reports()
        for invalid in (reports[:11], reports[:-1], reports + [reports[0]],
                        reports + [dict(reports[0], jellyfinVersion='12.4')]):
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

    def test_requested_proxy_coverage_is_required_on_both_hosts(self):
        reports = self.reports()
        with self.assertRaises(ValueError):
            qualification.verify(reports, 'commit', 'zip', 'dll', True)
        for report in reports:
            report['proxyMatrix'] = report['suite'] == 'server-enforcement'
        self.assertEqual('PASS', qualification.verify(reports, 'commit', 'zip', 'dll', True)['result'])

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
