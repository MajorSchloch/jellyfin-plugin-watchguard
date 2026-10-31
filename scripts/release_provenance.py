"""Bind qualification to one repository, source commit, run, attempt and artifact set."""
import io
import json
import os
from pathlib import Path
import zipfile

import catalog
import qualification
from release_state import candidate, digest, filename, require

WORKFLOW = '.github/workflows/release.yaml'


def artifact_name(kind, attempt):
    return f'WatchGuard-{kind}-attempt-{attempt}'


def check_run(api, run, attempt, allow_branch=False):
    repo = api.request('')
    require(run['repository']['full_name'] == api.repo and run['head_repository']['full_name'] == api.repo,
            'Untrusted qualification repository.')
    require(run['path'].split('@')[0] == WORKFLOW and run['event'] in ('push', 'workflow_dispatch'),
            'Untrusted qualification workflow or event. PR artifacts cannot publish.')
    require(run['run_attempt'] == attempt, 'Qualification attempt does not match.')
    require(allow_branch or run['head_branch'] == repo['default_branch'], 'Only default-branch qualification can publish.')
    # Associated PRs are metadata, even for a manual branch rehearsal or a
    # merged default-branch push. Trust comes from event, repository, branch
    # and exact-commit checks above, not an empty association list.
    if not allow_branch:
        comparison = api.request(f"compare/{run['head_sha']}...{repo['default_branch']}")
        require(comparison['status'] in ('ahead', 'identical'), 'Qualified commit is not on the default branch.')
    return repo


def check_artifact(asset, name, run, repository_id):
    require(asset['name'] == name and not asset['expired'], 'Missing, expired or misnamed artifact: ' + name)
    origin = asset['workflow_run']
    require(origin['id'] == run['id'] and origin['head_sha'] == run['head_sha'] and
            origin['repository_id'] == repository_id and origin['head_repository_id'] == repository_id,
            'Artifact provenance differs from qualification: ' + name)
    require(isinstance(asset.get('digest'), str) and asset['digest'].startswith('sha256:'), 'Artifact lacks a GitHub digest: ' + name)


def one_artifact(inventory, name, run, repository_id):
    matches = [a for a in inventory if a['name'] == name]
    require(len(matches) == 1, 'Missing or duplicate artifact: ' + name + '. Requalify the exact commit if it expired.')
    check_artifact(matches[0], name, run, repository_id)
    return matches[0]


def extract(api, asset, names):
    content = api.request(f"actions/artifacts/{asset['id']}/zip", binary=True)
    require('sha256:' + digest(content) == asset['digest'], 'Downloaded artifact digest mismatch.')
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        require(sorted(archive.namelist()) == sorted(names), 'Unexpected artifact contents.')
        return {name: archive.read(name) for name in names}


def expected_evidence(attempt):
    return [artifact_name(f'evidence-{host}-{shard}', attempt)
            for host in qualification.VERSIONS for shard in qualification.SHARDS]


def verify_jobs(api, run, attempt, include_gate):
    jobs = api.pages(f"actions/runs/{run['id']}/attempts/{attempt}/jobs", 'jobs')
    required = ['build'] + [f'Integration / {host} / {shard}' for host in qualification.VERSIONS for shard in qualification.SHARDS]
    if include_gate:
        required.append('Verify complete compatibility evidence')
    for name in required:
        matches = [j for j in jobs if j['name'] == name]
        require(len(matches) == 1 and matches[0]['conclusion'] == 'success' and matches[0]['run_attempt'] == attempt,
                'Required job did not pass in this attempt: ' + name + '. Preserve its failure evidence; do not reuse another attempt.')


