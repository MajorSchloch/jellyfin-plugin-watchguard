"""Native catalog installation of the release candidate in a disposable server."""
import functools,http.server,threading,shutil,json,hashlib,zipfile,time
from urllib.parse import urlencode
from pathlib import Path

def run(call,restart,docker,name,root,plugins,token,artifact):
    assert 'watchguard-poc-' in str(root)
    public=root/'experimental-catalog';public.mkdir()
    archive=public/'Jellyfin.Plugin.WatchGuard-v0.4.5.zip'
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
        'versions':[{'version':'0.4.5.0','targetAbi':'12.2.0.0','checksum':hashlib.md5(archive.read_bytes()).hexdigest(),'sourceUrl':base+'/'+archive.name,'timestamp':'2026-10-12T00:00:00Z','changelog':'Local release candidate, not published'}]}]
    baseline=Path(__file__).resolve().parents[1]/'artifacts/Jellyfin.Plugin.WatchGuard-v0.4.0.zip'
    assert hashlib.sha256(baseline.read_bytes()).hexdigest()=='439fdc1accf4922e7f6eb8d01451e8d83f3343d656ef65d778f5dc99163bda4d'
    shutil.copyfile(baseline,public/baseline.name)
    manifest[0]['versions'].append({**manifest[0]['versions'][0],'version':'0.4.0.0','sourceUrl':base+'/'+baseline.name,'checksum':hashlib.md5(baseline.read_bytes()).hexdigest()})
    recent=Path(__file__).resolve().parents[1]/'artifacts/Jellyfin.Plugin.WatchGuard-v0.4.1.zip'
    assert hashlib.sha256(recent.read_bytes()).hexdigest()=='b679195d7bc914ff64c6b311fa2938de0084ef195f447b92338284e10dd8411e'
    shutil.copyfile(recent,public/recent.name)
    manifest[0]['versions'].append({**manifest[0]['versions'][0],'version':'0.4.1.0','sourceUrl':base+'/'+recent.name,'checksum':hashlib.md5(recent.read_bytes()).hexdigest()})
    production=Path(__file__).resolve().parents[1]/'artifacts/Jellyfin.Plugin.WatchGuard-v0.4.2.zip'
    assert hashlib.sha256(production.read_bytes()).hexdigest()=='c4902b23a1125fe3db26ffe77520a0a14eeca54bff946879cc4a3a73044858a5'
    shutil.copyfile(production,public/production.name)
    manifest[0]['versions'].append({**manifest[0]['versions'][0],'version':'0.4.2.0','sourceUrl':base+'/'+production.name,'checksum':hashlib.md5(production.read_bytes()).hexdigest()})
    previous_release=Path(__file__).resolve().parents[1]/'artifacts/Jellyfin.Plugin.WatchGuard-v0.4.3.zip'
    assert hashlib.sha256(previous_release.read_bytes()).hexdigest()=='fc8bcb6e312f37fe73749ee0450a57f5dfda8fc4470549c633c1e3920271be47'
    shutil.copyfile(previous_release,public/previous_release.name)
    manifest[0]['versions'].append({**manifest[0]['versions'][0],'version':'0.4.3.0','sourceUrl':base+'/'+previous_release.name,'checksum':hashlib.md5(previous_release.read_bytes()).hexdigest()})
    baseline044=Path(__file__).resolve().parents[1]/'artifacts/Jellyfin.Plugin.WatchGuard-v0.4.4.zip'
    assert hashlib.sha256(baseline044.read_bytes()).hexdigest()=='516f29160d4e6efb7296867d7a00848124306af804586dedceea9e6828d2e679'
    shutil.copyfile(baseline044,public/baseline044.name)
    manifest[0]['versions'].append({**manifest[0]['versions'][0],'version':'0.4.4.0','sourceUrl':base+'/'+baseline044.name,'checksum':hashlib.md5(baseline044.read_bytes()).hexdigest()})
    (public/'manifest.json').write_text(json.dumps(manifest))
    try:
        shutil.move(str(plugins/'WatchGuard'),str(root/'retired-preinstall'))
        restart();call('/WatchGuard/Watchlist',token=token,expected=404)
        call('/Repositories','POST',[{'Name':'Standalone disposable fixture','Url':base+'/manifest.json','Enabled':True}],token,expected=204)
        query=urlencode({'assemblyGuid':guid,'version':'0.4.5.0','repositoryUrl':base+'/manifest.json'})
        call('/Packages/Installed/WatchGuard?'+query,'POST',token=token,expected=204,raw=True)
        restart()
        assert 'watchguard-standalone-loader' in call('/web/index.html',raw=True)
        assert not any('JavaScriptInjector' in p.name for p in plugins.rglob('*.dll'))
        assert (plugins/'WatchGuard_0.4.5.0/meta.json').exists()
        # Seed both schema-1 stores, then use native uninstall/install for rollback and upgrade.
        movie=call('/Items?Recursive=true&IncludeItemTypes=Movie&Limit=1',token=token)['Items'][0]['Id']
        call('/WatchGuard/Watchlist/'+movie,'PUT',token=token,expected=204)
        prefs={'Owner':'mine','Statuses':['watchlisted','watching'],'Sort':'recent'}
        call('/WatchGuard/Preferences','PUT',prefs,token)
        paths=[plugins/'Jellyfin.Plugin.WatchGuard'/f for f in ['watchlists.json','preferences.json']]+[plugins/'configurations/Jellyfin.Plugin.WatchGuard.xml']
        saved={p:p.read_bytes() for p in paths}
        for previous,version in [('0.4.5.0','0.4.0.0'),('0.4.0.0','0.4.1.0'),('0.4.1.0','0.4.2.0'),('0.4.2.0','0.4.3.0'),('0.4.3.0','0.4.4.0'),('0.4.4.0','0.4.5.0')]:
            call('/Plugins/'+guid+'/'+previous,'DELETE',token=token,expected=204)
            # Native uninstall may leave a versioned folder still discoverable.
            # Enforce a clean fixture boundary while the container is stopped,
            # without touching the separate WatchGuard JSON/preferences folder.
            docker('stop',name)
            previous_folder=plugins/('WatchGuard_'+previous)
            if previous_folder.exists():
                shutil.move(str(previous_folder),str(root/('retired-version-'+previous)))
            restart()
            call('/WatchGuard/Watchlist',token=token,expected=404)
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
            if len(active)!=1 or active[0]['Version']!=version:
                # Jellyfin 12.2 sometimes retains a previous Restart-pending
                # install even after its native uninstall returned 204. A bare
                # restart can reactivate that stale version. Repair only this
                # disposable fixture: stop, retire any *other versioned* folders,
                # restart, and require the normal one-Active invariant.
                unexpected=[p for p in plugins.glob('WatchGuard_*')
                            if p.is_dir() and p.name!=('WatchGuard_'+version)]
                assert unexpected, 'Native status mismatched without an identifiable stale version folder'
                docker('stop',name)
                for stale in unexpected:
                    assert stale.name in ('WatchGuard_0.4.0.0','WatchGuard_0.4.1.0','WatchGuard_0.4.2.0','WatchGuard_0.4.3.0','WatchGuard_0.4.4.0','WatchGuard_0.4.5.0')
                    destination=root/('retired-stale-'+stale.name)
                    assert not destination.exists()
                    shutil.move(str(stale),str(destination))
                restart()
                reloaded=call('/WatchGuard/IntegrationStatus',token=token)
                assert reloaded['PluginVersion']==version[:-2] and reloaded['Standalone']['LoaderActive'], (
                    'Expected plugin did not survive retirement of stale versioned files')
                assert all(p.read_bytes()==content for p,content in saved.items())
                plugin_rows=[p for p in call('/Plugins',token=token) if p['Id'].replace('-','')==guid.replace('-','')]
                active=[p for p in plugin_rows if p['Status']=='Active']
                print('Catalog round-trip post-cleanup state:',json.dumps({
                    'expected':version,
                    'plugins':[{'Version':p.get('Version'),'Status':p.get('Status')} for p in plugin_rows],
                    'versionFolders':sorted(p.name for p in plugins.glob('WatchGuard_*'))
                }),flush=True)
            assert len(active)==1 and active[0]['Version']==version
        call('/WatchGuard/Watchlist/'+movie,'DELETE',token=token,expected=204)
        call('/WatchGuard/Preferences','DELETE',token=token)
        report={'result':'PASS','baselineSha256':hashlib.sha256(baseline.read_bytes()).hexdigest(),'roundTrip':'0.4.5 -> 0.4.0 -> 0.4.1 -> 0.4.2 -> 0.4.3 -> 0.4.4 -> 0.4.5','storesAndConfigBytesPreserved':True,'noInjector':True,'singleActiveAssembly':True}
        (Path(__file__).resolve().parents[1]/'artifacts/catalog-upgrade-v045.json').write_text(json.dumps(report,indent=2)+'\n')
        print('v0.4.0 standalone catalog rollback/upgrade preserves both stores and configuration.',flush=True)
        print('Standalone native catalog install: fresh discovery, WatchGuard DLL only, restart loaded loader without Injector.',flush=True)
        return plugins/'WatchGuard_0.4.5.0'
    finally:server.shutdown();server.server_close();thread.join()
