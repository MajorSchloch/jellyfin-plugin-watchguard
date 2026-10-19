"""Native before/after benchmark on one disposable database; never production."""
import hashlib
import json
import os
from pathlib import Path
import statistics
import time
import zipfile
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode


def validate(output):
    results = {(r['version'], r['scope']): r for r in output['results']}
    for version in (output.get('baseline','published-v045'), 'candidate-v048'):
        for scope in ('movies-only', 'mixed-all-users'):
            row = results[version, scope]
            expected = 0 if version == 'published-v045' and scope == 'mixed-all-users' else 100
            assert row['returned'] == [expected] * 3, (version, scope, row['returned'])
            assert row['truncationFrequency'] == 1
    assert all(d['NativePlaybackBatches'] == 2 for d in results['candidate-v048', 'movies-only']['diagnostics'])
    assert len(results['candidate-v048', 'movies-only']['diagnostics']) == 3


def run(call, restart, docker, name, root, plugins, token):
    assert name.startswith('watchguard-poc-') and root.name.startswith('watchguard-poc-')
    repo = Path(__file__).resolve().parents[1]
    baseline_version = os.environ.get('WATCHGUARD_DISCOVERY_BASELINE','0.4.5')
    digests = {'0.4.5':'ebe3827470e439bd0a15f7fb65edfa330c6ecf2d1f8ec4112402680f109f709f',
               '0.4.7':'8046bbd611ba3e17bf003160e32d8bffdf07a22038f06863bd8414e78c08b6e0',
               '0.4.6':'e083f873d76a2cd62005e1093f30ecfde3201409fa9caa45948433372bba87e1'}
    baseline = repo/f'artifacts/Jellyfin.Plugin.WatchGuard-v{baseline_version}.zip'
    assert hashlib.sha256(baseline.read_bytes()).hexdigest() == digests[baseline_version]
    baseline_label = 'published-v'+baseline_version.replace('.','')
    dll = plugins/'WatchGuard/Jellyfin.Plugin.WatchGuard.dll'
    candidate = dll.read_bytes()
    script = '''set -eu
for count in 300 1000 1501; do
 folder="/tmp/poc-tv/Benchmark $count/Season 01"; mkdir -p "$folder"
 i=1; while [ "$i" -le "$count" ]; do
   episode=$(printf 'Benchmark %s S01E%04d' "$count" "$i")
   cp /tmp/fixture.mp4 "$folder/$episode.mp4"
   printf '<episodedetails><title>Episode %s</title><season>1</season><episode>%s</episode><aired>2020-01-01</aired></episodedetails>' "$i" "$i" > "$folder/$episode.nfo"
   i=$((i+1))
 done
done
i=1; while [ "$i" -le 340 ]; do
 folder="/tmp/poc-movies/Benchmark Movie $i"; mkdir -p "$folder"
 cp /tmp/fixture.mp4 "$folder/Benchmark Movie $i.mp4"
 i=$((i+1))
done
'''
    docker('exec', name, 'sh', '-c', script)
    call('/Library/Refresh', 'POST', token=token, expected=204)
    # Jellyfin indexes movies, series and episodes asynchronously. An episode
    # threshold alone does not prove that the movie library has finished scanning.
    # Keep the exact fixture cardinality assertions; wait for both collections.
    for attempt in range(360):
        episode_response = call('/Items?Recursive=true&IncludeItemTypes=Episode&Fields=PremiereDate&Limit=10000', token=token)
        episodes = episode_response['Items']
        titles_response = call('/Items?Recursive=true&IncludeItemTypes=Movie,Series&Limit=10000', token=token)
        titles = titles_response['Items']
        series = [i for i in titles if i['Type'] == 'Series' and i['Name'].startswith('Benchmark ')]
        movies = [i for i in titles if i['Type'] == 'Movie' and i['Name'].startswith('Benchmark Movie')]
        if len(episodes) >= 2801 and len(series) == 3 and len(movies) == 340:
            break
        if attempt % 30 == 0:
            print(f'Waiting for benchmark indexing: episodes={len(episodes)}/2801 '
                  f'series={len(series)}/3 movies={len(movies)}/340 '
                  f'episodeTotal={episode_response.get("TotalRecordCount")} '
                  f'titleTotal={titles_response.get("TotalRecordCount")}', flush=True)
        time.sleep(1)
    else:
        raise AssertionError(f'Synthetic scan incomplete: episodes={len(episodes)}/2801 '
                             f'series={len(series)}/3 movies={len(movies)}/340')
    assert len(series) == 3 and len(movies) == 340
    # Seed newest playback on the oversized title deterministically. Library
    # name order otherwise lets v0.4.5 verify one/two small titles before stopping.
    series.sort(key=lambda item: int(item['Name'].rsplit(' ',1)[1]))
    for item in series:
        full = call('/Items/'+item['Id'], token=token)
        call('/Items/'+item['Id'], 'POST', {**full, 'Status':'Continuing'}, token, expected=204)
    playback_base = datetime.now(timezone.utc) - timedelta(days=1)
    for number in range(6):
        user = call('/Users/New', 'POST', {'Name':f'BenchmarkUser{number}', 'Password':'DisposableBenchmark123!'}, token)
        for index, item in enumerate(series):
            # Native DatePlayed ordering must not depend on timestamp ties or scan order.
            stamp = (playback_base + timedelta(minutes=index)).strftime('%Y-%m-%dT%H:%M:%SZ')
            call('/UserPlayedItems/'+item['Id']+'?'+urlencode({'userId':user['Id'],'datePlayed':stamp}), 'POST', token=token)
            if number == 0:
                episode = next(e for e in episodes if e.get('SeriesId') == item['Id'])
                call('/UserItems/'+episode['Id']+'/UserData?userId='+user['Id'], 'POST', {'Played':False,'PlaybackPositionTicks':1000000,'LastPlayedDate':stamp}, token)
        if number == 0:
            resume = call('/UserItems/Resume?'+urlencode({'userId':user['Id'],'includeItemTypes':'Episode','limit':3}),token=token)['Items']
            assert [e['SeriesId'] for e in resume] == [s['Id'] for s in reversed(series)], 'Native resume ordering does not match the bounded stress fixture'
        for item in movies[:140]:
            call('/UserPlayedItems/'+item['Id']+'?userId='+user['Id'], 'POST', token=token)
    movie_owner = call('/Users/New', 'POST', {'Name':'BenchmarkMoviesOnly','Password':'DisposableBenchmark123!'}, token)
    for item in movies[:140]:
        call('/UserPlayedItems/'+item['Id']+'?userId='+movie_owner['Id'], 'POST', token=token)
    results = []
    snapshots = {}
    try:
        with zipfile.ZipFile(baseline) as archive: previous=archive.read('Jellyfin.Plugin.WatchGuard.dll')
        for label, assembly in [(baseline_label,previous), ('candidate-v048',candidate)]:
            docker('stop',name);dll.write_bytes(assembly);restart()
            for scope,route in [('movies-only','/WatchGuard/ActivityOverview/Users/'+movie_owner['Id']),('mixed-all-users','/WatchGuard/ActivityOverview')]:
                call(route,token=token)
                samples=[];returned=[];truncated=[];diagnostics=[];coverage=[]
                for _ in range(3):
                    start=time.perf_counter();response=call(route,token=token)
                    if baseline_version in ('0.4.6','0.4.7'):
                        # Preserve exact equality of legacy fields; only v0.5.2's new informational DTO is absent in the baseline.
                        comparable=json.loads(json.dumps(response['Items']))
                        for item in comparable:
                            for owner in item['Users']:
                                owner.pop('EpisodeProgress',None)
                        canonical=json.dumps({'items':comparable,'coverage':response['Coverage']},sort_keys=True)
                        if scope not in snapshots: snapshots[scope]=canonical
                        assert snapshots[scope]==canonical, 'Large-series classifications or coverage changed'
                    samples.append((time.perf_counter()-start)*1000)
                    returned.append(len(response['Items']));truncated.append(response['LimitReached'])
                    if response.get('Diagnostics'):diagnostics.append(response['Diagnostics'])
                    coverage.append(response.get('Coverage'))
                results.append({'version':label,'scope':scope,'requestMs':samples,'medianMs':statistics.median(samples),'returned':returned,
                    'truncationFrequency':sum(truncated)/len(truncated),'diagnostics':diagnostics,'coverage':coverage})
    finally:
        docker('stop',name);dll.write_bytes(candidate);restart()
    output={'kind':'native-disposable-official-image','baseline':baseline_label,'seriesEpisodeCounts':[300,1000,1501],
        'seriesPlaybackUsers':6,'movieOnlyUsers':1,'completedMovies':140,'untouchedMovies':200,'results':results}
    validate(output)
    (repo/f'artifacts/discovery-native-v048-{baseline_version}.json').write_text(json.dumps(output,indent=2)+'\n')
    print('Native discovery benchmark:',json.dumps(output),flush=True)
