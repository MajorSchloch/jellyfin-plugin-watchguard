"""Real native catalog install using maintained editorial content and one local candidate ZIP."""
import copy
import functools
import hashlib
import http.server
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import threading
from urllib.parse import urlencode

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('catalog',ROOT/'scripts/catalog.py')
catalog=importlib.util.module_from_spec(spec);spec.loader.exec_module(catalog)

def fixture_catalog(published, candidate):
    """Private install source also works when qualifying an already released build.

    Preserve the public document and every other revision. Replace only this
    version's private fixture entry instead of appending a duplicate revision.
    """
    catalog.validate(published)
    data=copy.deepcopy(published)
    data[0]['versions']=[candidate]+[v for v in data[0]['versions'] if v['version'] != candidate['version']]
    catalog.validate(data,True)
    return data


def prepare(call,restart,root,plugins,token,artifact,browser_fixture):
    public=root/'listing-catalog';public.mkdir()
    archive=ROOT/'artifacts/Jellyfin.Plugin.WatchGuard-v0.7.15.zip'
    shutil.copyfile(archive,public/archive.name)
    class Handler(http.server.SimpleHTTPRequestHandler):
        def log_message(self,*args):pass
        def list_directory(self,path):self.send_error(404)
    server=http.server.ThreadingHTTPServer(('0.0.0.0',0),functools.partial(Handler,directory=str(public)))
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    def close():
        server.shutdown();server.server_close();thread.join(timeout=10)
        assert not thread.is_alive()
    try:
        base='http://host.docker.internal:'+str(server.server_port)
        data=fixture_catalog(json.loads((ROOT/'manifest.json').read_text()),
                             catalog.entry(archive,base+'/'+archive.name,'2026-10-25T00:00:00Z'))
        (public/'manifest.json').write_text(json.dumps(data))
        shutil.move(str(plugins/'WatchGuard'),str(root/'retired-listing-preinstall'))
        restart()
        call('/Repositories','POST',[{'Name':'WatchGuard listing fixture','Url':base+'/manifest.json','Enabled':True}],token,expected=204)
        # Native package APIs add the repository link; do not fake it in the browser.
        packages=call('/Packages',token=token)
        package=next(p for p in packages if p['guid'].replace('-','')==catalog.GUID.replace('-',''))
        assert all(package[key]==data[0][key] for key in ('imageUrl','overview','description'))
        # Exercise the real available catalog before installing, including the
        # browser's direct public image URL (installed cards use a cached endpoint).
        fixture=root/'available-listing.json'
        fixture.write_text(json.dumps({**browser_fixture(), 'available':True,
            'repositoryUrl':base+'/manifest.json',
            'imageSha256':hashlib.sha256((ROOT/'assets/watchguard-v1.webp').read_bytes()).hexdigest()}))
        fixture.chmod(0o600)
        subprocess.run(['node',str(ROOT/'tests/catalog-listing-browser.cjs'),str(fixture)],check=True,timeout=240)
        query=urlencode({'assemblyGuid':catalog.GUID,'version':'0.7.15.0','repositoryUrl':base+'/manifest.json'})
        call('/Packages/Installed/WatchGuard?'+query,'POST',token=token,expected=204,raw=True)
        restart()
        folder=plugins/'WatchGuard_0.7.15.0'
        assert (folder/catalog.DLL).read_bytes()==artifact.read_bytes()
        meta=json.loads((folder/'meta.json').read_text())
        assert meta['imagePath'], 'Native installer failed to cache public artwork'
        image=folder/Path(meta['imagePath']).name
        assert image.read_bytes()==(ROOT/'assets/watchguard-v1.webp').read_bytes()
        active=next(p for p in call('/Plugins',token=token) if p['Id'].replace('-','')==catalog.GUID.replace('-','') and p['Status']=='Active')
        assert active['Version']=='0.7.15.0' and active['Description']==data[0]['description'] and active['HasImage']
        return {'close':close,'folder':folder,'repositoryUrl':base+'/manifest.json','imageSha256':hashlib.sha256(image.read_bytes()).hexdigest()}
    except BaseException:
        close();raise
