"""v0.7 native query comparison. Disposable fixture owner calls this; never production."""
from datetime import datetime
import hashlib
import json
from pathlib import Path
import re
import statistics
import subprocess
import time
from urllib.parse import urlencode
import zipfile

BASELINE_SHA = '3542b971231b51a78d9783b490f1438b231cd0fca48b61c6aad5098528d50bd7'



# DateTime/DateTimeOffset JSON may omit trailing fractional zeroes. String order
# is not chronological, and datetime alone truncates the seventh (100 ns) digit.
_TIMESTAMP = re.compile(r"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,7}))?(Z|[+-]\d{2}:\d{2})")
TICKS_PER_SECOND = 10_000_000


def utc_ticks(value):
    """Nullable .NET UTC ticks, exactly; reject ambiguous/malformed timestamps."""
    if value is None:
        return None
    match = _TIMESTAMP.fullmatch(value)
    if match is None:
        raise ValueError('Expected an explicit UTC/offset timestamp with at most seven fractional digits')
    whole, fraction, zone = match.groups()
    instant = datetime.strptime(whole, '%Y-%m-%dT%H:%M:%S')
    offset = 0
    if zone != 'Z':
        hours, minutes = map(int, zone[1:].split(':'))
        if hours > 14 or minutes > 59 or (hours == 14 and minutes):
            raise ValueError('Offset outside the DateTimeOffset range')
        offset = (hours * 60 + minutes) * 60 * (1 if zone[0] == '+' else -1)
    seconds = ((instant.toordinal() - 1) * 86400 + instant.hour * 3600 +
               instant.minute * 60 + instant.second - offset)
    ticks = seconds * TICKS_PER_SECOND + int((fraction or '').ljust(7, '0'))
    if not 0 <= ticks <= 3155378975999999999:
        raise ValueError('UTC instant outside the .NET date range')
    return ticks


def date_key(item, sort):
    if sort == 'title':
        return None
    field = 'LastPlayedDate' if sort == 'recent' else 'AddedAtUtc'
    dates = [utc_ticks(u.get(field)) for u in item['Users'].values()]
    return max((date for date in dates if date is not None), default=None)


def select(items, statuses, search, sort):
    wanted = {'watchlisted': ['Watchlisted'], 'watching': ['InProgress', 'CaughtUp'], 'playing': ['CurrentlyPlaying'], 'watched': ['Watched']}
    selected = []
    for item in items:
        if search.casefold() not in item['Name'].casefold(): continue
        people = {k: u for k, u in item['Users'].items() if any(set(wanted[s]) & set(u['Reasons']) for s in statuses.split(','))}
        if people: selected.append({**item, 'Users': people})
    # Keep the existing deterministic fixture title/ID ties. Null dates are last;
    # max and descending ordering both use instants, never serialized strings.
    selected.sort(key=lambda i: (i['Name'].lower(), i['Name'], i['ItemId']))
    selected.sort(key=lambda i: (date_key(i, sort) is not None, date_key(i, sort) or 0), reverse=True)
    return selected


def assert_global_order(items, statuses, search, sort, output, scenario, sample, label, owner):
    expected = select(items, statuses, search, sort)
    actual_ids = [i['ItemId'] for i in items]
    expected_ids = [i['ItemId'] for i in expected]
    # Allowlist only diagnostic fields from already-authorized synthetic rows.
    # Never serialize API envelopes, headers, continuation tokens or credentials.
    rows = []
    for item in items:
        rows.append({'itemId': item['ItemId'], 'name': item['Name'],
                     'titleTieBreak': [item['Name'].lower(), item['Name'], item['ItemId']],
                     'maxUtcTicks': date_key(item, sort),
                     'owners': [{'userId': uid, 'reasons': person['Reasons'],
                                 **{field: {'raw': person.get(field), 'utcTicks': utc_ticks(person.get(field))}
                                    for field in ('LastPlayedDate', 'AddedAtUtc')}}
                                for uid, person in item['Users'].items()]})
    evidence = {'scenario': scenario, 'sample': sample, 'candidate': label,
                'query': {'owner': owner, 'statuses': statuses, 'search': search, 'sort': sort},
                'dateKey': 'UTC ticks since 0001-01-01 (100 ns); descending, null last',
                'actualOrder': actual_ids, 'expectedOrder': expected_ids,
                'expectedUtcTicks': {i['ItemId']: date_key(i, sort) for i in expected}, 'rows': rows,
                'result': 'PASS' if actual_ids == expected_ids else 'FAIL'}
    path = output / f'order-{label}-{scenario}-{sample}.json'
    path.write_text(json.dumps(evidence, indent=2) + '\n')
    assert actual_ids == expected_ids, (scenario, 'global ordering', str(path))


