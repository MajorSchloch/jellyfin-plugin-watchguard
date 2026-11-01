# Release operation

Historical instructions and evidence from before the reduced qualification policy. Use [current release operation](release-automation.md) for new releases and recovery.

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

# Qualify a merged runtime fix that keeps the existing unpublished version.
# Directory.Build.props did not change, so no automatic push qualification starts.
gh workflow run release.yaml --ref master -f publish=true -f proxy_matrix=true

# Resume that exact qualification after review. Environment approval remains required.
gh workflow run publish.yaml --ref master -f run_id=123456 -f attempt=1 -f validation_only=false
```

An explicit validation run always remains available. With full proxy coverage, it also runs the publisher's record verifier in read-only mode. A branch rehearsal can verify its own record. It cannot authorize publication, including after a squash merge.

The existing qualification `publish=true` input requests publication after a new qualification. For a draft or catalog recovery, use **Publish WatchGuard** with the original run and attempt. Do not start another matrix for a publication-only failure.

## State and next action

| State | Operation and next action |
|---|---|
| Unpublished candidate | Qualify the exact merged source commit. No tag alone establishes success. |
| Unpublished or hidden draft | The read-only token cannot list drafts. Resume an existing qualification explicitly, or qualify the new candidate. The approved publisher checks all drafts before writes. |
| Existing draft | Use its qualification run and attempt. The publisher verifies the marker, target commit and each existing asset. |
| Qualified | The complete record is available. A validation-only run stops here; a publication request awaits environment approval. |
| Awaiting approval | Review the stated missing operations, then approve the existing `release` environment. |
| Published, catalog missing | Verify public downloads and update only the catalog. Do not rebuild or upload assets. |
| Catalog updated | The manifest contains the verified public release metadata. |
| Already published and verified | No writes occur. The public ZIP, SHA-256 sidecar, asset metadata and catalog entry agree. |
| Blocked | Inspect the stated conflict or missing evidence. Correct the cause, then resume explicitly. No automatic destructive repair occurs. |

A unique published release can be checked without touching an unrelated draft with the same tag. The summary lists those preserved draft IDs. Any write plan rejects multiple matching releases. During development, the live v0.7.11 check found empty draft `429209739` beside published release `429096534`. Both remain unchanged.

## Accepted design: read-only inspection

Read-only inspection is the accepted design. Before release approval, draft state can remain unknown. Inspection jobs must not receive broader tokens. Only the publisher receives write permissions, behind the existing `release` environment approval.

GitHub restricts draft visibility to push access, as described in its [release API documentation](https://docs.github.com/en/rest/releases/releases#list-releases). The hosted check confirmed this behavior: it verified v0.7.11 but could not see the existing empty draft. Inspection jobs retain `contents: read`. The publisher receives `contents: write` only after release-environment approval.

When no public release exists, the preflight reports `unpublished-or-draft`: draft state is unknown, not proof that no draft exists. A read-only publisher cannot plan draft writes from that incomplete list. After approval, the publisher requires draft visibility and inspects the complete state. It rejects conflicts before any write.

This accepted limitation means an invisible draft can cause an explicit qualification request to repeat work. For recovery, use **Publish WatchGuard** with the original qualification run ID and attempt, as shown above. This path verifies the retained record and exact package without a rebuild or another compatibility matrix. Missing or expired evidence still blocks publication. Automatic catalog/documentation commits do not start a matrix. Complete draft detection before qualification is not required; inspection credentials remain read-only.

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

The concurrency comparison uses release identity, tag, target commit, publication state, publication date and qualification markers. For assets, it compares IDs, names, sizes, states, digests and public download URLs, independent of list order. Download counters and unrelated presentation metadata do not affect this comparison. Asset bytes and hashes still require exact verification.

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

### Verified result

[Validation run 41166850534](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/41166850534), attempt 1, passed on `f252d741c4a3bfc6f90706d6f6556a72d09eaa7e`. It used `publish=false` and `proxy_matrix=true`. Build, all 18 integration jobs, the 39-suite gate, provenance sealing and the read-only publisher rehearsal passed.

The [qualification record](evidence/release-automation/qualification-record.json) contains all 39 suites, 54 primary scenarios and exact artifact identities. Package artifact: `13029635495`. Record artifact: `13030018454`. This branch validation does not authorize publication after a merge.

- ZIP SHA-256: `c48fc7150da44e6e37670bd2be41813ee1590c931b29a964a110fdb06e7a534b`.
- DLL SHA-256: `febca265d9dae4e638573377a94b72bd6a7124213bba9bc2f48bc41d3c87eaaa`.
- Fast checks: 376 backend, 203 JavaScript, 77 Python and eight catalog tests passed. Packaging, release-note checks and actionlint 1.7.12 also passed.

The package is byte-identical to published v0.7.11. Public catalog, release, draft and asset metadata remain unchanged. The [summary](evidence/release-automation/summary.json) records these checks and their limits. The later publisher correction below retains this package evidence; it has separate tooling regression coverage.

| Measurement | Observed result |
|---|---:|
| Earlier full run 41063076511, elapsed | 32m 32s |
| New full validation, elapsed | 32m 28s |
| Earlier full run, combined job execution | 6h 09m 21s |
| New full validation, combined job execution | 5h 57m 33s |
| Hosted completed-release inspection, elapsed | 20s |
| Hosted inspection, combined job execution | 12s |
| Hosted public verification within that inspection | 3.053s |
| Hosted publisher rehearsal, complete job | 13s |
| Publisher record/package verification within that job | 6.664s |
| Local public check, median of three samples | 1.668s |
| Local temporary-manifest recovery, median of three samples | 0.511s |

The full matrix retains the same work. These two full runs do not establish a matrix speedup. The new fast path avoids that work for a verified completed release. The hosted inspection skipped build, integration and qualification jobs. Its token could not see private drafts, which the report states explicitly.

The local recovery samples include anonymous metadata, ZIP and checksum checks. They exclude artifact retrieval, release uploads, remote catalog writes and approval waits. No live publication was performed. A separate local verification had a network timeout and retry; it is not part of these timing samples.

See [full timings](evidence/release-automation/qualification-timings.json), [hosted inspection timings](evidence/release-automation/hosted-inspect-final-timings.json), [publisher rehearsal](evidence/release-automation/publisher-rehearsal.json) and [local recovery samples](evidence/release-automation/recovery-timings.json). Timing reports separate elapsed time, combined execution and dependency-ready delay. Publication delay can include environment approval.

### Retained unsuccessful attempts

- [Run 41090215306](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/41090215306) was cancelled during integration after a live API probe found an incorrect download header. Actions artifact ZIP downloads require the normal API header. Release-asset downloads require the binary header. The fix has regression coverage and live read-only verification.
- [Run 41092304009](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/41092304009) passed all 39 suites but failed record sealing. GitHub associated its manual branch run with PR #57. The check incorrectly treated that association as a PR trigger. The corrected verifier checks the actual event, repository, branch and source commit. PR-triggered and fork runs remain ineligible for publication.

Neither run counts as successful workflow qualification. Their original logs and artifacts remain intact. The corrected final run used fresh evidence from one commit and attempt. It did not combine earlier reports or retry native assertions.

### Publisher counter correction

The original concurrency comparison serialized complete asset objects. Authenticated verification and public downloads increased `download_count`, so unchanged assets appeared to change concurrently. The fake API now increments counters for both download paths. Before the correction, the existing 23-test suite reported two failures and four errors. New publication stopped after its first upload; recovery also stopped.

The canonical comparison excludes counters and presentation fields, and normalizes asset order. All 28 publication/provenance tests pass, including new publication, partial uploads, catalog-only recovery and repeated execution. Negative tests retain rejection of changed identities, asset metadata, qualification markers and bytes. Public ZIP and sidecar corruption still prevent catalog writes, even when metadata stays unchanged.

All 82 Python tests, eight catalog tests, release-note validation and whitespace checks pass. No live publication was used. The existing 39-suite compatibility evidence remains unchanged because this correction does not change the plugin package. Read-only inspection and the release-environment permission policy remain unchanged.

### Publisher installation-token correction and v0.7.12 recovery

[Publication run 41230106691, attempt 1, job 124622433564](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/41230106691/job/124622433564) stopped before release writes. Its runner reported `Contents: write`. However, the repository response did not establish `permissions.push === true`. That user-permission field cannot reliably describe the approved job's installation token.

The approved publisher now checks authority through `POST /repos/{owner}/{repo}/releases/generate-notes`. GitHub documents that this endpoint requires **Contents: write** and [does not save its generated notes](https://docs.github.com/en/rest/releases/releases#generate-release-notes-content-for-a-release). The check uses the default branch and a probe name, `watchguard-permission-check`. It creates no tag, draft, asset or catalog commit. The publisher discards the response content. Publication notes still come from the exact qualified commit.

Only the writable publisher uses this check, behind the existing `release` environment approval. No workflow permissions or tokens change. Read-only inspection still uses available metadata and reports unknown draft state when it cannot establish visibility. A successful public release-list request alone never proves complete draft visibility.

The probe retains the existing 60-second API timeout. Permission denial, API failure, timeout, missing branch metadata or an invalid response blocks publication. There is no fallback to assumed authority and no automatic retry. After a successful check, the publisher still enumerates all release pages and rejects ambiguous drafts. Exact provenance, asset bytes, hashes, tag targets and concurrent-change checks remain required.

The regression fixture now inherits the real permission detector and release enumeration. Previously, its unconditional `True` hid this failure. Tests cover missing/false permission metadata, successful publication, partial uploads, catalog-only recovery and repeated execution. Negative cases cover API failures, malformed responses, later inventory-page failures and ambiguous drafts. Existing integrity and provenance assertions remain in place.

Retain [qualification run 41227441169](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/41227441169), **attempt 1**:

- Source commit: `816872c29aa4c0edb38d11c1da9bad93b28471f9`.
- Package artifact: `13052236910`.
- Qualification record artifact: `13053283727`.
- ZIP SHA-256: `e825e51bff1ff5b974ba558379cbfeb7e3f95d0fc688fdedf172c8fa4d24cccd`.
- All 39 compatibility suites passed, with full proxy coverage on Jellyfin 12.2, 12.3 and 12.4.

After this tooling fix reaches `master`, preview recovery:

```sh
gh workflow run publish.yaml --repo MajorSchloch/jellyfin-plugin-watchguard --ref master \
  -f run_id=41227441169 -f attempt=1 -f validation_only=true
