import importlib.util
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('timings',ROOT/'scripts/ci/timings.py')
timings=importlib.util.module_from_spec(spec);spec.loader.exec_module(timings)

class TimingTests(unittest.TestCase):
    def test_overlap_and_queue_are_not_counted_as_wall_execution(self):
        def job(name,id,start,end):
            return dict(name=name,id=id,started_at=f'2026-10-28T00:{start}:00Z',completed_at=f'2026-10-28T00:{end}:00Z',conclusion='success',steps=[])
        run=dict(id=1,head_sha='abc',status='completed',conclusion='success',created_at='2026-10-28T00:00:00Z',updated_at='2026-10-28T00:15:00Z')
        jobs=[job('build',1,'01','02'),job('Integration / 12.2 / a',2,'02','12'),job('Integration / 12.3 / a',3,'04','14'),job('Verify complete compatibility evidence',4,'14','15')]
        result=timings.summarize(run,jobs)
        self.assertEqual(result['elapsedSeconds'],900)
        self.assertEqual(result['combinedJobExecutionSeconds'],1320)
        self.assertEqual([j['readyToStartSeconds'] for j in result['jobs']],[60,0,120,0])

    def test_running_job_excluded_and_identified(self):
        run=dict(id=1,head_sha='abc',status='in_progress',conclusion=None,created_at='2026-10-28T00:00:00Z',updated_at='2026-10-28T00:01:00Z')
        result=timings.summarize(run,[dict(name='build',completed_at=None)])
        self.assertEqual(result['combinedJobExecutionSeconds'],0)
        self.assertEqual(result['incompleteJobs'],['build'])

class WorkflowTests(unittest.TestCase):
    def test_one_pr_trigger_and_master_push_with_development_cancellation(self):
        source=(ROOT/'.github/workflows/build.yaml').read_text()
        self.assertIn('push:\n    branches: [master]',source)
        self.assertIn('  pull_request:',source)
        self.assertIn('  workflow_dispatch:',source)
        self.assertIn('github.event.pull_request.number || github.ref',source)
        self.assertIn('cancel-in-progress: true',source)
        release=(ROOT/'.github/workflows/release.yaml').read_text()
        self.assertIn("format('watchguard-qualification-{0}', github.ref)",release)
        self.assertIn("format('watchguard-inspect-{0}', github.ref)",release)
        self.assertIn('cancel-in-progress: false',release)
        publisher=(ROOT/'.github/workflows/publish.yaml').read_text()
        self.assertIn('environment: release',publisher)
        self.assertIn('group: watchguard-release',publisher)
        self.assertIn('cancel-in-progress: false',publisher)
