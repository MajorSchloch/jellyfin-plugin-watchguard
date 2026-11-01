# Post-publication comparison

## Confirmed evidence

[Publication run 41316998829, attempt 1](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/41316998829/attempts/1) failed after the publication PATCH returned. The comparison reported only `Release changed concurrently during publication.` [Job 124879108421](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/41316998829/job/124879108421) retained neither compared snapshot.

GitHub published release `430641593`, tag `v0.7.14`, at `2026-11-01T14:36:44Z`. [Attempt 2](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/41316998829/attempts/2) reports one action: `Update the catalog`. It reused qualification run `41315324546`, attempt `1`, record artifact `13087583576`.

The read-only rehearsals verified that record, its exact package, the release marker, target/tag, authenticated asset bytes, anonymous public downloads and catalog metadata. No release, tag, asset or catalog writes occurred. See [rehearsal evidence](evidence/publication-comparison/resume-rehearsal.json).

## Remaining uncertainty

The original differing field is **unknown**. The later valid release cannot reconstruct the PATCH response or its preceding draft snapshot. A draft download URL change is a hypothesis, not a confirmed incident cause.

The old comparison did require each draft `browser_download_url` to remain unchanged after publication. A deterministic simulation of an `untagged-…` draft URL becoming the canonical public URL reproduces that exact failure. This establishes a comparison defect; it does not prove that GitHub returned that change in this run.

GitHub documents `browser_download_url` as a download location and an asset ID as the asset identifier. Its release API exposes publication state and timestamp. These are separate from package integrity. See [release assets](https://docs.github.com/en/rest/releases/assets#get-a-release-asset) and [release updates](https://docs.github.com/en/rest/releases/releases#update-a-release). A [historical client API trace](https://github.com/sigmavirus24/github3.py/issues/779) shows an `untagged-…` asset location. That trace is supporting observation, not a guaranteed API contract or evidence from this incident.

## Comparison policy

Before publication, validate each draft asset location. Accept only the canonical URL or an `untagged-` hexadecimal location in the same repository with the exact filename. Derive the final URL from the verified repository, tag and asset name.

Publication may change `draft` from true to false, assign a valid UTC publication timestamp, and replace those draft locations with canonical public URLs. The first timestamp is pinned for subsequent reads. Release ID, tag, target commit, prerelease state, qualification markers, asset IDs, names, states, sizes and digests remain exact. Asset bytes are verified again after reconciliation. Counters, asset ordering and unrelated presentation fields remain outside the comparison.

The publication response can retain a known draft asset URL. Readback must converge to canonical public URLs through both the exact release-ID endpoint and the authenticated inventory. Known prior snapshots or absence can also wait. The existing limit remains four rounds, 20 seconds per request and 90 seconds overall. An unknown URL or identity/integrity/provenance conflict stops immediately. There is no repeated PATCH or conflict retry.

Comparisons emit a structured `release_comparison_mismatch` event with a phase and changed field paths. The same object is retained in `publication-result.json`. Diagnostics contain no response values, credentials, release prose or signed URLs. They report at most 32 field paths and the number omitted.

Anonymous public-byte verification and the catalog blob-SHA compare-and-swap remain mandatory. Exact artifact selection, qualification provenance, workflow permissions, read-only inspection and release-environment approval are unchanged.

## Validation and limits

Tests cover the supported URL transition, mixed visibility, exhausted visibility, interrupted publication, partial drafts, catalog-only recovery, malformed/conflicting responses and diagnostic redaction. Existing exact-byte, provenance, permission, concurrency and catalog checks remain blocking.

The [baseline](evidence/publication-comparison/baseline.txt) runs the new simulated transition against master `9579d76334348241c58bdc2efa73f31ade8a459f`. It fails at the original fingerprint assertion. The corrected publisher passes the same test.

The ordinary read-only CLI rehearsal completed in 12.624 seconds. The explicit recovery-path rehearsal completed in 12.307 seconds with 20 authenticated GET calls and anonymous public downloads. Both returned `already published and verified`, with no actions. The final committed-tooling rehearsal completed in 12.127 seconds, also with no writes. These measurements establish recovery behavior, not a publication speedup. See [validation results](evidence/publication-comparison/results.json).

No live release was created for testing. No native compatibility matrix was rerun. The actual next publication transition remains untested until an approved future release. Physical-server behavior is outside this tooling-only change.

The fast checks also found a missing current-release record after catalog publication. [The v0.7.14 record](release-v0714.md) now links the existing release notes and qualification evidence. Runtime, version, public catalog and published assets remain unchanged.
