# Additional available episodes — v0.5.2

Watchlists cards and the administrator Series viewing panel retain an aired fraction and show a compact **+N** button for additional available episodes: **3/3 +1**. Click/tap, Enter or Space opens a native modal with season, episode/range, title, release date and **that user's** Watched/Unwatched state. Escape or Close dismisses it and restores focus. Removing the owning view on navigation/account change also removes its dialog. Text is constructed with DOM text nodes; no title or username is interpreted as HTML.

When a Caught Up user has an unwatched extra, the panel chip/summary and card icon's accessible label/tooltip say **Caught up on aired episodes**. Watched extras still appear in +N; they do not produce that qualification. The bookmark action stays independent.

## Native date and availability semantics

The pinned Jellyfin 12.2 implementation is [`BaseItem.IsUnaired`](https://github.com/jellyfin/jellyfin/blob/ca0f16eb7c195f720a1493ed469a27c4657db0c6/MediaBrowser.Controller/Entities/BaseItem.cs#L213): `PremiereDate.Value.ToLocalTime().Date >= DateTime.Now.Date`. The comparison uses the **server's local calendar**, not an elapsed release timestamp or the browser's timezone.

- **Aired:** known release date before the server-local current date; included once in the main fraction.
- **Release day:** known date equal to that date; available extra, explicitly labelled Release day, not Future-dated. It joins the aired fraction on a subsequent fresh request after the server's date advances.
- **Future-dated:** known date after today; available extra.
- **Date unknown:** no premiere date; available extra, without inferring an air date or completion coverage. Existing Unknown/incomplete coverage and fail-closed protection behavior remain intact.

Displayed dates use the browser's localized date formatting. The release-state label is server-calculated and can differ from the browser's local calendar near midnight. No new timer or background polling is added; refresh/navigation obtains fresh observations.

Only user-visible episodes that are neither `IsVirtualItem` nor native `IsMissingEpisode` enter the presentation. Jellyfin defines [`IsMissingEpisode`](https://github.com/jellyfin/jellyfin/blob/ca0f16eb7c195f720a1493ed469a27c4657db0c6/MediaBrowser.Controller/Entities/TV/Episode.cs#L131) from virtual location. A future virtual placeholder contributes zero extras. Availability reflects Jellyfin's native library record, not a new filesystem probe; stale library records still require a library scan.

The existing native queries group presentation keys and exclude owned alternate versions by default ([query defaults and options](https://github.com/jellyfin/jellyfin/blob/ca0f16eb7c195f720a1493ed469a27c4657db0c6/MediaBrowser.Controller/Entities/InternalItemsQuery.cs)). Native `GetResumeUserDataBatch` retains alternate-version selection, and completion uses `state.Played || resume.UserData.Played`, as before. The informational projection deduplicates IDs and partitions each eligible episode into either aired or extras, never both. No extra ancestry lookup, per-episode request, external metadata call or file traversal is introduced.

## Additive API contract

Series users in `ActivityOverview`, `ActivityOverview/Me`, `ActivityOverview/Users/{id}` and administrator-only `SeriesActivity/{id}` may include:

```json
{
  "EpisodeProgress": {
    "AiredAvailable": 3,
    "AiredWatched": 3,
    "ExtraEpisodes": [
      {
        "ItemId": "123456781234123412341234567890ab",
        "SeasonNumber": 1,
        "EpisodeNumber": 4,
        "Name": "An additional episode",
        "PremiereDate": "2026-10-24T00:00:00Z",
        "ReleaseStatus": "Future",
        "Watched": false
      }
    ]
  }
}
```

`EpisodeNumberEnd` is optional for multi-episode files. Missing numbers and dates may be omitted by Jellyfin's null serialization. `UnknownDate` has no date. The client validates optional progress before rendering and falls back to the original fields/labels when it is absent. Progressive merge retains the new object by user/item IDs, without replacing poster nodes. There is no new endpoint or request when opening details. Explicit membership-only rows keep their existing presentation until activity verification supplies progress; this change does not run extra series queries for every watchlisted poster. Bounded discovery can still omit such observations.

The original `AvailableEpisodes`, `WatchedEpisodes`, `LastPlayedDate`, `Reasons`, coverage fields, filters and classifications are preserved. In particular, the new aired denominator can differ from legacy observations for undated/ended series; it must not be used to reinterpret their protection or coverage. Existing notices remain visible.

## Work bounds, privacy and protection

Episode queries, native visibility checks and work accounting remain unchanged: 50 users, 100 returned titles, 1,000 rows per user/series and 20,000 verification units. Overview playback batches now also include already-enumerated available future/release-day rows for their watched flags, in the existing bounded batches of at most 1,000. This can add a batch at a chunk boundary; it does not add per-episode queries or a cross-request cache. Last-played aggregation is projected back to its original item set so the extra reads cannot change sorting or classifications. Targeted series already read those rows.

Protection calls the same series evaluation with informational projection disabled. It emits no `EpisodeProgress`, uses the same native reads and protection reasons, and never consumes overview results. Approval, deletion transport, permission policy, standalone loader and all persistent schemas are unchanged. Cross-user activity remains administrator-only; personal overview uses only the authenticated user's native visibility/playback.

A bounded or incomplete response is still bounded or incomplete. Extra counts describe the evaluated visible rows, not an exhaustive external catalog. No metadata gap is repaired or hidden by +N.

## Upgrade and rollback

Published v0.5.2 is the current release. [Publication run 39219433132](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/39219433132) passed; published assets and catalog history remain unchanged. Normal upgrade/rollback uses the existing single plugin assembly and a full Web reload. No new preference, storage file or configuration setting is introduced. Existing v0.5.1 preferences and the saved-sort downgrade limitations still apply; see [saved sorting](saved-sort-v051.md).

## Validation

Results and screenshot links are recorded in [release notes](release-v052.md). Legacy native benchmark comparisons exclude only the new `EpisodeProgress` object; every original item/user/playback/date/count/coverage field is still compared exactly. Dedicated regressions validate the new object independently.
