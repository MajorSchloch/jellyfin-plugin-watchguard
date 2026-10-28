"""Shared synthetic activity inventory; independent jobs never share state."""
import time


def seed(call, docker, name, token):
    assert name.startswith('watchguard-poc-')
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
    return owners, movies, series


def settle(call, token):
    deadline = time.monotonic() + 600
    while True:
        state = call('/WatchGuard/ActivityIndex/Status?owner=all', token=token)['Freshness']
        if state['DiscoveryFinished'] and state['Pending'] == 0 and state['Stored'] == state['Validated']:
            return
        assert time.monotonic() < deadline, state
        time.sleep(.5)


def prepare_browser(call, docker, name, token, phases):
    """Recreate the former comparison's ending state without rerunning comparisons.

    Same 120 movies/300 episodes/six viewers, six explicit memberships, one
    unplayed movie and one stopped partial playback. Browser assertions and all
    native polling intervals remain unchanged.
    """
    phases.phase('activity-browser-fixture-seed')
    owners, movies, series = seed(call, docker, name, token)
    explicit = next(i for i in call('/Items?Recursive=true&IncludeItemTypes=Movie&Limit=1000', token=token)['Items'] if not i['Name'].startswith('Index Movie'))
    for n in range(2):
        signed = call('/Users/AuthenticateByName', 'POST', {'Username': 'IndexUser'+str(n), 'Pw': 'DisposableIndex123!'})
        for item in [movies[-1], series[0], explicit]:
            call('/WatchGuard/Watchlist/'+item['Id'], 'PUT', token=signed['AccessToken'], expected=204)
    call('/UserItems/'+movies[0]['Id']+'/UserData?userId='+owners[0], 'POST', {'Played': False, 'PlaybackPositionTicks': 0}, token)
    signed = call('/Users/AuthenticateByName', 'POST', {'Username': 'IndexUser0', 'Pw': 'DisposableIndex123!'})
    call('/Sessions/Playing', 'POST', {'ItemId': movies[1]['Id'], 'PlayMethod': 'DirectPlay', 'PositionTicks': 10000}, signed['AccessToken'], expected=204)
    call('/Sessions/Playing/Stopped', 'POST', {'ItemId': movies[1]['Id'], 'PositionTicks': 10000}, signed['AccessToken'], expected=204)
    phases.phase('activity-browser-fixture-population')
    settle(call, token)
