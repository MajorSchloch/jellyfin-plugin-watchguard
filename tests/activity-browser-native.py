"""v0.7 native query comparison. Disposable fixture owner calls this; never production."""
import hashlib
import json
from pathlib import Path
import statistics
import subprocess
import time
from urllib.parse import urlencode
import zipfile

BASELINE_SHA = '3542b971231b51a78d9783b490f1438b231cd0fca48b61c6aad5098528d50bd7'


def run(call, restart, docker, name, plugins, token, owners, movies, series):
    assert name.startswith('watchguard-poc-')
    repo = Path(__file__).resolve().parents[1]
    output = repo / 'artifacts/activity-browser' / name
    output.mkdir(parents=True)
    baseline = output / 'published-v060.zip'
    subprocess.run(['curl', '--fail', '--location', '--retry', '3', '--max-time', '60',
                    'https://github.com/MajorSchloch/jellyfin-plugin-watchguard/releases/download/v0.6.0/Jellyfin.Plugin.WatchGuard-v0.6.0.zip', '-o', str(baseline)], check=True)
    assert hashlib.sha256(baseline.read_bytes()).hexdigest() == BASELINE_SHA
    with zipfile.ZipFile(baseline) as archive:
        old = archive.read('Jellyfin.Plugin.WatchGuard.dll')
    dll = plugins / 'WatchGuard/Jellyfin.Plugin.WatchGuard.dll'
    candidate = dll.read_bytes()
    report = {'baselineSha256': BASELINE_SHA, 'candidateDllSha256': hashlib.sha256(candidate).hexdigest(),
              'commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(),
              'fixture': {'users': 7, 'movies': 120, 'series': 1, 'episodes': 300,
                          'explicitMemberships': 6, 'liveOwners': 1},
              'limitations': ['Known fixture only; no exhaustive-library claim.',
                             'v0.6 client semantics require collecting all pages to filter/sort globally; its raw first page is recorded separately.',
                             'Candidate preparation can span requests; first ordered page includes preparation cost.',
                             'Three warm samples, sequential native requests, no concurrency/load claim.'], 'measurements': {}}
    explicit = next(i for i in call('/Items?Recursive=true&IncludeItemTypes=Movie&Limit=1000', token=token)['Items'] if not i['Name'].startswith('Index Movie'))
    for n in range(2):
        signed = call('/Users/AuthenticateByName', 'POST', {'Username': 'IndexUser' + str(n), 'Pw': 'DisposableIndex123!'})
        for item in [movies[-1], series[0], explicit]:
            call('/WatchGuard/Watchlist/' + item['Id'], 'PUT', token=signed['AccessToken'], expected=204)

    def settle():
        start = time.perf_counter()
        while True:
            state = call('/WatchGuard/ActivityIndex/Status?owner=all', token=token)['Freshness']
            if state['DiscoveryFinished'] and state['Pending'] == 0 and state['Stored'] == state['Validated']:
                return (time.perf_counter() - start) * 1000
            assert time.perf_counter() - start < 600, state
            time.sleep(.5)

    def merged(items):
        result = {}
        for item in items:
            key = item['ItemId'].replace('-', '')
            value = result.setdefault(key, {'ItemId': key, 'Name': item['Name'], 'Users': {}})
            for person in item['Users']:
                uid = person['UserId'].replace('-', '')
                prior = value['Users'].get(uid, {})
                value['Users'][uid] = {**prior, **person, 'LastPlayedDate': person.get('LastPlayedDate') or prior.get('LastPlayedDate'), 'Reasons': sorted(set(prior.get('Reasons', []) + person['Reasons']))}
        return list(result.values())

    def collect(route):
        start = time.perf_counter(); first = call(route, token=token, timeout=60)
        raw_first_ms = (time.perf_counter() - start) * 1000
        items = list(first['Items']); page = first; pages = 1
        first_result_ms = None if first.get('Preparing') else raw_first_ms
        work = {key: first.get('ReadDiagnostics', {}).get(key, 0) for key in ['CandidatesExamined', 'EpisodeVisibilityQueries', 'EpisodeRows']}
        seen = set()
        while page.get('Continuation'):
            cursor = page['Continuation']; assert cursor not in seen; seen.add(cursor)
            page = call(route + '&continuation=' + cursor, token=token, timeout=60); pages += 1
            assert pages < 100
            items += page['Items']
            if first_result_ms is None and not page.get('Preparing'):
                first_result_ms = (time.perf_counter() - start) * 1000
            for key in work: work[key] += page.get('ReadDiagnostics', {}).get(key, 0)
        return merged(items), {'rawFirstPageMs': raw_first_ms, 'firstOrderedPageMs': first_result_ms,
                               'completePaginationMs': (time.perf_counter() - start) * 1000, 'requests': pages,
                               'firstPageItems': len(first['Items']), 'work': work}

    def select(items, statuses, search, sort):
        wanted = {'watchlisted': ['Watchlisted'], 'watching': ['InProgress', 'CaughtUp'], 'playing': ['CurrentlyPlaying'], 'watched': ['Watched']}
        selected = []
        for item in items:
            if search.casefold() not in item['Name'].casefold(): continue
            people = {k: u for k, u in item['Users'].items() if any(set(wanted[s]) & set(u['Reasons']) for s in statuses.split(','))}
            if people: selected.append({**item, 'Users': people})
        def key(item):
            field = 'LastPlayedDate' if sort == 'recent' else 'AddedAtUtc'
            date = max((u.get(field) or '' for u in item['Users'].values()), default='') if sort != 'title' else ''
            return date
        selected.sort(key=lambda i: (i['Name'].lower(), i['Name'], i['ItemId']))
        selected.sort(key=key, reverse=True)
        return selected

    scenarios = [('all-title', 'all', 'watchlisted,watching,playing,watched', '', 'title'),
                 ('single-recent', owners[0], 'watchlisted,watching,playing,watched', '', 'recent'),
                 ('few-watchlists', 'all', 'watchlisted', '', 'added'),
                 ('few-search', 'all', 'watched', 'Index Movie 120', 'title'),
                 ('few-watching', 'all', 'watching', '', 'recent'),
                 ('live', 'all', 'playing', '', 'title')]
    expected = {}
    try:
        for label, payload in [('v060', old), ('v070', candidate)]:
            docker('stop', name); dll.write_bytes(payload); restart(); report[label + 'SettleMs'] = settle()
            live_user = call('/Users/AuthenticateByName', 'POST', {'Username': 'IndexUser0', 'Pw': 'DisposableIndex123!'})
            call('/Sessions/Playing', 'POST', {'ItemId': movies[1]['Id'], 'PlayMethod': 'DirectPlay', 'PositionTicks': 10000}, live_user['AccessToken'], expected=204)
            settle()
            for scenario, owner, statuses, search, sort in scenarios:
                samples = []
                for _ in range(3):
                    if label == 'v060':
                        start = time.perf_counter()
                        members = call('/WatchGuard/Watchlists' + ('/' + owner if owner != 'all' else ''), token=token)
                        members = [{**i, 'Users': [{**u, 'Reasons': ['Watchlisted'], 'LastPlayedDate': None} for u in i['Users']]} for i in members]
                        data, timing = collect('/WatchGuard/ActivityIndex?owner=' + owner)
                        data = merged([{'ItemId': i['ItemId'], 'Name': i['Name'], 'Users': list(i['Users'].values())} for i in data] + members)
                        data = select(data, statuses, search, sort)
                        timing['completePaginationMs'] = (time.perf_counter() - start) * 1000
                        timing['firstOrderedPageMs'] = timing['completePaginationMs']
                    else:
                        data, timing = collect('/WatchGuard/ActivityBrowser?' + urlencode({'owner': owner, 'statuses': statuses, 'sort': sort, 'search': search}))
                    ids = [i['ItemId'] for i in data]
                    # Native playback events can update dates between versions; compare membership and title order for deterministic text cases.
                    if label == 'v060': expected[scenario] = data
                    else:
                        assert set(ids) == {i['ItemId'] for i in expected[scenario]}, (scenario, ids, expected[scenario])
                        assert ids == [i['ItemId'] for i in select(data, statuses, search, sort)], (scenario, 'global ordering')
                        if sort == 'title': assert ids == [i['ItemId'] for i in expected[scenario]]
                        for item in data:
                            before = next(i for i in expected[scenario] if i['ItemId'] == item['ItemId'])
                            assert set(item['Users']) == set(before['Users']), (scenario, 'owner loss')
                            for uid, person in item['Users'].items():
                                assert set(person['Reasons']) == set(before['Users'][uid]['Reasons']), (scenario, 'reason loss')
                    timing['titles'] = len(ids); samples.append(timing)
                report['measurements'][label + '-' + scenario] = {'samples': samples,
                    'firstPageMedianMs': statistics.median(s['firstOrderedPageMs'] for s in samples),
                    'completePaginationMedianMs': statistics.median(s['completePaginationMs'] for s in samples)}
            call('/Sessions/Playing/Stopped', 'POST', {'ItemId': movies[1]['Id'], 'PositionTicks': 10000}, live_user['AccessToken'], expected=204)
        report['result'] = 'PASS'
    finally:
        (output / 'results.json').write_text(json.dumps(report, indent=2) + '\n')
        if dll.read_bytes() != candidate:
            docker('stop', name); dll.write_bytes(candidate); restart()
