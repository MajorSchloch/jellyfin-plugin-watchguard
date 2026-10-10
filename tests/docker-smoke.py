"""Optional real Jellyfin 12 test. Creates and removes its own isolated Docker server.
Run after publishing: python3 tests/docker-smoke.py [--injector-dll /path/to/Injector.dll]
Only generated test media is deleted. Requires Docker, Python 3 and Node 24+.
"""
import argparse
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
IMAGE = 'jellyfin/jellyfin:12.0@sha256:baba630419915985442f315f08b0cf46d9f4c8a0cc4bd38e94a6d35751dd5ef5'


def docker(*args):
    return subprocess.check_output(['docker', *args], text=True).strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--injector-dll', type=Path)
    options = parser.parse_args()
    artifact = ROOT / 'artifacts/WatchGuard/Jellyfin.Plugin.WatchGuard.dll'
    if not artifact.exists():
        raise SystemExit('Publish WatchGuard first; see README.md.')
    name = 'watchguard-test-' + uuid.uuid4().hex[:10]
    with tempfile.TemporaryDirectory(prefix='watchguard-test-') as temp:
        root = Path(temp)
        plugins = root / 'config/plugins'
        (plugins / 'WatchGuard').mkdir(parents=True)
        shutil.copy2(artifact, plugins / 'WatchGuard')
        if options.injector_dll:
            (plugins / 'JavaScriptInjector').mkdir()
            shutil.copy2(options.injector_dll, plugins / 'JavaScriptInjector')
        try:
            docker('run', '-d', '--rm', '--name', name, '-p', '127.0.0.1::8096',
                   '-v', f'{root}/config:/config', IMAGE)
            port = docker('port', name, '8096/tcp').split(':')[-1]
            base = 'http://127.0.0.1:' + port

            def call(path, method='GET', data=None, token=None, expected=200, raw=False):
                header = 'MediaBrowser Client="WatchGuardTest", Device="Smoke", DeviceId="watchguard-smoke", Version="1"'
                if token:
                    header += ', Token="' + token + '"'
                body = json.dumps(data).encode() if data is not None else (b'' if method == 'POST' else None)
                request = urllib.request.Request(base + path, data=body, method=method,
                                                headers={'Content-Type': 'application/json', 'Authorization': header})
                try:
                    with urllib.request.urlopen(request, timeout=15) as response:
                        status, result = response.status, response.read()
                except urllib.error.HTTPError as error:
                    status, result = error.code, error.read()
                assert status == expected, (path, status, result[:200])
                return result.decode() if raw else (json.loads(result) if result else None)

            for _ in range(60):
                try:
                    call('/System/Info/Public')
                    call('/Startup/User')
                    break
                except (urllib.error.URLError, http.client.HTTPException, ConnectionError, AssertionError):
                    time.sleep(1)
            else:
                raise RuntimeError('Jellyfin did not become ready.')
            password = uuid.uuid4().hex
            call('/Startup/User', 'POST', {'Name': 'WatchGuardAdmin', 'Password': password}, expected=204)
            call('/Startup/Complete', 'POST', expected=204)
            admin = call('/Users/AuthenticateByName', 'POST', {'Username': 'WatchGuardAdmin', 'Pw': password})
            at = admin['AccessToken']
            call('/Users/New', 'POST', {'Name': 'WatchGuardMember', 'Password': password}, at)
            member = call('/Users/AuthenticateByName', 'POST', {'Username': 'WatchGuardMember', 'Pw': password})
            mt = member['AccessToken']
            call('/WatchGuard/Watchlist', expected=401)
            assert call('/WatchGuard/Watchlist', token=mt) == []
            missing = '00000000000000000000000000000001'
            call('/WatchGuard/Protection/' + missing, token=mt, expected=403)
            call('/WatchGuard/Protection/' + missing, token=at, expected=404)

            docker('exec', name, 'mkdir', '-p', '/tmp/movies/WatchGuardTestMovie', '/tmp/tv/WatchGuardSeries/Season 01')
            movie_file = '/tmp/movies/WatchGuardTestMovie/WatchGuardTestMovie.mp4'
            docker('exec', name, '/usr/lib/jellyfin-ffmpeg/ffmpeg', '-hide_banner', '-loglevel', 'error',
                   '-f', 'lavfi', '-i', 'color=c=black:s=64x64:d=2', '-c:v', 'libx264', '-y', movie_file)
            for number in (1, 2):
                docker('exec', name, 'cp', movie_file, f'/tmp/tv/WatchGuardSeries/Season 01/WatchGuardSeries S01E0{number}.mp4')
            library = {'LibraryOptions': {'EnableRealtimeMonitor': False, 'EnableInternetProviders': False,
                       'TypeOptions': [{'Type': kind, 'MetadataFetchers': [], 'ImageFetchers': []}
                                       for kind in ('Movie', 'Series', 'Season', 'Episode')]}}
            for path, kind in (('movies', 'movies'), ('tv', 'tvshows')):
                call(f'/Library/VirtualFolders?name={path}&collectionType={kind}&paths=/tmp/{path}&refreshLibrary=true',
                     'POST', library, at, expected=204)
            for _ in range(60):
                movies = call('/Items?Recursive=true&IncludeItemTypes=Movie', token=at)['Items']
                episodes = call('/Items?Recursive=true&IncludeItemTypes=Episode', token=at)['Items']
                series = call('/Items?Recursive=true&IncludeItemTypes=Series', token=at)['Items']
                if len(movies) == 1 and len(episodes) == 2 and len(series) == 1:
                    break
                time.sleep(1)
            else:
                raise RuntimeError('Synthetic media was not scanned.')
            item = movies[0]['Id']
            status = lambda title: call('/WatchGuard/Protection/' + title, token=at)['Users']
            for token in (at, mt):
                call('/WatchGuard/Watchlist/' + item, 'PUT', token=token, expected=204)
            assert len(status(item)) == 2
            call('/WatchGuard/Watchlist/' + item, 'DELETE', token=at, expected=204)
            call('/UserItems/' + item + '/UserData', 'POST', {'Played': False, 'PlaybackPositionTicks': 1000000}, mt)
            assert status(item)[0]['Reasons'] == ['Watchlisted', 'Partially watched']
            call('/UserItems/' + item + '/UserData', 'POST', {'Played': True, 'PlaybackPositionTicks': 0}, mt)
            assert status(item)[0]['Reasons'] == ['Watchlisted']
            call('/WatchGuard/Watchlist/' + item, 'DELETE', token=mt, expected=204)
            assert status(item) == []
            call('/WatchGuard/Watchlist/' + item, 'PUT', token=mt, expected=204)
            sid = series[0]['Id']
            call('/UserItems/' + episodes[0]['Id'] + '/UserData', 'POST', {'Played': True}, mt)
            assert status(sid)[0]['Reasons'] == ['Partially watched']
            call('/UserItems/' + episodes[1]['Id'] + '/UserData', 'POST', {'Played': True}, mt)
            assert status(sid) == []
            if options.injector_dll:
                assert 'watchGuardLoaded' in call('/JavaScriptInjector/private.js', token=at, raw=True)
            credentials = root / 'auth.json'
            credentials.write_text(json.dumps({'admin': admin, 'member': member}))
            subprocess.run(['node', str(ROOT / 'tests/live-guard.cjs'), base, str(credentials), item], check=True)
            assert call('/WatchGuard/Watchlist', token=mt) == []
            call('/WatchGuard/Watchlist/' + item, 'DELETE', token=mt, expected=204)
            print('PASS: Jellyfin 12 HTTP auth, watchlists, progress, series, deletion and stale-item cleanup')
        finally:
            subprocess.run(['docker', 'rm', '-f', name], stdout=subprocess.DEVNULL, check=False)


if __name__ == '__main__':
    main()
