"""Measure public checks and local catalog recovery. Never write to GitHub."""
import argparse
import json
from pathlib import Path
import platform
import statistics
import sys
import tempfile
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import catalog
from release_state import GitHub, candidate, digest, inspect, require


def stable_release(release):
    fields = ('id', 'tag_name', 'target_commitish', 'draft', 'prerelease', 'published_at')
    asset_fields = ('id', 'name', 'size', 'digest', 'created_at', 'updated_at')
    return {**{k: release[k] for k in fields}, 'bodySha256': digest((release.get('body') or '').encode()), 'assets': [{k: a[k] for k in asset_fields} for a in release['assets']]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', default='MajorSchloch/jellyfin-plugin-watchguard')
    parser.add_argument('--zip', type=Path, required=True)
    parser.add_argument('--samples', type=int, choices=range(1, 6), default=3)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    api = GitHub(args.repo)
    version = candidate()
    repo = api.request('')
    raw, _ = api.file('manifest.json', repo['default_branch'])
    manifest = json.loads(raw)
    before = [stable_release(r) for r in api.pages('releases') if r['tag_name'] == 'v' + version]
    rows = []
    for sample in range(args.samples):
        start = time.monotonic()
        require(inspect(api, version, manifest) == 'complete', 'Benchmark requires a verified completed release.')
        check_time = time.monotonic() - start
        with tempfile.TemporaryDirectory() as temp:
            target = Path(temp) / 'manifest.json'
            missing = json.loads(raw)
            missing[0]['versions'] = [v for v in missing[0]['versions'] if v['version'] != version + '.0']
            target.write_text(json.dumps(missing))
            start = time.monotonic()
            catalog.add_release(target, args.repo, 'v' + version, args.zip)
            recovery_time = time.monotonic() - start
            recovered = json.loads(target.read_text())
            require(recovered == manifest, 'Recovery differs from the existing catalog.')
            catalog.preserve_history(missing, recovered)
        rows.append(dict(sample=sample+1, publicCheckSeconds=round(check_time,3), localCatalogRecoverySeconds=round(recovery_time,3)))
    after = [stable_release(r) for r in api.pages('releases') if r['tag_name'] == 'v' + version]
    require(before == after, 'Release or draft metadata changed during the benchmark.')
    latest, _ = api.file('manifest.json', repo['default_branch'])
    require(latest == raw, 'Public catalog changed during the benchmark.')
    result = dict(environment=platform.platform(), version=version, packageSha256=digest(args.zip.read_bytes()), samples=rows,
                  publicCheckMedianSeconds=statistics.median(r['publicCheckSeconds'] for r in rows),
                  localCatalogRecoveryMedianSeconds=statistics.median(r['localCatalogRecoverySeconds'] for r in rows),
                  limitations='Local network samples. Recovery writes a temporary manifest only. No release upload, remote catalog commit, approval wait or matrix speedup is measured.',
                  preservedReleases=before, publicCatalogUnchanged=True)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({k:v for k,v in result.items() if k != 'preservedReleases'}, indent=2))


if __name__ == '__main__': main()
