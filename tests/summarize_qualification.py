"""Render recorded fixture phases without copying credentials or full test logs."""
import json
import html
import os
from pathlib import Path

failures=[]
lines=['## Disposable qualification phases','','| Fixture | Phase | Result | Seconds |','|---|---|---|---|']
for root in [Path('artifacts/testing'),Path('artifacts/server-enforcement')]:
    for file in sorted(root.rglob('phases.json')):
        data=json.loads(file.read_text())
        for phase in data['phases']:
            if phase['status'] != 'PASS':
                failures.append((phase['phase'],phase.get('exceptionType','IncompletePhase'),phase.get('message','Phase did not report completion; inspect process exit.')))
            lines.append(f"| {file.parent.as_posix().replace('artifacts/','')} | {phase['phase']} | {phase['status']} | {phase.get('seconds','unfinished')} |")
if len(lines)==4: lines.append('| — | Environment setup (no fixture phase evidence) | Inspect failed workflow step | — |')
lines+=['','No destructive retries are performed. A failed or unfinished phase blocks qualification.']
details=[]
if failures:
    phase,kind,message=failures[0]
    subsystem='media readiness' if phase=='media-indexing' else 'teardown' if phase=='teardown' else 'native security assertions' if phase=='native-security-regressions' else 'browser contract' if 'browser' in phase else 'fixture/integration setup'
    details=['## First failed phase','',f'**{phase}** · {subsystem} · {kind}', '', html.escape(message[:800]).replace('|','&#124;'),'']
for root in [Path('artifacts/v049'),Path('artifacts/server-enforcement')]:
    for file in sorted(root.rglob('*-readiness.json')):
        state=json.loads(file.read_text())
        if state.get('failure'):
            details += ['Browser assertion: '+html.escape(state['failure']['message'][:800]),'']
            break
retries=sum(1 for root in [Path('artifacts/v049'),Path('artifacts/server-enforcement')] for file in root.rglob('*-attempt.json'))
lines+=['',f'Safe browser setup retries: {retries}. First-attempt evidence is retained. Suite/deletion retries are disabled.']
pull_attempts=Path('artifacts/testing/image-pull-attempts.txt')
if pull_attempts.exists():lines.append('Registry image pull attempts: '+str(int(pull_attempts.read_text().strip())))
readiness=[]
for root in [Path('artifacts/v049'),Path('artifacts/server-enforcement')]:
    for file in sorted(root.rglob('browser-timing-*.json')):
        data=json.loads(file.read_text());readiness.append(f"| {data['phase']} | {data['ms']} |")
if readiness:lines+=['','### Browser initialization','','| Contract | Milliseconds |','|---|---|',*readiness]
browser = Path('artifacts/activity-browser/ui/results.json')
if browser.exists():
    lines += ['', '### Native activity browser phases (within browser fixture time)', '', '| Scenario | Seconds |', '|---|---:|']
    for row in json.loads(browser.read_text()).get('phaseTimings', []):
        lines.append(f"| {row['phase']} | {row['seconds']:.3f} |")
text='\n'.join(details+lines)+'\n'
print(text)
if os.environ.get('GITHUB_STEP_SUMMARY'):
    with open(os.environ['GITHUB_STEP_SUMMARY'],'a') as summary:summary.write(text)
