"""Reject incomplete or mixed-package qualification evidence before publication."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

POLICY = json.loads(Path(__file__).with_name('qualification-policy.json').read_text())
def inventory(policy):
    if policy.get('schemaVersion') != 1:
        raise ValueError('Unsupported qualification policy schema')
    versions, plan, shards = tuple(policy['hosts']), policy['suites'], policy['shards']
    assignment = {suite: shard for shard, suites in shards.items() for suite in suites}
    if set(assignment) != set(plan) or sum(map(len, shards.values())) != len(plan):
        raise ValueError('Policy must assign every suite exactly once')
    matrix = [dict(jellyfin_version=host, shard=shard)
              for host, config in policy['hosts'].items() for shard in config['shards']]
    pairs = [(row['jellyfin_version'], suite) for row in matrix for suite in shards[row['shard']]]
    if len(pairs) != len(set(pairs)):
        raise ValueError('Policy contains duplicate host/suite assignments')
    return versions, plan, shards, assignment, matrix, pairs


VERSIONS, PLAN, SHARDS, SUITE_SHARD, MATRIX, PAIRS = inventory(POLICY)
SUITES = tuple(PLAN)


def verify(reports, commit, package_sha256, runtime_sha256, require_proxy=False, policy=None):
    _, plan, _, assignment, _, pairs = inventory(POLICY if policy is None else policy)
    expected = set(pairs)
    seen = set()
    for report in reports:
        key = (report['jellyfinVersion'], report['suite'])
        if key not in expected or key in seen:
            raise ValueError('Unexpected or duplicate suite: ' + str(key))
        if report.get('shard') != assignment[key[1]]:
            raise ValueError('Mismatched shard assignment: ' + str(key))
        if report.get('schemaVersion') != 2:
            raise ValueError('Unsupported evidence schema: ' + str(key))
        actual = [(a.get('scenario'), a.get('command'), a.get('environment')) for a in report['attempts']]
        required = [(s['id'], s['command'], s['env']) for s in plan[key[1]]]
        if actual != required:
            raise ValueError('Missing, duplicated, reordered or mismatched scenarios: ' + str(key))
        if report['status'] != 'PASS' or not report['attempts'] or any(a['exitCode'] != 0 or a['retry'] for a in report['attempts']):
            raise ValueError('Incomplete or failed suite: ' + str(key))
        if report['commit'] != commit or report['packageSha256'] != package_sha256 or report['runtimeSha256'] != runtime_sha256:
            raise ValueError('Mixed commit or package: ' + str(key))
        if report['suite'] == 'upgrade':
            baseline=report.get('upgradeBaseline',{})
            if baseline.get('result') != 'PASS' or baseline.get('candidateSha256') != package_sha256:
                raise ValueError('Missing or mismatched direct-upgrade evidence: ' + str(key))
            if not baseline.get('previous',{}).get('sha256') or not baseline.get('previousDllSha256'):
                raise ValueError('Missing previous stable package identity: ' + str(key))
        if require_proxy and report['suite'] == 'server-enforcement' and report.get('proxyMatrix') is not True:
            raise ValueError('Required proxy matrix was not exercised: ' + str(key))
        seen.add(key)
    if seen != expected:
        raise ValueError('Missing required suites: ' + str(sorted(expected - seen)))
    return {'result': 'PASS', 'commit': commit, 'packageSha256': package_sha256,
            'runtimeSha256': runtime_sha256, 'suites': reports}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--package', type=Path, required=True)
    parser.add_argument('--evidence', type=Path, required=True)
    parser.add_argument('--commit', required=True)
    parser.add_argument('--proxy-matrix', choices=('true', 'false'), default='false')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    package_sha256 = hashlib.sha256(args.package.read_bytes()).hexdigest()
    with zipfile.ZipFile(args.package) as package:
        runtime_sha256 = hashlib.sha256(package.read('Jellyfin.Plugin.WatchGuard.dll')).hexdigest()
    reports = [json.loads(p.read_text()) for p in sorted(args.evidence.rglob('suite.json'))]
    result = verify(reports, args.commit, package_sha256, runtime_sha256, args.proxy_matrix == 'true')
    args.output.write_text(json.dumps(result, indent=2) + '\n')
    print(f'PASS: {len(reports)} suites, all required host/suite pairs, package {package_sha256}')
