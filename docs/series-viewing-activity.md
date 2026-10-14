# WatchGuard v0.4.3 — targeted series viewing activity

Release candidate for Jellyfin Server/Web 12.2 and .NET 10. No publication, catalog update or production deployment is performed.

## API and native reads

`GET /WatchGuard/SeriesActivity/{seriesId}` requires a signed-in, enabled administrator (not an API key). Ordinary users receive 403, unauthenticated requests 401, and missing/inaccessible/non-series targets 404. Native lookup failures return 503, never an empty success. Responses are private and `no-store`.

Unlike the bounded global activity candidate search, this request already knows its series. It calls the existing InterestService batch reader with a request-local budget, not Continue Watching, Next Up, global history discovery or an overview cache. Each enabled user must see the series through Jellyfin's user-scoped library service. The service resolves current display names, ignores removed/disabled users and uses native episode ancestry queries, `GetUserDataBatch`, `GetResumeUserDataBatch` and active sessions (including additional users and primary-version resolution). One episode query and two native playback batch reads per visible user; no per-episode HTTP calls, filesystem traversal, external metadata or new persistence.

Example (IDs abbreviated only for documentation):

```json
{
  "ItemId": "series-id", "Name": "Example series", "SeriesStatus": "Continuing",
  "IsComplete": true, "LimitReached": false,
  "Users": [{
    "UserId": "user-id", "DisplayName": "Tom", "Reasons": ["CaughtUp"],
    "AvailableEpisodes": 12, "WatchedEpisodes": 12,
    "LastPlayedDate": "2026-10-13T18:30:00Z", "CoverageComplete": true,
    "Watchlisted": false, "CurrentlyPlaying": false
  }],
  "Notice": "Coverage describes the episodes known and visible to Jellyfin, not an external episode catalog."
}
```

`Reasons` describes the current viewing states; Watchlisted and CurrentlyPlaying can coexist with other states. A user's row occurs once. Native last-played date is the latest returned episode/alternate-version timestamp, not an invented completion date. Series status is Continuing, Ended or Unknown.

The pinned [Series model](https://github.com/jellyfin/jellyfin/blob/ca0f16eb7c195f720a1493ed469a27c4657db0c6/MediaBrowser.Controller/Entities/TV/Series.cs) exposes nullable `SeriesStatus`. Continuing plus all eligible aired episodes played, at least one such episode, and sufficient native metadata gives CaughtUp. Ended plus verified completion gives Watched. Started but unfinished aired episodes give InProgress (Watching). Unknown status or incomplete completion metadata gives Unknown instead of asserting completion. Active sessions and explicit membership remain independent.

The existing [native IsUnaired rule](https://github.com/jellyfin/jellyfin/blob/ca0f16eb7c195f720a1493ed469a27c4657db0c6/MediaBrowser.Controller/Entities/BaseItem.cs) treats premiere dates on or after the server-local current date as unaired. Future virtual rows do not create coverage gaps. A missing/virtual aired or undated row, or an available episode without an air date, prevents CaughtUp. No filesystem existence checks or external catalog completeness claims are made. Counts describe known visible available aired episodes. Future-only native unfinished playback can remain a deletion reason under the existing policy without being labelled aired Watching here.

## Limits and UI

Work is bounded at 50 enabled account candidates, 1,000 episode query rows per user, and 20,000 total account/episode read units. A native limit+1 query detects truncation before batch playback work. Budget exhaustion returns completed user observations with `IsComplete:false`, `LimitReached:true` and a notice. Metadata gaps are separate: `CoverageComplete:false` per user and an explanatory notice. `IsComplete` means the target query finished within its bounds, not that Jellyfin knows every externally released episode. Native service/storage errors fail the entire request with 503 rather than returning misleading partial success.

Administrators get a compact count summary and native HTML `details/summary` panel in the existing owned header container. Rows distinguish You, show all reasons once, available counts with incomplete labels and localized last-watched dates. No percentage is shown. Users sort by active playback, Watching/Caught Up, membership, then native recency. The panel scrolls within a bounded area on narrow screens. Parent-series labels remain for season/episode pages. Ordinary users retain their personal bookmark control and make no shared activity request.

Rendering uses DOM creation and textContent. Existing identity/navigation lifetime checks discard stale responses and remove controls on account changes. No React tree, native action button or bundled Web file is replaced. These placement anchors remain Jellyfin 12.2-specific.

## Release and rollback

Version 0.4.3.0 retains GUID `a3c6bc84-783d-4ba8-a0db-89bfb83ab486`, ABI `12.2.0.0`, standalone loader and schema-1 watchlists/preferences. See [Caught Up protection and migration](caught-up-protection.md) and [deployment](deployment.md). Published v0.4.2 assets and public manifest entries remain unchanged. The candidate ZIP contains only the plugin DLL and LICENSE.

## Validation — 2026-10-14

- 87 backend tests, 50 JavaScript/bootstrap tests and 4 catalog tests passed.
- All five existing parallel release jobs ran successfully locally: LinuxServer catalog + Caddy HTTPS, v0.3.1 migration, official-image base path, legacy catalog/browser rollback, and Caddy WebSocket/measurement.
- Four full browser runs each observed 13 approved native DELETEs and zero ordering violations. Existing movie/series/episode/season, bulk, self/other, Cancel/Escape/close, permission, failed lookup and account-change assertions passed. Caught Up adds fresh protection, live enabled/disabled checks, incomplete-metadata rejection and Escape cancellation with zero DELETE. Unit tests cover explicit approval exactly once for every scope/reason.
- Native catalog round trip: v0.4.3 → v0.4.0 → v0.4.1 → v0.4.2 → v0.4.3, with both schema-1 stores and configuration bytes retained; no Injector and one active assembly. The historical v0.3.1 migration/rollback suite also passed.
- Native settings persistence, anonymous/invalid authentication, CSP restrictions, HTTP HEAD/conditional/range/compression/no-store, startup/restart/uninstall and Web file integrity passed. The standalone source is unchanged.
- Synthetic four-episode target queries measured 19 ms direct, 21 ms over Caddy HTTPS and 22 ms through the base-path proxy (single observations during parallel tests). These are small-fixture observations, not production load benchmarks. Large-series work is bounded and exercised by unit safety-limit tests; no 1,000-episode Docker benchmark was performed. No caching was introduced.
- Existing native-browser WebSocket diagnostics still report their historical helper-state/frame-error discrepancy; authenticated Caddy 101 and three persistent ping/pong exchanges passed. This is not new loader behavior. See the existing standalone qualification documentation.

[Desktop screenshot](screenshots/v0.4.3/series-activity-1280.png) · [Narrow screenshot](screenshots/v0.4.3/series-activity-390.png) · [Machine-readable results](performance-data/release-v043.json).

The expanded desktop header shares space with Jellyfin's native actions and floated poster; its text column can narrow, with native title ellipsis and wrapped rows. Scrolling bounds the user list. Custom themes/layouts still need validation. No absolute-positioned overlay or replacement of native components is used.

Two forced Release builds produced identical ZIP bytes:

- SHA-256: `4f374251eb1b25182635c3583505c9838bdb2057842c335c1a21c4cb56c4c8e9`
- Jellyfin catalog MD5: `a55ef923ff48214afc29312713b50d20`

The checked-in catalog is retained unchanged (currently through v0.4.1); publication has an explicit history-preservation guard and requires reconciliation with the public catalog before a future publish. No v0.4.3 URL or timestamp is advertised.
