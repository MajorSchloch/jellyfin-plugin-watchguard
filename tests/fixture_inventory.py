"""Read-only, bounded inventory readiness for generated disposable fixtures.

Mutations (including starting the scan) belong to the caller and are never retried.
The get callback must apply its supplied timeout to each HTTP request.
"""
from collections import Counter
import json
from pathlib import Path
import time


def differences(items, expected):
    """Expected entries map native path to (type, parent path, optional name)."""
    by_path = {item.get('Path'): item for item in items}
    by_id = {item['Id']: item for item in items}
    issues = []
    counts = Counter(item['Type'] for item in items)
    wanted = Counter(value[0] for value in expected.values())
    if counts != wanted:
        issues.append({'counts': dict(counts), 'expectedCounts': dict(wanted)})
    for path, (kind, parent, name) in expected.items():
        item = by_path.get(path)
        if not item:
            issues.append({'missingPath': path})
            continue
        if item['Type'] != kind or (name and item['Name'] != name):
            issues.append({'wrongItem': path})
        if parent and by_id.get(item.get('ParentId'), {}).get('Path') != parent:
            issues.append({'wrongParent': path, 'expectedParent': parent})
    if len(by_path) != len(items):
        issues.append({'duplicatePaths': True})
    return issues


def wait_inventory(get, user_id, expected, output, seconds=120):
    started = time.monotonic()
    deadline = started + seconds
    snapshot = {'phase': 'media-indexing', 'status': 'WAITING', 'retries': 0}
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    while time.monotonic() < deadline:
        timeout = max(.1, min(10, deadline - time.monotonic()))
        try:
            response = get('/Items?UserId=' + user_id + '&Recursive=true&Fields=Path,ParentId&IncludeItemTypes=Movie,Series,Season,Episode&Limit=10000', timeout)
            items = response['Items']
            snapshot['differences'] = differences(items, expected)
            snapshot['counts'] = dict(Counter(i['Type'] for i in items))
            tasks = get('/ScheduledTasks', max(.1, min(10, deadline - time.monotonic())))
            snapshot['scanTasks'] = [{k: t.get(k) for k in ('Key', 'State', 'CurrentProgressPercentage')} for t in tasks if t['Key'] == 'RefreshLibrary']
            if not snapshot['differences'] and snapshot['scanTasks'] and all(t['State'] == 'Idle' for t in snapshot['scanTasks']):
                snapshot['status'] = 'PASS'
                snapshot['elapsedSeconds'] = round(time.monotonic() - started, 3)
                output.write_text(json.dumps(snapshot, indent=2) + '\n')
                return items
        except (OSError, TimeoutError) as error:
            # Only transport failures on read-only readiness queries may retry.
            snapshot['transportError'] = type(error).__name__
        snapshot['elapsedSeconds'] = round(time.monotonic() - started, 3)
        output.write_text(json.dumps(snapshot, indent=2) + '\n')
        time.sleep(min(1, max(0, deadline - time.monotonic())))
    snapshot['status'] = 'FAIL'
    output.write_text(json.dumps(snapshot, indent=2) + '\n')
    raise AssertionError('Media inventory precondition failed; see ' + str(output))


def wait_ready(probe, seconds=90):
    """Retry only a caller-supplied read-only startup probe, within one deadline."""
    import http.client
    deadline=time.monotonic()+seconds
    last=None
    while time.monotonic()<deadline:
        try:
            probe(max(.1,min(5,deadline-time.monotonic())))
            return
        except (OSError,http.client.HTTPException,AssertionError) as error:
            last=type(error).__name__
        time.sleep(min(1,max(0,deadline-time.monotonic())))
    raise AssertionError('Server readiness deadline exceeded; last failure type: '+str(last))
