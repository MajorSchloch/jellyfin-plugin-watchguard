"""Resume publication from an explicit qualification run. Read-only unless --write is set."""
import argparse
import base64
import copy
import json
import os
from pathlib import Path
import re
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
    # Downloads change counters, and GitHub does not promise asset list order.
    # Compare identity/integrity and provenance, not presentation or activity.
    snapshot = {key: release[key] for key in ('id', 'tag_name', 'target_commitish', 'draft', 'prerelease', 'published_at')}
    snapshot['qualificationMarkers'] = sorted(re.findall(
        r'<!--\s*watchguard-qualified\b.*?(?:-->|$)', release.get('body') or '', flags=re.DOTALL))
    snapshot['assets'] = sorted(
        ({key: asset.get(key) for key in ('id', 'name', 'size', 'state', 'digest', 'browser_download_url')}
         for asset in release['assets']), key=lambda asset: json.dumps(asset, sort_keys=True))
    return json.dumps(snapshot, sort_keys=True)


def verify_existing(api, record, archive, release):
    if release is None:
        return
    require(re.findall(r'<!--\s*watchguard-qualified\b.*?(?:-->|$)', release.get('body') or '', flags=re.DOTALL) == [marker(record)], 'Release lacks this qualification marker. Inspect provenance manually; no overwrite is permitted.')
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


def reconcile(api, version, expected, previous=None):
    """Read our exact write back; tolerate only absence or its known prior state.

    Both the ID endpoint and complete authenticated inventory must converge.
    A different object/marker/asset is a conflict, never a reason to retry.
    Four rounds, at most 20 seconds per API request and 90 seconds overall.
    """
    require(isinstance(expected, dict) and isinstance(expected.get('id'), int),
            'GitHub did not return the intended release. Re-run failed jobs to inspect it; do not recreate it.')
    deadline = time.monotonic() + 90
    old_deadline = getattr(api, 'deadline', None)
    api.deadline = deadline
    try:
        for attempt in range(4):
            exact = api.request(f"releases/{expected['id']}", missing=True)
            matches = [r for r in api.pages('releases') if r['tag_name'] == 'v' + version]
            require(len(matches) <= 1, 'Multiple releases use this tag. Inspect them manually.')
            listed = matches[0] if matches else None
            for value in (exact, listed):
                require(value is None or fingerprint(value) in (fingerprint(previous), fingerprint(expected)),
                        'Release state changed concurrently during write reconciliation. No further writes were made.')
            if all(value is not None and fingerprint(value) == fingerprint(expected) for value in (exact, listed)):
                return exact
            if attempt < 3:
                time.sleep(1 + attempt)
        raise Blocked('Release write is not yet visible consistently. Re-run failed jobs; the intended draft and assets are retained.')
    finally:
        api.deadline = old_deadline


