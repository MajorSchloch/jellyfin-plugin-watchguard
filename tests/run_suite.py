"""Single local/CI command table. One attempt only; preserve all command outcomes."""
import fixture_images
import hashlib
import xml.etree.ElementTree as ET
import argparse
import json
import os
from pathlib import Path
import platform
import subprocess
import time
import uuid

PLAN=json.loads((Path(__file__).resolve().parents[1]/'scripts/qualification-plan.json').read_text())
parser=argparse.ArgumentParser()
parser.add_argument('suite',choices=PLAN)
parser.add_argument('--injector-dll',default='/tmp/watchguard-injector/Jellyfin.Plugin.JavaScriptInjector/bin/Release/net10.0/Jellyfin.Plugin.JavaScriptInjector.dll')
a=parser.parse_args()
output=Path('artifacts/testing')/a.suite/uuid.uuid4().hex[:10]
output.mkdir(parents=True,exist_ok=True)
report={'schemaVersion':2,'jellyfinVersion':fixture_images.version(), 'image':fixture_images.image(a.suite in ('standalone-caddy','migration','websocket','server-enforcement-linuxserver')), 'suite':a.suite,'attempts':[],'status':'RUNNING','python':platform.python_version(),'node':subprocess.check_output(['node','--version'],text=True).strip(),'commit':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()}
package=next(Path('artifacts').glob('Jellyfin.Plugin.WatchGuard-v'+ET.parse('Directory.Build.props').findtext('./PropertyGroup/Version')+'.zip'))
report['packageSha256']=hashlib.sha256(package.read_bytes()).hexdigest()
report['runtimeSha256']=hashlib.sha256(Path('artifacts/WatchGuard/Jellyfin.Plugin.WatchGuard.dll').read_bytes()).hexdigest()
report['proxyMatrix']=os.environ.get('WATCHGUARD_PROXY_MATRIX')=='1'
report['dotnet']=subprocess.check_output(['dotnet','--version'],text=True).strip()
report['host']=platform.platform()
report['browserEnvironment']=os.environ.get('WATCHGUARD_BROWSER_IMAGE','host-installed')
report['playwright']=json.loads(Path('tests/browser/node_modules/playwright/package.json').read_text())['version']
report['chromium']=next(b for b in json.loads(Path('tests/browser/node_modules/playwright-core/browsers.json').read_text())['browsers'] if b['name']=='chromium')
assert report['dotnet']==json.loads(Path('global.json').read_text())['sdk']['version'], 'Use pinned .NET SDK'
assert report['playwright']=='1.56.1', 'Use locked Playwright dependency'
assert report['python']=='3.12.0', 'Use pinned Python 3.12.0'
assert report['node']=='v24.22.0', 'Use pinned Node 24.22.0'
def save(): (output/'suite.json').write_text(json.dumps(report,indent=2)+'\n')
save()
for scenario in PLAN[a.suite]:
    command=[part.replace('{injector_dll}',a.injector_dll) for part in scenario['command']]
    env=scenario['env']
    started=time.monotonic()
    result=subprocess.run(['python3',*command],env={**os.environ,**env})
    report['attempts'].append({'scenario':scenario['id'],'command':scenario['command'],'environment':env,'elapsedSeconds':round(time.monotonic()-started,3),'exitCode':result.returncode,'retry':False})
    if result.returncode:
        report['status']='FAIL';save();raise SystemExit(result.returncode)
    save()
report['status']='PASS';save()
