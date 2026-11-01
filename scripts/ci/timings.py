"""GitHub timing evidence: wall time, execution and dependency-ready delay.

Run after completion for final wall time. Within the qualification gate, the
report explicitly excludes that still-running job from execution totals.
"""
import argparse
from datetime import datetime
import json
import os
from pathlib import Path
import subprocess


def timestamp(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00'))


def duration(start, end):
    value = (timestamp(end)-timestamp(start)).total_seconds()
    return value if value >= 0 else None


def summarize(run, jobs):
    completed = [j for j in jobs if j.get('completed_at') and j.get('conclusion') != 'skipped']
    plan = next((j for j in jobs if j['name'] == 'plan'), None)
    build = next((j for j in jobs if j['name'] == 'build'), None)
    integrations = [j for j in jobs if j['name'].startswith('Integration /')]
    gate = next((j for j in jobs if j['name'] == 'Verify complete compatibility evidence'), None)
    inspection = next((j for j in jobs if j['name'] == 'inspect'), None)
    origin = run.get('run_started_at', run['created_at']) if run.get('run_attempt', 1) > 1 else run['created_at']
    rows = []
    all_steps = []
    anomalies = []
    for job in completed:
        ready = origin
        if job['name'] == 'build' and plan and plan.get('completed_at'):
            ready = plan['completed_at']
        elif job in integrations and build and build.get('completed_at'):
            ready = build['completed_at']
        elif job['name'] == 'Verify complete compatibility evidence' and integrations:
            ready = max((j['completed_at'] for j in integrations if j.get('completed_at')), default=origin)
        elif job['name'] == 'publication-rehearsal' and gate and gate.get('completed_at'):
            ready = gate['completed_at']
        elif job['name'] == 'status':
            dependencies = [j for j in jobs if j['name'] in ('plan', 'build', 'Verify complete compatibility evidence') or j in integrations]
            ready = max((j['completed_at'] for j in dependencies if j.get('completed_at')), default=origin)
        elif job['name'] == 'publish':
            prerequisite = inspection or gate
            if prerequisite and prerequisite.get('completed_at'):
                ready = prerequisite['completed_at']
        steps = []
        for step in job.get('steps', []):
            if step.get('conclusion') == 'skipped' or not step.get('completed_at'): continue
            name = step['name']; category = 'other'
            if any(term in name.lower() for term in ('setup-', 'set up job', 'checkout', 'npm ci', 'playwright install', 'browser setup', 'preinstalled browser', 'zstd decoder', 'proxy decoder')):
                category = 'setup'
            if any(term in name.lower() for term in ('download', 'pull pinned', 'extract verified')):
                category = 'download'
            if name == 'Complete disposable regression suite': category = 'fixtures-and-checks'
            if 'upload' in name.lower() or 'post ' in name.lower(): category = 'evidence-and-cleanup'
            seconds = duration(step['started_at'],step['completed_at'])
            steps.append(dict(name=name, category=category, seconds=seconds, startedAt=step['started_at'], completedAt=step['completed_at']))
            all_steps.append(steps[-1])
            if seconds is None: anomalies.append(dict(job=job['name'], step=name, reason='Step completion precedes start'))
        execution = duration(job['started_at'],job['completed_at'])
        delay = duration(ready,job['started_at'])
        if execution is None: anomalies.append(dict(job=job['name'], reason='Job completion precedes start'))
        if delay is None: anomalies.append(dict(job=job['name'], reason='Job starts before dependency completion'))
        step_span = duration(min(s['startedAt'] for s in steps),max(s['completedAt'] for s in steps)) if steps else None
        rows.append(dict(name=job['name'], id=job['id'], conclusion=job['conclusion'],
                         executionSeconds=execution, stepSpanSeconds=step_span,
                         rawTimes=dict(startedAt=job['started_at'],completedAt=job['completed_at'],dependencyReadyAt=ready),
                         readyToStartSeconds=delay, readyDelayIncludesApproval=job['name'] == 'publish', steps=steps))
    end = run['updated_at'] if run['status'] == 'completed' else max((j['completed_at'] for j in completed), default=run['created_at'])
    elapsed = duration(origin,end)
    if elapsed is None: anomalies.append(dict(reason='Workflow completion precedes origin'))
    def total(values):
        return None if any(v is None for v in values) else sum(values)
    return dict(runId=run['id'],runAttempt=run.get('run_attempt', 1),commit=run['head_sha'],status=run['status'],conclusion=run['conclusion'],
                elapsedSeconds=elapsed, rawTimes=dict(origin=origin,end=end), timestampAnomalies=anomalies,
                workflowStepSpanSeconds=duration(min(s['startedAt'] for s in all_steps),max(s['completedAt'] for s in all_steps)) if all_steps else None,
                combinedStepExecutionSeconds=total([s['seconds'] for s in all_steps]),
                stepDefinition='Step execution sums recorded step intervals; workflow step span is first recorded step to last completed step. Neither substitutes for end-to-end elapsed/queue time when job timestamps are inconsistent.',
                combinedJobExecutionSeconds=total([j['executionSeconds'] for j in rows]),
                combinedReadyToStartSeconds=total([j['readyToStartSeconds'] for j in rows]),
                queueDefinition='Dependency-ready to job start; includes scheduler/runner provisioning and, for publication, environment approval. GitHub does not expose an exact runner queue timestamp.',
                elapsedDefinition='First attempt: workflow creation to completion. Later attempts: attempt start to completion.',
                executionDefinition='Sum of completed non-skipped job intervals, including setup and cleanup; overlapping jobs count separately.',
                incompleteJobs=[j['name'] for j in jobs if not j.get('completed_at')],jobs=rows)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run',default=os.environ.get('GITHUB_RUN_ID'))
    parser.add_argument('--attempt', type=int, default=int(os.environ.get('GITHUB_RUN_ATTEMPT', '1')))
    parser.add_argument('--repo',default=os.environ.get('GITHUB_REPOSITORY','MajorSchloch/jellyfin-plugin-watchguard'))
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    def api(path): return json.loads(subprocess.check_output(['gh','api',path],text=True))
    base=f'repos/{args.repo}/actions/runs/{args.run}'
    run=api(base+f'/attempts/{args.attempt}');jobs=[];page=1
    while True:
        batch=api(base+f'/attempts/{args.attempt}/jobs?per_page=100&page={page}')['jobs'];jobs+=batch
        if len(batch)<100: break
        page+=1
    report=summarize(run,jobs)
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(report,indent=2)+'\n')
    show=lambda value: 'unavailable' if value is None else f'{value:.0f}s'
    text=(f"## Qualification timing ({report['status']})\n\n"
          f"Elapsed: {show(report['elapsedSeconds'])}; combined completed-job execution: {show(report['combinedJobExecutionSeconds'])}.\n\n"
          f"Recorded step span: {show(report['workflowStepSpanSeconds'])}; combined step execution: {show(report['combinedStepExecutionSeconds'])}.\n\n"
          + report['queueDefinition']+'\n\n| Job | Execution seconds | Ready-to-start seconds |\n|---|---:|---:|\n'
          +'\n'.join(f"| {j['name']} | {show(j['executionSeconds'])} | {show(j['readyToStartSeconds'])} |" for j in report['jobs'])+'\n')
    if report['timestampAnomalies']: text+='\nTimestamp anomalies: '+str(len(report['timestampAnomalies']))+'. Invalid intervals are unavailable, never clamped to zero. See retained raw times.\n'
    if report['incompleteJobs']: text+='\nStill running and excluded from execution totals: '+', '.join(report['incompleteJobs'])+'.\n'
    print(text)
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'],'a') as file: file.write(text)

if __name__=='__main__': main()
