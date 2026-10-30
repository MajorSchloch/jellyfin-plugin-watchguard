"""Resume publication from an explicit qualification run. Read-only unless --write is set."""
import argparse
import base64
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time

import catalog
import release_provenance
from release_state import (Blocked, GitHub, assets, candidate, digest, filename, inspect,
                           outputs, public_package, require, summary)


def marker(record):
    return f"<!-- watchguard-qualified:{record['run']}:{record['attempt']}:{record['sourceCommit']}:{record['qualification']['packageSha256']} -->"


def fingerprint(release):
    if release is None:
        return None
    return json.dumps({key: release[key] for key in ('id', 'tag_name', 'target_commitish', 'draft', 'prerelease',
                                                     'published_at', 'body', 'assets')}, sort_keys=True)


def verify_existing(api, record, archive, release):
    if release is None:
        return
    require(marker(record) in (release.get('body') or ''), 'Release lacks this qualification marker. Inspect provenance manually; no overwrite is permitted.')
    require(release['target_commitish'] == record['sourceCommit'], 'Release target differs from the exact qualified commit.')
    tag = api.tag('v' + record['version'])
    require(tag in (None, record['sourceCommit']), 'Tag differs from the exact qualified commit.')
    if not release['draft']:
        require(tag == record['sourceCommit'], 'Published tag does not resolve to the qualified commit.')
    files = assets(release, record['version'])
    for name, asset in files.items():
        expected = (archive.parent / name).read_bytes()
        content = api.request(f"releases/assets/{asset['id']}", binary=True)
        require(content == expected and asset['size'] == len(expected) and asset.get('digest') == 'sha256:' + digest(expected),
                'Existing asset bytes conflict: ' + name + '. No replacement is permitted.')


def unchanged(api, version, previous):
    require(fingerprint(api.release(version)) == fingerprint(previous), 'Release state changed concurrently. Inspect it, then resume explicitly.')


