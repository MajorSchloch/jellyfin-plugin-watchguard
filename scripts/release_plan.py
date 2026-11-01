"""Check release state before any build or fixture starts."""
import argparse
import json
import os
from pathlib import Path
import time

from release_state import GitHub, candidate, inspect, outputs, summary, require


def validate_version(version, manifest, state, changed_files=()):
    number=lambda value: tuple(map(int,value.split('.')))
    published=[v['version'] for p in manifest for v in p['versions']]
    require(not published or number(version+'.0') >= max(map(number,published)),
            'Candidate version is older than the published catalog. Correct Directory.Build.props before qualification.')
    if state == 'complete':
        runtime=[f for f in changed_files if f.startswith('Jellyfin.Plugin.WatchGuard/') or f in
                 ('Directory.Build.props','Directory.Build.targets','global.json','LICENSE',
                  'scripts/browser/build.cjs','scripts/browser/package.json','scripts/browser/package-lock.json')]
        require(not runtime, 'Published version has runtime/package changes: '+', '.join(runtime)+
                '. Prepare a new version; existing release bytes cannot be replaced.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--publish', choices=['true', 'false'], default='false')
    parser.add_argument('--inspect-only', choices=['true', 'false'], default='false')
    parser.add_argument('--metadata-only', action='store_true')
    args = parser.parse_args()
    started = time.monotonic()
    version = candidate()
    outputs(version=version, package=f'Jellyfin.Plugin.WatchGuard-v{version}.zip')
    if args.metadata_only:
        return
    result = {'version': version}
    try:
        api = GitHub(os.environ.get('GITHUB_REPOSITORY', 'MajorSchloch/jellyfin-plugin-watchguard'))
        repo = api.request('')
        raw, _ = api.file('manifest.json', repo['default_branch'])
        manifest=json.loads(raw)
        validate_version(version, manifest, 'pending')
        state = inspect(api, version, manifest)
        if state == 'complete' and args.publish == 'true':
            source=os.environ.get('GITHUB_SHA')
            require(bool(source), 'Source commit is required for automatic release planning.')
            comparison=api.request(f"compare/{api.tag('v'+version)}...{source}")
            files=comparison.get('files',[])
            require(len(files)<300, 'Too many changed files to check published-version safety. Inspect the version manually.')
            validate_version(version,manifest,state,[f['filename'] for f in files])
        # Validation always remains available, even for published versions.
        qualify = args.inspect_only == 'false' and (args.publish == 'false' or state in ('unpublished', 'unpublished-or-draft', 'draft'))
        result.update(state=state, qualify=qualify, preservedDrafts=getattr(api, 'preserved_drafts', []), draftVisibility=api.can_see_drafts())
        outputs(qualify=qualify, state=state)
        action = {'unpublished-or-draft': 'No public release is visible. This token cannot list drafts. Draft state is unknown before approval. This exact merged commit will qualify; any existing conflicting draft will stop publication after approval.',
                  'unpublished': 'Full qualification will test this exact source commit.',
                  'draft': 'Use Re-run failed jobs on the original Publish WatchGuard run. The approved publisher will inspect and resume the draft.',
                  'catalog-missing': 'Use Re-run failed jobs on the original Publish WatchGuard run. Only catalog verification/update remains.',
                  'complete': 'Already published and verified. No publication or catalog writes are needed.'}[state]
        if qualify and args.publish == 'false':
            action += '\nThis explicit validation-only request will still run the complete matrix.'
        if result['preservedDrafts']:
            action += '\nUnrelated drafts remain unchanged: ' + ', '.join(map(str, result['preservedDrafts'])) + '.'
        summary(state, action, version=version)
    except Exception as error:
        result.update(state='blocked', error=str(error))
        summary('Blocked', str(error) + '\nInspect the release state before another attempt.')
        raise
    finally:
        result['elapsedSeconds'] = round(time.monotonic() - started, 3)
        Path('artifacts').mkdir(exist_ok=True)
        Path('artifacts/release-plan.json').write_text(json.dumps(result, indent=2) + '\n')


if __name__ == '__main__':
    main()
