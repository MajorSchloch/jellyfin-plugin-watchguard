"""Direct native upgrade, with real previous-release writes and preserved personal data."""
import functools
import hashlib
import http.server
import json
from pathlib import Path
import shutil
import threading
from urllib.parse import urlencode
import zipfile
import xml.etree.ElementTree as ET

ROOT=Path(__file__).resolve().parents[1]
GUID='a3c6bc84-783d-4ba8-a0db-89bfb83ab486'
DLL='Jellyfin.Plugin.WatchGuard.dll'


def run(call,restart,docker,name,root,plugins,token,items):
    assert name.startswith('watchguard-poc-') and root.name.startswith('watchguard-poc-')
    baseline=ROOT/'artifacts/previous-stable'
    identity=json.loads((baseline/'identity.json').read_text())
    archive=baseline/identity['filename']
    assert hashlib.sha256(archive.read_bytes()).hexdigest()==identity['sha256']
    version=ET.parse(ROOT/'Directory.Build.props').findtext('./PropertyGroup/Version')
    assert tuple(map(int,identity['version'].split('.'))) < tuple(map(int,version.split('.')))
    candidate=ROOT/'artifacts'/f'Jellyfin.Plugin.WatchGuard-v{version}.zip'
    installed=plugins/'WatchGuard'
    with zipfile.ZipFile(archive) as z: previous=z.read(DLL)
    docker('stop',name);(installed/DLL).write_bytes(previous);(installed/'meta.json').unlink(missing_ok=True);restart()
    assert call('/WatchGuard/IntegrationStatus',token=token)['PluginVersion']==identity['version']
    deployed=docker('exec',name,'sha256sum','/config/'+(installed/DLL).relative_to(root/'config').as_posix()).split()[0]
    assert deployed==hashlib.sha256(previous).hexdigest()
    active=[p for p in call('/Plugins',token=token) if p['Id'].replace('-','')==GUID.replace('-','') and p['Status']=='Active']
    assert len(active)==1 and active[0]['Version']==identity['version']+'.0'
    movie=next(i['Id'] for i in items if i['Type']=='Movie')
    owner=call('/Users/New','POST',{'Name':'UpgradeOwner','Password':'DisposableUpgrade123!'},token)
    signed=call('/Users/AuthenticateByName','POST',{'Username':'UpgradeOwner','Pw':'DisposableUpgrade123!'})
    other=signed['AccessToken']
    prefs={'Owner':'mine','Statuses':['watchlisted','watching'],'Sort':'added'}
    for auth in (token,other):
        call('/WatchGuard/Watchlist/'+movie,'PUT',token=auth,expected=204)
        call('/WatchGuard/Preferences','PUT',prefs,auth)
    data=plugins/'Jellyfin.Plugin.WatchGuard'
    paths=[data/f for f in ('watchlists.json','watchlist-dates.json','preferences.json','preference-sorts.json')]
    saved={p:p.read_bytes() for p in paths}
    before=[call('/WatchGuard/Watchlist',token=auth) for auth in (token,other)]
    public=root/'upgrade-catalog';public.mkdir();shutil.copyfile(candidate,public/candidate.name)
    class Handler(http.server.SimpleHTTPRequestHandler):
        def log_message(self,*args): pass
        def list_directory(self,path): self.send_error(404)
    server=http.server.ThreadingHTTPServer(('0.0.0.0',0),functools.partial(Handler,directory=str(public)))
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    try:
        url=f'http://host.docker.internal:{server.server_port}/manifest.json'
        manifest=json.loads((ROOT/'manifest.json').read_text())
        entry=dict(identity['catalog'],version=version+'.0',sourceUrl=url.rsplit('/',1)[0]+'/'+candidate.name,checksum=hashlib.md5(candidate.read_bytes()).hexdigest())
        manifest[0]['versions']=[entry]
        (public/'manifest.json').write_text(json.dumps(manifest))
        call('/Repositories','POST',[{'Name':'Direct upgrade fixture','Url':url,'Enabled':True}],token,expected=204)
        query=urlencode(dict(assemblyGuid=GUID,version=version+'.0',repositoryUrl=url))
        call('/Packages/Installed/WatchGuard?'+query,'POST',token=token,expected=204,raw=True)
        # Native installation may leave the manually installed previous folder.
        # Retire only that known input at the stopped-server boundary.
        docker('stop',name);shutil.move(str(installed),str(root/'previous-runtime'));restart()
        current=plugins/('WatchGuard_'+version+'.0')
        with zipfile.ZipFile(candidate) as z: assert (current/DLL).read_bytes()==z.read(DLL)
        assert call('/WatchGuard/IntegrationStatus',token=token)['PluginVersion']==version
        active=[p for p in call('/Plugins',token=token) if p['Id'].replace('-','')==GUID.replace('-','') and p['Status']=='Active']
        assert len(active)==1 and active[0]['Version']==version+'.0'
        assert all(p.read_bytes()==value for p,value in saved.items()), 'Upgrade changed personal storage bytes'
        for auth,rows in zip((token,other),before):
            assert call('/WatchGuard/Watchlist',token=auth)==rows
            assert call('/WatchGuard/Preferences',token=auth)==prefs
        call('/WatchGuard/Watchlist/'+movie,'DELETE',token=token,expected=204)
        assert call('/WatchGuard/Watchlist',token=other)==before[1], 'Removal affected another owner'
        call('/Items/'+movie,token=token) # membership removal cannot remove media
        for auth in (token,other): call('/WatchGuard/Preferences','DELETE',token=auth)
        call('/WatchGuard/Watchlist/'+movie,'DELETE',token=other,expected=204)
        call('/Users/'+owner['Id'],'DELETE',token=token,expected=204)
        report=dict(result='PASS',previous=identity,previousDllSha256=deployed,candidate=version,
                    candidateSha256=hashlib.sha256(candidate.read_bytes()).hexdigest(),personalFiles=[p.name for p in saved],
                    checks=['native-install','active-identity','exact-storage','memberships','dates','preferences','owner-isolation','media-retained'])
        (ROOT/'artifacts/previous-stable-upgrade.json').write_text(json.dumps(report,indent=2)+'\n')
        return current
    finally:
        server.shutdown();server.server_close();thread.join(timeout=10)
        assert not thread.is_alive()
