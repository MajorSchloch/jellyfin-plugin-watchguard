# WatchGuard v0.5.0 — Watchlist-added dates

**Published 2026-10-18:** [WatchGuard v0.5.0](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/releases/tag/v0.5.0). The public Jellyfin catalog lists `0.5.0.0`.

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

## Verified release results

The [publication run 39134889908](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/39134889908) qualified source commit `a1a5b877f9dcad9f6d354977ffa52adc976fcfb6` and published v0.5.0 on 2026-10-18. The build, all ten integration jobs and the gated publish job passed.

- **188 backend tests** and **95 JavaScript/bootstrap/server-enforcement tests** passed, covering timestamp storage, unknown dates, rollback-compatible preferences and existing deletion safeguards.
- **14 Python infrastructure checks** and **4 catalog tests** passed against the pre-publication source tree.
- **All ten disposable integration suites passed:** standalone + Caddy, migration, official-image base path, legacy, WebSocket, discovery, verification, and server enforcement on official-image direct, official-image base path and LinuxServer.io installations. The official direct server-enforcement job used `WATCHGUARD_PROXY_MATRIX=1` for the extended proxy matrix.
- The workflow verified the published v0.4.10 rollback ZIP, exercised upgrade/rollback and storage persistence, and compared performance models against the published v0.4.7 baseline. Only disposable media and accounts were used.
- Two release builds produced identical ZIP checksums; catalog validation checked the runtime-file allowlist and checksum sidecar before publication.

Published ZIP SHA-256: `a9ff9255785761aed574e0ac0d14535445461a3de6da5f4d3eb32f5dd300332b`.
Jellyfin catalog MD5: `c9df7d223b304c077409cd3ada732a76`.

### Qualification history

[Run 39129611260](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/39129611260), on `ed924bd`, passed the build, legacy suite and all three server-enforcement suites. The other six suites stopped at a stale `backend-smoke.py` assertion expecting v0.4.10; their later browser/performance phases were not reached.

The shared check was corrected to read the candidate version from `Directory.Build.props`, retaining the pinned v0.3.1 Injector baseline. [Run 39131683055](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/39131683055), on `3b349734fa866e3dd52e114043200362048b97e0`, then passed the build and all ten integration jobs with publication skipped. The final publication run above repeated qualification on the merged release commit and passed. The earlier fixture failure is resolved; it is not a pending release gate.
