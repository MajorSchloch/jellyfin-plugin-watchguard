"""Called only by docker-smoke.py against its disposable config and synthetic library."""
import functools
import hashlib
import http.server
import importlib.util
import json
from pathlib import Path
import shutil
import threading
import time
from urllib.parse import urlencode
import zipfile

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('catalog',ROOT/'scripts/catalog.py')
catalog=importlib.util.module_from_spec(spec);spec.loader.exec_module(catalog)
GUID=catalog.GUID
INJECTOR='f5a34f7b-2e8a-4e6a-a722-3a216a81b374'


def run(call, restart, docker, name, root, plugins, token, movie):
    assert name.startswith('watchguard-poc-') and 'watchguard-poc-' in str(root)
    public=root/'catalog';public.mkdir()
    backup=root/'retired-plugins';backup.mkdir()
    archive=ROOT/'artifacts/Jellyfin.Plugin.WatchGuard-v0.3.1.zip'
    shutil.copyfile(archive,public/archive.name)
    rollback=ROOT/'artifacts/Jellyfin.Plugin.WatchGuard-v0.3.0.zip'
    shutil.copyfile(rollback,public/rollback.name)
    requests=[]
    class Handler(http.server.SimpleHTTPRequestHandler):
        def do_GET(self):
            requests.append(self.path);super().do_GET()
        def log_message(self,*args):pass
        def list_directory(self,path):self.send_error(404)
    # Only release ZIPs/manifests are served, never fixture config, tokens or media.
    server=http.server.ThreadingHTTPServer(('0.0.0.0',0),functools.partial(Handler,directory=str(public)))
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    base='http://host.docker.internal:'+str(server.server_port)
    version=catalog.entry(archive,base+'/'+archive.name,'2026-10-11T00:00:00Z')
    old_version=catalog.entry(rollback,base+'/'+rollback.name,'2026-10-11T14:02:34Z','0.3.0.0')
    manifest=[catalog.package([version,old_version])];catalog.validate(manifest,True)
    (public/'manifest.json').write_text(json.dumps(manifest))
    bad=json.loads(json.dumps(manifest));bad[0]['versions'][0]['checksum']='0'*32
    (public/'bad.json').write_text(json.dumps(bad))
    def repo(file):
        call('/Repositories','POST',[{'Name':'WatchGuard disposable catalog','Url':base+'/'+file,'Enabled':True}],token,expected=204)
    def install(file='manifest.json',expected=204,version='0.3.1.0'):
        repo(file)
        packages=call('/Packages',token=token)
        assert any(p['guid'].replace('-','')==GUID.replace('-','') for p in packages), ('Catalog not found',requests, [line for line in docker('logs',name).splitlines() if 'repository' in line.lower() or 'host.docker.internal' in line][-8:])
        call('/Packages/Installed/WatchGuard?'+urlencode({'assemblyGuid':GUID,'version':version,'repositoryUrl':base+'/'+file}),'POST',token=token,expected=expected,raw=True)
    def verify():
        found=[p for p in call('/Plugins',token=token) if p['Id'].replace('-','')==GUID.replace('-','')]
        assert len(found)==1 and found[0]['Version']=='0.3.1.0'
        assert (plugins/'Jellyfin.Plugin.WatchGuard/watchlists.json').read_bytes()==saved
        assert call('/WatchGuard/Watchlist',token=token)[0]['ItemId'].replace('-','')==movie.replace('-','')
        registered=call('/Plugins/'+INJECTOR+'/Configuration',token=token)['PluginJavaScripts']
        rows=[r for r in registered if r['Id']=='watchguard-v1']
        assert len(rows)==1 and rows[0]['PluginVersion']=='0.3.1'
    try:
        call('/WatchGuard/Watchlist/'+movie,'PUT',token=token,expected=204)
        saved=(plugins/'Jellyfin.Plugin.WatchGuard/watchlists.json').read_bytes()
        settings=(plugins/'configurations/Jellyfin.Plugin.WatchGuard.xml').read_bytes()
        # First prove an installation with no WatchGuard assembly in discovery.
        shutil.move(str(plugins/'WatchGuard'),str(backup/'initial'))
        restart()
        call('/WatchGuard/Watchlist',token=token,expected=404)
        install('bad.json',500)
        assert not (plugins/'WatchGuard_0.3.1.0').exists()
        install()
        folder=plugins/'WatchGuard_0.3.1.0'
        assert (folder/'meta.json').exists()
        with zipfile.ZipFile(archive) as z:assert (folder/catalog.DLL).read_bytes()==z.read(catalog.DLL)
        restart();verify()
        # Install published v0.3.0 through the native installer, then update normally without DLL manipulation.
        shutil.move(str(folder),str(backup/'clean-install'))
        restart(); install(version='0.3.0.0'); restart()
        assert any(p['Id'].replace('-','')==GUID.replace('-','') and p['Version']=='0.3.0.0' for p in call('/Plugins',token=token))
        install(); restart(); verify()
        assert (plugins/'configurations/Jellyfin.Plugin.WatchGuard.xml').read_bytes()==settings
        # Preferences survive deliberate stopped-server rollback; old version safely ignores the separate file.
        prefs={'Owner':'all','Statuses':['watched'],'Sort':'recent'}
        call('/WatchGuard/Preferences','PUT',prefs,token)
        preference_path=plugins/'Jellyfin.Plugin.WatchGuard/preferences.json'
        preference_bytes=preference_path.read_bytes()
        docker('stop',name)
        shutil.move(str(folder),str(backup/'upgrade-v031'))
        old=plugins/'WatchGuard_0.3.0.0'
        if old.exists(): shutil.move(str(old),str(backup/'native-old-retained'))
        old.mkdir()
        with zipfile.ZipFile(rollback) as z:(old/catalog.DLL).write_bytes(z.read(catalog.DLL))
        restart()
        assert any(p['Id'].replace('-','')==GUID.replace('-','') and p['Version']=='0.3.0.0' for p in call('/Plugins',token=token))
        assert preference_path.read_bytes()==preference_bytes
        assert (plugins/'Jellyfin.Plugin.WatchGuard/watchlists.json').read_bytes()==saved
        install();restart();verify()
        assert call('/WatchGuard/Preferences',token=token)==prefs
        # An absent dependency must not be reported as successful registration.
        shutil.move(str(plugins/'JavaScriptInjector'),str(backup/'injector'))
        since=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())
        restart();call('/WatchGuard/Watchlist',token=token)
        call('/JavaScriptInjector/private.js',token=token,expected=404)
        for _ in range(75):
            logs=docker('logs','--since',since,name)
            if 'WatchGuard web script was not registered. No deletion confirmation is active.' in logs:break
            time.sleep(1)
        else:raise AssertionError('Missing Injector diagnostic was not emitted')
        assert 'WatchGuard web script registered with JavaScript Injector.' not in logs
        status=call('/WatchGuard/IntegrationStatus',token=token)
        assert not status['Registration']['InjectorDiscovered'] and not status['Registration']['RegistrationSucceeded']
        shutil.move(str(backup/'injector'),str(plugins/'JavaScriptInjector'))
        restart();verify()
        report={'result':'PASS','catalogInstaller':'native Packages API','checksumMismatch':'rejected before extraction','cleanInstall':True,'catalogUpgrade':'0.3.0 -> 0.3.1','rollback':'0.3.1 -> 0.3.0 -> 0.3.1','preferencesPreserved':True,'watchlistsBytesPreserved':True,'configurationBytesPreserved':True,'duplicateLoadedPlugins':False,'injectorRegistrations':1,'missingInjectorDiagnostic':True,'productionTouched':False}
        (ROOT/'artifacts/catalog-validation.json').write_text(json.dumps(report,indent=2)+'\n')
        print('Catalog checks passed: native checksum rejection, clean install, catalog upgrade and rollback, preserved data/config, unique registration, missing Injector.',flush=True)
    finally:
        server.shutdown();server.server_close();thread.join()
