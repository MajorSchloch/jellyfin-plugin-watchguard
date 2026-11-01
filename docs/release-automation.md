# Release operation

## Normal procedure

1. Prepare the version in `Directory.Build.props`, release copy, catalog summary and preparation notes. Merge the release PR after fast checks pass.
2. **Qualify WatchGuard** starts on the merged commit. Fixes to an unpublished candidate also start qualification; a version-file change is not required. All [required tests](qualification-policy.md) must pass on one exact package and source commit.
3. Approve the existing **release** environment in **Publish WatchGuard**. That workflow verifies the sealed record, publishes the exact ZIP, verifies anonymous downloads and updates the catalog. A completed release reports **already published and verified** without writes.

Inspection remains read-only. Before approval, **draft state unknown** is an accepted result. The approved publisher checks complete draft state before writes. No broader token or PAT is needed.

## Recovery procedure

Open the failed **Publish WatchGuard** run, read the failed step, correct the reported cause, and select **Re-run failed jobs**. Approve the release environment again if GitHub requests it. The publisher retains the original qualification run, attempt and record artifact ID. It reuses verified assets and performs only missing operations. It does not rebuild or repeat the compatibility matrix. Keep the original attempt and its diagnostics.

A conflicting draft, tag, asset, provenance marker or package stops publication. Do not delete or overwrite objects to bypass that check. Missing or expired qualification evidence requires a new complete **Qualify WatchGuard** run on the exact intended source commit. A partial qualification rerun cannot combine evidence from different attempts. Explicit run/attempt dispatch remains available for exceptional, reviewed recovery, but is not needed for ordinary publication retries.

For validation without publication, manually run **Qualify WatchGuard** with `publish=false` and `proxy_matrix=true`. This also works for a published version. `inspect_only=true` checks release state without a build or matrix.

See [policy and implementation](release-operation-policy.md), [required coverage](qualification-policy.md), and [historical operating evidence](release-automation-history.md).
