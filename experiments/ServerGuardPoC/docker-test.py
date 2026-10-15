"""Disposable native HTTP qualification. Never accepts a remote server/config/media path."""
import argparse, concurrent.futures, hashlib, io, json, os, pathlib, shutil, subprocess, tempfile, time, urllib.request, urllib.error, uuid, zipfile
ROOT=pathlib.Path(__file__).resolve().parents[2]
IMAGE='jellyfin/jellyfin:12.2@sha256:357724bf0ae27a672c7cbaa899db2d9abeb13dbd8657ccce750258a4c059d037'
DLL=ROOT/'experiments/ServerGuardPoC/bin/Release/net10.0/WatchGuard.ServerGuardPoC.dll'
BASELINE=ROOT/'artifacts/PublishedV048/Jellyfin.Plugin.WatchGuard.dll'
BASELINE_SHA256='06f33f62d06d864b63c879213ec1b3536d81c8ebb0ab7ac186b6820580aa24d5'

def docker(*args): return subprocess.check_output(['docker',*args],text=True,stderr=subprocess.DEVNULL).strip()

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--base-path',choices=['','/jellyfin'],default='');a=parser.parse_args()
    output=ROOT/'experiments/ServerGuardPoC/evidence'/('basepath' if a.base_path else 'direct');output.mkdir(parents=True,exist_ok=True)
    report={'image':IMAGE,'basePath':a.base_path,'cases':[],'status':'RUNNING'}
    archive=subprocess.check_output(['curl','--fail','--silent','--show-error','--location','--max-time','60','https://github.com/MajorSchloch/jellyfin-plugin-watchguard/releases/download/v0.4.8/Jellyfin.Plugin.WatchGuard-v0.4.8.zip'])
    assert hashlib.sha256(archive).hexdigest()==BASELINE_SHA256
    BASELINE.parent.mkdir(parents=True,exist_ok=True)
    BASELINE.write_bytes(zipfile.ZipFile(io.BytesIO(archive)).read('Jellyfin.Plugin.WatchGuard.dll'))
    report['publishedBaselineZipSha256']=BASELINE_SHA256
    name='wg-guard-test-'+uuid.uuid4().hex[:10]
    with tempfile.TemporaryDirectory(prefix='wg-guard-disposable-') as temp:
        root=pathlib.Path(temp);plugins=root/'config/plugins';guard=plugins/'WatchGuard';guard.mkdir(parents=True)
        shutil.copy2(DLL,guard/DLL.name);shutil.copy2(BASELINE,plugins/'WatchGuard'/BASELINE.name)
        (guard/'meta.json').write_text(json.dumps({'guid':'a3c6bc84-783d-4ba8-a0db-89bfb83ab486','name':'WatchGuard','version':'0.4.8.0','targetAbi':'12.2.0.0','status':'Active','autoUpdate':False}))
        (root/'config/config').mkdir();(root/'config/config/network.xml').write_text('<NetworkConfiguration><BaseUrl>'+a.base_path+'</BaseUrl></NetworkConfiguration>')
        token=None;base=None;media_records=[]
        def call(path,method='GET',data=None,auth='admin',expected=200):
            actual=token if auth=='admin' else auth
            header='MediaBrowser Client="GuardFixture", Device="Disposable", DeviceId="guard", Version="1"'
            if actual: header+=', Token="'+actual+'"'
            request=urllib.request.Request(base+path,method=method,data=json.dumps(data).encode() if data is not None else (b'' if method=='POST' else None),headers={'Authorization':header,'Content-Type':'application/json'})
            try:
                with urllib.request.urlopen(request,timeout=120) as r: status,body=r.status,r.read()
            except urllib.error.HTTPError as e: status,body=e.code,e.read()
            assert status==expected,(path,status,expected)
            try:return json.loads(body) if body else None
            except ValueError:return body
        def ready():
            nonlocal base
            base='http://127.0.0.1:'+docker('port',name,'8096/tcp').split(':')[-1]+a.base_path
            for _ in range(90):
                try:
                    assert call('/System/Info/Public').get('Version');call('/Startup/User') if token is None else call('/Users/Me');return
                except Exception:time.sleep(1)
            raise RuntimeError('Server startup timeout')
        def start(enabled=True):
            docker('run','-d','--name',name,'--user',f'{os.getuid()}:{os.getgid()}','-p','127.0.0.1::8096','-e','WATCHGUARD_DISPOSABLE_SERVER_GUARD='+('1' if enabled else '0'),'-v',str(root/'config')+':/config','-v',str(root/'media')+':/media',IMAGE);ready()
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
            media=root/'media';media.mkdir();start()
            assert call('/System/Info/Public')['Version'].startswith('12.2')
            password=uuid.uuid4().hex
            call('/Startup/User','POST',{'Name':'WatchGuardPoCTest','Password':password},expected=204)
            call('/Startup/Complete','POST',expected=204)
            signed=call('/Users/AuthenticateByName','POST',{'Username':'WatchGuardPoCTest','Pw':password});token=signed['AccessToken']
            tasks=call('/ScheduledTasks');update=next(t for t in tasks if t['Key']=='PluginUpdates');call('/ScheduledTasks/'+update['Id']+'/Triggers','POST',[],expected=204)
            docker('restart',name);ready()
            report['pluginDiscovery']=[{'name':p['Name'],'id':p['Id'],'version':p['Version']} for p in call('/Plugins') if 'WatchGuard' in p['Name']]
            logs=docker('logs',name);assert 'WG-GUARD-POC attached=2 supported=true' in logs
            docker('exec',name,'/usr/lib/jellyfin-ffmpeg/ffmpeg','-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=black:s=64x64:d=1','-c:v','libx264','-y','/media/template.mp4')
            for title in ['Protected','Clear','BulkClear','Disabled','Uninstalled','ConcurrentClear','WebProtected','NativeDisabled']:
                folder=media/'movies'/title;folder.mkdir(parents=True);shutil.copy2(media/'template.mp4',folder/(title+'.mp4'))
            for title,count in [('Guard Series',2),('Long Series',300)]:
                folder=media/'tv'/title/'Season 01';folder.mkdir(parents=True)
                (folder.parent/'tvshow.nfo').write_text('<tvshow><title>'+title+'</title><status>Ended</status></tvshow>')
                for number in range(1,count+1):
                    stem=f'{title} S01E{number:03d}';shutil.copy2(media/'template.mp4',folder/(stem+'.mp4'))
                    (folder/(stem+'.nfo')).write_text(f'<episodedetails><title>Fixture {number}</title><season>1</season><episode>{number}</episode><aired>2020-01-01</aired></episodedetails>')
            options={'LibraryOptions':{'EnableRealtimeMonitor':False,'EnableInternetProviders':False,'TypeOptions':[{'Type':kind,'MetadataFetchers':[],'ImageFetchers':[]} for kind in ['Movie','Series','Season','Episode']]}}
            for kind in ['movies','tvshows']:
                path='/media/'+('movies' if kind=='movies' else 'tv')
                call('/Library/VirtualFolders?name='+kind+'&collectionType='+kind+'&paths='+path+'&refreshLibrary=true','POST',options,expected=204)
            for _ in range(120):
                items=call('/Items?Recursive=true&Fields=Path&IncludeItemTypes=Movie,Series,Season,Episode')['Items']
                if len([i for i in items if i['Type']=='Episode'])==302:break
                time.sleep(1)
            else:raise AssertionError('Scan incomplete')
            media_records=items
            movies={i['Name']:i for i in items if i['Type']=='Movie'};series={i['Name']:i for i in items if i['Type']=='Series'}
            parent=series['Guard Series'];children=call('/Items?Recursive=true&ParentId='+parent['Id']+'&Fields=Path')['Items'];ep=next(i for i in children if i['Type']=='Episode');season=next(i for i in children if i['Type']=='Season')
            for item in [movies['Protected'],movies['WebProtected'],parent,series['Long Series'],movies['Disabled'],movies['Uninstalled'],movies['NativeDisabled']]:call('/WatchGuard/Watchlist/'+item['Id'],'PUT',expected=204)
            call('/WatchGuard/Preferences','PUT',{'Owner':'mine','Statuses':['watchlisted','watching','playing'],'Sort':'title'})
            saved_data={p:p.read_bytes() for p in (root/'config').rglob('*.json') if p.name in ('watchlists.json','preferences.json')}
            assert len(saved_data)==2
            for label,item in [('movie',movies['Protected']),('series',parent),('season',season),('episode',ep),('long-series-300',series['Long Series'])]:
                veto(label,[item],code='WatchGuardProtectionRequired')
                if item['Type'] in ['Series','Season']:preserved([i for i in children if i['Type']=='Episode'])
            for repeat in range(3):
                veto('warm-movie-'+str(repeat),[movies['Protected']],code='WatchGuardProtectionRequired')
                veto('warm-long-series-'+str(repeat),[series['Long Series']],code='WatchGuardProtectionRequired')
            clear=movies['Clear'];before=docker('logs',name).count('outcome=ContinueNative')
            t=time.perf_counter();call('/Items/'+clear['Id'],'DELETE',expected=204)
            request_ms=round((time.perf_counter()-t)*1000,2)
            call('/Items/'+clear['Id'],expected=404);assert not (root/clear['Path'].lstrip('/')).exists()
            assert docker('logs',name).count('outcome=ContinueNative')==before+1
            report['cases'].append({'case':'unprotected','http':204,'nativeContinuations':1,'fileAndRecordRemoved':True,'requestDurationMs':request_ms})
            memberPassword=uuid.uuid4().hex;member=call('/Users/New','POST',{'Name':'GuardMember','Password':memberPassword})
            memberToken=call('/Users/AuthenticateByName','POST',{'Username':'GuardMember','Pw':memberPassword})['AccessToken']
            veto('native-permission',[movies['Protected']],auth=memberToken,status=401,code='DeletionNotPermitted')
            policy=member['Policy'];policy['EnableContentDeletion']=True;call('/Users/'+member['Id']+'/Policy','POST',policy,expected=204)
            veto('ordinary-user-no-history',[movies['Protected']],auth=memberToken,code='WatchGuardProtectionRequired')
            policy['EnableAllFolders']=False;policy['EnabledFolders']=[];call('/Users/'+member['Id']+'/Policy','POST',policy,expected=204)
            veto('invisible',[movies['Protected']],auth=memberToken,status=404,code='TargetUnavailable')
            veto('empty-bulk',[movies['Protected']],path='/Items',status=400,code='InvalidTargetSet')
            veto('unauthenticated',[movies['Protected']],auth=None,status=401)
            call('/Auth/Keys?app=GuardFixture','POST',expected=204);key=call('/Auth/Keys')['Items'][0]['AccessToken']
            veto('api-key',[movies['Protected']],auth=key,status=403,code='ApiKeyDeletionUnsupported')
            store=next(p for p in saved_data if p.name=='watchlists.json')
            try:
                store.write_text('{broken')
                veto('lookup-failure',[movies['BulkClear']],status=503,code='ProtectionUnavailable')
            finally:store.write_bytes(saved_data[store])
            bulk=[movies['BulkClear'],movies['Protected']]
            veto('api-key-bulk',bulk,path='/Items?ids='+','.join(i['Id'] for i in bulk),auth=key,status=403,code='ApiKeyDeletionUnsupported')
            veto('protected-last',bulk,path='/Items?ids='+','.join(i['Id'] for i in bulk),code='WatchGuardProtectionRequired')
            veto('duplicates',[movies['Protected']],path='/Items?ids='+movies['Protected']['Id']+','+movies['Protected']['Id'],status=400,code='InvalidTargetSet')
            veto('overlap-series-episode',[parent,ep],path='/Items?ids='+parent['Id']+','+ep['Id'],status=400,code='OverlappingTargets')
            veto('overlap-season-episode',[season,ep],path='/Items?ids='+season['Id']+','+ep['Id'],status=400,code='OverlappingTargets')
            veto('missing-last',[movies['BulkClear']],path='/Items?ids='+movies['BulkClear']['Id']+','+uuid.uuid4().hex,status=404,code='TargetUnavailable')
            veto('malformed',[movies['Protected']],path='/Items?ids=not-a-guid',status=400)
            folder=call('/Items?Fields=Path')['Items'][0]
            veto('unsupported-library-folder-native-permission',[folder],status=401,code='DeletionNotPermitted')
            allowed=[movies['BulkClear'],movies['ConcurrentClear']]
            before=docker('logs',name).count('outcome=ContinueNative')
            started=time.perf_counter();call('/Items?ids='+','.join(i['Id'] for i in allowed),'DELETE',expected=204)
            duration=round((time.perf_counter()-started)*1000,2)
            assert docker('logs',name).count('outcome=ContinueNative')==before+1
            for item in allowed:
                call('/Items/'+item['Id'],expected=404);assert not (root/item['Path'].lstrip('/')).exists()
            report['cases'].append({'case':'unprotected-bulk','http':204,'nativeContinuations':1,'nativeTargetCount':2,'filesAndRecordsRemoved':True,'requestDurationMs':duration})
            with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
                replies=list(pool.map(lambda _:call('/Items/'+movies['Protected']['Id'],'DELETE',expected=409),range(4)))
            assert all(r['Code']=='WatchGuardProtectionRequired' for r in replies);preserved([movies['Protected']]);report['cases'].append({'case':'concurrent-protected','requests':4,'filesAndRecordsPreserved':True})
            before=docker('logs',name).count('WG-GUARD-POC outcome=')
            for path in ['/System/Info/Public','/Items?Limit=2','/WatchGuard/Watchlist','/Users/Me']:call(path)
            assert docker('logs',name).count('WG-GUARD-POC outcome=')==before
            report['unrelatedRequestsEvaluations']=0
            fixture=root/'browser.json';fixture.write_text(json.dumps({'base':base,'username':'WatchGuardPoCTest','password':password,'id':movies['WebProtected']['Id'],'serverId':signed['ServerId']}));fixture.chmod(0o600)
            subprocess.run(['node',str(ROOT/'experiments/ServerGuardPoC/browser-test.cjs'),str(fixture)],check=True)
            preserved([movies['WebProtected']]);report['browser']='PASS: Cancel zero DELETE; Delete Anyway one DELETE rejected 409'
            docker('restart',name);ready();assert 'attached=2 supported=true' in docker('logs',name);veto('restart',[movies['Protected']],code='WatchGuardProtectionRequired')
            # Native disable applies to the whole disposable co-located plugin folder.
            attachment_count=docker('logs',name).count('attached=2 supported=true')
            call('/Plugins/a3c6bc84-783d-4ba8-a0db-89bfb83ab486/0.4.8.0/Disable','POST',expected=204)
            docker('restart',name);ready()
            assert docker('logs',name).count('attached=2 supported=true')==attachment_count
            call('/Items/'+movies['NativeDisabled']['Id'],'DELETE',expected=204)
            call('/Items/'+movies['NativeDisabled']['Id'],expected=404)
            assert not (root/movies['NativeDisabled']['Path'].lstrip('/')).exists()
            call('/Plugins/a3c6bc84-783d-4ba8-a0db-89bfb83ab486/0.4.8.0/Enable','POST',expected=204)
            docker('restart',name);ready()
            veto('native-reenable',[movies['Protected']],code='WatchGuardProtectionRequired')
            report['nativeDisable']='co-located WatchGuard folder disabled after restart: no attachment and native deletion restored; reenable restores veto'
            # Separate recreated container, same generated data. Environment opt-out is startup-only.
            (output/'guard.log').write_text('\n'.join(l for l in docker('logs',name).splitlines() if 'WG-GUARD-POC' in l)+'\n')
            docker('rm','-f',name);start(False)
            assert 'WG-GUARD-POC attached=' not in docker('logs',name)
            call('/Items/'+movies['Disabled']['Id'],'DELETE',expected=204);assert not (root/movies['Disabled']['Path'].lstrip('/')).exists();call('/Items/'+movies['Disabled']['Id'],expected=404)
            report['disabled']='native deletion restored after environment opt-out/recreation'
            docker('rm','-f',name);(guard/DLL.name).unlink();start(True)
            assert 'WG-GUARD-POC attached=' not in docker('logs',name)
            call('/Items/'+movies['Uninstalled']['Id'],'DELETE',expected=204);assert not (root/movies['Uninstalled']['Path'].lstrip('/')).exists();call('/Items/'+movies['Uninstalled']['Id'],expected=404)
            report['uninstalled']='native deletion restored after assembly removal/restart';report['status']='PASS'
            assert all(p.read_bytes()==value for p,value in saved_data.items())
            report['watchlistsAndPreferences']='byte-identical after veto, restart, disable and uninstall'
            (output/'failure.log').unlink(missing_ok=True)
        finally:

            if report['status']=='RUNNING':
                report['status']='FAIL'
                try:(output/'failure.log').write_text('\n'.join(l for l in docker('logs',name).splitlines() if 'WG-GUARD-POC' in l or 'Error' in l or 'Exception' in l))
                except Exception:pass
            (output/'results.json').write_text(json.dumps(report,indent=2)+'\n')
            subprocess.run(['docker','rm','-f',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    print(json.dumps({'status':report['status'],'cases':len(report['cases']),'basePath':a.base_path}))
if __name__=='__main__':main()
