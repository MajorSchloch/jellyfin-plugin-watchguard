"""Bounded failure evidence from owned disposable containers only."""
import json
import re
import subprocess
from pathlib import Path


def redact(text):
    text=re.sub(r'(?im)(authorization|cookie|set-cookie|x-watchguard-approval)[:=][^\r\n]*',r'\1: [REDACTED]',text)
    text=re.sub(r'(?i)(authorization|cookie|set-cookie|x-watchguard-approval|access_token|api_key|token|password|pw|challengeid|approvalid)([\s\"\x27:=]+)[^\s,\r\n]+',r'\1\2[REDACTED]',text)
    # Opaque operation IDs, account tokens and GUIDs are unnecessary in logs.
    return re.sub(r'\b[A-Za-z0-9_-]{32,}\b','[IDENTIFIER]',text)


def capture(output, container, error, read=None):
    if not container.startswith(('watchguard-poc-','wg-approval-test-')):
        raise ValueError('Refusing evidence capture from non-fixture container')
    output=Path(output);output.mkdir(parents=True,exist_ok=True)
    report={'status':'FAIL','exceptionType':type(error).__name__,'message':redact(str(error))}
    for key,args in [('container',['inspect','--format','{{json .State}}',container]),('logs',['logs','--tail','250',container])]:
        try:
            result=subprocess.run(['docker',*args],capture_output=True,text=True,timeout=15)
            (output/(key+'.txt')).write_text(redact(result.stdout+'\n'+result.stderr))
        except (OSError,subprocess.TimeoutExpired) as failure:
            report[key+'CaptureFailure']=type(failure).__name__
    if read:
        for label,route,fields in [('scan','/ScheduledTasks',('Key','State','CurrentProgressPercentage')),('plugins','/Plugins',('Name','Version','Status')),('libraries','/Library/VirtualFolders',('Name','Locations','CollectionType'))]:
            try:
                report[label]=[{k:r.get(k) for k in fields} for r in read(route)]
            except Exception as failure:
                report[label+'CaptureFailure']=type(failure).__name__
    (output/'failure.json').write_text(redact(json.dumps(report,indent=2))+'\n')

class Phases:
    """A transition marks the previous phase complete; failure keeps its first phase."""
    def __init__(self, output):
        import time
        self.clock=time.monotonic
        self.started=self.clock()
        self.output=Path(output)
        self.output.parent.mkdir(parents=True,exist_ok=True)
        self.rows=[]
        self.phase('workspace')

    def save(self):
        self.output.write_text(json.dumps({'elapsedSeconds':round(self.clock()-self.started,3),'phases':self.rows},indent=2)+'\n')

    def phase(self, name):
        now=self.clock()
        if self.rows and self.rows[-1]['status']=='RUNNING':
            self.rows[-1].update(status='PASS',seconds=round(now-self.phase_started,3))
        self.phase_started=now
        self.rows.append({'phase':name,'status':'RUNNING'})
        self.save()

    def fail(self, error):
        if self.rows[-1]['status']=='RUNNING':
            self.rows[-1].update(status='FAIL',seconds=round(self.clock()-self.phase_started,3),exceptionType=type(error).__name__,message=redact(str(error)))
        self.save()

    def complete(self):
        if self.rows[-1]['status']=='RUNNING':
            self.rows[-1].update(status='PASS',seconds=round(self.clock()-self.phase_started,3))
        self.save()