```

Review that result. When publication is authorized, request recovery and approve the existing `release` environment:

```sh
gh workflow run publish.yaml --repo MajorSchloch/jellyfin-plugin-watchguard --ref master \
  -f run_id=41227441169 -f attempt=1 -f validation_only=false
```

Use a new publisher run, not a rerun of the failed job's old tooling. The publisher uses the retained qualified commit and package; the tooling-fix commit does not become the release target. This path requires no rebuild or compatibility matrix. It verifies existing assets, resumes only missing operations and stops on conflicts. If publication already completed, it verifies the release and catalog and performs no writes. Missing or expired qualification artifacts still block recovery.

These commands are operator instructions, not actions performed by the fix. Keep the original failed run and its diagnostics. No live publication or release mutation is needed to test this tooling change. The approved job's live permission probe will execute during authorized recovery; local regression tests simulate its API responses.

Validation for this correction: 37 targeted publication/provenance tests, 94 Python tests in total, eight catalog tests, 210 JavaScript tests and 376 backend tests passed. Release-note and package checks passed. The focused new-publication test fails with the original detector and passes with the correction. A read-only provenance check retrieved and verified both artifact IDs above and all 39 retained suite reports. Local packaging produced an identical ZIP and DLL (`847a754bfb55b4da6b8e25ed3957c6df21425aba0c399c1e1b3ca83f82704c61`). No new compatibility matrix ran. The local read-only check used existing operator credentials; its metadata established draft visibility. The workflow inspection token remains read-only, with unknown draft state covered by regression tests.
