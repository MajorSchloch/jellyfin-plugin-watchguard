from fixture_evidence import capture as capture_failure, Phases
from fixture_inventory import wait_inventory, wait_ready
"""Disposable native HTTP qualification. Never accepts a remote server/config/media path."""
import argparse, functools, http.server, threading, runpy, concurrent.futures, hashlib, io, json, os, pathlib, shutil, subprocess, tempfile, time, urllib.request, urllib.error, uuid, zipfile
ROOT=pathlib.Path(__file__).resolve().parents[1]
IMAGE='jellyfin/jellyfin:12.2@sha256:357724bf0ae27a672c7cbaa899db2d9abeb13dbd8657ccce750258a4c059d037'
DLL=ROOT/'artifacts/WatchGuard/Jellyfin.Plugin.WatchGuard.dll'
BASELINE=ROOT/'artifacts/PublishedV048/Jellyfin.Plugin.WatchGuard.dll'
BASELINE_SHA256='06f33f62d06d864b63c879213ec1b3536d81c8ebb0ab7ac186b6820580aa24d5'

def docker(*args): return subprocess.check_output(['docker',*args],text=True,stderr=subprocess.DEVNULL,timeout=180).strip()

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--linuxserver',action='store_true');parser.add_argument('--web',action='store_true',default=True);parser.add_argument('--base-path',choices=['','/jellyfin'],default='');a=parser.parse_args()
    image='lscr.io/linuxserver/jellyfin:12.2ubu2604-ls53@sha256:1bb4f88d822a0510bb3604b68aacb80d77c1d2a30181e500090c65111b98723b' if a.linuxserver else IMAGE
    run_user=['-e',f'PUID={os.getuid()}','-e',f'PGID={os.getgid()}'] if a.linuxserver else ['--user',f'{os.getuid()}:{os.getgid()}']
    output=ROOT/'artifacts/server-enforcement'/('linuxserver' if a.linuxserver else 'official')/('basepath' if a.base_path else 'direct')/uuid.uuid4().hex[:10];output.mkdir(parents=True,exist_ok=True)
    report={'image':image,'basePath':a.base_path,'cases':[],'status':'RUNNING'}
    (output/'results.json').write_text(json.dumps(report,indent=2)+'\n')
    archive=subprocess.check_output(['curl','--fail','--silent','--show-error','--location','--max-time','60','https://github.com/MajorSchloch/jellyfin-plugin-watchguard/releases/download/v0.4.8/Jellyfin.Plugin.WatchGuard-v0.4.8.zip'])
    assert hashlib.sha256(archive).hexdigest()==BASELINE_SHA256
    BASELINE.parent.mkdir(parents=True,exist_ok=True)
    BASELINE.write_bytes(zipfile.ZipFile(io.BytesIO(archive)).read('Jellyfin.Plugin.WatchGuard.dll'))
    report['publishedBaselineZipSha256']=BASELINE_SHA256
    name='wg-approval-test-'+uuid.uuid4().hex[:10]
    phases=Phases(output/'phases.json')
    with tempfile.TemporaryDirectory(prefix='wg-guard-disposable-') as temp:
        root=pathlib.Path(temp);plugins=root/('config/data/plugins' if a.linuxserver else 'config/plugins');guard=plugins/'WatchGuard';guard.mkdir(parents=True)
        shutil.copy2(BASELINE,guard/DLL.name)
        (guard/'meta.json').write_text(json.dumps({'guid':'a3c6bc84-783d-4ba8-a0db-89bfb83ab486','name':'WatchGuard','version':'0.4.8.0','targetAbi':'12.2.0.0','status':'Active','autoUpdate':False}))
        network_dir=root/('config' if a.linuxserver else 'config/config');network_dir.mkdir(exist_ok=True);(network_dir/'network.xml').write_text('<NetworkConfiguration><BaseUrl>'+a.base_path+'</BaseUrl></NetworkConfiguration>')
        token=None;base=None;media_records=[]
        def call(path,method='GET',data=None,auth='admin',expected=200,headers=None,device='guard',timeout=120):
            actual=token if auth=='admin' else auth
            header='MediaBrowser Client="GuardFixture", Device="Disposable", DeviceId="'+device+'", Version="1"'
            if actual: header+=', Token="'+actual+'"'
            request=urllib.request.Request(base+path,method=method,data=json.dumps(data).encode() if data is not None else (b'' if method=='POST' else None),headers={'Authorization':header,'Content-Type':'application/json',**(headers or {})})
            try:
                with urllib.request.urlopen(request,timeout=timeout) as r: status,body,response_headers=r.status,r.read(),r.headers
            except urllib.error.HTTPError as e: status,body,response_headers=e.code,e.read(),e.headers
            assert status in (expected if isinstance(expected,tuple) else (expected,)),(path.split('?')[0],status,expected)
            try:result=json.loads(body) if body else None
            except ValueError:return body
            if isinstance(result,dict) and ('Code' in result or path.startswith('/WatchGuard/ServerApproval/') and status != 401):
                assert 'no-store' in response_headers.get('Cache-Control','')
            return result
        def ready():
            nonlocal base
            base='http://127.0.0.1:'+docker('port',name,'8096/tcp').split(':')[-1]+a.base_path
            def probe(timeout):
                assert call('/health',timeout=timeout)==b'Healthy', 'Native startup health is not Healthy'
                assert call('/System/Info/Public',timeout=timeout).get('Version')
                call('/Startup/User' if token is None else '/Users/Me',timeout=timeout)
            wait_ready(probe)
        def start(enabled=None,web=False):
            if enabled is not None: set_enabled(enabled, offline=True)
            docker('run','-d','--name',name,*run_user,'-p','127.0.0.1::8096','--add-host','host.docker.internal:host-gateway','-v',str(root/'config')+':/config','-v',str(root/'media')+':/media',image);ready()
        def set_enabled(enabled,offline=False):
            if not offline:
                config=call('/Plugins/a3c6bc84-783d-4ba8-a0db-89bfb83ab486/Configuration');config['EnableServerEnforcement']=enabled
                call('/Plugins/a3c6bc84-783d-4ba8-a0db-89bfb83ab486/Configuration','POST',config,expected=204);return
            config=plugins/'configurations/Jellyfin.Plugin.WatchGuard.xml';config.parent.mkdir(exist_ok=True)
            import xml.etree.ElementTree as ET
            tree=ET.parse(config) if config.exists() else ET.ElementTree(ET.Element('Configuration'))
            node=tree.getroot().find('EnableServerEnforcement')
            if node is None:node=ET.SubElement(tree.getroot(),'EnableServerEnforcement')
            node.text='true' if enabled else 'false';tree.write(config)
        def preserved(items):
            expanded={i['Id']:i for i in items}
            for parent in items:
                for child in media_records:
                    if child.get('Path','').startswith(parent['Path'].rstrip('/')+'/'):expanded[child['Id']]=child
            for item in expanded.values():
                call('/Items/'+item['Id'])
                assert (root/item['Path'].lstrip('/')).exists(), 'Media path missing after veto'
        def veto(label,items,path=None,status=409,auth='admin',code=None):
            print('CASE '+label,flush=True);preserved(items);started=time.perf_counter();r=call(path or '/Items/'+items[0]['Id'],'DELETE',auth=auth,expected=status)
            request_ms=round((time.perf_counter()-started)*1000,2)
            preserved(items)
            if code:assert r['Code']==code
            if isinstance(r,dict):assert 'Users' not in r and 'DisplayName' not in r
            report['cases'].append({'case':label,'http':status,'filesAndRecordsPreserved':True,'requestDurationMs':request_ms})
        try:
            phases.phase('container-start')
            media=root/'media';media.mkdir();start()
            assert call('/System/Info/Public')['Version'].startswith('12.2')
            phases.phase('native-setup-authentication')
            password=uuid.uuid4().hex
            call('/Startup/User','POST',{'Name':'WatchGuardPoCTest','Password':password},expected=204)
            call('/Startup/Complete','POST',expected=204)
            signed=call('/Users/AuthenticateByName','POST',{'Username':'WatchGuardPoCTest','Pw':password});token=signed['AccessToken']
            phases.phase('background-tasks')
            tasks=call('/ScheduledTasks');update=next(t for t in tasks if t['Key']=='PluginUpdates');call('/ScheduledTasks/'+update['Id']+'/Triggers','POST',[],expected=204)
            docker('restart',name);ready()
            report['pluginDiscovery']=[{'name':p['Name'],'id':p['Id'],'version':p['Version']} for p in call('/Plugins') if 'WatchGuard' in p['Name']]
            assert call('/WatchGuard/IntegrationStatus')['PluginVersion']=='0.4.8'
            phases.phase('generate-media')
            docker('exec',name,'/usr/lib/jellyfin-ffmpeg/ffmpeg','-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=black:s=64x64:d=1','-c:v','libx264','-y','/media/template.mp4')
            for title in ['Protected','Clear','BulkClear','Disabled','Uninstalled','ConcurrentClear','WebProtected','NativeDisabled','ApprovedSingle','ApprovedBulk1','ApprovedBulk2','Replay','ParallelA','ParallelBulk1','ParallelBulk2','WebApproved','WebError','WebClear','WebBulkA','WebBulkB','CaddyWeb','WebLegacy','DefaultDisabled']:
                folder=media/'movies'/title;folder.mkdir(parents=True);shutil.copy2(media/'template.mp4',folder/(title+'.mp4'))
            for title,count in [('Guard Series',2),('Long Series',300),('Web Series',2)]:
                folder=media/'tv'/title/'Season 01';folder.mkdir(parents=True)
                (folder.parent/'tvshow.nfo').write_text('<tvshow><title>'+title+'</title><status>Ended</status></tvshow>')
                for number in range(1,count+1):
                    stem=f'{title} S01E{number:03d}';shutil.copy2(media/'template.mp4',folder/(stem+'.mp4'))
                    (folder/(stem+'.nfo')).write_text(f'<episodedetails><title>Fixture {number}</title><season>1</season><episode>{number}</episode><aired>2020-01-01</aired></episodedetails>')
            phases.phase('configure-libraries')
            options={'LibraryOptions':{'EnableRealtimeMonitor':False,'EnableInternetProviders':False,'TypeOptions':[{'Type':kind,'MetadataFetchers':[],'ImageFetchers':[]} for kind in ['Movie','Series','Season','Episode']]}}
            for kind in ['movies','tvshows']:
                path='/media/'+('movies' if kind=='movies' else 'tv')
                call('/Library/VirtualFolders?name='+kind+'&collectionType='+kind+'&paths='+path+'&refreshLibrary=false','POST',options,expected=204)
            expected = {}
            for file in (media/'movies').glob('*/*.mp4'):
                expected['/media/'+file.relative_to(media).as_posix()] = ('Movie', None, file.stem)
            for folder in (media/'tv').iterdir():
                series_path='/media/'+folder.relative_to(media).as_posix()
                expected[series_path]=('Series',None,folder.name)
                for season_folder in folder.glob('Season *'):
                    season_path='/media/'+season_folder.relative_to(media).as_posix()
                    expected[season_path]=('Season',series_path,None)
                    for file in season_folder.glob('*.mp4'):
                        expected['/media/'+file.relative_to(media).as_posix()]=('Episode',season_path,None)
            phases.phase('media-indexing')
            scan=next(t for t in call('/ScheduledTasks') if t['Key']=='RefreshLibrary')
            call('/ScheduledTasks/Running/'+scan['Id'],'POST',expected=204)
            items=wait_inventory(lambda path,timeout:call(path,timeout=timeout), signed['User']['Id'], expected, output/'inventory.json')
            phases.phase('native-security-regressions')
            media_records=items
            movies={i['Name']:i for i in items if i['Type']=='Movie'};series={i['Name']:i for i in items if i['Type']=='Series'}
            parent=series['Guard Series'];children=call('/Items?Recursive=true&ParentId='+parent['Id']+'&Fields=Path')['Items'];ep=next(i for i in children if i['Type']=='Episode');season=next(i for i in children if i['Type']=='Season')
            for item in [i for n,i in movies.items() if n not in ('Clear','BulkClear','ConcurrentClear','WebClear')]+[parent,series['Long Series'],series['Web Series']]:call('/WatchGuard/Watchlist/'+item['Id'],'PUT',expected=204)
            call('/WatchGuard/Preferences','PUT',{'Owner':'mine','Statuses':['watchlisted','watching','playing'],'Sort':'title'})
            saved_data={p:p.read_bytes() for p in (root/'config').rglob('*.json') if p.name in ('watchlists.json','preferences.json')}
            assert len(saved_data)==2
            legacy_script=root/'legacy.js';legacy_script.write_bytes(call('/WatchGuard/Standalone/script.js'))
            # Upgrade through Jellyfin's catalog using a loopback-served, checksum-validated candidate.
            import xml.etree.ElementTree as ET
            configuration=call('/Plugins/a3c6bc84-783d-4ba8-a0db-89bfb83ab486/Configuration')
            assert 'EnableServerEnforcement' not in configuration
            configuration['ProtectCaughtUpSeries']=False
            call('/Plugins/a3c6bc84-783d-4ba8-a0db-89bfb83ab486/Configuration','POST',configuration,expected=204)
            public=root/'catalog';public.mkdir();archive_path=ROOT/'artifacts/Jellyfin.Plugin.WatchGuard-v0.4.9.zip'
            digest=archive_path.with_suffix('.zip.sha256').read_text().split()[0]
            assert hashlib.sha256(archive_path.read_bytes()).hexdigest()==digest
            report['candidateZipSha256']=digest
            shutil.copy2(archive_path,public/archive_path.name)
            class Handler(http.server.SimpleHTTPRequestHandler):
                def log_message(self,*args):pass
                def list_directory(self,path):self.send_error(404)
            server=http.server.ThreadingHTTPServer(('0.0.0.0',0),functools.partial(Handler,directory=str(public)))
            thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
            catalog_url='http://host.docker.internal:'+str(server.server_port)
            guid='a3c6bc84-783d-4ba8-a0db-89bfb83ab486'
            manifest=[{'guid':guid,'name':'WatchGuard','owner':'Disposable qualification','category':'General','description':'Local candidate','overview':'Fixture','versions':[{'version':'0.4.9.0','targetAbi':'12.2.0.0','checksum':hashlib.md5(archive_path.read_bytes()).hexdigest(),'sourceUrl':catalog_url+'/'+archive_path.name,'timestamp':'2026-10-16T00:00:00Z','changelog':'Unpublished local fixture'}]}]
            (public/'manifest.json').write_text(json.dumps(manifest))
            try:
                call('/Repositories','POST',[{'Name':'Disposable candidate','Url':catalog_url+'/manifest.json','Enabled':True}],expected=204)
                from urllib.parse import urlencode
                call('/Packages/Installed/WatchGuard?'+urlencode({'assemblyGuid':guid,'version':'0.4.9.0','repositoryUrl':catalog_url+'/manifest.json'}),'POST',expected=204)
                docker('stop',name);shutil.move(str(guard),str(root/'retired-v048'));guard=plugins/'WatchGuard_0.4.9.0'
                assert (guard/'meta.json').exists()
                assert (guard/DLL.name).read_bytes()==DLL.read_bytes()
                docker('start',name);ready()
            finally:server.shutdown();server.server_close();thread.join()
            caps=call('/WatchGuard/ServerApproval/Capabilities')
            assert caps['State']=='Disabled' and not caps['Configured'] and caps['AttachedActions']==2 and not caps['RestartRequired']
            assert not call('/Plugins/'+guid+'/Configuration')['ProtectCaughtUpSeries']
            assert all(p.read_bytes()==value for p,value in saved_data.items())
            assert len(list(plugins.rglob('Jellyfin.Plugin.WatchGuard.dll')))==1
            target=movies['DefaultDisabled'];call('/Items/'+target['Id'],'DELETE',expected=204)
            call('/Items/'+target['Id'],expected=404);assert not (root/target['Path'].lstrip('/')).exists()
            set_enabled(True)
            caps=call('/WatchGuard/ServerApproval/Capabilities');assert caps['State']=='Disabled' and caps['RestartRequired'] and caps['Configured']
            docker('restart',name);ready()
            caps=call('/WatchGuard/ServerApproval/Capabilities');assert caps['State']=='Enabled' and not caps['RestartRequired'] and caps['AttachedActions']==2
            assert 'WG-GUARD attached=2 supported=true enabledAtStartup=True' in docker('logs',name)
            report['catalogUpgrade']='PASS: published v0.4.8 without setting -> catalog candidate off -> explicit save -> restart active; stores preserved; single assembly'
            api='/WatchGuard/ServerApproval/'
            def route(targets,bulk=False):return '/Items?ids='+','.join(i['Id'] for i in targets) if bulk else '/Items/'+targets[0]['Id']
            def attempt(label,targets,path=None,auth='admin',headers=None,status=409,code=None):
                preserved(targets);before=docker('logs',name).count('guard outcome=ContinueNative');t=time.perf_counter()
                r=call(path or route(targets),'DELETE',auth=auth,headers=headers,expected=status)
                ms=round((time.perf_counter()-t)*1000,2);preserved(targets)
                assert docker('logs',name).count('guard outcome=ContinueNative')==before
                if code:assert r['Code']==code,(label,r.get('Code'),code)
                assert not isinstance(r,dict) or ('Protection' not in r and 'Users' not in r)
                report['cases'].append({'case':label,'status':status,'filesAndRecordsPreserved':True,'requestMs':ms});print('PASS '+label,flush=True)
                return r
            def challenge(targets,bulk=False,auth='admin'):
                r=attempt('challenge',targets,path=route(targets,bulk),auth=auth,code='ProtectionRequired');assert len(r['ChallengeId'])==64;return r['ChallengeId']
            def step(action,id,auth='admin',expected=200,headers=None):
                t=time.perf_counter();r=call(api+action,'POST',{'ChallengeId':id,'Decision':'Approve'},auth=auth,expected=expected,headers=headers)
                report.setdefault('protocolTimings',[]).append({'action':action,'ms':round((time.perf_counter()-t)*1000,2),'status':expected});return r
            def approved(targets,bulk=False,auth='admin'):
                id=challenge(targets,bulk,auth);assert step('Present',id,auth)['State']=='Presented';assert step('Approve',id,auth)['State']=='Approved';return id
            def allow(label,targets,id=None,bulk=False,auth='admin'):
                before=docker('logs',name).count('guard outcome=ContinueNative');t=time.perf_counter()
                call(route(targets,bulk),'DELETE',auth=auth,expected=204,headers={'X-WatchGuard-Approval':id} if id else None)
                ms=round((time.perf_counter()-t)*1000,2);assert docker('logs',name).count('guard outcome=ContinueNative')==before+1
                for item in targets:
                    call('/Items/'+item['Id'],expected=404);assert not (root/item['Path'].lstrip('/')).exists()
                report['cases'].append({'case':label,'status':204,'nativeContinuations':1,'fileAndRecordRemoved':True,'requestMs':ms})
            protected=movies['Protected']
            attempt('unauthenticated',[protected],auth=None,status=401)
            attempt('origin-rejected',[protected],headers={'Origin':'https://attacker.invalid'},status=403,code='ApprovalInvalid')
            attempt('untrusted-forwarded-origin-rejected',[protected],headers={'Origin':'https://attacker.invalid','X-Forwarded-Host':'attacker.invalid','X-Forwarded-Proto':'https'},status=403,code='ApprovalInvalid')
            attempt('fetch-site-rejected',[protected],headers={'Sec-Fetch-Site':'cross-site'},status=403,code='ApprovalInvalid')
            attempt('url-token-rejected',[protected],path=route([protected])+'?ApiKey='+token,status=403,code='ApprovalInvalid')
            attempt('missing-auth-header',[protected],headers={'Authorization':''},auth=None,status=401)
            call('/Auth/Keys?app=ApprovalFixture','POST',expected=204);key=call('/Auth/Keys')['Items'][0]['AccessToken']
            attempt('api-key',[protected],auth=key,status=403,code='NativePermissionDenied')
            memberPassword=uuid.uuid4().hex;member=call('/Users/New','POST',{'Name':'Ordinary','Password':memberPassword})
            memberToken=call('/Users/AuthenticateByName','POST',{'Username':'Ordinary','Pw':memberPassword},device='ordinary')['AccessToken']
            attempt('native-permission',[protected],auth=memberToken,status=403,code='NativePermissionDenied')
            policy=dict(member['Policy'],EnableContentDeletion=True);call('/Users/'+member['Id']+'/Policy','POST',policy,expected=204)
            r=attempt('ordinary-protected',[protected],auth=memberToken,code='ProtectionRequired');assert r.get('ChallengeId') is None
            allow('ordinary-clear',[movies['Clear']],auth=memberToken)
            call('/Users/'+member['Id']+'/Policy','POST',dict(policy,EnableAllFolders=False,EnabledFolders=[]),expected=204)
            attempt('invisible',[protected],auth=memberToken,status=404,code='TargetUnavailable')
            call('/Users/'+member['Id']+'/Policy','POST',policy,expected=204)
            id=challenge([protected])
            for action in ('Present','Approve'):
                assert step(action,id,memberToken,403)['Code']=='NativePermissionDenied';assert step(action,id,key,403)['Code']=='NativePermissionDenied'
            assert step('Approve',id,expected=409)['Code']=='ApprovalInvalid'
            other=call('/Users/AuthenticateByName','POST',{'Username':'WatchGuardPoCTest','Pw':password},device='other')['AccessToken'];assert other!=token
            assert step('Present',id,other,409)['Code']=='ApprovalInvalid'
            id=approved([protected]);attempt('cross-session-redeem',[protected],auth=other,headers={'X-WatchGuard-Approval':id},code='ApprovalInvalid')
            assert step('Present',id,headers={'Origin':'https://attacker.invalid'},expected=403)['Code']=='ApprovalInvalid'
            id=approved([protected]);step('Revoke',id);attempt('explicit-revoke',[protected],headers={'X-WatchGuard-Approval':id},code='ApprovalRevoked')
            id=approved([protected]);call('/WatchGuard/Watchlist/'+protected['Id'],'PUT',auth=memberToken,expected=204)
            attempt('new-watchlist-interest',[protected],headers={'X-WatchGuard-Approval':id},code='ApprovalStateChanged')
            call('/WatchGuard/Watchlist/'+protected['Id'],'DELETE',auth=memberToken,expected=204)
            id=approved([protected]);call('/UserItems/'+protected['Id']+'/UserData','POST',{'Played':False,'PlaybackPositionTicks':1000000},auth=memberToken)
            attempt('new-playback-interest',[protected],headers={'X-WatchGuard-Approval':id},code='ApprovalStateChanged')
            call('/UserItems/'+protected['Id']+'/UserData','POST',{'Played':False,'PlaybackPositionTicks':0},auth=memberToken)
            id=approved([protected]);call('/WatchGuard/Watchlist/'+protected['Id'],'DELETE',expected=204)
            attempt('interest-removed-no-fallback',[protected],headers={'X-WatchGuard-Approval':id},code='ApprovalStateChanged')
            call('/WatchGuard/Watchlist/'+protected['Id'],'PUT',expected=204)
            id=approved([protected]);attempt('different-target',[protected,movies['BulkClear']],path=route([movies['BulkClear']]),headers={'X-WatchGuard-Approval':id},code='ApprovalInvalid')
            id=approved([protected]);attempt('different-action',[protected],path=route([protected],True),headers={'X-WatchGuard-Approval':id},code='ApprovalInvalid')
            attempt('malformed-binding',[protected],path='/Items?ids=not-a-guid',status=400)
            attempt('unknown-approval',[protected],headers={'X-WatchGuard-Approval':'0'*64},code='ApprovalInvalid')
            attempt('malformed-approval-header',[protected],headers={'X-WatchGuard-Approval':'short'},code='ApprovalInvalid')
            assert call(api+'Present','POST',{'ChallengeId':'short'},expected=400)['status']==400
            assert call(api+'Prepare','POST',{},expected=400)['status']==400
            preserved([protected])
            attempt('duplicates',[protected],path='/Items?ids='+protected['Id']+','+protected['Id'],status=400,code='ApprovalInvalid')
            attempt('overlap',[parent,ep],path=route([parent,ep],True),status=400,code='ApprovalInvalid')
            attempt('missing-last',[movies['BulkClear']],path='/Items?ids='+movies['BulkClear']['Id']+','+uuid.uuid4().hex,status=404,code='TargetUnavailable')
            attempt('bulk-protected-last',[movies['BulkClear'],protected],path=route([movies['BulkClear'],protected],True),code='ProtectionRequired')
            id=approved([protected,movies['BulkClear']],True);attempt('bulk-order-changed',[protected,movies['BulkClear']],path=route([movies['BulkClear'],protected],True),headers={'X-WatchGuard-Approval':id},code='ApprovalInvalid')
            expiry=approved([protected]);print('Waiting for real 60-second expiry',flush=True);time.sleep(30);time.sleep(31)
            attempt('expired',[protected],headers={'X-WatchGuard-Approval':expiry},status=410,code='ApprovalExpired')
            adminPassword=uuid.uuid4().hex;second=call('/Users/New','POST',{'Name':'Approver','Password':adminPassword})
            adminPolicy=dict(second['Policy'],IsAdministrator=True,EnableContentDeletion=True,EnableAllFolders=True)
            call('/Users/'+second['Id']+'/Policy','POST',adminPolicy,expected=204)
            adminToken=call('/Users/AuthenticateByName','POST',{'Username':'Approver','Pw':adminPassword},device='approver')['AccessToken']
            for field in ['EnableContentDeletion','IsAdministrator','IsDisabled']:
                id=approved([protected],auth=adminToken);changed=dict(adminPolicy);changed[field]=field=='IsDisabled'
                if field=='IsDisabled':
                    call('/Users/'+second['Id']+'/Policy','POST',dict(adminPolicy,IsAdministrator=False),expected=204)
                    changed['IsAdministrator']=False
                call('/Users/'+second['Id']+'/Policy','POST',changed,expected=204)
                attempt('revoked-'+field,[protected],auth=adminToken,headers={'X-WatchGuard-Approval':id},status=(401,403))
                call('/Users/'+second['Id']+'/Policy','POST',adminPolicy,expected=204)
            adminToken=call('/Users/AuthenticateByName','POST',{'Username':'Approver','Pw':adminPassword},device='approver')['AccessToken']
            id=approved([protected],auth=adminToken);call('/Sessions/Logout','POST',auth=adminToken,expected=204)
            attempt('session-revoked',[protected],auth=adminToken,headers={'X-WatchGuard-Approval':id},status=401)
            id=approved([protected]);dto=call('/Items/'+protected['Id']);dto['DateCreated']='2020-02-02T00:00:00Z';call('/Items/'+protected['Id'],'POST',dto,expected=204)
            attempt('native-metadata-changed',[protected],headers={'X-WatchGuard-Approval':id},code='ApprovalStateChanged')
            store=next(p for p in saved_data if p.name=='watchlists.json');original=store.read_bytes()
            try:
                store.write_text('{broken');attempt('lookup-failure',[protected],status=503,code='ProtectionUnavailable')
            finally:store.write_bytes(original)
            for label,target in [('long-series',series['Long Series']),('episode',ep),('season',season)]:
                id=approved([target]);step('Revoke',id);attempt(label+'-revoke',[target],headers={'X-WatchGuard-Approval':id},code='ApprovalRevoked')
            id=approved([movies['ApprovedSingle']]);allow('approved-single',[movies['ApprovedSingle']],id)
            assert call(route([movies['ApprovedSingle']]),'DELETE',headers={'X-WatchGuard-Approval':id},expected=409)['Code']=='ApprovalAlreadyUsed'
            bulk=[movies['ApprovedBulk1'],movies['ApprovedBulk2']];id=approved(bulk,True);allow('approved-bulk',bulk,id,True)
            target=movies['Replay'];id=approved([target]);before=docker('logs',name).count('guard outcome=ContinueNative')
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                replies=list(pool.map(lambda _:call(route([target]),'DELETE',headers={'X-WatchGuard-Approval':id},expected=(204,409)),range(2)))
            assert replies.count(None)==1 and any(isinstance(r,dict) and r['Code']=='ApprovalAlreadyUsed' for r in replies)
            assert docker('logs',name).count('guard outcome=ContinueNative')==before+1;call('/Items/'+target['Id'],expected=404);assert not (root/target['Path'].lstrip('/')).exists()
            report['cases'].append({'case':'concurrent-single-approval','nativeContinuations':1,'fileAndRecordRemoved':True})
            parallel=[movies['ParallelBulk1'],movies['ParallelBulk2']];parallel_id=approved(parallel,True)
            before=docker('logs',name).count('guard outcome=ContinueNative')
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                replies=list(pool.map(lambda _:call(route(parallel,True),'DELETE',headers={'X-WatchGuard-Approval':parallel_id},expected=(204,409)),range(2)))
            assert replies.count(None)==1 and any(isinstance(r,dict) and r['Code']=='ApprovalAlreadyUsed' for r in replies)
            assert docker('logs',name).count('guard outcome=ContinueNative')==before+1
            for item in parallel:
                call('/Items/'+item['Id'],expected=404);assert not (root/item['Path'].lstrip('/')).exists()
            report['cases'].append({'case':'concurrent-bulk-approval','nativeContinuations':1,'filesAndRecordsRemoved':True})
            target=movies['ParallelA'];a1=approved([target]);a2=approved([target]);allow('first-of-two-challenges',[target],a1)
            assert call(route([target]),'DELETE',headers={'X-WatchGuard-Approval':a2},expected=409)['Code']=='ApprovalRevoked'
            for label,target in [('episode',ep),('season',season),('series',parent)]:
                id=approved([target]);allow('approved-'+label,[target],id)
                media_records=[i for i in media_records if i['Id']!=target['Id'] and not i['Path'].startswith(target['Path'].rstrip('/')+'/')]
            before=docker('logs',name).count('WG-GUARD evaluation')
            for path in ['/System/Info/Public','/Items?Limit=2','/WatchGuard/Watchlist','/Users/Me']:call(path)
            assert docker('logs',name).count('WG-GUARD evaluation')==before;report['unrelatedRequestsEvaluations']=0
            phases.phase('old-tab-browser')
            fixture=root/'browser.json';fixture.write_text(json.dumps({'base':base,'username':'WatchGuardPoCTest','password':password,'output':str(output.resolve()),'legacyScript':str(legacy_script),'id':movies['WebProtected']['Id'],'userId':signed['User']['Id'],'serverId':signed['ServerId']}));fixture.chmod(0o600)
            subprocess.run(['node',str(ROOT/'tests/server-enforcement-old-tab.cjs'),str(fixture)],check=True,timeout=600)
            preserved([movies['WebProtected']]);report['browser']='PASS: unchanged Cancel zero DELETE; Delete Anyway one DELETE rejected 409'
            phases.phase('current-browser-and-proxy')
            def web_browser(url,proxy=False,legacy=False):
                selected=[movies[n] for n in (['WebLegacy'] if legacy else ['CaddyWeb'] if proxy else ['WebApproved','WebError','WebClear','WebBulkA','WebBulkB'])]
                if not proxy and not legacy:selected+= [series['Web Series']]+call('/Items?Recursive=true&ParentId='+series['Web Series']['Id']+'&Fields=Path')['Items']
                config={'base':url,'username':'WatchGuardPoCTest','password':password,'userId':signed['User']['Id'],'serverId':signed['ServerId'],'items':selected,'output':str(output.resolve()),'proxy':proxy,'legacy':legacy,'mediaRoot':str(media)}
                fixture.write_text(json.dumps(config));fixture.chmod(0o600)
                subprocess.run(['node',str(ROOT/'tests/server-enforcement-browser.cjs'),str(fixture)],check=True,timeout=600)
                result=json.loads((output/('browser-legacy.json' if legacy else 'browser-proxy.json' if proxy else 'browser.json')).read_text())
                for item in selected:
                    if item['Id'] in result['removed']:
                        call('/Items/'+item['Id'],expected=404);assert not (root/item['Path'].lstrip('/')).exists()
                    else:preserved([item])
                report['webLegacy' if legacy else 'webProxy' if proxy else 'web']=result
            if a.web:
                docker('rm','-f',name);start(web=True);web_browser(base)
            if not a.base_path:
                caddy=runpy.run_path(str(ROOT/'tests/standalone-caddy.py'))['Caddy'](docker,name,root)
                try:
                    # Trust only this disposable proxy's exact address; Jellyfin otherwise ignores forwarded scheme.
                    proxy_ip=json.loads(docker('inspect',caddy.name))[0]['NetworkSettings']['Networks'][caddy.network]['IPAddress']
                    network=call('/System/Configuration/network');network['KnownProxies']=[proxy_ip]
                    call('/System/Configuration/network','POST',network,expected=204)
                    docker('restart',name);ready()
                    before=docker('logs',name).count('WG-GUARD evaluation');caddy.verify(token)
                    assert docker('logs',name).count('WG-GUARD evaluation')==before
                    def proxy(path,method='GET',body=None,expected=200,approval=None):
                        headers={'Authorization':'MediaBrowser Token="'+token+'"','Origin':caddy.base,'Content-Type':'application/json'}
                        if approval:headers['X-WatchGuard-Approval']=approval
                        req=urllib.request.Request(caddy.base+path,method=method,data=json.dumps(body).encode() if body else None,headers=headers)
                        try:
                            with urllib.request.urlopen(req,context=caddy.ssl,timeout=120) as response:status,data=response.status,response.read()
                        except urllib.error.HTTPError as error:status,data=error.code,error.read()
                        assert status==expected,(path,status,expected)
                        return json.loads(data) if data else None
                    target=movies['Disabled'];id=proxy(route([target]),'DELETE',expected=409)['ChallengeId'];preserved([target])
                    for action in ['Present','Approve']:proxy(api+action,'POST',{'ChallengeId':id,'Decision':'Approve'})
                    proxy(route([target]),'DELETE',expected=204,approval=id);call('/Items/'+target['Id'],expected=404);assert not (root/target['Path'].lstrip('/')).exists()
                    if a.web:web_browser(caddy.base,True)
                    report['caddy']='PASS: trusted HTTPS same-origin challenge/approval/redemption; gzip/zstd and WebSocket unaffected'
                finally:caddy.close()
                # Docker Desktop can retain a dead host-port route after disconnecting a second network.
                # Restart this disposable container before further direct requests; no DELETE is retried.
                docker('restart',name);ready()
            id=approved([protected]);docker('restart',name);ready();attempt('restart-invalidates',[protected],headers={'X-WatchGuard-Approval':id},code='ApprovalInvalid')
            (output/'guard.log').write_text('\n'.join(l for l in docker('logs',name).splitlines() if 'WG-GUARD' in l)+'\n')
            phases.phase('disable-and-rollback')
            set_enabled(False)
            caps=call(api+'Capabilities');assert caps['State']=='Enabled' and caps['RestartRequired'] and not caps['Configured']
            attempt('saved-off-still-enforced',[protected],code='ProtectionRequired')
            docker('rm','-f',name);start(web=a.web)
            if a.web:web_browser(base,legacy=True)
            assert call(api+'Present','POST',{'ChallengeId':id},expected=503)['Code']=='ServerGuardUnsupported'
            call(route([movies['NativeDisabled']]),'DELETE',expected=204);call('/Items/'+movies['NativeDisabled']['Id'],expected=404);assert not (root/movies['NativeDisabled']['Path'].lstrip('/')).exists()
            report['optOut']='PASS: startup-disabled filter passes through without protection work; approval endpoints unavailable'
            docker('rm','-f',name);shutil.copy2(BASELINE,guard/DLL.name);start(False);assert 'WG-GUARD attached=' not in docker('logs',name)
            call(route([movies['Uninstalled']]),'DELETE',expected=204);call('/Items/'+movies['Uninstalled']['Id'],expected=404);assert not (root/movies['Uninstalled']['Path'].lstrip('/')).exists()
            report['rollback']='native deletion restored after replacing the single assembly with verified published v0.4.8 and restart'
            assert all(p.read_bytes()==value for p,value in saved_data.items());report['watchlistsAndPreferences']='byte-identical; approved deletion did not clear memberships'
            report['status']='PASS';(output/'failure.log').unlink(missing_ok=True)

        except BaseException as error:
            phases.fail(error)
            capture_failure(output/'diagnostics',name,error,lambda path:call(path,timeout=5))
            raise
        finally:
            phases.phase('teardown')

            if report['status']=='RUNNING':
                report['status']='FAIL'
                try:(output/'failure.log').write_text(__import__('fixture_evidence').redact('\n'.join(l for l in docker('logs',name).splitlines() if 'WG-GUARD' in l or 'Error' in l or 'Exception' in l)))
                except Exception:pass
            (output/'results.json').write_text(json.dumps(report,indent=2)+'\n')
            subprocess.run(['docker','rm','-f',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=True,timeout=60)
            phases.complete()
    print(json.dumps({'status':report['status'],'cases':len(report['cases']),'basePath':a.base_path}))
if __name__=='__main__':main()
