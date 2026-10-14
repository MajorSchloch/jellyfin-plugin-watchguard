# Phase 2: watchlists and interest detection

> **v0.4.1:** [Self-protection and Caught Up](release-v041.md) supersede historical self-only deletion exclusions and add an activity-only series status. Protection API shape, permissions, storage and standalone loading are retained. Historical validation results below describe their original release.


See [v0.2.1 interest overview and UI refinement](interest-overview.md) for the new playback-aware overview and count popover. Existing explicit-list API contracts and navigation anchors below remain unchanged.

Target and validation baseline: **Jellyfin Server 12.2, .NET 10**, Controller/Model packages **12.2.0**. This backend implements the design in [architecture.md](architecture.md). The backend contract below remains stable. [Phase 3](web-ui.md) now consumes it for detail controls and conditional warnings; there is still no server deletion gate.

## Native services and custom code

`ServiceRegistrator` registers singleton `WatchlistStore` and `InterestService`. Jellyfin discovers the ASP.NET controller. Backend operation does not require JavaScript Injector; the existing web PoC still does.

- `[Authorize]` applies native authentication. `IAuthorizationContext.GetAuthorizationInfo(HttpContext)` resolves the authenticated identity. `IUserManager.GetUserById` rechecks the current account and disabled status. Anonymous requests, removed/disabled accounts, and server API keys without a personal identity cannot own lists. No route accepts a target user ID.
- `ILibraryManager.GetItemById<BaseItem>(id, user)` enforces native item visibility, including ancestor restrictions. Only movies and series are supported. Interest is evaluated only for users who can see the title; deleted/disabled users are ignored. Display names come from current Jellyfin users.
- `IUserDataManager.GetUserDataBatch` reads native played/resume data. `GetResumeUserDataBatch` supplies native alternate-version selection. Completion in either the primary state or selected resume state is authoritative; the selected version supplies the resume position. WatchGuard does not write playback, Favorites, tags, metadata or media files.
- Series use a per-user `InternalItemsQuery`: series ancestor, recursive episodes, `IsVirtualItem=false`, `IsMissing=false`. Currently returned available episodes are the entire aggregation set. An absent episode contributes nothing; incomplete playback service results cause an error, not an assumed unplayed state.
- `ISessionManager.Sessions` supplies active sessions and additional users. `IsActive` plus a non-null `NowPlayingItem` is required. Now-playing IDs match the visible movie/episodes, including a visible alternate with a native `PrimaryVersionId` pointing to one of those IDs.

There is no HTTP loopback, database schema extension, custom playback persistence or additional runtime package dependency. JSON uses `System.Text.Json`. Test-only dependencies are xUnit, Microsoft.NET.Test.Sdk and Moq; they are not deployed with the plugin.

