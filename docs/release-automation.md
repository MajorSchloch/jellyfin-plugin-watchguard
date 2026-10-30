# Release operation

This workflow change does not prepare a plugin release. The candidate version remains in `Directory.Build.props`. The public v0.7.11 assets and catalog stay unchanged.

## Normal operation

1. Prepare the version metadata, maintained catalog summary and publication notes in a PR.
2. Let the automatic PR checks finish.
3. Merge the prepared version into `master`.
4. Review the full qualification results and the publication plan.
5. Approve the `release` environment when publication is appropriate.

A version-metadata change on `master` starts **Qualify WatchGuard**. Its first job checks public release state before any build or fixture. A new candidate receives one build plus the intentional deterministic rebuild comparison. The same package then passes through all 39 suites on Jellyfin 12.2, 12.3 and 12.4. Automatic release qualification always includes the full proxy matrix.

The strict gate retains all 13 suites, six shards per host and 54 primary fixture commands. Historical comparisons, native polling, browser assertions, permission checks and failure diagnostics remain unchanged.

After successful qualification, **Publish WatchGuard** starts from the workflow completion event. Its read-only job verifies the exact record and reports the next actions. The write job retains the `release` environment approval and the global `watchguard-release` lock. It checks state again after approval.

Documentation and catalog changes do not trigger automatic qualification. The generated catalog commit cannot create a qualification loop. The normal build workflow still runs once per PR update, on master pushes and on manual requests.

## Manual commands

Use the default branch for publication. Replace each example run ID and attempt with the intended qualification record.

```sh
# Full validation, including an already published version. No publication.
gh workflow run release.yaml --ref master -f publish=false -f proxy_matrix=true

# Read-only state check. No build or matrix.
gh workflow run release.yaml --ref master -f inspect_only=true

# Preview an explicit publication or recovery. No writes.
gh workflow run publish.yaml --ref master -f run_id=123456 -f attempt=1 -f validation_only=true

# Resume that exact qualification after review. Environment approval remains required.
gh workflow run publish.yaml --ref master -f run_id=123456 -f attempt=1 -f validation_only=false
```

An explicit validation run always remains available. With full proxy coverage, it also runs the publisher's record verifier in read-only mode. A branch rehearsal can verify its own record. It cannot authorize publication, including after a squash merge.

The existing qualification `publish=true` input requests publication after a new qualification. For a draft or catalog recovery, use **Publish WatchGuard** with the original run and attempt. Do not start another matrix for a publication-only failure.

## State and next action

| State | Operation and next action |
|---|---|
| Unpublished candidate | Qualify the exact merged source commit. No tag alone establishes success. |
| Existing draft | Use its qualification run and attempt. The publisher verifies the marker, target commit and each existing asset. |
| Qualified | The complete record is available. A validation-only run stops here; a publication request awaits environment approval. |
| Awaiting approval | Review the stated missing operations, then approve the existing `release` environment. |
| Published, catalog missing | Verify public downloads and update only the catalog. Do not rebuild or upload assets. |
| Catalog updated | The manifest contains the verified public release metadata. |
| Already published and verified | No writes occur. The public ZIP, SHA-256 sidecar, asset metadata and catalog entry agree. |
| Blocked | Inspect the stated conflict or missing evidence. Correct the cause, then resume explicitly. No automatic destructive repair occurs. |

A unique published release can be checked without touching an unrelated draft with the same tag. The summary lists those preserved draft IDs. Any write plan rejects multiple matching releases. During development, the live v0.7.11 check found empty draft `429209739` beside published release `429096534`. Both remain unchanged.

## Qualification record and trust

The record contains the repository, source commit, run, attempt, version, package/DLL hashes, artifact IDs and GitHub artifact digests. It also contains the supported hosts, complete suite inventory, proxy coverage and all gate reports. Suite reports carry their own repository/run/attempt origin.

The publisher requires an explicit run and attempt. It verifies these against the GitHub API, including the exact workflow path and each successful job. Publication requires a push or manual run from the same repository's default branch. The qualified commit must remain on that branch. PR and fork artifacts cannot authorize publication.

Package, record and evidence names include the attempt. The record lists exact artifact IDs. The publisher checks availability, origin, IDs, archive digests and archive contents. It repeats the strict 39-suite gate against the downloaded package and extracted DLL. It never selects the newest artifact or combines attempts.

A record cannot qualify a squash-merge commit because its version or runtime hash happens to match. The automatic path qualifies the merged commit itself. The release target and tag must match that exact commit.

A completed historical release can pass the read-only public/catalog check without a new-format record. This does not qualify the requested source commit or authorize a new write. When a new-format record exists, its package must also match the completed public release. Legacy catalog recovery remains documented in [catalog recovery](catalog-recovery.md).

Missing or expired evidence blocks an incomplete release's publication. Preserve the original failure diagnostics. Requalify the exact intended commit if the required artifacts have expired. Do not substitute artifacts from another commit. A qualification rerun must run all jobs in a new attempt; partial reruns cannot combine earlier evidence with later results. Publication recovery uses a new publisher run, leaving the original matrix and failure records intact.

## Resume and concurrency rules

A draft contains a marker that binds it to the qualification run, attempt, source commit and package hash. Existing draft assets must match the qualified bytes and GitHub SHA-256 metadata. Uploads add only missing assets. There is no replacement flag.

The publisher checks state before each write and after each release operation. Unknown assets, partial asset states, conflicting bytes, different tags and unrelated draft markers stop the operation. GitHub also rejects duplicate asset names. Nothing deletes a release, tag or asset.

GitHub does not provide a transaction across release, asset and catalog operations. The global workflow lock serializes these publishers. A concurrent external change can still cause a safe failure. Inspect that change before an explicit resume.

Catalog recovery uses the existing anonymous verifier and bounded public-download retries. It preserves installation history. The final Contents API request includes the previous manifest blob SHA, so a concurrent manifest change is rejected. If the manifest already agrees, the publisher makes no commit.

The 120-second public-download budget remains unchanged. A longer outage requires a later explicit recovery. Authenticated API calls have separate 60-second request bounds; workflow jobs also have finite timeouts. No retry wraps a failed test or a release mutation.

## Unresolved native menu failure

[Run 41075911155, attempt 1, job 124132556154](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/41075911155/job/124132556154) failed in `12.3 / standalone-discovery`.

The original browser assertion timed out after 10,000 ms at `tests/browser-poc.cjs:1032`. It waited for `.actionSheet.opened .watchguard-native-action` with the exact text “Remove from Watchlist”. The cause remains unresolved. This tooling change does not retry that assertion, add delays, extend its timeout or change menu behavior.

## Validation and timing

Measurements and hosted validation results are recorded in the PR and the accompanying evidence file. Public checks and recovery rehearsals perform no GitHub writes. A catalog-recovery rehearsal updates only a temporary local manifest. It does not measure a real publication or an environment approval wait.

The earlier [CI efficiency report](ci-efficiency.md) remains historical evidence. Its matrix measurements are not a prediction for every run. The new fast path avoids builds and fixtures for a verified completed release; the full matrix itself retains its work and limits.

GitHub's [artifact API](https://docs.github.com/en/rest/actions/artifacts) supplies artifact IDs, digests and run origin. The [workflow-run API](https://docs.github.com/en/rest/actions/workflow-runs) supplies exact attempts and jobs. Those API checks accompany the record; a JSON claim alone is not publication authority.
