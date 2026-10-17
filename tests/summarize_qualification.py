"""Render recorded fixture phases without copying credentials or full test logs."""
import json
import os
from pathlib import Path

lines=['## Disposable qualification phases','','| Fixture | Phase | Result | Seconds |','|---|---|---|---|']
for root in [Path('artifacts/testing'),Path('artifacts/server-enforcement')]:
    for file in sorted(root.rglob('phases.json')):
        data=json.loads(file.read_text())
        for phase in data['phases']:
            lines.append(f"| {file.parent.name} | {phase['phase']} | {phase['status']} | {phase.get('seconds','unfinished')} |")
if len(lines)==4: lines.append('| — | Environment setup (no fixture phase evidence) | Inspect failed workflow step | — |')
lines+=['','No destructive retries are performed. A failed or unfinished phase blocks qualification.']
text='\n'.join(lines)+'\n'
print(text)
if os.environ.get('GITHUB_STEP_SUMMARY'):
    with open(os.environ['GITHUB_STEP_SUMMARY'],'a') as summary:summary.write(text)
