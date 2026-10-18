"""Single local/CI command table. One attempt only; preserve all command outcomes."""
import argparse
import json
import os
from pathlib import Path
import platform
import subprocess
import time
import uuid

parser=argparse.ArgumentParser()
parser.add_argument('suite',choices=['standalone-caddy','migration','basepath','legacy','websocket','discovery','verification','server-enforcement','server-enforcement-basepath','server-enforcement-linuxserver'])
parser.add_argument('--injector-dll',default='/tmp/watchguard-injector/Jellyfin.Plugin.JavaScriptInjector/bin/Release/net10.0/Jellyfin.Plugin.JavaScriptInjector.dll')
a=parser.parse_args()
commands={
 'standalone-caddy':[(['tests/docker-smoke.py','--linuxserver','--catalog','--caddy','--preference-roundtrip'],{})],
 'migration':[(['tests/docker-smoke.py','--linuxserver','--migration','--injector-dll',a.injector_dll],{})],
 'basepath':[(['tests/docker-smoke.py','--base-path','/jellyfin','--proxy'],{})],
 'legacy':[(['tests/docker-smoke.py','--legacy-injector','--catalog','--injector-dll',a.injector_dll],{}),(['tests/docker-smoke.py','--legacy-injector','--injector-dll',a.injector_dll],{})],
 'websocket':[(['tests/docker-smoke.py','--linuxserver','--caddy','--measure'],{})],
 'discovery':[(['tests/docker-smoke.py','--profile','discovery'],{})],
 'verification':[(['tests/docker-smoke.py','--profile','verification'],{}),(['tests/docker-smoke.py','--profile','verification'],{'WATCHGUARD_VERIFICATION_POLICIES':'1','WATCHGUARD_VERIFICATION_OUTPUT':'artifacts/verification-native-v048-policies.json'}),(['tests/docker-smoke.py','--profile','discovery'],{'WATCHGUARD_DISCOVERY_BASELINE':'0.4.7'})],
 'server-enforcement':[(['tests/server-enforcement.py'],{})],
 'server-enforcement-basepath':[(['tests/server-enforcement.py','--base-path','/jellyfin'],{})],
 'server-enforcement-linuxserver':[(['tests/server-enforcement.py','--linuxserver'],{})],
}
output=Path('artifacts/testing')/a.suite/uuid.uuid4().hex[:10]
output.mkdir(parents=True,exist_ok=True)
report={'suite':a.suite,'attempts':[],'status':'RUNNING','python':platform.python_version(),'node':subprocess.check_output(['node','--version'],text=True).strip(),'commit':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()}
report['dotnet']=subprocess.check_output(['dotnet','--version'],text=True).strip()
report['host']=platform.platform()
report['playwright']=json.loads(Path('tests/browser/node_modules/playwright/package.json').read_text())['version']
report['chromium']=next(b for b in json.loads(Path('tests/browser/node_modules/playwright-core/browsers.json').read_text())['browsers'] if b['name']=='chromium')
assert report['dotnet']==json.loads(Path('global.json').read_text())['sdk']['version'], 'Use pinned .NET SDK'
assert report['playwright']=='1.56.1', 'Use locked Playwright dependency'
assert report['python']=='3.12.0', 'Use pinned Python 3.12.0'
assert report['node']=='v24.22.0', 'Use pinned Node 24.22.0'
def save(): (output/'suite.json').write_text(json.dumps(report,indent=2)+'\n')
save()
for command,env in commands[a.suite]:
    started=time.monotonic()
    result=subprocess.run(['python3',*command],env={**os.environ,**env})
    report['attempts'].append({'command':command,'elapsedSeconds':round(time.monotonic()-started,3),'exitCode':result.returncode,'retry':False})
    if result.returncode:
        report['status']='FAIL';save();raise SystemExit(result.returncode)
    save()
report['status']='PASS';save()
