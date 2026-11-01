"""Publication evidence must cover every required host/suite using the exact same runtime."""
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
        return [dict(schemaVersion=2, jellyfinVersion=version, suite=suite, shard=qualification.SUITE_SHARD[suite], status='PASS', commit='commit',
                     packageSha256='zip', runtimeSha256='dll', upgradeBaseline=dict(result='PASS',candidateSha256='zip',previous={'sha256':'baseline'},previousDllSha256='old-dll'), attempts=[dict(scenario=s['id'],command=s['command'],environment=s['env'],exitCode=0,retry=False) for s in qualification.PLAN[suite]])
                for version,suite in qualification.PAIRS]

    def verify(self, reports):
        return qualification.verify(reports, 'commit', 'zip', 'dll')

    def test_explicit_policy_retains_required_behavior_and_retires_old_ladders(self):
        self.assertEqual({'12.4':'full','12.3':'core'}, {k:v['level'] for k,v in qualification.POLICY['hosts'].items()})
        self.assertEqual('12.2.0.0', qualification.POLICY['minimumAbi'])
        self.assertEqual({'activity-index','activity-browser','basepath','basepath-navigation',
                          'server-enforcement','server-enforcement-basepath','server-enforcement-linuxserver',
                          'upgrade','browser79','verification'}, set(qualification.SUITES))
        self.assertEqual({'basepath','server-enforcement','upgrade'}, {s for v,s in qualification.PAIRS if v=='12.3'})
        self.assertTrue(any('--previous-stable' in c['command'] for c in qualification.PLAN['upgrade']))
        self.assertTrue(any('--browser79' in c['command'] for c in qualification.PLAN['browser79']))
        ids=[c['id'] for commands in qualification.PLAN.values() for c in commands]
        self.assertEqual(len(ids),len(set(ids)))
        self.assertNotIn('legacy',qualification.SUITES)
        self.assertNotIn('migration',qualification.SUITES)

    def test_complete_identical_package_matrix(self):
        self.assertEqual(13, len(self.reports()))
        self.assertEqual('PASS', self.verify(self.reports())['result'])

    def test_one_host_or_missing_duplicate_or_extra_suite_cannot_publish(self):
        reports = self.reports()
        for invalid in (reports[:11], reports[:3], reports[:-1], reports + [reports[0]],
                        reports + [dict(reports[0], jellyfinVersion='12.5')]):
            with self.subTest(count=len(invalid)), self.assertRaises(ValueError):
                self.verify(invalid)

    def test_failed_incomplete_retried_or_mixed_runtime_cannot_publish(self):
        for change in ({'shard': 'wrong'}, {'status': 'RUNNING'}, {'status': 'FAIL'}, {'attempts': []},
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
        source = (ROOT / '.github/workflows/release.yaml').read_text()
        self.assertIn('matrix: ${{ fromJSON(needs.plan.outputs.matrix) }}',source.split('  integration:',1)[1])
        self.assertIn('matrix: ${{ steps.matrix.outputs.matrix }}',source.split('  build:',1)[0])
        self.assertIn('qualification_policy.py --matrix',source)
        self.assertIn('qualification_policy.py --suites',source)
        publication = (ROOT / '.github/workflows/publish.yaml').read_text()
        self.assertIn('needs: inspect', publication)
        self.assertIn('environment: release', publication)
        workflow_name = source.splitlines()[0].removeprefix('name: ').strip()
        self.assertIn(f'workflows: [{workflow_name}]', publication)
        inspection, approved = publication.split('\n  publish:\n', 1)
        self.assertNotIn('contents: write', inspection)
        self.assertNotIn('--write', inspection)
        self.assertIn('environment: release', approved)
        self.assertIn('--write', approved)
        self.assertIn('github.ref_name == github.event.repository.default_branch', publication)
        self.assertNotIn('build-release.py', publication)
        self.assertIn("github.event_name == 'push' || inputs.proxy_matrix || inputs.publish", source)
        self.assertEqual(source.count('name: WatchGuard-package-attempt-${{ github.run_attempt }}'), 3)
        self.assertIn("artifact_name('package', attempt)", (ROOT / 'scripts/release_provenance.py').read_text())
        self.assertIn('WatchGuard-evidence-${{ matrix.jellyfin_version }}-${{ matrix.shard }}-attempt-${{ github.run_attempt }}', source)
        ignored=source.split('    paths-ignore:',1)[1].split('  workflow_dispatch:',1)[0]
        self.assertIn("- 'manifest.json'",ignored)
        self.assertNotIn("- 'docs/**'",ignored)
        self.assertNotIn("- 'README.md'",ignored)
        self.assertNotIn('paths: [Directory.Build.props]', source)
        self.assertIn('--validate-branch --verify-record', source)