def resume(api, record, archive, write=False):
    require(not write or api.writable, 'Publication requires explicit write authority.')
    require(not write or api.can_see_drafts(), 'Cannot inspect all drafts with this token. Use the approved publisher with contents:write.')
    version = record['version']
    repo = api.request('')
    branch = repo['default_branch']
    metadata, _ = api.file('Directory.Build.props', branch)
    require(candidate(metadata) == version, 'Default branch now prepares a different version. Inspect release order manually.')
    raw, manifest_sha = api.file('manifest.json', branch)
    manifest = json.loads(raw)
    release = api.release(version)
    verify_existing(api, record, archive, release)
    if release is None and not write and not api.can_see_drafts():
        return 'awaiting approval', ['After approval, inspect draft state against this qualified record. Create or upload only verified missing objects. No draft writes can be planned from this token’s incomplete release list.']
    actions = []
    if release is None:
        actions.append('Create the intended draft')
        if write:
            notes, _ = api.file(f'docs/releases/v{version}.md', record['sourceCommit'])
            unchanged(api, version, release)
            release = api.request('releases', 'POST', {'tag_name': 'v' + version, 'target_commitish': record['sourceCommit'],
                        'name': 'WatchGuard v' + version, 'body': notes.decode() + '\n\n' + marker(record), 'draft': True})
            require(release is not None and release.get('draft') is True and release.get('tag_name') == 'v' + version, 'Invalid draft creation response.')
            verify_existing(api, record, archive, release)
            release = reconcile(api, version, release)
    files = assets(release, version) if release else {}
    for name in (archive.name, archive.name + '.sha256'):
        if name in files:
            continue
        require(release is None or release['draft'], 'Published asset is missing. Inspect it manually; uploads require the intended draft.')
        actions.append('Upload missing ' + name)
        if write:
            unchanged(api, version, release)
            # GitHub rejects duplicate names; this targets the verified ID.
            uploaded = api.upload(release['id'], archive.parent / name)
            require(isinstance(uploaded, dict) and uploaded.get('name') == name, 'Invalid asset upload response. Re-run failed jobs to inspect the retained draft.')
            expected = copy.deepcopy(release)
            expected['assets'].append(uploaded)
            release = reconcile(api, version, expected, release)
            verify_existing(api, record, archive, release)
    if release is None or release['draft']:
        actions.append('Publish the verified draft')
        if write:
            require(set(assets(release, version)) == {archive.name, archive.name + '.sha256'}, 'Draft assets are incomplete.')
            unchanged(api, version, release)
            published = api.request(f"releases/{release['id']}", 'PATCH', {'draft': False})
            require(isinstance(published, dict) and published.get('id') == release['id'] and published.get('draft') is False, 'Invalid publication response.')
            expected = copy.deepcopy(release)
            expected.update(draft=False, published_at=published.get('published_at'))
            require(fingerprint(published) == fingerprint(expected), 'Release changed concurrently during publication.')
            release = reconcile(api, version, published, release)
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
    parser.add_argument('--attempt', type=int, help='Original qualification attempt; automatic handoff resolves the sole sealed record')
    parser.add_argument('--record-id', type=int, help='Pinned record artifact ID from read-only inspection')
    parser.add_argument('--write', action='store_true')
    parser.add_argument('--automatic', action='store_true')
    parser.add_argument('--verify-record', action='store_true', help='Verify the exact artifact even when the public release is complete')
    parser.add_argument('--validate-branch', action='store_true', help='Read-only branch rehearsal; never publication authority')
    parser.add_argument('--output', type=Path, default=Path('artifacts/publication-result.json'))
    args = parser.parse_args()
    started = time.monotonic()
    result = {'qualificationRun': args.run, 'qualificationAttempt': args.attempt, 'write': args.write,
              'publicationRun': os.environ.get('GITHUB_RUN_ID'), 'publicationAttempt': os.environ.get('GITHUB_RUN_ATTEMPT')}
    try:
        require(not (args.write and args.validate_branch), 'Branch rehearsals cannot publish.')
        api = GitHub(args.repo, writable=args.write)
        if args.automatic and args.attempt is None:
            event_run = api.request(f'actions/runs/{args.run}')
            jobs = api.pages(f"actions/runs/{args.run}/attempts/{event_run['run_attempt']}/jobs", 'jobs')
            gates = [j for j in jobs if j['name'] == 'Verify complete compatibility evidence']
            inventory = api.pages(f'actions/runs/{args.run}/artifacts', 'artifacts')
            has_seal = any(re.fullmatch(r'WatchGuard-qualification-attempt-\d+', a['name']) for a in inventory)
            if not has_seal and gates and all(j['conclusion'] == 'skipped' for j in gates):
                result.update(state='checked', actions=['No qualification was requested. No publication writes.'])
                outputs(publish=False)
                summary('Checked', result['actions'][0])
                return
        if args.attempt is None:
            require(args.automatic, 'Explicit recovery requires the original qualification attempt.')
            args.attempt, resolved_id = release_provenance.sealed_attempt(api, args.run)
            require(args.record_id in (None, resolved_id), 'Sealed record identity changed.')
            args.record_id = resolved_id
        result['qualificationAttempt'] = args.attempt
        # Resolve the requested version from the explicit source run, not latest.
        run = api.request(f'actions/runs/{args.run}/attempts/{args.attempt}')
        repo = release_provenance.check_run(api, run, args.attempt, args.validate_branch)
        source, _ = api.file('Directory.Build.props', run['head_sha'])
        version = candidate(source)
        if args.automatic:
            jobs = api.pages(f'actions/runs/{args.run}/attempts/{args.attempt}/jobs', 'jobs')
            gates = [j for j in jobs if j['name'] == 'Verify complete compatibility evidence']
            if not gates or all(j['conclusion'] == 'skipped' for j in gates):
                result.update(state='checked', actions=['No qualification ran. No publication was requested.'])
                outputs(publish=False)
                summary('Checked', result['actions'][0], run=args.run, attempt=args.attempt)
                return
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
                record, archive = release_provenance.load(api, args.run, args.attempt, Path(temp), args.validate_branch, allow_validation=args.automatic)
                require(args.record_id in (None, record['recordArtifactId']), 'Sealed qualification record identity changed.')
                outputs(qualification_run=args.run, qualification_attempt=args.attempt, record_id=record['recordArtifactId'])
                if args.automatic and not record['publishRequested']:
                    result.update(state='qualified', actions=['Validation-only run. No publication was requested.'])
                    outputs(publish=False)
                elif state == 'complete':
                    release = api.release(version, public_only=True)
                    public = public_package(api, release, version, Path(temp) / 'public')
                    require(public.read_bytes() == archive.read_bytes(), 'Qualified ZIP conflicts with the completed public release.')
                    result.update(state='already published and verified', version=version, actions=[],
                                  packageSha256=record['qualification']['packageSha256'], recordArtifactId=record['recordArtifactId'])
                    outputs(publish=False)
                else:
                    state, actions = resume(api, record, archive, args.write)
                    result.update(state=state, actions=actions, version=version, commit=record['sourceCommit'],
                                  packageSha256=record['qualification']['packageSha256'], recordArtifactId=record['recordArtifactId'])
                    outputs(publish=state != 'already published and verified' and not args.validate_branch)
        result['preservedDrafts'] = getattr(api, 'preserved_drafts', [])
        result['draftVisibility'] = api.can_see_drafts()
        details = {key: result[key] for key in ('qualificationRun', 'qualificationAttempt', 'publicationRun', 'publicationAttempt', 'version', 'commit', 'packageSha256', 'recordArtifactId') if key in result}
        summary(result['state'], '\n'.join(result['actions']) or 'No writes are needed.', **details)
    except Exception as error:
        result.update(state='blocked', error=str(error))
        summary('Blocked', str(error) + '\nKeep the original failure evidence. After correction, use Re-run failed jobs on Publish WatchGuard. Missing or expired evidence requires qualification of the exact source commit again.')
        raise
    finally:
        result['elapsedSeconds'] = round(time.monotonic() - started, 3)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, indent=2) + '\n')


if __name__ == '__main__':
    main()