def seal(api, result, package_id, attempt, publish_requested):
    run = api.request(f"actions/runs/{os.environ['GITHUB_RUN_ID']}/attempts/{attempt}")
    repo = check_run(api, run, attempt, allow_branch=True)
    verify_jobs(api, run, attempt, include_gate=False)
    inventory = api.pages(f"actions/runs/{run['id']}/artifacts", 'artifacts')
    package = one_artifact(inventory, artifact_name('package', attempt), run, repo['id'])
    require(package['id'] == package_id, 'Build artifact ID changed.')
    evidence = [one_artifact(inventory, name, run, repo['id']) for name in expected_evidence(attempt)]
    for report in result['suites']:
        require(report.get('origin') == {'repository': api.repo, 'run': run['id'], 'attempt': attempt},
                'Suite evidence comes from another run or attempt.')
    return dict(schemaVersion=1, repository=api.repo, sourceCommit=run['head_sha'], run=run['id'], attempt=attempt,
                workflow=WORKFLOW, version=candidate(), publishRequested=publish_requested,
                supportedHosts=list(qualification.VERSIONS), suiteInventory=qualification.PLAN,
                proxyMatrix=all(r.get('proxyMatrix') for r in result['suites'] if r['suite'] == 'server-enforcement'),
                packageArtifact=package, evidenceArtifacts=evidence, qualification=result)


def load(api, run_id, attempt, folder, allow_branch=False, allow_validation=False):
    run = api.request(f'actions/runs/{run_id}/attempts/{attempt}')
    repo = check_run(api, run, attempt, allow_branch)
    verify_jobs(api, run, attempt, include_gate=True)
    inventory = api.pages(f'actions/runs/{run_id}/artifacts', 'artifacts')
    record_asset = one_artifact(inventory, artifact_name('qualification', attempt), run, repo['id'])
    record = json.loads(extract(api, record_asset, ['qualification-record.json'])['qualification-record.json'])
    require(record['schemaVersion'] == 1 and record['repository'] == api.repo and record['sourceCommit'] == run['head_sha'] and
            record['run'] == run_id and record['attempt'] == attempt and record['workflow'] == WORKFLOW,
            'Qualification record provenance mismatch.')
    require(record['supportedHosts'] == list(qualification.VERSIONS) and record['suiteInventory'] == qualification.PLAN,
            'Qualification inventory differs from the required matrix.')
    require_proxy = not (allow_validation and record.get('publishRequested') is False)
    require(not require_proxy or record['proxyMatrix'] is True, 'Publication requires the full proxy matrix. Run validation with proxy_matrix=true.')
    metadata, _ = api.file('Directory.Build.props', run['head_sha'])
    require(candidate(metadata) == record['version'], 'Qualified source version differs from record.')
    expected = [artifact_name('package', attempt)] + expected_evidence(attempt)
    recorded = [record['packageArtifact']] + record['evidenceArtifacts']
    require([a['name'] for a in recorded] == expected, 'Artifact inventory is incomplete or duplicated.')
    for asset in recorded:
        current = one_artifact(inventory, asset['name'], run, repo['id'])
        require(all(current[k] == asset[k] for k in ('id', 'digest', 'size_in_bytes')), 'Artifact identity changed.')
    name = filename(record['version'])
    content = extract(api, record['packageArtifact'], [name, name + '.sha256'])
    folder.mkdir(parents=True, exist_ok=True)
    for file, value in content.items():
        (folder / file).write_bytes(value)
    archive = folder / name
    _, sha = catalog.inspect_zip(archive)
    require(content[name + '.sha256'].decode().split() == [sha, name], 'Qualified sidecar mismatch.')
    with zipfile.ZipFile(archive) as package:
        dll = digest(package.read(catalog.DLL))
    result = record['qualification']
    require(result['result'] == 'PASS' and result['commit'] == run['head_sha'] and
            result['packageSha256'] == sha and result['runtimeSha256'] == dll, 'Qualified package hash mismatch.')
    qualification.verify(result['suites'], run['head_sha'], sha, dll, require_proxy)
    for report in result['suites']:
        require(report.get('origin') == {'repository': api.repo, 'run': run_id, 'attempt': attempt}, 'Mixed suite provenance.')
    record['recordArtifactId'] = record_asset['id']
    return record, archive
