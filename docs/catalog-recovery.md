# Recover a published release's catalog entry

Release publication and the catalog commit are separate workflow steps. A release can be public before its assets are available from every download endpoint. curl's standard `--retry` does not retry HTTP 404; v0.7.11's checksum request failed less than two seconds after publication, so the manifest commit never ran.

## Recovery procedure

1. Confirm that build, every integration job and the complete-evidence gate passed for the publication run. Record its commit, validated artifact ID and expected ZIP SHA-256. Start a small branch from current master.
2. Download that run's `WatchGuard-v<version>-validated` artifact, keeping its ZIP and `.zip.sha256` together. Verify the sidecar and the independently recorded expected SHA-256. Do not substitute a newly built package for the qualified artifact.
3. Run the existing generator against the public release, substituting its repository, tag and artifact path:

   ```sh
   python3 scripts/catalog.py --from-release MajorSchloch/jellyfin-plugin-watchguard v0.7.11 \
     --zip artifacts/catalog-recovery-v0711/validated/Jellyfin.Plugin.WatchGuard-v0.7.11.zip
   ```

   The generator validates the local sidecar before downloading, anonymously checks release metadata, compares the public ZIP byte-for-byte with the validated ZIP, checks the public SHA-256 and filename, then derives the catalog URL and timestamp from the public release. It never uploads or modifies release assets.
4. Review the manifest diff: only the missing version should be added, using the actual `published_at`, asset URL, ZIP MD5 and maintained release summary. Check all previous entries against master with `--check-history`; retain their complete contents. Run the catalog and normal PR checks, then submit the recovery PR for review.

Do not rerun the publication job to repair a catalog-only failure: its create/upload steps intentionally do not replace existing immutable releases. Do not delete, recreate or overwrite assets. If checksums or ZIP contents disagree, stop and investigate provenance. A failed verification leaves the manifest unchanged. If assets remain unavailable beyond the retry budget, leave the catalog unchanged and investigate public availability before a later explicit recovery attempt.

## Download bounds

Release metadata, ZIP and checksum downloads share one **120-second monotonic deadline**. Each download makes at most **six attempts**, with 2/4/8/16/32-second backoffs when the remaining budget permits. Each attempt has a maximum **10-second connection timeout** and **30-second total transfer/process timeout**, reduced to the remaining shared budget. No nested curl retries extend these limits.

Retries cover HTTP 404 (publication propagation), 408, 429, 500, 502, 503 and 504, plus selected transient DNS, connection, partial-transfer, timeout and send/receive failures. Other HTTP failures, including 401/403, fail immediately. Certificate verification stays enabled. curl configuration is disabled so local credentials or options cannot turn the public check into authenticated access. Content/sidecar mismatches are never retried. These bounded retries cannot guarantee recovery from an outage longer than the budget.

## v0.7.11 recovery evidence

- Source/qualified commit: `734c820a495a40af5bc13c9e4342ed0af86a6eb9`.
- [Publication run 41063076511](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/41063076511): build, all 18 integration jobs (39 suites across Jellyfin 12.2–12.4) and qualification gate passed. Only publication's public-checksum download failed with HTTP 404; the manifest step did not run.
- [Validated artifact 12982350487](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/41063076511/artifacts/12982350487), `WatchGuard-v0.7.11-validated`, was retrieved independently of existing local build outputs.
- [Existing public release](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/releases/tag/v0.7.11), release ID `429096534`, published `2026-10-30T13:57:38Z`.
- ZIP asset ID `692287735`, 582,213 bytes; checksum asset ID `692287737`, 105 bytes. Both created/updated `2026-10-30T13:57:37Z`. Public downloads are byte-identical to their validated artifact counterparts.
- ZIP SHA-256: `c48fc7150da44e6e37670bd2be41813ee1590c931b29a964a110fdb06e7a534b`.
- ZIP MD5 (native catalog): `ca893261451f75f68c9e32902226b565`.
- DLL SHA-256: `febca265d9dae4e638573377a94b72bd6a7124213bba9bc2f48bc41d3c87eaaa`.
- Checksum-file SHA-256: `630dab11c0800004b927011b85b3f574ab186502a4b6ac1be6865c82359f28be`.

The generator adds `0.7.11.0` with ABI `12.2.0.0` and the actual publication timestamp. All 28 previous entries and the package-level catalog metadata are unchanged. Runtime sources, version, dependencies, qualification workflow, tag and published assets are unchanged. The original qualification evidence remains applicable to the identical package.

Focused regression coverage uses real curl requests against a disposable local HTTP server for temporary 404s on metadata/ZIP/checksum, exhausted checksum retries, permanent authorization errors and mismatched ZIP/checksum content. A simulated monotonic clock verifies the connection, attempt and shared deadline bounds without waiting two minutes. Every failure path asserts that the manifest bytes remain unchanged; existing catalog tests retain historical immutability checks.

Recovery checks passed: 376 backend tests, 203 JavaScript tests, 53 Python checks (including six new download tests), eight catalog tests, release-note validation, catalog history/sidecar validation and whitespace checks. A clean deterministic package build is byte-identical to the retrieved validated/public ZIP. Public release metadata, asset IDs, sizes, hashes and timestamps were compared before and after recovery and are unchanged. No new full integration run was needed for this tooling/documentation-only change; the published package's successful qualification is retained.
