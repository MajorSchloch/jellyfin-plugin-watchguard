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
    policies = os.environ.get('WATCHGUARD_VERIFICATION_POLICIES') == '1'
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
    if policies:
        # Per-episode rating/tag/future metadata exercises filtering below a visible series.
        for index,item in enumerate(series[:10]):
            episode=next(e for e in episodes if e.get('SeriesId')==item['Id'])
            full=call('/Items/'+episode['Id'],token=token)
            call('/Items/'+episode['Id'],'POST',{**full,'OfficialRating':'TV-MA',
                 'Tags':['episode-restricted'],
                 'PremiereDate':'2099-01-01T00:00:00Z' if index==3 else full.get('PremiereDate')},token,expected=204)
        for item in series[::2]:
            full=call('/Items/'+item['Id'],token=token)
            call('/Items/'+item['Id'],'POST',{**full,'Tags':full.get('Tags',[])+['allowed-series']},token,expected=204)
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
    if policies:
        folders=call('/Library/VirtualFolders',token=token)
        tv=next(f['ItemId'] for f in folders if f['Name']=='PoC TV')
        movie_folder=next(f['ItemId'] for f in folders if f['Name']=='PoC Movies')
        ratings=call('/Localization/ParentalRatings',token=token)
        maximum=next(r['Value'] for r in ratings if r['Name']=='TV-PG')
        restrictions=[(1,{'BlockedTags':['episode-restricted']}),
                      (2,{'MaxParentalRating':maximum}),
                      (3,{'EnableAllFolders':False,'EnabledFolders':[movie_folder],'BlockedMediaFolders':[tv]}),
                      (4,{'AllowedTags':['allowed-series']})]
        for index,change in restrictions:
            policy=call('/Users/'+owners[index],token=token)['Policy']
            call('/Users/'+owners[index]+'/Policy','POST',{**policy,**change},token,expected=204)
        # Explicit membership is preserved independently of automatic results.
        call('/WatchGuard/Watchlist/'+series[0]['Id'],'PUT',token=token,expected=204)
    repo = Path(__file__).resolve().parents[1]
    baseline = repo/'artifacts/Jellyfin.Plugin.WatchGuard-v0.4.7.zip'
    assert hashlib.sha256(baseline.read_bytes()).hexdigest() == '8046bbd611ba3e17bf003160e32d8bffdf07a22038f06863bd8414e78c08b6e0'
    dll = plugins/'WatchGuard/Jellyfin.Plugin.WatchGuard.dll'
    candidate = dll.read_bytes()
    with zipfile.ZipFile(baseline) as archive:
        previous = archive.read('Jellyfin.Plugin.WatchGuard.dll')
    results = []
    snapshots = {}
    try:
        for label, assembly in [('published-v047', previous), ('candidate-v048', candidate)]:
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
                    # Only the additive v0.5.2 presentation is absent from v0.4.7.
                    # Keep exact equality for all original playback/visibility/coverage fields.
                    comparable = json.loads(json.dumps(response['Items']))
                    for item in comparable:
                        for owner in item['Users']:
                            owner.pop('EpisodeProgress', None)
                    canonical = json.dumps({'items':comparable,'coverage':response['Coverage']}, sort_keys=True)
                    if scope not in snapshots: snapshots[scope] = canonical
                    assert canonical == snapshots[scope], 'Playback classifications or title coverage changed'
                    assert len(response['Items']) == 100
                    if policies and scope=='all-users':
                        assert all(u['UserId'].replace('-','')!=owners[3].replace('-','') for item in response['Items'] for u in item['Users'])
                    if policies and scope=='all-users':
                        for restricted in (1,2):
                            assert any(u['UserId'].replace('-','')==owners[restricted].replace('-','') and u['AvailableEpisodes']<24 for item in response['Items'] for u in item['Users'])
                    if policies:
                        assert any(i['ItemId'].replace('-','')==series[0]['Id'].replace('-','') for i in call('/WatchGuard/Watchlist',token=token))
                    samples.append({'httpMs':(time.perf_counter()-started)*1000,
                                    'returned':len(response['Items']), 'diagnostics':response['Diagnostics'],
                                    'coverage':response['Coverage']})
                results.append({'version':label,'scope':scope,'samples':samples,'medianMs':statistics.median(s['httpMs'] for s in samples)})
    finally:
        docker('stop',name); dll.write_bytes(candidate); restart()
    output = {'kind':'synthetic-native-verification','series':100,'episodesPerSeries':24,'enabledUsers':7,
              'variants':['continuing','ended','unfinished','alternate-versions','missing-air-date','blocked-tags']+(['episode-tags','parental-rating','restricted-library-folders','allowed-tags','future-episode','explicit-membership'] if policies else []), 'results':results}
    path = Path(os.environ.get('WATCHGUARD_VERIFICATION_OUTPUT','artifacts/verification-native-v048.json'))
    path.write_text(json.dumps(output,indent=2)+'\n')
    print('Verification benchmark complete: '+str(path), flush=True)
