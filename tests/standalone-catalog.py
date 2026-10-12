"""Native catalog installation of the release candidate in a disposable server."""
import functools,http.server,threading,shutil,json,hashlib,zipfile,time
from urllib.parse import urlencode
from pathlib import Path

def run(call,restart,root,plugins,token,artifact):
    assert 'watchguard-poc-' in str(root)
    public=root/'experimental-catalog';public.mkdir()
    archive=public/'Jellyfin.Plugin.WatchGuard-v0.4.0.zip'
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
        'versions':[{'version':'0.4.0.0','targetAbi':'12.2.0.0','checksum':hashlib.md5(archive.read_bytes()).hexdigest(),'sourceUrl':base+'/'+archive.name,'timestamp':'2026-10-12T00:00:00Z','changelog':'Local experimental build, not a release'}]}]
    (public/'manifest.json').write_text(json.dumps(manifest))
    try:
        shutil.move(str(plugins/'WatchGuard'),str(root/'retired-preinstall'))
        restart();call('/WatchGuard/Watchlist',token=token,expected=404)
        call('/Repositories','POST',[{'Name':'Standalone disposable fixture','Url':base+'/manifest.json','Enabled':True}],token,expected=204)
        query=urlencode({'assemblyGuid':guid,'version':'0.4.0.0','repositoryUrl':base+'/manifest.json'})
        call('/Packages/Installed/WatchGuard?'+query,'POST',token=token,expected=204,raw=True)
        restart()
        assert 'watchguard-standalone-loader' in call('/web/index.html',raw=True)
        assert not any('JavaScriptInjector' in p.name for p in plugins.rglob('*.dll'))
        assert (plugins/'WatchGuard_0.4.0.0/meta.json').exists()
        print('Standalone native catalog install: fresh discovery, WatchGuard DLL only, restart loaded loader without Injector.',flush=True)
        return plugins/'WatchGuard_0.4.0.0'
    finally:server.shutdown();server.server_close();thread.join()
