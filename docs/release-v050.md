# WatchGuard v0.5.0 — Watchlist-added dates

**Status: unreleased development candidate. Do not install or publish until full qualification and explicit release approval.** The latest public catalog release remains v0.4.10.

Target: Jellyfin Server/Web 12.2.0, .NET 10. The plugin GUID, native deletion guard, approval protocols, original watchlist JSON, preference schema and existing configuration are unchanged.

## New behavior

- WatchGuard records the actual UTC time of a **new** watchlist membership and shows **Added** dates for each authorized user in the Watchlists overview.
- Existing memberships and dates made untrustworthy by legacy writes display **Added: unknown** instead of invented timestamps.
- **Sort by → Recently added** orders titles using the newest known add date among the users matching the selected owner/status filters, with unknown dates sorted last and stable title ties. Playback-recency sorting remains independent.
- Removing and later re-adding an item records a fresh date; idempotent add preserves the original date.
- `sort=added` works in Watchlists links and browser history. To retain v0.4.10 preference compatibility, **Recently added cannot be saved as an account default** yet. It is available as a bookmarkable URL. The existing title/playback sorting defaults remain writable.

## Storage and rollback

`watchlists.json` remains the exact **schema-1** `Version` / `Entries` document that released v0.4.10 reads with strict unmapped-member validation. `preferences.json` remains schema 1 and only stores `title` or `recent`.

A new, versioned `watchlist-dates.json` lives alongside the existing membership store under Jellyfin's plugin data folder. It contains UTC per-user/per-item add dates and a fingerprint binding it to the current membership file (SHA-256 of the legacy JSON plus filesystem creation/last-write timestamps). On read, mismatched metadata is **ignored as unknown**; newer writes reconcile without backfilling dates. An older plugin's atomic replacement (even one restoring the exact same identity set) invalidates the associated known dates instead of silently showing stale additions.

The two files cannot be replaced as one filesystem transaction. If a crash happens after a membership commit but before the metadata write, the membership remains authoritative and dates whose fingerprint no longer matches are unknown. Corrupt or unsupported timestamp data is **not silently reset**: explicit-list reading/changes report an error until it is repaired or restored, while deletion enforcement continues using the authoritative membership store alone. Do not interpret a date as an authorization token or as proof of history before this release.

For rollback, back up the stopped server's `watchlists.json`, `watchlist-dates.json`, optional `preferences.json`, plugin configuration XML and the working v0.4.10 package. Reinstall the checksum-verified published v0.4.10 through native catalog management, restart Jellyfin and fully reload clients. v0.4.10 ignores the sidecar and reads legacy memberships/preferences unmodified. Re-upgrading after an older version mutates memberships may legitimately show **unknown** added dates; it must not fabricate them from file timestamps.

## Security and compatibility

Dates are returned only with authorized explicit membership data: current account for `Watchlist`, administrator-only for `Watchlists` and `Watchlists/{userId}`, with existing per-owner native visibility checks. Automatic viewing discovery cannot set add dates and never persists them. No change to protection, administrator approvals, API-key restrictions, native permissions or supported DELETE routes.

This release does **not** add mobile/TV client integration, Sonarr/Radarr/Tdarr filesystem protection or broader Jellyfin server compatibility.

## Verification before release

- Unit tests: legacy schema roundtrip, unknown legacy date, idempotency, remove/re-add, per-user isolation, corrupted sidecar preservation, parallel writes and legacy file-replacement invalidation.
- Browser tests: Date/unknown labels, owner-filtered sorting, independent playback dates, safe literal rendering and refusal to save the rollback-incompatible `added` default.
- Full disposable Docker release matrix on the **exact final candidate**, with published v0.4.10 checksum-verified rollback, native upgrade/restart, Web/API contracts, and storage persistence. No production media or accounts.
- Two identical reproducible candidate ZIP builds, release checksums, and explicit release approval before `publish=true`.

This document is the draft release-notes source for the future v0.5.0 publication. It makes **no** claim that the candidate has been published, installed or fully qualified.

### First hosted qualification — blocked by a stale fixture version

[Run 39129611260](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/39129611260), on `ed924bd`, passed the build, legacy suite and all three server-enforcement suites. The other six suites all stopped at the same `backend-smoke.py` assertion, which still expected v0.4.10 from the v0.5.0 candidate. Standalone catalog rollback/upgrade checks completed before that assertion, but later browser and performance phases in the affected suites were not reached.

The shared check now reads the candidate version from `Directory.Build.props`; the published Injector baseline remains pinned to v0.3.1. Fast regression tests reproduce the original rejection of v0.5.0 and acceptance of stale v0.4.10, then verify the corrected version check and unchanged readiness assertions. A **new full workflow run on the corrected branch**, with `publish=false` and `proxy_matrix=true`, is still required. Re-running the old run would test the old commit again.
