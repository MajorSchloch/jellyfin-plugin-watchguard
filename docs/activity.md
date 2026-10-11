# WatchGuard v0.2.3 — viewing activity and dates

> **v0.2.4 UI:** See [status checkboxes, compact cards and inline icons](ui-refinement.md). The release-specific behavior below remains historical.

Target: Jellyfin Server/Web **12.2**, .NET **10**. Watchlists is now a small shared activity overview; regular accounts see only themselves. No activity database, background scan, new framework or runtime dependency is added. Personal membership storage remains schema 1 and is compatible with v0.2.2.

## Dates and statuses

| Status | Source and displayed date |
| --- | --- |
| Watchlisted | Existing explicit membership. No creation date exists in schema 1, so no date is invented or displayed for membership. |
| Watching (`InProgress`) | Existing unfinished-movie / started-but-incomplete-series rules. Show the latest available native `LastPlayedDate`. |
| Watched | Native played state verified against all currently available episodes for a series. Show the latest native `LastPlayedDate`, **not a completion timestamp**. |
| Currently Playing | Existing active-session rules, including additional session users. Show an active dot with text; no start time is inferred. |

The date is the maximum native last-played date across the movie or available series episodes, including native alternate-version resume data, using the same reads as the interest verifier. If the native date is absent, Watching has no date. Watched history requires a non-null date inside the configured window and not later than the request's UTC snapshot time. Old/unknown/future-dated completion is excluded from recent history. Native “mark played,” rewatching, imported state and clock skew can affect these values; they are not a forensic playback or completion log.

Dates render with browser-native `Intl.DateTimeFormat` in the browser's locale/time zone, with calendar date, year and time to the minute. The API retains the native full timestamp. A combined Watchlisted/Watched card labels its date **Last played**, never “added” or “completed.” An active-only record has no displayed start/date; an active record with Watching/Watched can also display its genuine last-played date.

## Bounded discovery and completion

The source-verified native APIs remain `InternalItemsQuery`, `ILibraryManager`, `IUserDataManager` batch/resume reads and `ISessionManager`. Relevant pinned 12.2 source:

