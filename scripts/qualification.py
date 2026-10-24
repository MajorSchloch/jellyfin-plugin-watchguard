"""Reject incomplete or mixed-package qualification evidence before publication."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

VERSIONS = ('12.2', '12.3')
SUITES = ('standalone-caddy', 'migration', 'basepath', 'legacy', 'websocket', 'discovery',
          'verification', 'activity-index', 'server-enforcement', 'server-enforcement-basepath',
          'server-enforcement-linuxserver')


def verify(reports, commit, package_sha256, runtime_sha256, require_proxy=False):
    expected = {(version, suite) for version in VERSIONS for suite in SUITES}
    seen = set()
    for report in reports:
        key = (report['jellyfinVersion'], report['suite'])
        if key not in expected or key in seen:
            raise ValueError('Unexpected or duplicate suite: ' + str(key))
        if report['status'] != 'PASS' or not report['attempts'] or any(a['exitCode'] != 0 or a['retry'] for a in report['attempts']):
            raise ValueError('Incomplete or failed suite: ' + str(key))
        if report['commit'] != commit or report['packageSha256'] != package_sha256 or report['runtimeSha256'] != runtime_sha256:
            raise ValueError('Mixed commit or package: ' + str(key))
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
    print(f'PASS: {len(reports)} suites, both supported hosts, package {package_sha256}')
