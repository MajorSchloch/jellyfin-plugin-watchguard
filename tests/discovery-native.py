"""Native before/after benchmark on one disposable database; never production."""
import hashlib
import json
from pathlib import Path
import statistics
import time
import zipfile


def validate(output):
    results = {(r['version'], r['scope']): r for r in output['results']}
    for version in ('published-v045', 'candidate-v046'):
        for scope in ('movies-only', 'mixed-all-users'):
            row = results[version, scope]
            expected = 0 if version == 'published-v045' and scope == 'mixed-all-users' else 100
            assert row['returned'] == [expected] * 3, (version, scope, row['returned'])
            assert row['truncationFrequency'] == 1
    assert all(d['NativePlaybackBatches'] == 2 for d in results['candidate-v046', 'movies-only']['diagnostics'])
    assert len(results['candidate-v046', 'movies-only']['diagnostics']) == 3


def run(call, restart, docker, name, root, plugins, token):
    assert name.startswith('watchguard-poc-') and root.name.startswith('watchguard-poc-')
    repo = Path(__file__).resolve().parents[1]
    baseline = repo/'artifacts/Jellyfin.Plugin.WatchGuard-v0.4.5.zip'
    assert hashlib.sha256(baseline.read_bytes()).hexdigest() == 'ebe3827470e439bd0a15f7fb65edfa330c6ecf2d1f8ec4112402680f109f709f'
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
    for _ in range(360):
        episodes = call('/Items?Recursive=true&IncludeItemTypes=Episode&Fields=PremiereDate', token=token)['Items']
        if len(episodes) >= 2811: break
        time.sleep(1)
    else: raise AssertionError('Synthetic scan did not complete')
    titles = call('/Items?Recursive=true&IncludeItemTypes=Movie,Series', token=token)['Items']
    series = [i for i in titles if i['Type'] == 'Series' and i['Name'].startswith('Benchmark ')]
    movies = [i for i in titles if i['Type'] == 'Movie' and i['Name'].startswith('Benchmark Movie')]
    assert len(series) == 3 and len(movies) == 340
    for item in series:
        full = call('/Items/'+item['Id'], token=token)
        call('/Items/'+item['Id'], 'POST', {**full, 'Status':'Continuing'}, token, expected=204)
    for number in range(3):
        user = call('/Users/New', 'POST', {'Name':f'BenchmarkUser{number}', 'Password':'DisposableBenchmark123!'}, token)
        for item in series:
            call('/UserPlayedItems/'+item['Id']+'?userId='+user['Id'], 'POST', token=token)
            if number == 0:
                episode = next(e for e in episodes if e.get('SeriesId') == item['Id'])
                call('/UserItems/'+episode['Id']+'/UserData?userId='+user['Id'], 'POST', {'Played':False,'PlaybackPositionTicks':1000000}, token)
        for item in movies[:140]:
            call('/UserPlayedItems/'+item['Id']+'?userId='+user['Id'], 'POST', token=token)
    movie_owner = call('/Users/New', 'POST', {'Name':'BenchmarkMoviesOnly','Password':'DisposableBenchmark123!'}, token)
    for item in movies[:140]:
        call('/UserPlayedItems/'+item['Id']+'?userId='+movie_owner['Id'], 'POST', token=token)
    results = []
    try:
        with zipfile.ZipFile(baseline) as archive: previous=archive.read('Jellyfin.Plugin.WatchGuard.dll')
        for label, assembly in [('published-v045',previous), ('candidate-v046',candidate)]:
            docker('stop',name);dll.write_bytes(assembly);restart()
            for scope,route in [('movies-only','/WatchGuard/ActivityOverview/Users/'+movie_owner['Id']),('mixed-all-users','/WatchGuard/ActivityOverview')]:
                call(route,token=token)
                samples=[];returned=[];truncated=[];diagnostics=[]
                for _ in range(3):
                    start=time.perf_counter();response=call(route,token=token)
                    samples.append((time.perf_counter()-start)*1000)
                    returned.append(len(response['Items']));truncated.append(response['LimitReached'])
                    if response.get('Diagnostics'):diagnostics.append(response['Diagnostics'])
                results.append({'version':label,'scope':scope,'requestMs':samples,'medianMs':statistics.median(samples),'returned':returned,
                    'truncationFrequency':sum(truncated)/len(truncated),'diagnostics':diagnostics})
    finally:
        docker('stop',name);dll.write_bytes(candidate);restart()
    output={'kind':'native-disposable-official-image','seriesEpisodeCounts':[300,1000,1501],
        'seriesPlaybackUsers':3,'movieOnlyUsers':1,'completedMovies':140,'untouchedMovies':200,'results':results}
    validate(output)
    (repo/'artifacts/discovery-native-v046.json').write_text(json.dumps(output,indent=2)+'\n')
    print('Native discovery benchmark:',json.dumps(output),flush=True)