def run(call, restart, docker, name, plugins, token, owners, movies, series, phases):
    assert name.startswith('watchguard-poc-')
    repo = Path(__file__).resolve().parents[1]
    output = repo / 'artifacts/activity-browser' / name
    output.mkdir(parents=True)
    phases.phase('historical-v060-download')
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
        first_result_ms = raw_first_ms if not first.get('Preparing') and (first['Items'] or not first.get('Continuation')) else None
        first_requests = 1 if first_result_ms is not None else None
        preparations = int(bool(first.get('Preparing')))
        empty_boundaries = int(not first.get('Preparing') and not first['Items'] and bool(first.get('Continuation')))
        work = {key: first.get('ReadDiagnostics', {}).get(key, 0) for key in ['CandidatesExamined', 'EpisodeVisibilityQueries', 'EpisodeRows']}
        seen = set()
        while page.get('Continuation'):
            cursor = page['Continuation']; assert cursor not in seen; seen.add(cursor)
            page = call(route + '&continuation=' + cursor, token=token, timeout=60); pages += 1
            assert pages < 100
            items += page['Items']
            preparations += int(bool(page.get('Preparing')))
            empty_boundaries += int(not page.get('Preparing') and not page['Items'] and bool(page.get('Continuation')))
            if first_result_ms is None and not page.get('Preparing') and (page['Items'] or not page.get('Continuation')):
                first_result_ms = (time.perf_counter() - start) * 1000
                first_requests = pages
            for key in work: work[key] += page.get('ReadDiagnostics', {}).get(key, 0)
        return merged(items), {'rawFirstPageMs': raw_first_ms, 'firstOrderedPageMs': first_result_ms,
                               'completePaginationMs': (time.perf_counter() - start) * 1000, 'requests': pages,
                               'firstPageItems': len(first['Items']), 'firstOrderedRequests': first_requests,
                               'preparationResponses': preparations, 'emptyPreparedBoundaries': empty_boundaries, 'work': work}

    scenarios = [('all-title', 'all', 'watchlisted,watching,playing,watched', '', 'title'),
                 ('single-recent', owners[0], 'watchlisted,watching,playing,watched', '', 'recent'),
                 ('few-watchlists', 'all', 'watchlisted', '', 'added'),
                 ('few-search', 'all', 'watched', 'Index Movie 120', 'title'),
                 ('few-watching', 'all', 'watching', '', 'recent'),
                 ('live', 'all', 'playing', '', 'title')]
    expected = {}
    try:
        for label, payload in [('v060', old), ('v0711', candidate)]:
            phases.phase(label + '-query-population')
            docker('stop', name); dll.write_bytes(payload); restart(); report[label + 'SettleMs'] = settle()
            live_user = call('/Users/AuthenticateByName', 'POST', {'Username': 'IndexUser0', 'Pw': 'DisposableIndex123!'})
            call('/Sessions/Playing', 'POST', {'ItemId': movies[1]['Id'], 'PlayMethod': 'DirectPlay', 'PositionTicks': 10000}, live_user['AccessToken'], expected=204)
            settle()
            phases.phase(label + '-query-comparison')
            for scenario, owner, statuses, search, sort in scenarios:
                samples = []
                before_work = call('/WatchGuard/ActivityIndex/Status?owner=all', token=token)['Freshness']
                for sample in range(4):
                    if label == 'v060':
                        start = time.perf_counter()
                        members = call('/WatchGuard/Watchlists' + ('/' + owner if owner != 'all' else ''), token=token)
                        members = [{**i, 'Users': [{**u, 'Reasons': ['Watchlisted'], 'LastPlayedDate': None} for u in i['Users']]} for i in members]
                        data, timing = collect('/WatchGuard/ActivityIndex?owner=' + owner)
                        data = merged([{'ItemId': i['ItemId'], 'Name': i['Name'], 'Users': list(i['Users'].values())} for i in data] + members)
                        data = select(data, statuses, search, sort)
                        timing['requests'] += 1  # Explicit membership fetch is part of the combined answer.
                        timing['completePaginationMs'] = (time.perf_counter() - start) * 1000
                        timing['firstOrderedPageMs'] = timing['completePaginationMs']
                        timing['firstOrderedRequests'] = timing['requests']
                    else:
                        data, timing = collect('/WatchGuard/ActivityBrowser?' + urlencode({'owner': owner, 'statuses': statuses, 'sort': sort, 'search': search}))
                    assert_global_order(data, statuses, search, sort, output, scenario, sample, label, owner)
                    ids = [i['ItemId'] for i in data]
                    # Native playback events can update dates between versions; compare membership and title order for deterministic text cases.
                    if label == 'v060': expected[scenario] = data
                    else:
                        assert set(ids) == {i['ItemId'] for i in expected[scenario]}, (scenario, ids, expected[scenario])
                        if sort == 'title': assert ids == [i['ItemId'] for i in expected[scenario]]
                        for item in data:
                            before = next(i for i in expected[scenario] if i['ItemId'] == item['ItemId'])
                            assert set(item['Users']) == set(before['Users']), (scenario, 'owner loss')
                            for uid, person in item['Users'].items():
                                assert set(person['Reasons']) == set(before['Users'][uid]['Reasons']), (scenario, 'reason loss')
                    timing['titles'] = len(ids)
                    if sample: samples.append(timing)
                after_work = call('/WatchGuard/ActivityIndex/Status?owner=all', token=token)['Freshness']
                delta = after_work['PlaybackBatches'] - before_work['PlaybackBatches']
                assert delta == 0, (label, scenario, 'Page requests repeated background classification')
                report['measurements'][label + '-' + scenario] = {'samples': samples, 'workerPlaybackBatchesDelta': delta,
                    'firstPageMedianMs': statistics.median(s['firstOrderedPageMs'] for s in samples),
                    'completePaginationMedianMs': statistics.median(s['completePaginationMs'] for s in samples)}
            call('/Sessions/Playing/Stopped', 'POST', {'ItemId': movies[1]['Id'], 'PositionTicks': 10000}, live_user['AccessToken'], expected=204)
        phases.phase('current-query-permission-revocation')
        # A native account revocation invalidates a saved query before another page is disclosed.
        policy = call('/Users/' + owners[1], token=token)['Policy']
        first = call('/WatchGuard/ActivityBrowser?owner=all&statuses=watched&sort=title', token=token)
        assert first.get('Continuation')
        try:
            call('/Users/' + owners[1] + '/Policy', 'POST', {**policy, 'IsDisabled': True}, token, expected=204)
            denied = call('/WatchGuard/ActivityBrowser?owner=all&statuses=watched&sort=title&continuation=' + first['Continuation'], token=token, expected=409)
            assert denied['Code'] == 'ActivityViewExpired'
            scoped, _ = collect('/WatchGuard/ActivityBrowser?owner=all&statuses=watchlisted&sort=added')
            assert all(owners[1].replace('-', '') not in item['Users'] for item in scoped)
            report['nativePermissionRevocation'] = 'PASS'
        finally:
            call('/Users/' + owners[1] + '/Policy', 'POST', policy, token, expected=204)
            settle()
        report['result'] = 'PASS'
    finally:
        (output / 'results.json').write_text(json.dumps(report, indent=2) + '\n')
        if dll.read_bytes() != candidate:
            docker('stop', name); dll.write_bytes(candidate); restart()
