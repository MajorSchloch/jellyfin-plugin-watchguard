from fixture_evidence import capture as capture_failure, Phases
from fixture_inventory import wait_inventory, wait_ready
"""Run isolated Jellyfin 12.2 deployment and browser tests; never mounts real media.
Default runs browser-poc.cjs and cleans up. --serve keeps the fixture alive until Ctrl+C.
"""
import argparse
import os
import runpy
import http.client
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]
IMAGE = 'jellyfin/jellyfin:12.2@sha256:357724bf0ae27a672c7cbaa899db2d9abeb13dbd8657ccce750258a4c059d037'


def docker(*args):
    return subprocess.check_output(['docker', *args], text=True, timeout=180).strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--injector-dll', type=Path)
    parser.add_argument('--linuxserver', action='store_true')
    parser.add_argument('--caddy', action='store_true')
    parser.add_argument('--standalone', action='store_true', help='Compatibility alias; standalone is the default')
    parser.add_argument('--legacy-injector', action='store_true', help='Retained published v0.3.1 regression only')
    parser.add_argument('--qualification-upgrade', action='store_true')
    parser.add_argument('--preference-roundtrip', action='store_true', help='Qualify saved added sort against published v0.5.0/v0.4.10')
    parser.add_argument('--standalone-catalog', action='store_true')
    parser.add_argument('--artifact', type=Path)
    parser.add_argument('--base-path', default='')
    parser.add_argument('--proxy',action='store_true')
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--serve', action='store_true')
    mode.add_argument('--measure', action='store_true')
    mode.add_argument('--migration', action='store_true')
    mode.add_argument('--catalog', action='store_true', help='Exercise native catalog install, manual upgrade and missing Injector.')
    mode.add_argument('--profile', choices=['before', 'after', 'activity', 'v030-before', 'v030-after', 'discovery', 'verification', 'activity-index'], help='Run isolated performance measurements instead of destructive browser tests.')
    options = parser.parse_args()
    options.standalone = not options.legacy_injector
    if options.catalog and options.standalone: options.standalone_catalog = True
    if (options.migration or options.qualification_upgrade) and not options.injector_dll: parser.error('Migration requires the rollback Injector DLL')
    image = 'lscr.io/linuxserver/jellyfin:12.2ubu2604-ls53@sha256:1bb4f88d822a0510bb3604b68aacb80d77c1d2a30181e500090c65111b98723b' if options.linuxserver else IMAGE
    web_index = '/usr/share/jellyfin/web/index.html' if options.linuxserver else '/jellyfin/jellyfin-web/index.html'
    run_user = ['-e', f'PUID={os.getuid()}', '-e', f'PGID={os.getgid()}'] if options.linuxserver else ['--user', f'{os.getuid()}:{os.getgid()}']
    caddy = None
    artifact = options.artifact or ROOT / ('artifacts/WatchGuard/Jellyfin.Plugin.WatchGuard.dll' if options.standalone else 'artifacts/RollbackV031/Jellyfin.Plugin.WatchGuard.dll')
    if not options.standalone and not options.injector_dll: parser.error('--injector-dll is required in Injector mode')
    if options.base_path not in ('', '/jellyfin'): parser.error('Only the disposable /jellyfin prefix is supported')
    if not artifact.exists():
        raise SystemExit('Publish WatchGuard first.')
    pristine_web_hash = docker('run', '--rm', '--entrypoint', 'sha256sum', image, web_index).split()[0]
    proxy = None
    name = 'watchguard-poc-' + uuid.uuid4().hex[:10]
    phases=Phases(ROOT/'artifacts/testing'/name/'phases.json')
    with tempfile.TemporaryDirectory(prefix='watchguard-poc-') as temp:
        root = Path(temp)
        plugins = root / ('config/data/plugins' if options.linuxserver else 'config/plugins')
        for folder, source in [('WatchGuard', artifact)] + ([('JavaScriptInjector', options.injector_dll)] if options.injector_dll else []):
            (plugins / folder).mkdir(parents=True)
            shutil.copy2(source, plugins / folder)
        (plugins / 'configurations').mkdir()
        (plugins / 'configurations/Jellyfin.Plugin.WatchGuard.xml').write_text(
            '<?xml version="1.0"?><Configuration><DiagnosticMode>true</DiagnosticMode></Configuration>')
        if options.base_path:
            network_dir = root/('config' if options.linuxserver else 'config/config')
            network_dir.mkdir(parents=True,exist_ok=True)
            (network_dir/'network.xml').write_text('<NetworkConfiguration><BaseUrl>'+options.base_path+'</BaseUrl></NetworkConfiguration>')
        try:
            phases.phase('container-start')
            docker('run', '-d', '--name', name, *run_user,
                   '-p', '127.0.0.1::8096',
                   '--add-host', 'host.docker.internal:host-gateway', '-v', f'{root}/config:/config', image)
            port = docker('port', name, '8096/tcp').split(':')[-1]
            base = 'http://127.0.0.1:' + port + options.base_path

            def call(path, method='GET', data=None, token=None, expected=200, raw=False, timeout=15):
                header = 'MediaBrowser Client="WatchGuardPoCTest", Device="Disposable", DeviceId="watchguard-poc", Version="1"'
                if token: header += ', Token="' + token + '"'
                body = json.dumps(data).encode() if data is not None else (b'' if method == 'POST' else None)
                request = urllib.request.Request(base + path, data=body, method=method,
                    headers={'Content-Type': 'application/json', 'Authorization': header})
                try:
                    with urllib.request.urlopen(request, timeout=timeout) as response:
                        status, result = response.status, response.read()
                except urllib.error.HTTPError as error:
                    status, result = error.code, error.read()
                assert status == expected, (path, status) # Never print response bodies or credentials.
                return result.decode() if raw else (json.loads(result) if result else None)

            def healthy(timeout):
                assert call('/health',raw=True,timeout=timeout)=='Healthy', 'Native startup health is not Healthy'

            def restart():
                nonlocal base
                docker('restart', name)
                base = 'http://127.0.0.1:' + docker('port', name, '8096/tcp').split(':')[-1] + options.base_path
                wait_ready(lambda timeout:(healthy(timeout),call('/System/Info/Public',timeout=timeout),call('/Plugins',token=token,timeout=timeout)))
            wait_ready(lambda timeout:(healthy(timeout),call('/System/Info/Public',timeout=timeout),call('/Startup/User',timeout=timeout)))
            version = call('/System/Info/Public')['Version']
            assert version.startswith('12.2'), version
            print('Verified server '+version+' image '+image, flush=True)
            phases.phase('native-setup-authentication')
            password = uuid.uuid4().hex
            username = 'WatchGuardPoCTest'
            call('/Startup/User', 'POST', {'Name': username, 'Password': password}, expected=204)
            call('/Startup/Complete', 'POST', expected=204)
            admin = call('/Users/AuthenticateByName', 'POST', {'Username': username, 'Pw': password})
            token = admin['AccessToken']
            # Own installation order in this disposable fixture. The native StartupTrigger
            # otherwise upgrades the rollback DLL concurrently with our Packages API call.
            phases.phase('background-tasks')
            updates=next(t for t in call('/ScheduledTasks',token=token) if t['Key']=='PluginUpdates')
            call('/ScheduledTasks/'+updates['Id']+'/Triggers','POST',[],token,expected=204)
            restart() # Ends any already-running startup task without a cancel/idle race.
            task=call('/ScheduledTasks/'+updates['Id'],token=token)
            assert task['State']=='Idle' and task['Triggers']==[]
            print('Disposable fixture: native automatic plugin update triggers disabled; explicit catalog operations remain asserted.',flush=True)

            phases.phase('generate-media')
            movies = ['PoC Movie Detail', 'PoC Context Movie', 'PoC Bulk One', 'PoC Bulk Two', 'PoC Escape', 'PoC Modern Movie', 'PoC Zero', 'PoC Self', 'PoC Layout Legacy', 'PoC Layout Modern']
            docker('exec', name, 'mkdir', '-p', '/tmp/poc-movies', '/tmp/poc-tv/PoC Series Detail/Season 01')
            docker('exec', name, '/usr/lib/jellyfin-ffmpeg/ffmpeg', '-hide_banner', '-loglevel', 'error',
                   '-f', 'lavfi', '-i', 'color=c=black:s=64x64:d=2', '-c:v', 'libx264', '-y', '/tmp/fixture.mp4')
            docker('exec', name, '/usr/lib/jellyfin-ffmpeg/ffmpeg', '-hide_banner', '-loglevel', 'error',
                   '-f', 'lavfi', '-i', 'color=c=steelblue:s=240x360', '-frames:v', '1', '-y', '/tmp/poster.jpg')
            for title in movies:
                docker('exec', name, 'mkdir', '-p', '/tmp/poc-movies/' + title)
                docker('exec', name, 'cp', '/tmp/fixture.mp4', f'/tmp/poc-movies/{title}/{title}.mp4')
                docker('exec', name, 'cp', '/tmp/poster.jpg', f'/tmp/poc-movies/{title}/poster.jpg')
            for number in (1, 2):
                docker('exec', name, 'cp', '/tmp/fixture.mp4', f'/tmp/poc-tv/PoC Series Detail/Season 01/PoC Series Detail S01E0{number}.mp4')
            for title in ('PoC Parent Interested', 'PoC Parent Clear'):
                for season in (1, 2):
                    folder = f'/tmp/poc-tv/{title}/Season 0{season}'
                    docker('exec', name, 'mkdir', '-p', folder)
                    for episode in (1, 2):
                        docker('exec', name, 'cp', '/tmp/fixture.mp4', f'{folder}/{title} S0{season}E0{episode}.mp4')
            if options.linuxserver:
                docker('exec', name, 'chown', '-R', f'{os.getuid()}:{os.getgid()}', '/tmp/poc-movies', '/tmp/poc-tv')
                assert docker('exec', name, 'id', '-u', 'abc') == str(os.getuid())
                assert docker('exec', name, 'id', '-g', 'abc') == str(os.getgid())
                print('LinuxServer native s6 startup and abc PUID/PGID verified; plugins=/config/data/plugins.', flush=True)
            phases.phase('configure-libraries')
            library = {'LibraryOptions': {'EnableRealtimeMonitor': False, 'EnableInternetProviders': False,
                       'TypeOptions': [{'Type': kind, 'MetadataFetchers': [], 'ImageFetchers': []}
                                       for kind in ('Movie', 'Series', 'Season', 'Episode')]}}
            for path, kind, title in [('poc-movies', 'movies', 'PoC Movies'), ('poc-tv', 'tvshows', 'PoC TV')]:
                call(f'/Library/VirtualFolders?name={title.replace(" ", "%20")}&collectionType={kind}&paths=/tmp/{path}&refreshLibrary=false',
                     'POST', library, token, expected=204)
            expected = {f'/tmp/poc-movies/{title}/{title}.mp4': ('Movie',None,title) for title in movies}
            for title,seasons in [('PoC Series Detail',(1,)),('PoC Parent Interested',(1,2)),('PoC Parent Clear',(1,2))]:
                series_path=f'/tmp/poc-tv/{title}'
                expected[series_path]=('Series',None,title)
                for season in seasons:
                    season_path=f'{series_path}/Season 0{season}'
                    expected[season_path]=('Season',series_path,None)
                    for episode in (1,2):
                        expected[f'{season_path}/{title} S0{season}E0{episode}.mp4']=('Episode',season_path,None)
            phases.phase('media-indexing')
            scan=next(t for t in call('/ScheduledTasks',token=token) if t['Key']=='RefreshLibrary')
            call('/ScheduledTasks/Running/'+scan['Id'],'POST',token=token,expected=204)
            items=wait_inventory(lambda path,timeout:call(path,token=token,timeout=timeout), admin['User']['Id'], expected,
                                 ROOT/'artifacts/testing'/name/'inventory.json')
            phases.phase('installation-and-regressions')
            installed_folder = plugins/'WatchGuard'
            if options.standalone_catalog:
                assert options.standalone and not options.injector_dll
                installed_folder = runpy.run_path(str(ROOT/'tests/standalone-catalog.py'))['run'](call,restart,docker,name,root,plugins,token,artifact)
            if not options.standalone:
                assert 'WatchGuard: This item may still be in use.' in call('/JavaScriptInjector/private.js', token=token, raw=True)
                injector_id = 'f5a34f7b-2e8a-4e6a-a722-3a216a81b374'
                injector_config = call('/Plugins/' + injector_id + '/Configuration', token=token)
                assert not injector_config['DisableScriptInjectionMiddleware']
                registrations = [s for s in injector_config['PluginJavaScripts'] if s['Id'] == 'watchguard-v1']
                assert len(registrations) == 1
                registration = registrations[0]
                assert registration['Enabled'] and registration['RequiresAuthentication']
                assert registration['PluginVersion'] == '0.3.1' and registration['Name'] == 'WatchGuard'
                # Restart with the persisted registration: upsert must retain exactly one script.
                docker('restart', name)
                # Docker Desktop can allocate a different ephemeral host port on restart.
                base = 'http://127.0.0.1:' + docker('port', name, '8096/tcp').split(':')[-1] + options.base_path
                def registered_probe(timeout):
                    healthy(timeout)
                    current=call('/Plugins/'+injector_id+'/Configuration',token=token,timeout=timeout)
                    registered=[row for row in current['PluginJavaScripts'] if row['Id']=='watchguard-v1']
                    assert len(registered)==1 and registered[0]['PluginVersion']=='0.3.1'
                wait_ready(registered_probe)
                assert 'WatchGuard web script registered with JavaScript Injector.' in docker('logs', name)
            else:
                runpy.run_path(str(ROOT/'tests/standalone-http.py'))['run'](base,token)
            assert call('/WatchGuard/Watchlist', token=token) == []
            runpy.run_path(str(ROOT / 'tests/backend-smoke.py'))['run'](
                call, token, {i['Name']: i['Id'] for i in items}, plugins, standalone=options.standalone)
            if options.qualification_upgrade or options.migration:
                assert options.standalone
                installed_folder = runpy.run_path(str(ROOT/'tests/standalone-upgrade.py'))['run'](call,restart,docker,name,root,plugins,token,next(i['Id'] for i in items if i['Type']=='Movie' and i['Name']=='PoC Movie Detail'),installed_folder)
            if options.preference_roundtrip:
                assert options.standalone
                runpy.run_path(str(ROOT/'tests/preference-roundtrip.py'))['run'](call,restart,docker,name,root,plugins,token,installed_folder)
            browser_base = base
            if options.proxy:
                proxy = runpy.run_path(str(ROOT/'tests/standalone-proxy.py'))['start'](base)
                browser_base = proxy[2] + options.base_path
            if options.caddy:
                assert not options.proxy and not options.base_path
                caddy = runpy.run_path(str(ROOT/'tests/standalone-caddy.py'))['Caddy'](docker,name,root)
                browser_base = caddy.base
                caddy.verify(token)
            fixture = root / 'fixture.json'
            fixture.write_text(json.dumps({'base': browser_base, 'username': username, 'password': password,
                'standalone':options.standalone, 'activityIndex':options.standalone, 'tls':options.caddy, 'reportDirectory':str(ROOT/'artifacts/v049'/('linuxserver' if options.linuxserver else 'official')/('caddy' if options.caddy else 'basepath' if options.base_path else 'direct')/('migration' if options.migration else 'standalone' if options.standalone else 'injector')/name), 'token': token, 'userId': admin['User']['Id'], 'serverId': admin['ServerId'], 'items': {i['Name']: i['Id'] for i in items}}))
            fixture.chmod(0o600)
            if caddy: os.environ['NODE_EXTRA_CA_CERTS'] = str(caddy.ca)
            print('READY fixture=' + str(fixture), flush=True)
            if options.measure:
                subprocess.run(['node', str(ROOT/'tests/socket-browser.cjs'), str(fixture)], check=True,timeout=600)
                runpy.run_path(str(ROOT/'tests/standalone-measure.py'))['run'](base,options.standalone)
            elif options.catalog and not options.standalone:
                runpy.run_path(str(ROOT / 'tests/catalog-smoke.py'))['run'](call, restart, docker, name, root, plugins, token, next(i['Id'] for i in items if i['Type']=='Movie' and i['Name']=='PoC Movie Detail'))
            elif options.profile == 'discovery':
                runpy.run_path(str(ROOT/'tests/discovery-native.py'))['run'](call, restart, docker, name, root, plugins, token)
            elif options.profile == 'activity-index':
                runpy.run_path(str(ROOT/'tests/activity-index-native.py'))['run'](call, restart, docker, name, plugins, token)
                # Package comparisons restart the container; Docker may assign a
                # new ephemeral port. Hand the browser the current native URL.
                browser_fixture = json.loads(fixture.read_text())
                browser_fixture['base'] = base
                fixture.write_text(json.dumps(browser_fixture))
                subprocess.run(['node', str(ROOT/'tests/activity-browser-ui.cjs'), str(fixture)], check=True,timeout=900)
            elif options.profile == 'verification':
                runpy.run_path(str(ROOT/'tests/verification-native.py'))['run'](call, restart, docker, name, plugins, token)
            elif options.serve:
                while True: time.sleep(1)
            else:
                if options.standalone:
                    subprocess.run(['node', str(ROOT / 'tests/standalone-browser.cjs'), str(fixture)], check=True,timeout=600)
                if not options.profile:
                    subprocess.run(['node', str(ROOT / 'tests/settings-browser.cjs'), str(fixture)], check=True,timeout=600)
                subprocess.run(['node', str(ROOT / 'tests/profile-overview.cjs' if options.profile else 'tests/browser-poc.cjs'), str(fixture), *([options.profile] if options.profile else [])], check=True,timeout=600)
                if not options.standalone:
                    # Same operation as removing the plugin-managed script in Injector's dashboard.
                    injector_config['PluginJavaScripts'] = [s for s in injector_config['PluginJavaScripts'] if s['Id'] != 'watchguard-v1']
                    call('/Plugins/' + injector_id + '/Configuration', 'POST', injector_config, token, expected=204)
                    assert 'WatchGuard: This item may still be in use.' not in call('/JavaScriptInjector/private.js', token=token, raw=True)
                    assert docker('exec', name, 'sha256sum', web_index).split()[0] == pristine_web_hash
                    print('Deployment checks passed: v0.3.1 registration, middleware injection, persisted script cleanup, unchanged Web index.', flush=True)
            if options.standalone:
                data_folder = plugins/'Jellyfin.Plugin.WatchGuard'
                derived = data_folder/'activity-index.json'
                derived_present = derived.exists()
                # Personal data is immutable across the entire uninstall. The
                # background projection may legitimately checkpoint until the
                # loaded plugin stops; snapshot it at that lifecycle boundary.
                saved = {p:p.read_bytes() for p in data_folder.glob('*.json') if p != derived}
                call('/Plugins/a3c6bc84-783d-4ba8-a0db-89bfb83ab486/0.7.1.0','DELETE',token=token,expected=204)
                docker('stop', name)
                if derived_present:
                    assert derived.exists(), 'Uninstall must retain the derived index'
                    saved[derived] = derived.read_bytes()
                restart()
                assert 'watchguard-standalone-loader' not in call('/web/index.html',raw=True)
                call('/WatchGuard/Standalone/bootstrap.js',expected=404)
                assert all(p.read_bytes()==value for p,value in saved.items())
                assert docker('exec',name,'sha256sum',web_index).split()[0]==pristine_web_hash
                print('Native standalone uninstall: no loader, no asset endpoint, JSON retained, Web files unchanged.',flush=True)

        except BaseException as error:
            phases.fail(error)
            capture_failure(ROOT/'artifacts/testing'/name, name, error,
                            (lambda path:call(path,token=token,timeout=5)) if 'token' in locals() else None)
            raise
        finally:
            phases.phase('teardown')
            if caddy: caddy.close()
            if proxy:
                proxy[0].shutdown(); proxy[0].server_close(); proxy[1].join()
                print('Reverse proxy counts: '+json.dumps(proxy[3]),flush=True)
            subprocess.run(['docker', 'rm', '-f', name], stdout=subprocess.DEVNULL, check=True, timeout=60)
            phases.complete()


if __name__ == '__main__':
    try: main()
    except KeyboardInterrupt: raise SystemExit(130)
