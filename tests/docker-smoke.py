"""Run isolated Jellyfin 12.2 deployment and browser tests; never mounts real media.
Default runs browser-poc.cjs and cleans up. --serve keeps the fixture alive until Ctrl+C.
"""
import argparse
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
    return subprocess.check_output(['docker', *args], text=True).strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--injector-dll', type=Path, required=True)
    parser.add_argument('--serve', action='store_true')
    options = parser.parse_args()
    artifact = ROOT / 'artifacts/WatchGuard/Jellyfin.Plugin.WatchGuard.dll'
    if not artifact.exists():
        raise SystemExit('Publish WatchGuard first.')
    pristine_web_hash = docker('run', '--rm', '--entrypoint', 'sha256sum', IMAGE, '/jellyfin/jellyfin-web/index.html').split()[0]
    name = 'watchguard-poc-' + uuid.uuid4().hex[:10]
    with tempfile.TemporaryDirectory(prefix='watchguard-poc-') as temp:
        root = Path(temp)
        plugins = root / 'config/plugins'
        for folder, source in [('WatchGuard', artifact), ('JavaScriptInjector', options.injector_dll)]:
            (plugins / folder).mkdir(parents=True)
            shutil.copy2(source, plugins / folder)
        (plugins / 'configurations').mkdir()
        (plugins / 'configurations/Jellyfin.Plugin.WatchGuard.xml').write_text(
            '<?xml version="1.0"?><Configuration><DiagnosticMode>true</DiagnosticMode></Configuration>')
        try:
            docker('run', '-d', '--rm', '--name', name, '-p', '127.0.0.1::8096',
                   '-v', f'{root}/config:/config', IMAGE)
            port = docker('port', name, '8096/tcp').split(':')[-1]
            base = 'http://127.0.0.1:' + port

            def call(path, method='GET', data=None, token=None, expected=200, raw=False):
                header = 'MediaBrowser Client="WatchGuardPoCTest", Device="Disposable", DeviceId="watchguard-poc", Version="1"'
                if token: header += ', Token="' + token + '"'
                body = json.dumps(data).encode() if data is not None else (b'' if method == 'POST' else None)
                request = urllib.request.Request(base + path, data=body, method=method,
                    headers={'Content-Type': 'application/json', 'Authorization': header})
                try:
                    with urllib.request.urlopen(request, timeout=15) as response:
                        status, result = response.status, response.read()
                except urllib.error.HTTPError as error:
                    status, result = error.code, error.read()
                assert status == expected, (path, status) # Never print response bodies or credentials.
                return result.decode() if raw else (json.loads(result) if result else None)

            for _ in range(60):
                try:
                    call('/System/Info/Public'); call('/Startup/User'); break
                except (urllib.error.URLError, http.client.HTTPException, ConnectionError, AssertionError):
                    time.sleep(1)
            else: raise RuntimeError('Jellyfin did not become ready.')
            password = uuid.uuid4().hex
            username = 'WatchGuardPoCTest'
            call('/Startup/User', 'POST', {'Name': username, 'Password': password}, expected=204)
            call('/Startup/Complete', 'POST', expected=204)
            admin = call('/Users/AuthenticateByName', 'POST', {'Username': username, 'Pw': password})
            token = admin['AccessToken']
            movies = ['PoC Movie Detail', 'PoC Context Movie', 'PoC Bulk One', 'PoC Bulk Two', 'PoC Escape', 'PoC Modern Movie', 'PoC Zero', 'PoC Self', 'PoC Layout Legacy', 'PoC Layout Modern']
            docker('exec', name, 'mkdir', '-p', '/tmp/poc-movies', '/tmp/poc-tv/PoC Series Detail/Season 01')
            docker('exec', name, '/usr/lib/jellyfin-ffmpeg/ffmpeg', '-hide_banner', '-loglevel', 'error',
                   '-f', 'lavfi', '-i', 'color=c=black:s=64x64:d=2', '-c:v', 'libx264', '-y', '/tmp/fixture.mp4')
            for title in movies:
                docker('exec', name, 'mkdir', '-p', '/tmp/poc-movies/' + title)
                docker('exec', name, 'cp', '/tmp/fixture.mp4', f'/tmp/poc-movies/{title}/{title}.mp4')
            for number in (1, 2):
                docker('exec', name, 'cp', '/tmp/fixture.mp4', f'/tmp/poc-tv/PoC Series Detail/Season 01/PoC Series Detail S01E0{number}.mp4')
            for title in ('PoC Parent Interested', 'PoC Parent Clear'):
                for season in (1, 2):
                    folder = f'/tmp/poc-tv/{title}/Season 0{season}'
                    docker('exec', name, 'mkdir', '-p', folder)
                    for episode in (1, 2):
                        docker('exec', name, 'cp', '/tmp/fixture.mp4', f'{folder}/{title} S0{season}E0{episode}.mp4')
            library = {'LibraryOptions': {'EnableRealtimeMonitor': False, 'EnableInternetProviders': False,
                       'TypeOptions': [{'Type': kind, 'MetadataFetchers': [], 'ImageFetchers': []}
                                       for kind in ('Movie', 'Series', 'Season', 'Episode')]}}
            for path, kind, title in [('poc-movies', 'movies', 'PoC Movies'), ('poc-tv', 'tvshows', 'PoC TV')]:
                call(f'/Library/VirtualFolders?name={title.replace(" ", "%20")}&collectionType={kind}&paths=/tmp/{path}&refreshLibrary=true',
                     'POST', library, token, expected=204)
            for _ in range(60):
                items = call('/Items?Recursive=true&IncludeItemTypes=Movie,Series', token=token)['Items']
                if len(items) == 13: break
                time.sleep(1)
            else: raise RuntimeError('Synthetic media was not scanned.')
            assert 'WatchGuard: This item may still be in use.' in call('/JavaScriptInjector/private.js', token=token, raw=True)
            injector_id = 'f5a34f7b-2e8a-4e6a-a722-3a216a81b374'
            injector_config = call('/Plugins/' + injector_id + '/Configuration', token=token)
            assert not injector_config['DisableScriptInjectionMiddleware']
            registrations = [s for s in injector_config['PluginJavaScripts'] if s['Id'] == 'watchguard-v1']
            assert len(registrations) == 1
            registration = registrations[0]
            assert registration['Enabled'] and registration['RequiresAuthentication']
            assert registration['PluginVersion'] == '0.1.0' and registration['Name'] == 'WatchGuard'
            assert 'WatchGuard web script registered with JavaScript Injector.' in docker('logs', name)
            assert call('/WatchGuard/Watchlist', token=token) == []
            runpy.run_path(str(ROOT / 'tests/backend-smoke.py'))['run'](
                call, token, {i['Name']: i['Id'] for i in items}, plugins)
            fixture = root / 'fixture.json'
            fixture.write_text(json.dumps({'base': base, 'username': username, 'password': password,
                'token': token, 'serverId': admin['ServerId'], 'items': {i['Name']: i['Id'] for i in items}}))
            fixture.chmod(0o600)
            print('READY fixture=' + str(fixture), flush=True)
            if options.serve:
                while True: time.sleep(1)
            else:
                subprocess.run(['node', str(ROOT / 'tests/browser-poc.cjs'), str(fixture)], check=True)
                # Same operation as removing the plugin-managed script in Injector's dashboard.
                injector_config['PluginJavaScripts'] = [s for s in injector_config['PluginJavaScripts'] if s['Id'] != 'watchguard-v1']
                call('/Plugins/' + injector_id + '/Configuration', 'POST', injector_config, token, expected=204)
                assert 'WatchGuard: This item may still be in use.' not in call('/JavaScriptInjector/private.js', token=token, raw=True)
                assert docker('exec', name, 'sha256sum', '/jellyfin/jellyfin-web/index.html').split()[0] == pristine_web_hash
                print('Deployment checks passed: v0.1.0 registration, middleware injection, persisted script cleanup, unchanged Web index.', flush=True)

        finally:
            subprocess.run(['docker', 'rm', '-f', name], stdout=subprocess.DEVNULL, check=False)


if __name__ == '__main__':
    try: main()
    except KeyboardInterrupt: pass
