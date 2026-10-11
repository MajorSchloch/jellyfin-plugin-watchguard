"""Backend assertions used only by the disposable Docker fixture."""
import time
import uuid
from concurrent.futures import ThreadPoolExecutor


def run(call, admin_token, items, plugins):
    movie = items['PoC Modern Movie']
    series = items['PoC Series Detail']
    password = 'Disposable-' + uuid.uuid4().hex
    member = call('/Users/New', 'POST', {'Name': 'BackendMember', 'Password': password}, admin_token)
    signed = call('/Users/AuthenticateByName', 'POST', {'Username': 'BackendMember', 'Pw': password})
    token = signed['AccessToken']
    route = '/WatchGuard/Watchlist/' + movie
    call('/WatchGuard/Watchlist', expected=401)
    call('/WatchGuard/Watchlists', expected=401)
    call('/WatchGuard/Watchlists', token=token, expected=403)
    call('/WatchGuard/Protection/' + movie, token=token, expected=403)
    call('/WatchGuard/Protection/' + str(uuid.uuid4()), token=admin_token, expected=404)
    call('/WatchGuard/Watchlist/' + str(uuid.uuid4()), 'PUT', token=token, expected=404)
    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(lambda _: call(route, 'PUT', token=token, expected=204), range(16)))
    assert len(call('/WatchGuard/Watchlist', token=token)) == 1
    assert call('/WatchGuard/Watchlist', token=admin_token) == []
    call(route, 'PUT', token=admin_token, expected=204)
    shared = call('/WatchGuard/Watchlists', token=admin_token)
    assert len(shared) == 1 and len(shared[0]['Users']) == 2
    assert {owner['DisplayName'] for owner in shared[0]['Users']} == {'BackendMember', 'WatchGuardPoCTest'}
    call(route, 'DELETE', token=admin_token, expected=204)
    state = call('/WatchGuard/Protection/' + movie, token=admin_token)
    assert state['HasOtherInterestedUsers'] and state['Users'][0]['DisplayName'] == 'BackendMember'
    assert state['Users'][0]['Reasons'] == ['Watchlisted']
    call(route, 'DELETE', token=token, expected=204)
    call(route, 'DELETE', token=token, expected=204)
    assert not call('/WatchGuard/Protection/' + movie, token=admin_token)['HasInterest']
    # Real native playback writes, not a WatchGuard substitute.
    def playback(item, played, position):
        call('/UserItems/' + item + '/UserData', 'POST', {'Played': played, 'PlaybackPositionTicks': position}, token)
    playback(movie, False, 1000000)
    assert call('/WatchGuard/Protection/' + movie, token=admin_token)['Users'][0]['Reasons'] == ['InProgress']
    call(route, 'PUT', token=token, expected=204)
    playback(movie, True, 0)
    assert call('/WatchGuard/Protection/' + movie, token=admin_token)['Users'][0]['Reasons'] == ['Watchlisted']
    episodes = call('/Shows/' + series + '/Episodes', token=token)['Items']
    playback(episodes[0]['Id'], True, 0)
    assert call('/WatchGuard/Protection/' + series, token=admin_token)['HasOtherInterestedUsers']
    playback(episodes[1]['Id'], True, 0)
    assert not call('/WatchGuard/Protection/' + series, token=admin_token)['HasInterest']
    call('/Sessions/Playing', 'POST', {'ItemId': movie, 'PlayMethod': 'DirectPlay', 'PositionTicks': 0}, token, expected=204)
    assert 'CurrentlyPlaying' in call('/WatchGuard/Protection/' + movie, token=admin_token)['Users'][0]['Reasons']
    call('/Sessions/Playing/Stopped', 'POST', {'ItemId': movie, 'PositionTicks': 0}, token, expected=204)
    # Corruption remains intact and returns an error; explicit restoration recovers without restart.
    path = plugins / 'Jellyfin.Plugin.WatchGuard/watchlists.json'
    good = path.read_bytes()
    path.write_text('{broken')
    call('/WatchGuard/Watchlist', token=token, expected=503)
    call(route, 'PUT', token=token, expected=503)
    call('/WatchGuard/Protection/' + movie, token=admin_token, expected=503)
    call('/WatchGuard/Watchlists', token=admin_token, expected=503)
    assert path.read_text() == '{broken'
    restored = path.with_suffix('.restore')
    restored.write_bytes(good)
    restored.replace(path)
    # Docker Desktop bind-mount propagation is asynchronous.
    for attempt in range(20):
        try:
            assert len(call('/WatchGuard/Watchlist', token=token)) == 1
            break
        except AssertionError:
            if attempt == 19: raise
            time.sleep(0.25)
    call('/Users/' + member['Id'], 'DELETE', token=admin_token, expected=204)
    assert not call('/WatchGuard/Protection/' + movie, token=admin_token)['HasInterest']
    assert call('/WatchGuard/Watchlists', token=admin_token) == []
    print('Backend HTTP checks passed: CRUD, isolation, concurrency, playback, series, sessions, corruption, removed user.', flush=True)
