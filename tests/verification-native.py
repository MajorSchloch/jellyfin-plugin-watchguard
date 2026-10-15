"""Synthetic multi-user series verification profile, isolated by docker-smoke."""
import hashlib
import zipfile
import json
import os
from pathlib import Path
import statistics
import time


def run(call, restart, docker, name, plugins, token):
    assert name.startswith('watchguard-poc-')
    docker('exec', name, 'sh', '-c', '''set -eu
s=1; while [ "$s" -le 100 ]; do
 folder="/tmp/poc-tv/Verification $s/Season 01"; mkdir -p "$folder"
 e=1; while [ "$e" -le 24 ]; do
  episode=$(printf 'Verification %s S01E%02d' "$s" "$e")
  cp /tmp/fixture.mp4 "$folder/$episode.mp4"
  printf '<episodedetails><title>Episode %s</title><season>1</season><episode>%s</episode><aired>2020-01-01</aired></episodedetails>' "$e" "$e" > "$folder/$episode.nfo"
  e=$((e+1))
 done
 s=$((s+1))
done''')
    call('/Library/Refresh', 'POST', token=token, expected=204)
    for _ in range(360):
        episodes = call('/Items?Recursive=true&IncludeItemTypes=Episode&Limit=10000', token=token)['Items']
        if len([e for e in episodes if e.get('SeriesName','').startswith('Verification ')]) == 2400:
            break
        time.sleep(1)
    else:
        raise AssertionError('Verification fixture scan did not complete')
    series = [s for s in call('/Items?Recursive=true&IncludeItemTypes=Series&Limit=10000', token=token)['Items']
              if s['Name'].startswith('Verification ')]
    assert len(series) == 100
    series.sort(key=lambda item:item['Name'])
    for index,item in enumerate(series):
        full=call('/Items/'+item['Id'],token=token)
        call('/Items/'+item['Id'],'POST',{**full,'Status':'Continuing' if index%2==0 else 'Ended',
              'Tags':['verification-restricted'] if index%5==0 else []},token,expected=204)
    first_rows=[e for e in episodes if e.get('SeriesId')==series[0]['Id']]
    assert len(first_rows)==24
    call('/Videos/MergeVersions?ids='+','.join(e['Id'] for e in first_rows[:2]),'POST',token=token,expected=204)
    gap=next(e for e in episodes if e.get('SeriesId')==series[2]['Id'])
    full=call('/Items/'+gap['Id'],token=token)
    call('/Items/'+gap['Id'],'POST',{**full,'PremiereDate':None},token,expected=204)
    # Admin plus six accounts: seven visible users, six with progress.
    owners = []
    for index in range(6):
        owner = call('/Users/New', 'POST', {'Name':f'VerificationUser{index}', 'Password':'DisposableBenchmark123!'}, token)
        owners.append(owner['Id'])
        for item in series:
            call('/UserPlayedItems/'+item['Id']+'?userId='+owner['Id'], 'POST', token=token)
            if index==0:
                episode=next(e for e in episodes if e.get('SeriesId')==item['Id'])
                call('/UserItems/'+episode['Id']+'/UserData?userId='+owner['Id'],'POST',
                     {'Played':False,'PlaybackPositionTicks':1000000},token)
        if index==5:
            policy=call('/Users/'+owner['Id'],token=token)['Policy']
            call('/Users/'+owner['Id']+'/Policy','POST',{**policy,'BlockedTags':['verification-restricted']},token,expected=204)
    repo = Path(__file__).resolve().parents[1]
    baseline = repo/'artifacts/Jellyfin.Plugin.WatchGuard-v0.4.6.zip'
    assert hashlib.sha256(baseline.read_bytes()).hexdigest() == 'e083f873d76a2cd62005e1093f30ecfde3201409fa9caa45948433372bba87e1'
    dll = plugins/'WatchGuard/Jellyfin.Plugin.WatchGuard.dll'
    candidate = dll.read_bytes()
    with zipfile.ZipFile(baseline) as archive:
        previous = archive.read('Jellyfin.Plugin.WatchGuard.dll')
    results = []
    snapshots = {}
    try:
        for label, assembly in [('published-v046', previous), ('candidate-v047', candidate)]:
            docker('stop',name); dll.write_bytes(assembly); restart()
            for scope, route in [('single-user','/WatchGuard/ActivityOverview/Users/'+owners[0]),
                                 ('all-users','/WatchGuard/ActivityOverview')]:
                # The published baseline can exceed 15 seconds on contended CI runners.
                # Only the timed benchmark requests get a longer transport timeout;
                # preserve all result/equality/coverage assertions.
                call(route, token=token, timeout=60)
                samples = []
                for _ in range(3):
                    started = time.perf_counter()
                    response = call(route, token=token, timeout=60)
                    canonical = json.dumps(response['Items'], sort_keys=True)
                    if scope not in snapshots: snapshots[scope] = canonical
                    assert canonical == snapshots[scope], 'Playback classifications or title coverage changed'
                    assert len(response['Items']) == 100
                    samples.append({'httpMs':(time.perf_counter()-started)*1000,
                                    'returned':len(response['Items']), 'diagnostics':response['Diagnostics'],
                                    'coverage':response['Coverage']})
                results.append({'version':label,'scope':scope,'samples':samples,'medianMs':statistics.median(s['httpMs'] for s in samples)})
    finally:
        docker('stop',name); dll.write_bytes(candidate); restart()
    output = {'kind':'synthetic-native-verification','series':100,'episodesPerSeries':24,'enabledUsers':7,
              'variants':['continuing','ended','unfinished','alternate-versions','missing-air-date','blocked-tags'], 'results':results}
    path = Path(os.environ.get('WATCHGUARD_VERIFICATION_OUTPUT','artifacts/verification-native-v047.json'))
    path.write_text(json.dumps(output,indent=2)+'\n')
    print('Verification benchmark complete: '+str(path), flush=True)