def resume(api, record, archive, write=False):
    require(not write or api.writable, 'Publication requires explicit write authority.')
    version = record['version']
    repo = api.request('')
    branch = repo['default_branch']
    metadata, _ = api.file('Directory.Build.props', branch)
    require(candidate(metadata) == version, 'Default branch now prepares a different version. Inspect release order manually.')
    raw, manifest_sha = api.file('manifest.json', branch)
    manifest = json.loads(raw)
    release = api.release(version)
    verify_existing(api, record, archive, release)
    actions = []
    if release is None:
        actions.append('Create the intended draft')
        if write:
            notes, _ = api.file(f'docs/releases/v{version}.md', record['sourceCommit'])
            unchanged(api, version, release)
            api.request('releases', 'POST', {'tag_name': 'v' + version, 'target_commitish': record['sourceCommit'],
                        'name': 'WatchGuard v' + version, 'body': notes.decode() + '\n\n' + marker(record), 'draft': True})
            release = api.release(version)
            verify_existing(api, record, archive, release)
    files = assets(release, version) if release else {}
    for name in (archive.name, archive.name + '.sha256'):
        if name in files:
            continue
        require(release is None or release['draft'], 'Published asset is missing. Inspect it manually; uploads require the intended draft.')
        actions.append('Upload missing ' + name)
        if write:
            unchanged(api, version, release)
            # No --clobber: GitHub rejects a duplicate name if another writer wins.
            subprocess.run(['gh', 'release', 'upload', 'v' + version, str(archive.parent / name), '--repo', api.repo], check=True, timeout=60)
            current = api.release(version)
            require(current['id'] == release['id'] and current['draft'], 'Release identity changed during upload.')
            release = current
            verify_existing(api, record, archive, release)
    if release is None or release['draft']:
        actions.append('Publish the verified draft')
        if write:
            require(set(assets(release, version)) == {archive.name, archive.name + '.sha256'}, 'Draft assets are incomplete.')
            unchanged(api, version, release)
            api.request(f"releases/{release['id']}", 'PATCH', {'draft': False})
            release = api.release(version)
            verify_existing(api, record, archive, release)
            summary('Published', 'Verify the public downloads, then update the catalog.', version=version)
    if release and not release['draft']:
        # Public verification remains anonymous, including on a catalog-only resume.
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'manifest.json'
            path.write_bytes(raw)
            catalog.add_release(path, api.repo, 'v' + version, archive)
            updated = path.read_bytes()
            catalog.preserve_history(manifest, json.loads(updated))
        if json.loads(updated) == manifest:
            return 'already published and verified', actions
        actions.append('Update the catalog')
        if write:
            unchanged(api, version, release)
            # The blob SHA is a compare-and-swap. A concurrent manifest update
            # fails rather than losing another version or forcing a branch push.
            api.request('contents/manifest.json', 'PUT', {'message': 'Update WatchGuard catalog for v' + version,
                        'content': base64.b64encode(updated).decode(), 'sha': manifest_sha, 'branch': branch})
            return 'catalog updated', actions
    else:
        actions.append('Verify public downloads and update the catalog after publication')
    return ('awaiting approval' if not write else 'published'), actions


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', default=os.environ.get('GITHUB_REPOSITORY', 'MajorSchloch/jellyfin-plugin-watchguard'))
    parser.add_argument('--run', type=int, required=True)
    parser.add_argument('--attempt', type=int, required=True)
    parser.add_argument('--write', action='store_true')
    parser.add_argument('--automatic', action='store_true')
    parser.add_argument('--verify-record', action='store_true', help='Verify the exact artifact even when the public release is complete')
    parser.add_argument('--validate-branch', action='store_true', help='Read-only branch rehearsal; never publication authority')
    parser.add_argument('--output', type=Path, default=Path('artifacts/publication-result.json'))
    args = parser.parse_args()
    started = time.monotonic()
    result = {'run': args.run, 'attempt': args.attempt, 'write': args.write}
    try:
        require(not (args.write and args.validate_branch), 'Branch rehearsals cannot publish.')
        api = GitHub(args.repo, writable=args.write)
        # Resolve the requested version from the explicit source run, not latest.
        run = api.request(f'actions/runs/{args.run}/attempts/{args.attempt}')
        repo = release_provenance.check_run(api, run, args.attempt, args.validate_branch)
        source, _ = api.file('Directory.Build.props', run['head_sha'])
        version = candidate(source)
        raw, _ = api.file('manifest.json', repo['default_branch'])
        state = inspect(api, version, json.loads(raw))
        recorded = []
        if state == 'complete' and not args.verify_record:
            inventory = api.pages(f'actions/runs/{args.run}/artifacts', 'artifacts')
            recorded = [a for a in inventory if a['name'] == release_provenance.artifact_name('qualification', args.attempt)]
        if state == 'complete' and not args.verify_record and not recorded:
            # Existing catalog + public bytes are enough for a no-write result.
            # This does not qualify or promote any new source commit.
            result.update(state='already published and verified', version=version, actions=[])
            outputs(publish=False)
        else:
            with tempfile.TemporaryDirectory() as temp:
                record, archive = release_provenance.load(api, args.run, args.attempt, Path(temp), args.validate_branch)
                if state == 'complete':
                    release = api.release(version, public_only=True)
                    public = public_package(api, release, version, Path(temp) / 'public')
                    require(public.read_bytes() == archive.read_bytes(), 'Qualified ZIP conflicts with the completed public release.')
                    result.update(state='already published and verified', version=version, actions=[],
                                  packageSha256=record['qualification']['packageSha256'], recordArtifactId=record['recordArtifactId'])
                    outputs(publish=False)
                elif args.automatic and not record['publishRequested']:
                    result.update(state='qualified', actions=['Validation-only run. No publication was requested.'])
                    outputs(publish=False)
                else:
                    state, actions = resume(api, record, archive, args.write)
                    result.update(state=state, actions=actions, version=version, commit=record['sourceCommit'],
                                  packageSha256=record['qualification']['packageSha256'], recordArtifactId=record['recordArtifactId'])
                    outputs(publish=state != 'already published and verified' and not args.validate_branch)
        result['preservedDrafts'] = getattr(api, 'preserved_drafts', [])
        summary(result['state'], '\n'.join(result['actions']) or 'No writes are needed.', run=args.run, attempt=args.attempt)
    except Exception as error:
        result.update(state='blocked', error=str(error))
        summary('Blocked', str(error) + '\nInspect the retained evidence. Resume with the explicit run and attempt after correction.')
        raise
    finally:
        result['elapsedSeconds'] = round(time.monotonic() - started, 3)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, indent=2) + '\n')


if __name__ == '__main__':
    main()
