# Watchlist-added dates — v0.5.0 implementation and safety

**Unreleased**. See [draft v0.5.0 release notes](release-v050.md) and the [currently published v0.4.10](release-v0410.md).

## Why a sidecar instead of adding a field to watchlists.json?

v0.4.10 uses strict `JsonUnmappedMemberHandling.Disallow` for `WatchlistDocument(Version=1, Entries=[UserId, ItemId])`. Adding an `AddedAtUtc` field there would render a normal v0.5.0 membership document unreadable after a downgrade to v0.4.10, including for deletion protection. Therefore the authoritative membership file and its wire format are **unchanged**.

The optional metadata file `watchlist-dates.json` is versioned independently:

```json
{
  "Version": 1,
  "MembershipFingerprint": "<SHA256-of-watchlists.json>:<LastWriteUtcTicks>:<CreationUtcTicks>",
  "Entries": [
    {"UserId":"00000000-0000-0000-0000-000000000001","ItemId":"00000000-0000-0000-0000-000000000002","AddedAtUtc":"2026-10-18T12:00:00+00:00"}
  ]
}
```

The timestamp is taken only on the first successful **new** membership under v0.5.0. Old entries stay `null`, no estimates from playback or file modification times are shown. An idempotent PUT cannot refresh a timestamp. REMOVE drops its metadata; a future ADD records a new value.

The metadata fingerprint also binds to file creation and modification information because **legacy v0.4.10 writes replace the entire membership file**. If an old version removes and later re-adds a pair, identical JSON bytes alone cannot distinguish new membership from old membership. A changed fingerprint invalidates all stored dates, conservatively returning `null` rather than suggesting false historical accuracy.

This is not an adversarial tamper-evident signature. External tools able to forge the membership bytes and filesystem metadata could defeat this conservative invalidation; the plugin does not claim to audit actions by other processes. Concurrent servers writing the same directory are unsupported by the existing singleton storage model.

## Transactions, errors and recovery

Both JSON files are written with same-directory temporary files, a flush-to-disk, and atomic replacement of each destination. **Atomicity across both files is impossible** without a shared journal/database. Membership is committed first; dates then receive the fingerprint of that exact committed file. An interrupted metadata commit causes unknown dates on later reads, while WatchGuard's native deletion guard still uses the original membership file. The server never treats a missing date as missing interest.

Malformed or unknown-schema metadata is preserved and produces a visible API error for explicit watchlist reads/changes. The core `WatchlistStore.Read()`, which deletion protection uses, deliberately does not parse the sidecar. Stop Jellyfin and restore verified backups if the metadata file becomes damaged. Never delete or overwrite `watchlists.json` in an attempt to fix optional timestamps.

## API and browser rules

- `GET /WatchGuard/Watchlist` returns `ItemId`, `Name`, and nullable `AddedAtUtc` for the authenticated user only.
- `GET /WatchGuard/Watchlists` and `/Watchlists/{userId}` return `AddedAtUtc` separately for each authorized user in `Users[]`. The existing admin and per-owner native visibility checks are retained.
- `PUT/DELETE /WatchGuard/Watchlist/{itemId}` are unchanged. Metadata never authorizes a delete; server-side enforcement still checks authoritative interest/permissions independently.
- `AddedAtUtc` is never emitted by automatic playback discovery. The Web validator rejects a dated user who lacks the explicit `Watchlisted` reason.
- `sort=added` picks the latest known timestamp **among the users matched by the current filter**; automatic-only items and unknown dates sort after known entries, with deterministic title/item-ID ties.
- When the server returns an explicit `AddedAtUtc: null`, the UI displays **Added: unknown**. Older servers that omit the field remain renderable without implying a timestamp.
- Membership DTOs explicitly retain that null field under Jellyfin's native PascalCase and camelCase JSON profiles, which otherwise omit null properties. The account directory remains free of membership-date fields. Regression tests serialize controller results with Jellyfin's own `JsonDefaults` options, including legacy and invalidated dates.

## Saved preferences limitation

The existing `preferences.json` schema-1 validates `Sort` as `title` or `recent`. Adding `added` to the persisted enum would break rollback even though the JSON version number stayed unchanged. The new sort is therefore available only in the active view, URL and browser bookmarks. The **Save view as defaults** command explains why this one sort mode is not persisted; no bad preference write is attempted. A future optional preference sidecar or migration could address this without changing the v0.4.10 contract.
