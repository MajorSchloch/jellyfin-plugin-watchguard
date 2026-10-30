"""Check release state before any build or fixture starts."""
import argparse
import json
import os
from pathlib import Path
import time

from release_state import GitHub, candidate, inspect, outputs, summary


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
        state = inspect(api, version, json.loads(raw))
        # Validation always remains available, even for published versions.
        qualify = args.inspect_only == 'false' and (args.publish == 'false' or state in ('unpublished', 'unpublished-or-draft'))
        result.update(state=state, qualify=qualify, preservedDrafts=getattr(api, 'preserved_drafts', []), draftVisibility=api.can_see_drafts())
        outputs(qualify=qualify, state=state)
        action = {'unpublished-or-draft': 'No public release is visible. This token cannot list drafts. If this version already qualified, resume Publish WatchGuard with its original run and attempt. Otherwise, qualification can proceed.',
                  'unpublished': 'Full qualification will test this exact source commit.',
                  'draft': 'Resume Publish WatchGuard with the draft qualification run and attempt.',
                  'catalog-missing': 'Resume Publish WatchGuard with the original qualification run and attempt. Only the catalog needs an update.',
                  'complete': 'Already published and verified. No publication or catalog writes are needed.'}[state]
        if qualify and state != 'unpublished':
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
