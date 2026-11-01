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

    def test_preflight_gate_and_approval_waits_have_separate_dependencies(self):
        def job(name,start,end):
            return dict(name=name,id=name,started_at=f'2026-10-28T00:{start}:00Z',completed_at=f'2026-10-28T00:{end}:00Z',conclusion='success',steps=[])
        run=dict(id=1,head_sha='abc',status='completed',conclusion='success',created_at='2026-10-28T00:00:00Z',updated_at='2026-10-28T00:15:00Z')
        jobs=[job('plan','00','01'),job('build','01','02'),job('Integration / 12.2 / a','02','12'),
              job('Verify complete compatibility evidence','12','13'),job('status','13','14'),job('publication-rehearsal','13','15')]
        result=timings.summarize(run,jobs)
        self.assertEqual([r['readyToStartSeconds'] for r in result['jobs']],[0]*6)
        result=timings.summarize(run,[job('inspect','00','01'),job('publish','10','15')])
        self.assertEqual(result['jobs'][1]['readyToStartSeconds'],540)
        self.assertTrue(result['jobs'][1]['readyDelayIncludesApproval'])
        result=timings.summarize(run,[job('Verify complete compatibility evidence','00','01'),job('publish','10','15')])
        self.assertEqual(result['jobs'][1]['readyToStartSeconds'],540)
        run.update(run_attempt=2,run_started_at='2026-10-28T00:10:00Z')
        self.assertEqual(timings.summarize(run,[job('plan','10','15')])['elapsedSeconds'],300)

    def test_inconsistent_job_timestamps_are_not_false_zero_speedups(self):
        run=dict(id=1,head_sha='abc',status='completed',conclusion='success',created_at='2026-11-01T09:51:34Z',updated_at='2026-11-01T09:13:31Z')
        jobs=[dict(name='build',id=2,started_at='2026-11-01T09:55:53Z',completed_at='2026-11-01T09:09:38Z',conclusion='success',
                   steps=[dict(name='fixture',conclusion='success',started_at='2026-11-01T08:57:04Z',completed_at='2026-11-01T09:09:32Z')])]
        result=timings.summarize(run,jobs)
        self.assertIsNone(result['elapsedSeconds'])
        self.assertIsNone(result['combinedJobExecutionSeconds'])
        self.assertEqual(result['combinedStepExecutionSeconds'],748)
        self.assertEqual(result['workflowStepSpanSeconds'],748)
        self.assertEqual(len(result['timestampAnomalies']),2)
        self.assertEqual(result['jobs'][0]['rawTimes']['completedAt'],jobs[0]['completed_at'])

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
