"""Published v0.3.1 + Injector -> normal catalog RC -> rollback, disposable only."""
import functools, hashlib, http.server, json, shutil, threading, zipfile
from pathlib import Path
from urllib.parse import urlencode
ROOT=Path(__file__).resolve().parents[1]
GUID='a3c6bc84-783d-4ba8-a0db-89bfb83ab486'
INJECTOR='f5a34f7b-2e8a-4e6a-a722-3a216a81b374'
def run(call,restart,docker,name,root,plugins,token,movie,installed):
    assert name.startswith('watchguard-poc-')
    public=root/'upgrade-catalog';public.mkdir()
    archives={v:ROOT/'artifacts'/f'Jellyfin.Plugin.WatchGuard-v{v}.zip' for v in ['0.3.1','0.4.0']}
    assert hashlib.sha256(archives['0.3.1'].read_bytes()).hexdigest()=='c4ac915c3f35a28e6737bd68580f712cd0e0e113735a6d399c2a889c7ae7b2f2'
    for archive in archives.values():shutil.copyfile(archive,public/archive.name)
    class Handler(http.server.SimpleHTTPRequestHandler):
        def log_message(self,*args):pass
        def list_directory(self,path):self.send_error(404)
    server=http.server.ThreadingHTTPServer(('0.0.0.0',0),functools.partial(Handler,directory=str(public)))
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    base='http://host.docker.internal:'+str(server.server_port)
    versions=[{'version':v+'.0','targetAbi':'12.2.0.0','checksum':hashlib.md5(a.read_bytes()).hexdigest(),'sourceUrl':base+'/'+a.name,'timestamp':'2026-10-12T00:00:00Z','changelog':'Disposable migration fixture'} for v,a in archives.items()]
    manifest=[{'guid':GUID,'name':'WatchGuard','owner':'Disposable test','category':'General','description':'Local only','overview':'Fixture','versions':versions}]
    (public/'manifest.json').write_text(json.dumps(manifest))
    bad=json.loads(json.dumps(manifest));bad[0]['versions'][1]['checksum']='0'*32
    (public/'bad.json').write_text(json.dumps(bad))
    def install(version,file='manifest.json',expected=204):
        call('/Repositories','POST',[{'Name':'Disposable upgrade','Url':base+'/'+file,'Enabled':True}],token,expected=204)
        call('/Packages/Installed/WatchGuard?'+urlencode({'assemblyGuid':GUID,'version':version+'.0','repositoryUrl':base+'/'+file}),'POST',token=token,expected=expected,raw=True)
    def config():return call('/Plugins/'+INJECTOR+'/Configuration',token=token)
    def remove_registration():
        value=config();value['PluginJavaScripts']=[r for r in value['PluginJavaScripts'] if r['Id']!='watchguard-v1']
        call('/Plugins/'+INJECTOR+'/Configuration','POST',value,token,expected=204)
    def verify_data(saved,prefs):
        assert all(p.read_bytes()==data for p,data in saved.items())
        assert call('/WatchGuard/Preferences',token=token)==prefs
        assert len(call('/WatchGuard/Watchlist',token=token))==1
    try:
        # Real published baseline, installed natively, not a compile/runtime switch.
        docker('stop',name);shutil.move(str(installed),str(root/'retired-initial'))
        restart();install('0.3.1');restart()
        assert call('/WatchGuard/IntegrationStatus',token=token)['PluginVersion']=='0.3.1'
        value=config();assert len([r for r in value['PluginJavaScripts'] if r['Id']=='watchguard-v1'])==1
        sentinel={'Id':'watchguard-fixture-other','Name':'Other fixture','Script':'/* unrelated */','Enabled':True,'RequiresAuthentication':True,'PluginId':'77777777-7777-7777-7777-777777777777','PluginName':'Other fixture','PluginVersion':'1'}
        value['PluginJavaScripts'].append(sentinel)
        call('/Plugins/'+INJECTOR+'/Configuration','POST',value,token,expected=204)
        call('/WatchGuard/Watchlist/'+movie,'PUT',token=token,expected=204)
        prefs={'Owner':'all','Statuses':['watchlisted','watching'],'Sort':'recent'}
        call('/WatchGuard/Preferences','PUT',prefs,token)
        paths=[plugins/'Jellyfin.Plugin.WatchGuard'/f for f in ['watchlists.json','preferences.json']]+[plugins/'configurations/Jellyfin.Plugin.WatchGuard.xml']
        saved={p:p.read_bytes() for p in paths}
        injector_xml=plugins/'configurations/Jellyfin.Plugin.JavaScriptInjector.xml'
        prior=injector_xml.read_bytes()
        install('0.4.0','bad.json',500)
        # The native installer can leave a staged folder after returning HTTP 500.
        # A checksum failure must not activate the candidate; never reuse staged
        # bytes when exercising the subsequent valid catalog installation.
        active_before_restart = [p for p in call('/Plugins',token=token)
                                 if p['Id'].replace('-','')==GUID.replace('-','') and p['Status']=='Active']
        assert len(active_before_restart)==1 and active_before_restart[0]['Version']=='0.3.1.0'
        failed_stage = plugins/'WatchGuard_0.4.0.0'
        if failed_stage.exists():
            docker('stop',name)
            shutil.move(str(failed_stage),str(root/'rejected-checksum-stage'))
            restart()
            baseline = call('/WatchGuard/IntegrationStatus',token=token)
            assert baseline['PluginVersion']=='0.3.1'
        install('0.4.0');restart()
        status=call('/WatchGuard/IntegrationStatus',token=token)
        assert status['PluginVersion']=='0.4.0' and not status['Standalone']['LoaderActive']
        assert status['Standalone']['Injector']['WatchGuardRegistration']
        assert injector_xml.read_bytes()==prior # RC never edits old persisted registrations.
        assert 'watchguard-standalone-loader' not in call('/web/index.html',raw=True)
        call('/WatchGuard/Standalone/bootstrap.js',expected=409)
        call('/WatchGuard/Standalone/script.js',token=token,expected=409)
        verify_data(saved,prefs)
        remove_registration();restart()
        assert [r['Id'] for r in config()['PluginJavaScripts']]==['watchguard-fixture-other']
        assert call('/WatchGuard/IntegrationStatus',token=token)['Standalone']['LoaderActive']
        assert 'watchguard-standalone-loader' in call('/web/index.html',raw=True)
        verify_data(saved,prefs)
        folder=plugins/'WatchGuard_0.4.0.0'
        assert (folder/'meta.json').exists()
        active=[p for p in call('/Plugins',token=token) if p['Id'].replace('-','')==GUID.replace('-','') and p['Status']=='Active']
        assert len(active)==1 and active[0]['Version']=='0.4.0.0'
        docker('stop',name);shutil.move(str(folder),str(root/'retired-rc'))
        restart();install('0.3.1');restart()
        assert call('/WatchGuard/IntegrationStatus',token=token)['PluginVersion']=='0.3.1'
        rows=config()['PluginJavaScripts']
        assert len([r for r in rows if r['Id']=='watchguard-v1'])==1
        assert next(r for r in rows if r['Id']=='watchguard-fixture-other')==sentinel
        call('/WatchGuard/Standalone/bootstrap.js',expected=404)
        verify_data(saved,prefs)
        install('0.4.0');restart()
        assert not call('/WatchGuard/IntegrationStatus',token=token)['Standalone']['LoaderActive']
        remove_registration();restart();verify_data(saved,prefs)
        assert call('/WatchGuard/IntegrationStatus',token=token)['Standalone']['LoaderActive']
        assert next(r for r in config()['PluginJavaScripts'] if r['Id']=='watchguard-fixture-other')==sentinel
        call('/WatchGuard/Watchlist/'+movie,'DELETE',token=token,expected=204)
        call('/WatchGuard/Preferences','DELETE',token=token)
        report={'result':'PASS','publishedBaselineSha256':hashlib.sha256(archives['0.3.1'].read_bytes()).hexdigest(),'upgrade':'0.3.1 -> 0.4.0','rollback':'0.4.0 -> 0.3.1 -> 0.4.0','checksumRejection':True,'conflictBlocked':True,'noAutomaticInjectorWrites':True,'otherScriptsPreserved':True,'dataAndConfigBytesPreserved':True,'duplicateActivePlugins':False}
        (ROOT/'artifacts/migration-v040.json').write_text(json.dumps(report,indent=2)+'\n')
        print('RC catalog migration/rollback passed: published v0.3.1, checksum rejection, conflict refusal, explicit cleanup, unchanged stores/config and unrelated scripts.',flush=True)
        return folder
    finally:server.shutdown();server.server_close();thread.join()
