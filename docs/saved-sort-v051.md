# Saved Recently added sort — v0.5.1 candidate

Unreleased. The public catalog/current release remains v0.5.0. This changes personal view defaults only; watchlist timestamps, activity queries, deletion enforcement, approvals and the standalone loader are unchanged.

## Behavior and API

Choose **Recently added**, then **Save view as defaults** in the existing filter disclosure. The authenticated account's owner, status selection and sort survive page reloads and server restarts. Saving Title or Playback recency replaces the added default. **Reset to Defaults** removes the complete saved view for that account.

The existing authenticated, no-store `GET/PUT/DELETE /WatchGuard/Preferences` routes remain in use. PUT and GET now accept/return `Sort: "added"` in addition to `title` and `recent`. Only explicit Save sends PUT; ordinary filtering, sorting, navigation and shared links never save defaults. Each explicit `owner`, `interest` and `sort` URL parameter independently overrides only that saved field. `interest=none` still means no statuses. Ordinary users cannot save cross-user scopes. Disabled accounts, unauthenticated callers and API keys remain rejected; reads revalidate administrator status and saved owner availability.

Failed save/reset requests retain visible errors, and unavailable reads use URL/built-in defaults without writing recovery data. Identity/token/navigation checks discard late responses after an account change.

## Backward-compatible persistence

Published v0.5.0 and v0.4.10 strictly validate `preferences.json`. Its schema 1 is unchanged: `Version`, `Entries`, and each `UserId`/`Preferences` with `Owner`, `Statuses`, `Sort`. It **never** receives `Sort: "added"` or additional fields. A saved added view stores `title` there as the downgrade fallback, preserving the selected owner and statuses.

A separate schema-1 `preference-sorts.json` under the same plugin data directory stores only the account IDs whose effective sort is added:

```json
{"Version":1,"PreferenceFingerprint":"<SHA256>:<LastWriteUtcTicks>:<CreationUtcTicks>","AddedUsers":["<Jellyfin user GUID>"]}
```

There is no second writable copy of owner/status preferences. The sidecar is the sole representation of the added override; the legacy file is authoritative for everything else. No calculated viewing state or watchlist membership is stored here.

The fingerprint binds the override to the bytes and filesystem creation/last-write timestamps of the entire legacy file. Older plugins atomically replace that file when saving **or resetting**, including identical saves. A changed fingerprint makes all overrides inactive. On a later v0.5.1 save, only still-valid overrides are retained; an obsolete one is not rebound to the new revision.

### Downgrade limitations

- v0.5.0/v0.4.10 ignore the sidecar and use Title for an added default, with the same owner/status selection. An untouched downgrade/re-upgrade retains the added default.
- **Any legacy preference save/reset invalidates added overrides for all accounts**, even when another account made the change. This conservative fallback avoids guessing which entries an older plugin changed. Owners/statuses and legacy sorts remain intact. Users can explicitly save added again after upgrading.
- Identity here is filesystem provenance, not an adversarial integrity guarantee. Restoring a complete earlier pair intentionally restores that snapshot. External tools that preserve/forge the exact bytes and timestamps, or filesystems unable to distinguish identical replacements at their timestamp resolution, cannot be distinguished from an untouched file. The actual published plugins are exercised through native HTTP against the disposable Docker filesystem. Arbitrary backup tools/filesystems are not certified.
- One Jellyfin process owns the directory. Concurrent server processes or external writers are unsupported. Normal request concurrency is serialized by the existing singleton lock; no request can read another account's effective defaults.
- Old cached Web adapters do not support the new effective sort. Fully reload Web clients after upgrading or rolling back.

## Corruption, interrupted writes and backups

Reads validate both documents. Malformed/unknown-schema data, duplicate/empty IDs and matching-fingerprint orphan overrides are errors. No GET repairs files; save/reset validate before modifying either file. API failures return 503 with guidance to reload and inspect saved state, without returning raw exception details.

A write performs three steps under the singleton lock:

1. If an override sidecar exists or is needed, flush and atomically replace it with an empty invalidation record.
2. Flush and atomically replace the schema-1 legacy file.
3. Flush and atomically replace the final sidecar, bound to the committed legacy file.

There is **no two-file transaction**. Failure before step 1 preserves the originals. Failure after invalidation falls back to legacy values (and may clear other accounts' added overrides). Failure after step 2 may commit the requested legacy owner/status/fallback despite the request reporting failure. The caller must reload to inspect the saved state and explicitly retry if desired. No interrupted update can reactivate an old sidecar. Temporary files are cleaned up; successful writes are flushed before rename. Disk/filesystem durability guarantees still apply.

Stop Jellyfin before backing up/restoring `preferences.json` and `preference-sorts.json` together, alongside existing watchlist/date files and configuration. A restore that changes legacy file timestamps conservatively loses added overrides; save them again. Corrupt files are preserved: stop the server and restore or repair a known-good pair. Reset is not a corruption-recovery shortcut.

## Qualification

Focused tests cover strict legacy schema compatibility, restart via fresh stores, actual published plugin downgrade/re-upgrade (including identical saves and reset), concurrent accounts, corrupt documents, write failures and interrupted-write boundaries. The native settings browser fixture covers save/reload, per-field URL precedence, sort replacement, errors, reset and native account switching. See [candidate results](release-v051.md) for executed checks and remaining qualification.
