# WatchGuard v0.2.1 — interest overview and native UI refinement

> **v0.2.2 update:** See [performance and inline detail UI](performance.md). The numeric badge/popover is removed; explicit entries now render before a separate automatic-interest request. Filters reuse the current page snapshot. The historical decisions below describe their named release.

Target: Jellyfin Server/Web **12.2**, .NET 10. The overview combines explicit membership with native playback interest, without persisting automatic interest. Existing watchlists, Favorites, playback state, Injector registration and deletion policies are unchanged.

## Native discovery research

Source inspected at Jellyfin commit [`ca0f16eb7c195f720a1493ed469a27c4657db0c6`](https://github.com/jellyfin/jellyfin/tree/ca0f16eb7c195f720a1493ed469a27c4657db0c6):

- `Jellyfin.Api/Controllers/ItemsController.cs`, `GetResumeItems`: Continue Watching uses `InternalItemsQuery` with `IsResumable=true`, `DatePlayed` descending and native `Limit`. Its HTTP implementation also applies Home/library preferences and optional active-session exclusions. WatchGuard uses the underlying library query, includes active playback separately and does not inherit Home exclusions.
- `Emby.Server.Implementations/TV/TVSeriesManager.cs`: `GetNextUp` obtains series keys and batches episodes **before** applying the public result limit. Without a specific series, the internal key limit is null; a small public `NextUpQuery.Limit` does not bound all discovery work.
- `Jellyfin.Server.Implementations/Item/NextUpService.cs`: Next Up groups series by non-null last-played dates and uses series presentation keys, ordering rules, specials and rewatching settings. Its batch implementation can materialize all played episodes for the selected series. It is not an exact match for WatchGuard's available-episode interest rules.
- `ISessionManager.Sessions` supplies active primary/additional users and now-playing IDs. Session activity is interpreted exactly as in the existing interest service; paused-but-active playback can count.

The implementation therefore uses two **bounded native library queries per enabled user**: resumable movies/episodes and recently played completed episodes. The second discovers series between episodes even when no episode has a resume position. Episode candidates resolve to their native SeriesId; native alternate-version candidates resolve to PrimaryVersionId first. Active sessions and explicit store entries also supply candidates. User/library visibility is checked during discovery, then the existing InterestService verifies candidates across eligible users.

No Next Up HTTP loopback, per-library enumeration, new SQL/database schema or alternate interest-rule implementation was added. The native database still needs to filter/sort playback rows; a bounded result is not a promise of constant database execution time.

## Coverage and request budgets

The overview is a **bounded snapshot, not an exhaustive library audit**. Every response has `IsComplete:false` and a visible notice. Limits are fixed in `InterestOverviewService`:

| Work | Bound |
| --- | --- |
| Enabled accounts in administrator overview | 50; exceeding this returns 503 instead of silently dropping users |
| Resume candidates per account | 100, plus one probe row to detect truncation |
| Played episode candidates per account | 100, plus one probe row |
| Distinct movie/series candidates verified | 100, active playback considered first |
| Available episodes per series/user verification | 1,000, plus one probe row |
| Verification work across the request | 20,000 account/item units |

When discovery, candidate or verification limits are reached, `LimitReached:true` and the notice explains that items were omitted. Partially evaluated titles are never returned. An ordinary storage/library/playback failure discards the response and returns **503**, not partial success. A missing/invisible item or disabled/deleted owner is safely omitted. No arbitrary inactivity timeout is added to native sessions; enabled users with old interest are still eligible for discovery.

Older resumable titles, series displaced by many recently played episodes, unusual imported/alternate-version playback states, or items beyond these caps may be absent. Completed episodes with no date can be discovered by the played query but sort behind dated history. Stored memberships can also be omitted when the candidate/verification budget is exhausted; the original membership list APIs remain available. `LimitReached:false` does not claim an exhaustive result.

Only the overview uses these bounds. `GET Protection/{id}` and deletion continue to evaluate their target through the existing **uncapped** InterestService path. Absence from the overview is never evidence that deletion is safe. Every deletion still requests fresh per-title protection; no deletion decision uses overview data.

## API contracts and privacy

The old `GET /WatchGuard/Watchlists` remains unchanged: administrator-only, explicit memberships, array response. Own-list CRUD and schema 1 also remain unchanged.

New non-cacheable routes:

- `GET /WatchGuard/InterestOverview`: enabled administrator account only; 403 for regular users.
- `GET /WatchGuard/InterestOverview/Me`: authenticated enabled current user only. Candidate discovery and verification are both restricted to this account; it never aggregates other users and then merely hides them in the browser. It accepts no target user ID.

Both reject anonymous/userless API-key identities. Native services resolve identities, current permissions, display names, visibility and playback. Regular-user UI calls only the personal endpoint; it also rejects any unexpected cross-user payload defensively.

```json
{
  "Items": [
    {
      "ItemId": "11111111-1111-1111-1111-111111111111",
      "Name": "Example Series",
      "Users": [
        {
          "UserId": "22222222-2222-2222-2222-222222222222",
          "DisplayName": "Anna",
          "Reasons": ["Watchlisted", "InProgress", "CurrentlyPlaying"],
          "LastPlayedDate": "2026-10-11T10:00:00Z"
        }
      ]
    }
  ],
  "IsComplete": false,
  "LimitReached": false,
  "Notice": "Recent viewing interest and explicit watchlists; not an exhaustive library audit."
}
```

Items and interested users are distinct; all verified reasons are retained. `LastPlayedDate` is the latest available native date across the movie/available series episodes and native resume versions, or null. It is not fabricated from session heartbeat, file modification time or watchlist order. A request-local store snapshot is reused during overview verification; no state is cached between requests or written by the overview.

## Page and detail UI

The stable top navigation link and namespaced Home route remain as documented in [navigation.md](navigation.md). The page uses a responsive poster grid, native image URLs/detail links, native button/select/icon classes and theme colors. Compact filters and an icon-only Refresh share one toolbar. Own-entry removal is a small bookmark-remove action on the poster.

- User: **My list**, **All users**, individual users for administrators. Regular users are scoped to themselves.
- Interest: **All interest**, **Watchlisted**, **Watching**. Watching includes `InProgress` and `CurrentlyPlaying`. User and reason predicates must match the same user; another user's progress cannot make a watchlisted-only user match Watching.
- Cards show matching users and reasons, including combined reasons. Regular-user cards show their reasons without other users' names. Automatic-only interest has no Remove membership action. Removing an explicit entry can leave a card visible if playback interest remains.
- Sorting: title or latest available playback date among the filtered users, descending with unknown dates last and title/ID tie-breaks. **Watchlist-add date is unavailable** in schema 1, so that option is disabled and labelled “not recorded.” No schema migration or guessed dates were introduced.
- Filter/sort state is encoded in hash query parameters and survives history/reload. Queries refresh on page/filter changes or explicit Refresh; there is no polling of overview data. Loading disables filters until their account/filter state is ready. Errors, empty results and coverage limits are visible.

The bookmark toggle stays beside native Favorite/More. A separate small administrator count button within the same control opens a native HTML popover with names/reasons. Clicking the count cannot invoke the bookmark mutation. Escape/outside click closes the popover; navigation/account changes remove it. The detached interest paragraph and its layout reservation are removed. Lookup failure uses an unavailable indicator, not a misleading zero count. Normal users have only their own bookmark action and scope tooltip; no cross-user count/popover is populated.

Season/episode controls still verify and target the parent series, labelling the popover/tooltip accordingly. All names/titles are text nodes. No framework, global network patch, React tree replacement, Jellyfin Web file modification or new runtime package was added. Chromium supports the native Popover API; other browsers/custom themes still require validation.

## Release and rollback

Version **0.2.1**, script ID **watchguard-v1**, same plugin GUID. Install only the packaged DLL with the tested jf12 JavaScript Injector; keep response-time middleware enabled. Verify exactly one authenticated enabled registration at version 0.2.1, fully reload tabs and check `WatchGuardPoc.isInstalled()`.

Keep the **v0.2.0 ZIP** for rollback. Stop Jellyfin, back up `/config`, replace the DLL with v0.2.0 (retire stale plugin installation metadata), preserve schema-1 `watchlists.json`, restart and fully reload tabs. The old binary re-registers its own script at the same ID. No data conversion is needed. See [deployment.md](deployment.md) for Docker Compose, backup and persisted-registration cleanup.

## Validation

Results and release checksum are recorded in [deployment.md](deployment.md#automated-results). The disposable fixture includes a completed first episode with later episodes available, no WatchGuard membership, appearance under Watching, a Watching-only count popover and a cancelled native deletion with zero DELETE. It verifies the series never becomes permanently watchlisted. Additional checks cover combined reasons, active playback, own/admin isolation, title/recency sorting, filters/history, explicit membership CRUD, failures, both desktop shells and all previous deletion/playback regressions.

Release SHA-256: `9359d6193c24887042c005ae42c67e2171d05486e35e22bcc54cb9645bb90986`. Two forced compilations produced identical ZIPs. Backend **34/34** and JavaScript **26/26** tests passed; Docker backend/browser regressions passed, including the playback-only series and stable registration after restart. No production configuration/media was accessed and no release was published.

The final browser pass also verified the grid at **390 px and 1280 px**, with no horizontal overflow. It recorded **27 interceptions, 11 cancellations, three failed checks, four clear decisions, nine overrides and 13 native media DELETE requests**, with zero ordering violations. All fixture containers/configuration/media were cleaned up.
