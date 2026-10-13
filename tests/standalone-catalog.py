"""Native catalog installation of the release candidate in a disposable server."""
import functools,http.server,threading,shutil,json,hashlib,zipfile,time
from urllib.parse import urlencode
from pathlib import Path

def run(call,restart,root,plugins,token,artifact):
    assert 'watchguard-poc-' in str(root)
    public=root/'experimental-catalog';public.mkdir()
    archive=public/'Jellyfin.Plugin.WatchGuard-v0.4.1.zip'
    shutil.copyfile(Path(__file__).resolve().parents[1]/'artifacts'/archive.name,archive)
    with zipfile.ZipFile(archive) as z:
        assert z.namelist()==['Jellyfin.Plugin.WatchGuard.dll','LICENSE']
        assert z.read('Jellyfin.Plugin.WatchGuard.dll')==artifact.read_bytes()
    class Handler(http.server.SimpleHTTPRequestHandler):
        def log_message(self,*args):pass
        def list_directory(self,path):self.send_error(404)
    server=http.server.ThreadingHTTPServer(('0.0.0.0',0),functools.partial(Handler,directory=str(public)))
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    base='http://host.docker.internal:'+str(server.server_port)
    guid='a3c6bc84-783d-4ba8-a0db-89bfb83ab486'
    manifest=[{'guid':guid,'name':'WatchGuard','owner':'Disposable PoC','category':'General','description':'Release candidate, local only','overview':'Fixture',
        'versions':[{'version':'0.4.1.0','targetAbi':'12.2.0.0','checksum':hashlib.md5(archive.read_bytes()).hexdigest(),'sourceUrl':base+'/'+archive.name,'timestamp':'2026-10-12T00:00:00Z','changelog':'Local release candidate, not published'}]}]
    baseline=Path(__file__).resolve().parents[1]/'artifacts/Jellyfin.Plugin.WatchGuard-v0.4.0.zip'
    assert hashlib.sha256(baseline.read_bytes()).hexdigest()=='439fdc1accf4922e7f6eb8d01451e8d83f3343d656ef65d778f5dc99163bda4d'
    shutil.copyfile(baseline,public/baseline.name)
    manifest[0]['versions'].append({**manifest[0]['versions'][0],'version':'0.4.0.0','sourceUrl':base+'/'+baseline.name,'checksum':hashlib.md5(baseline.read_bytes()).hexdigest()})
    (public/'manifest.json').write_text(json.dumps(manifest))
    try:
        shutil.move(str(plugins/'WatchGuard'),str(root/'retired-preinstall'))
        restart();call('/WatchGuard/Watchlist',token=token,expected=404)
        call('/Repositories','POST',[{'Name':'Standalone disposable fixture','Url':base+'/manifest.json','Enabled':True}],token,expected=204)
        query=urlencode({'assemblyGuid':guid,'version':'0.4.1.0','repositoryUrl':base+'/manifest.json'})
        call('/Packages/Installed/WatchGuard?'+query,'POST',token=token,expected=204,raw=True)
        restart()
        assert 'watchguard-standalone-loader' in call('/web/index.html',raw=True)
        assert not any('JavaScriptInjector' in p.name for p in plugins.rglob('*.dll'))
        assert (plugins/'WatchGuard_0.4.1.0/meta.json').exists()
        # Seed both schema-1 stores, then use native uninstall/install for rollback and upgrade.
        movie=call('/Items?Recursive=true&IncludeItemTypes=Movie&Limit=1',token=token)['Items'][0]['Id']
        call('/WatchGuard/Watchlist/'+movie,'PUT',token=token,expected=204)
        prefs={'Owner':'mine','Statuses':['watchlisted','watching'],'Sort':'recent'}
        call('/WatchGuard/Preferences','PUT',prefs,token)
        paths=[plugins/'Jellyfin.Plugin.WatchGuard'/f for f in ['watchlists.json','preferences.json']]+[plugins/'configurations/Jellyfin.Plugin.WatchGuard.xml']
        saved={p:p.read_bytes() for p in paths}
        for previous,version in [('0.4.1.0','0.4.0.0'),('0.4.0.0','0.4.1.0')]:
            call('/Plugins/'+guid+'/'+previous,'DELETE',token=token,expected=204);restart()
            query=urlencode({'assemblyGuid':guid,'version':version,'repositoryUrl':base+'/manifest.json'})
            call('/Packages/Installed/WatchGuard?'+query,'POST',token=token,expected=204,raw=True);restart()
            status=call('/WatchGuard/IntegrationStatus',token=token)
            assert status['PluginVersion']==version[:-2] and status['Standalone']['LoaderActive']
            assert all(p.read_bytes()==content for p,content in saved.items())
            assert call('/WatchGuard/Preferences',token=token)==prefs
            assert len(call('/WatchGuard/Watchlist',token=token))==1
            plugin_rows=[p for p in call('/Plugins',token=token) if p['Id'].replace('-','')==guid.replace('-','')]
            active=[p for p in plugin_rows if p['Status']=='Active']
            if len(active)!=1 or active[0]['Version']!=version:
                # Native install metadata can lag or be marked Restart/Superseded.
                # Keep the assertion strict until the actual state is observed.
                print('Catalog round-trip plugin diagnostic:',json.dumps({
                    'expected':version,
                    'executing':status['PluginVersion'],
                    'plugins':[{'Version':p.get('Version'),'Status':p.get('Status')} for p in plugin_rows],
                    'versionFolders':sorted(p.name for p in plugins.glob('WatchGuard_*')),
                    'metaPresent':(plugins/('WatchGuard_'+version)/'meta.json').exists()
                }),flush=True)
            assert len(active)==1 and active[0]['Version']==version
        call('/WatchGuard/Watchlist/'+movie,'DELETE',token=token,expected=204)
        call('/WatchGuard/Preferences','DELETE',token=token)
        report={'result':'PASS','baselineSha256':hashlib.sha256(baseline.read_bytes()).hexdigest(),'roundTrip':'0.4.1 -> 0.4.0 -> 0.4.1','storesAndConfigBytesPreserved':True,'noInjector':True,'singleActiveAssembly':True}
        (Path(__file__).resolve().parents[1]/'artifacts/catalog-upgrade-v041.json').write_text(json.dumps(report,indent=2)+'\n')
        print('v0.4.0 standalone catalog rollback/upgrade preserves both stores and configuration.',flush=True)
        print('Standalone native catalog install: fresh discovery, WatchGuard DLL only, restart loaded loader without Injector.',flush=True)
        return plugins/'WatchGuard_0.4.1.0'
    finally:server.shutdown();server.server_close();thread.join()