- [InternalItemsQuery](https://github.com/jellyfin/jellyfin/blob/ca0f16eb7c195f720a1493ed469a27c4657db0c6/MediaBrowser.Controller/Entities/InternalItemsQuery.cs): `IsPlayed`, item kinds, `DatePlayed` ordering and database-side `Limit`; no last-played-date cutoff property. `MinDateLastSavedForUser` is not substituted for last playback.
- [Prior native discovery research](interest-overview.md#native-discovery-research): Next Up's public limit does not bound all its internal series/episode enumeration, so it is not used for global discovery.

Activity discovery reuses the bounded resume and played-episode queries. It adds **one bounded played-movie query per enabled account**, sorted by native playback date descending. Active sessions are prioritized, then existing resume/series candidates, then completed movies. Episode candidates resolve their native parent series; alternate versions resolve through the existing primary-version logic. Native visibility is checked for the requesting account and each owner.

Every candidate is verified through the existing InterestService reads. Only its overview-specific branch records completion and episode counts; it does not append history to protection reasons. A series is complete only when it has at least one available episode and **all** of those effective native states are played. The latest completed episode alone proves nothing about the rest. A newly available unwatched episode changes the series back to Watching. Missing/virtual episodes are excluded by the existing native query; an empty series is never complete.

`AvailableEpisodes` and `WatchedEpisodes` are nullable for movies, and native available/played counts for verified series. Counts reuse the already-loaded, bounded episode array and batch playback results. There is **no second episode query or per-poster progress request**. A partially watched episode is started but is not counted as a played episode.

### Settings and bounds

Optional native plugin configuration fields, under `/config/plugins/configurations/Jellyfin.Plugin.WatchGuard.xml`:

```xml
<ActivityWindowDays>30</ActivityWindowDays>
<ActivityLimit>100</ActivityLimit>
```

Stop Jellyfin before editing its XML, retain the other configuration elements and restart. Defaults apply when older configuration has no fields. `ActivityWindowDays` is clamped to **1–90**, and `ActivityLimit` to **1–100**; these are server-controlled, not client query overrides. The window applies to **completed history**, not existing unfinished or active interest.

| Work | Bound |
| --- | --- |
| Enabled accounts | 50; excess produces 503 |
| Resume / played-episode candidates | 100 each per account, plus one truncation probe |
| Completed-movie candidates | ActivityLimit per account, plus one probe |
| Distinct automatic titles verified | ActivityLimit, default 100 |
| Available episodes per series/user | 1,000, plus one probe |
| Total verification work | Existing 20,000 account/item budget |

A reached limit sets `LimitReached:true` and a visible notice; partially verified titles are omitted. All responses remain **`IsComplete:false`**, even below the limits. Recently completed titles can be displaced by many recently played episodes, current-interest candidates or the title cap. Large series can exceed the verification budget. Undated/old playback, unavailable/invisible media and unusual alternate-version discovery can be missed. Applying the date window after a capped native query does not imply that every matching title was enumerated. Database filtering/sorting can still cost time even with bounded returned rows. No full-library or unbounded episode scan, server cache or activity-history persistence is introduced.

## API and privacy

New authenticated, non-cacheable, read-only routes:

- `GET /WatchGuard/ActivityOverview` — currently enabled administrator only.
- `GET /WatchGuard/ActivityOverview/Me` — current authenticated account only; discovery and verification are restricted to it.

Anonymous/userless API-key requests are rejected; normal users cannot call the administrator route. Deleted/disabled owners, missing media and titles invisible to either relevant account are omitted. Genuine lookup/processing failures return **503**, not a successful empty history. The UI keeps successful explicit memberships visible with an independent automatic-activity error. Existing InterestOverview endpoints retain their interest-only reasons and optional `automaticOnly` behavior; nullable progress properties are additive to the shared response record.

Example automatic activity response:

```json
{
  "Items": [{
    "ItemId": "11111111-1111-1111-1111-111111111111",
    "Name": "Example Series",
    "Users": [{
      "UserId": "22222222-2222-2222-2222-222222222222",
      "DisplayName": "Anna",
      "Reasons": ["Watched"],
      "LastPlayedDate": "2026-10-10T18:42:00Z",
      "AvailableEpisodes": 12,
      "WatchedEpisodes": 12
    }]
  }],
  "IsComplete": false,
  "LimitReached": false,
  "Notice": "Recent viewing activity: completed titles with a native playback date in the last 30 days, plus current viewing interest; not an exhaustive library audit."
}
```

Automatic results never contain Watchlisted; the browser merges the unchanged explicit-list response by item/user ID and unions statuses. An owner can therefore have Watchlisted + Watched or Watched + Currently Playing, without duplicate cards or users.

## UI and loading

The existing navigation/page integration and detail bookmark/inline protection UI are retained. Card filters are **All activity, Watchlisted, Watching, Watched, Currently Playing**. Watching retains its existing unfinished-or-active meaning; Currently Playing narrows to active sessions. User and status predicates must match the same owner. Cards show all applicable statuses for each matching owner, localized native dates and optional `7/12 episodes`. Regular users see their own name/status only. Title and playback-recency sorts remain; date-added sorting stays unavailable because no membership timestamp is stored.

Memberships paint first. An inline native Material Icons `sync` spinner and loading text remain until automatic activity settles. It respects reduced-motion preferences, is hidden from assistive text, and the region uses `aria-busy`. Existing posters stay visible. There is no final empty state while pending or after a source error. Failure clears the spinner and reports incomplete results independently of successful memberships. Refresh re-reads both sources; filters/sort/history update locally without another discovery request, and merges retain card/image nodes. Page/account lifecycle guards discard late responses; already-issued native AJAX can finish server-side.

Screenshots from disposable generated media:

- [Completed movie/series, exact dates and counts](screenshots/v0.2.3/activity-watched.png)
- [Active playback filter](screenshots/v0.2.3/activity-playing.png)
- [Explicit cards and pending spinner](screenshots/v0.2.3/progressive-memberships.png)

## Deletion is deliberately separate

**Watched is never a protection reason.** Fresh `Protection/{id}` continues to return only Watchlisted, InProgress and CurrentlyPlaying, with exactly the prior permission, parent-series and fail-closed rules. The deletion adapter and its reason allowlist are unchanged; even a malformed protection response containing Watched is rejected rather than treated as a valid decision. No deletion uses the activity snapshot, date window, counts or candidate limits.

Consequently, a completed title without manual membership/unfinished/active interest adds no warning; a completed title explicitly watchlisted by another user still warns. An active rewatch still protects via CurrentlyPlaying. Generic native cancellation errors and known bypasses (native clients, direct API, cleanup plugins, filesystem deletion) remain as documented. This is Web advisory protection, not server-side deletion enforcement.

## Validation and release

**44 backend tests and 32 JavaScript tests** cover native dates/window bounds, completed movies, whole-series completion/new episodes/empty series, counts without duplicate episode queries, session combinations, users, visibility, disabled/deleted owners, limits/errors, date formatting, status filters and pending/error spinner behavior, plus every existing regression. Disposable Docker tests exercise real native played data, completed movie/series cards, exact localized dates, 4/4 counts, combined membership/history, user and active filters, normal-account privacy and native deletion of a history-only movie without an extra warning. All original deletion paths remain tested.

See [updated performance measurements](performance.md#v023-activity-measurements) and [final release/deployment results](deployment.md#automated-results). The release ZIP contains only the plugin DLL and LICENSE. `watchguard-v1`, plugin GUID, membership schema and default-disabled diagnostics remain stable. Roll back by replacing the DLL with retained v0.2.2, preserving data and fully reloading Web tabs. No automatic deployment or publication is performed.
