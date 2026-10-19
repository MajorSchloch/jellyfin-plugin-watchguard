"""Native index qualification; invoked only by the disposable docker-smoke owner."""
import hashlib
import json
from pathlib import Path
import statistics
import time
import subprocess
import zipfile

BASELINE_SHA = '62af61f98b9d914f7890967048986f8c4641b8f3417edc2f08756bd15df7b3ec'


def run(call, restart, docker, name, plugins, token):
    assert name.startswith('watchguard-poc-')
    repo = Path(__file__).resolve().parents[1]
    evidence = repo / 'artifacts/activity-index' / name
    evidence.mkdir(parents=True)
    baseline = evidence / 'published-v052.zip'
    subprocess.run(['curl','--fail','--location','--retry','3','--max-time','60',
        'https://github.com/MajorSchloch/jellyfin-plugin-watchguard/releases/download/v0.5.2/Jellyfin.Plugin.WatchGuard-v0.5.2.zip',
        '-o',str(baseline)],check=True)
    assert hashlib.sha256(baseline.read_bytes()).hexdigest() == BASELINE_SHA
    docker('exec', name, 'sh', '-c', '''set -eu
n=1; while [ "$n" -le 120 ]; do
 mkdir -p "/tmp/poc-movies/Index Movie $n"
 cp /tmp/fixture.mp4 "/tmp/poc-movies/Index Movie $n/Index Movie $n.mp4"
 n=$((n+1))
done
mkdir -p '/tmp/poc-tv/Index Continuing/Season 01'
printf '<tvshow><title>Index Continuing</title><status>Continuing</status></tvshow>' > '/tmp/poc-tv/Index Continuing/tvshow.nfo'
n=1; while [ "$n" -le 300 ]; do
 f=$(printf '/tmp/poc-tv/Index Continuing/Season 01/Index Continuing S01E%03d' "$n")
 cp /tmp/fixture.mp4 "$f.mp4"
 printf '<episodedetails><title>Episode %s</title><season>1</season><episode>%s</episode><aired>2020-01-01</aired></episodedetails>' "$n" "$n" > "$f.nfo"
 n=$((n+1))
done''')
    call('/Library/Refresh', 'POST', token=token, expected=204)
    deadline = time.monotonic() + 180
    while True:
        movies = [i for i in call('/Items?Recursive=true&IncludeItemTypes=Movie&Limit=1000', token=token)['Items'] if i['Name'].startswith('Index Movie ')]
        series = [i for i in call('/Items?Recursive=true&IncludeItemTypes=Series&Limit=100', token=token)['Items'] if i['Name'] == 'Index Continuing']
        episodes = call('/Items?Recursive=true&IncludeItemTypes=Episode&Limit=1000', token=token)['Items']
        episodes = [i for i in episodes if series and i.get('SeriesId') == series[0]['Id']]
        if len(movies) == 120 and len(series) == 1 and len(episodes) == 300: break
        assert time.monotonic() < deadline, {'movies': len(movies), 'series': len(series), 'episodes': len(episodes)}
        time.sleep(.5)
    owners = []
    for n in range(6):
        user = call('/Users/New', 'POST', {'Name': 'IndexUser' + str(n), 'Password': 'DisposableIndex123!'}, token)
        owners.append(user['Id'])
        for item in movies + series:
            call('/UserPlayedItems/' + item['Id'] + '?userId=' + user['Id'], 'POST', token=token)
        if n % 2 == 0:
            call('/UserItems/' + episodes[0]['Id'] + '/UserData?userId=' + user['Id'], 'POST', {'Played': False, 'PlaybackPositionTicks': 10000}, token)
    dll = plugins / 'WatchGuard/Jellyfin.Plugin.WatchGuard.dll'
    candidate = dll.read_bytes()
    with zipfile.ZipFile(baseline) as archive: previous = archive.read('Jellyfin.Plugin.WatchGuard.dll')
    result = {'baselineSha256': BASELINE_SHA, 'fixture': {'users': 7, 'completedMovies': 120, 'seriesEpisodes': 300}, 'measurements': {}}
    scopes = [('single', owners[0]), ('all', 'all')]
    old_results = {}
    def normalized(items):
        return {i['ItemId'].replace('-', ''): {u['UserId'].replace('-', ''): {k:v for k,v in u.items() if k not in ('UserId', 'DisplayName')}
                for u in i['Users']} for i in items}
    try:
        docker('stop', name); dll.write_bytes(previous); restart()
        for scope, owner in scopes:
            route = '/WatchGuard/ActivityOverview' + ('/Users/' + owner if owner != 'all' else '')
            call(route, token=token, timeout=120)  # warm-up
            samples = []
            for _ in range(3):
                start = time.perf_counter(); value = call(route, token=token, timeout=120); samples.append((time.perf_counter()-start)*1000)
            old_results[scope] = normalized(value['Items'])
            result['measurements']['v052-' + scope] = {'milliseconds': samples, 'medianMs': statistics.median(samples), 'items': len(value['Items']), 'diagnostics': value['Diagnostics'], 'causes': value['Coverage']['Causes']}
        docker('stop', name); dll.write_bytes(candidate)
        # Remove only rebuildable state, never personal data, for cold qualification.
        for file in plugins.glob('*/activity-index.json'): file.unlink()
        start = time.perf_counter(); restart()
        progress = []
        deadline = time.monotonic() + 600
        while True:
            value = call('/WatchGuard/ActivityIndex/Status?owner=all', token=token, timeout=60)
            state = value['Freshness']; progress.append({k:state[k] for k in ('Stored','Validated','Pending','DiscoveryPages','DiscoveryFinished')})
            if state['DiscoveryFinished'] and state['Pending'] == 0 and state['Stored'] == state['Validated']: break
            assert time.monotonic() < deadline, state
            time.sleep(1)
        result['coldPopulationMs'] = (time.perf_counter()-start)*1000
        result['progress'] = progress
        for scope, owner in scopes:
            route = '/WatchGuard/ActivityIndex?owner=' + owner
            samples = []
            for _ in range(4):
                start = time.perf_counter(); first = call(route, token=token, timeout=60); samples.append((time.perf_counter()-start)*1000)
            page_started = time.perf_counter(); visibility_queries = first.get('ReadDiagnostics',{}).get('EpisodeVisibilityQueries',0)
            all_items = list(first['Items']); cursor = first.get('Continuation')
            while cursor:
                page = call(route + '&continuation=' + cursor, token=token, timeout=60)
                all_items += page['Items']; cursor = page.get('Continuation')
                visibility_queries += page.get('ReadDiagnostics',{}).get('EpisodeVisibilityQueries',0)
            actual = normalized(all_items)
            assert len(actual) == len(all_items), 'Duplicate cards across stable pages'
            assert len(actual) == 121, (scope, len(actual), first['Coverage'])
            for item, people in old_results[scope].items(): assert actual[item] == people, (scope, item, actual[item], people)
            result['measurements']['index-' + scope] = {'milliseconds': samples[1:], 'medianMs': statistics.median(samples[1:]), 'firstPageItems': len(first['Items']), 'totalItems':len(actual),'allPagesMs': samples[-1]+(time.perf_counter()-page_started)*1000,'allPagesVisibilityQueries': visibility_queries,'freshness':first['Freshness']}
        # Native manual unplayed event removes a completed movie without any Refresh request.
        target = movies[0]['Id']; owner = owners[0]
        start = time.perf_counter()
        call('/UserItems/' + target + '/UserData?userId=' + owner, 'POST', {'Played': False, 'PlaybackPositionTicks': 0}, token)
        deadline = time.monotonic() + 30
        while True:
            page = call('/WatchGuard/ActivityIndex/Status?owner=' + owner, token=token)
            if page['Freshness']['Pending'] == 0 and page['Freshness']['Stored'] == page['Freshness']['Validated']: break
            assert time.monotonic() < deadline, page['Freshness']
            time.sleep(.2)
        result['incrementalSettledMs'] = (time.perf_counter()-start)*1000
        # Check the entire paginated owner view, not merely the first page.
        page = call('/WatchGuard/ActivityIndex?owner=' + owner, token=token)
        items = page['Items']; cursor = page.get('Continuation')
        while cursor:
            page = call('/WatchGuard/ActivityIndex?owner=' + owner + '&continuation=' + cursor, token=token)
            items += page['Items']; cursor = page.get('Continuation')
        assert target.replace('-', '') not in normalized(items)
        tasks = call('/ScheduledTasks', token=token)
        task = next(t for t in tasks if t['Key'] == 'WatchGuardActivityIndex')
        result['nativeTaskDiscovered'] = bool(task['Id'])
        result['result'] = 'PASS'
    finally:
        (evidence / 'results.json').write_text(json.dumps(result, indent=2) + '\n')
        if dll.read_bytes() != candidate: docker('stop', name); dll.write_bytes(candidate); restart()
    print('Activity index native qualification: ' + str(evidence / 'results.json'), flush=True)