Source contracts were checked in the pinned Jellyfin 12.2 source used by the architecture review: [authorization context](https://github.com/jellyfin/jellyfin/blob/v12.2/MediaBrowser.Controller/Net/IAuthorizationContext.cs), [native playback implementation](https://github.com/jellyfin/jellyfin/blob/v12.2/Emby.Server.Implementations/Library/UserDataManager.cs), [library interface](https://github.com/jellyfin/jellyfin/blob/v12.2/MediaBrowser.Controller/Library/ILibraryManager.cs), and [session activity](https://github.com/jellyfin/jellyfin/blob/v12.2/MediaBrowser.Controller/Session/SessionInfo.cs).

## Interest rules

| Reason | Condition |
| --- | --- |
| `Watchlisted` | Explicit user/title ID pair in WatchGuard storage. Playback completion never removes it. |
| `InProgress` — movie | Effective played state is false and resume position is greater than zero. |
| `InProgress` — series | At least one available episode has been played or has a resume position, and at least one available episode is not played. |
| `CurrentlyPlaying` | Active native session reports the movie or an available episode, for its primary or additional user. Paused playback can count. |

Each user appears once, with all applicable reasons. Empty series, completely unstarted series and fully completed content have no automatic progress interest. Explicit membership and current playback can still contribute. Specials participate if available. Newly available episodes can make a completed series in progress again. Resume thresholds remain Jellyfin's responsibility.

Every request rereads the JSON and native services; WatchGuard has no decision cache. Jellyfin maintains its own native playback cache. Results are a best-effort snapshot across those services, not an atomic transaction with deletion or playback updates.

## API

All responses are non-cacheable (`Cache-Control: no-store`, through ASP.NET response-cache handling). Use the ordinary Jellyfin user authentication header, such as `Authorization: MediaBrowser Token="<user-access-token>"`. Do not put tokens in URLs or diagnostic output. JSON uses Jellyfin's native PascalCase property conventions.

| Method and route | Access and result |
| --- | --- |
| `GET /WatchGuard/Watchlist` | Current enabled user only. `200` array of visible supported entries with `ItemId` and `Name`. Stale/inaccessible entries are omitted. |
| `PUT /WatchGuard/Watchlist/{itemId}` | Add own visible movie/series; `204`, including repeated adds. No request body. |
| `DELETE /WatchGuard/Watchlist/{itemId}` | Remove own membership; `204`, including repeated removal and stale/inaccessible IDs. Does not delete media. |
| `GET /WatchGuard/Protection/{itemId}` | Current enabled **administrator** only. `200` complete interest snapshot for a visible movie/series. |

Malformed GUIDs do not match the route (`404`); empty GUIDs on mutations return `400`. Unknown, invisible or unsupported titles return `404` on add/protection. Missing membership is not an error on removal. Unauthenticated/userless requests return `401`. A non-administrator receives `403` on protection **before item lookup**, without counts, names, reasons or interest booleans. Native authorization may reject invalid/disabled credentials before the controller runs.

Watchlist example:

```json
[
  { "ItemId": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "Name": "Example Movie" }
]
```

Administrator protection example:

```json
{
  "ItemId": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "HasInterest": true,
  "HasOtherInterestedUsers": true,
  "Users": [
    {
      "UserId": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "DisplayName": "Alice",
      "Reasons": ["Watchlisted", "InProgress", "CurrentlyPlaying"]
    }
  ]
}
```

`Users` includes the acting administrator if interested. `HasOtherInterestedUsers` excludes that administrator by ID. A confirmed zero-interest result is `200` with both booleans false and `Users: []`. API consumers should treat only a successful valid response as a completed check.

Storage/query/processing failures return **503 ProblemDetails**, with title `WatchGuard state unavailable` and detail `Interest could not be determined. Retry after resolving the server error.` Partial results are discarded. Paths, exception messages and credentials are not included. The server logs the exception type only. `404`, `401`, `403`, `503` and network failures are **not** zero-interest responses or deletion authorization.

## Persistence and recovery

The store is `Plugin.DataFolderPath/watchlists.json`. In the official container this is normally `/config/plugins/Jellyfin.Plugin.WatchGuard/watchlists.json`, separate from the directory into which the plugin DLL was copied. Use the plugin-provided directory rather than assuming a `/config/data` path.

```json
{
  "Version": 1,
  "Entries": [
    {
      "UserId": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      "ItemId": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
    }
  ]
}
```

One singleton lock serializes reads and read-modify-write operations. Idempotent changes do not rewrite the file. Writes serialize to a unique file in the same directory, flush file contents to disk, and atomically rename over the destination. Failed writes do not publish in-memory state. Temporary files from caught failures are removed; a process crash can leave an unused `.tmp` file. No directory-fsync/power-loss durability guarantee is claimed.

Malformed JSON, unknown properties/schema versions, missing/null entry arrays, empty IDs and duplicate pairs are rejected. **There is no automatic reset or salvage that could silently discard memberships.** All dependent operations return unavailable until the file is repaired/restored. A missing file is treated as a new empty store; back up the plugin data directory along with Jellyfin's configuration.

Recovery procedure:

1. Stop Jellyfin to prevent concurrent external edits. Preserve the damaged file separately for investigation.
2. Restore a known-good version-1 file from backup using atomic replacement. Do not delete the damaged file merely to dismiss the error; that would create an empty list.
3. Restart and verify list/protection responses. No internal cache needs invalidation. Tests also demonstrate explicit restoration without restarting; Docker Desktop bind-mount propagation can delay visibility briefly.

The plugin does not maintain an automatic backup or merge externally edited files. It supports **one server process per store on a local filesystem**. Shared/network filesystems and multiple writers outside the singleton are unsupported. Store permissions follow the Jellyfin process and filesystem defaults; protect the configuration volume. Removed-user and missing-item pairs are retained on disk, omitted from results, and never reassigned by username. An existing incompatible prototype schema causes an explicit error and requires deliberate migration/restoration; it is not silently overwritten.

## Validation and reproduction

Run from the repository root:

```sh
dotnet restore Jellyfin.Plugin.WatchGuard.slnx --locked-mode
dotnet test Jellyfin.Plugin.WatchGuard.slnx -c Release --no-restore
node --test tests/web.test.cjs
dotnet publish Jellyfin.Plugin.WatchGuard/Jellyfin.Plugin.WatchGuard.csproj \
  -c Release --no-restore -o artifacts/WatchGuard
npm ci --prefix tests/browser
(cd tests/browser && npx playwright install chromium)
python3 tests/docker-smoke.py --injector-dll /path/to/Jellyfin.Plugin.JavaScriptInjector.dll
```

The Docker harness creates its own localhost-only server, synthetic videos and temporary accounts; it never mounts an existing media library. It runs `backend-smoke.py` before the unchanged browser deletion scenarios, then removes the container and fixture. Injector revision and image digest are recorded in [deletion-poc.md](deletion-poc.md#test-environment-and-evidence). `--serve` runs the backend assertions, then leaves the disposable fixture available until Ctrl+C.

Results on **2026-10-10**:

- **25 backend unit tests passed:** own CRUD/idempotency and account isolation; 100 concurrent additions/removals with reload; malformed/unknown-schema/invalid-entry storage and explicit recovery; failed replacement cleanup; incomplete/completed movies; alternate-version resume/completion; empty/unstarted/partly/fully completed series; ignored historical missing episodes; multiple users and reasons; active/inactive sessions and additional users; alternate movie sessions; unauthorized/disabled/deleted accounts; missing/hidden items; lookup failures returning 503.
- **Live Jellyfin 12.2 HTTP checks passed:** native authentication and admin denial, concurrent idempotent requests, account isolation, missing-item rejection, native playback updates, series completion, reported playback start/stop, corruption preservation/503 and explicit restoration, deleted-user filtering. Successful empty responses were distinguished from errors. This verifies real controller discovery and DI as well as mocked unit contracts.
- **14 unchanged web adapter unit tests passed. Live browser regression passed** for movie and series detail pages, card context menus, Escape, and two-item bulk selection. The run recorded 11 interceptions, six cancellations with no corresponding DELETE, five explicitly approved DELETE requests, and zero ordering violations. Native generic error dialogs still appear on cancellation. Evidence is generated at `artifacts/poc/report.json`; broader client limitations remain in [deletion-poc.md](deletion-poc.md).

## Remaining limits

This backend answers interest queries; it does not bind the answer atomically to deletion. Phase 3 now displays names/reasons through its web adapter. Native clients, direct API deletion, filesystem deletion and server-side cleaners are not protected.

Visibility and playback results follow Jellyfin's native services. Available means present in the native library query, not that WatchGuard probes files or remote streams. Paused and stale-but-still-active native sessions can count; no arbitrary timeout is added. Alternate matching follows native resume selection and `PrimaryVersionId`; independently imported copies are separate IDs, and alternate deletion scope is not verified here. Multi-version behavior is unit-tested, not covered by a multi-version live media fixture.

Aggregation is proportional to users and available episodes, with batched native data calls but no large-library performance benchmark. There is no pagination, automatic stale-entry cleanup, playlist synchronization, external database or production UI. The Phase 3 web integration retains the advisory web-only limitations documented in Phase 1. Nothing was deployed to production.

## v0.2.0 addition

The existing endpoints and schema are unchanged. Administrator-only `GET /WatchGuard/Watchlists` provides deduplicated explicit memberships with native owner display names; it is read-only and returns 503 on lookup/storage failure. See [route contract, authorization and example](navigation.md#read-only-administrator-api).

## v0.2.2 optional automatic overview

Both `GET /WatchGuard/InterestOverview?automaticOnly=true` (administrator only) and `GET /WatchGuard/InterestOverview/Me?automaticOnly=true` (current account only) retain the existing response shape and native discovery/verification budgets. The optional flag defaults to false, preserving the v0.2.1 combined contract. With the flag enabled, the service does not read membership storage or seed explicit-only candidates; results contain `InProgress` and/or `CurrentlyPlaying`, never `Watchlisted`. The page first loads the unchanged explicit-list endpoint and merges these independent snapshots by item/user ID. Storage errors and automatic lookup errors remain distinguishable in the UI. Native InterestService, protection routes, deletion checks, permissions and storage schema are unchanged. See [performance.md](performance.md).

## v0.2.3 activity projection

`GET /WatchGuard/ActivityOverview` is administrator-only; `GET /WatchGuard/ActivityOverview/Me` returns only the authenticated account. They use the overview response envelope with native `LastPlayedDate`, nullable `AvailableEpisodes`/`WatchedEpisodes`, and an overview-only `Watched` status. The existing InterestOverview routes retain their interest-only reason contract. Neither history nor counts alter protection responses. Read [activity.md](activity.md) for exact dates, budgets, completion rules and examples.

## v0.4.6 activity discovery

ActivityOverview adds structured `Coverage` and aggregate `Diagnostics`; existing fields and authorization remain. See [API field definitions, bounds, failure/cancellation semantics and benchmarks](activity-discovery-v046.md). No continuation cursor is offered. The protection endpoint, schemas and policies remain unchanged.
