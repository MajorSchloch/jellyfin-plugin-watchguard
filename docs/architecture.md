# WatchGuard architecture proposal — Jellyfin 12

> **v0.4.3:** See [targeted series activity](series-viewing-activity.md) and [configurable Caught Up protection](caught-up-protection.md). These supersede the historical activity-only Caught Up policy; standalone loading remains unchanged.

> **v0.4.1:** [Self-protection and Caught Up](release-v041.md) supersede historical self-only deletion exclusions and add an activity-only series status. Protection API shape, permissions, storage and standalone loading are retained. Historical validation results below describe their original release.


Research date: **2026-10-10**. Status: **research and proposed design; deletion-warning approach awaits browser validation and approval before implementation proceeds**. This review changes documentation only. Existing prototype code and previous 12.0 test results are not evidence that the proposed integration works in every current 12.x client.

## Recommendation and decision gate

Use native Jellyfin identity, permissions, library queries, playback state, and deletion. Store only explicit personal watchlist membership in a small plugin-owned JSON file. Use JavaScript Injector for a small web adapter.

**There is no supported cancellable pre-delete event in the inspected Jellyfin 12.2 library API.** `ItemRemoved` occurs after file deletion. An injected wrapper around the specific Web `ApiClient.deleteItem` method is a feasible **web-only advisory warning**, subject to validating the actual browser call path. It is an internal, version-specific integration, not a supported Jellyfin extension contract or server-wide deletion safeguard.

Proceed only if that limited scope is acceptable and the validation checklist below passes. If universal prevention across native clients and server cleanup is required, this design is insufficient; a supported upstream server hook would be the appropriate longer-term solution.

## Research baseline and sources

The current stable [server](https://github.com/jellyfin/jellyfin/releases/tag/v12.2) and [web client](https://github.com/jellyfin/jellyfin-web/releases/tag/v12.2) are **12.2**, rather than the previously reviewed 12.0 baseline. Source archives were inspected at these revisions:

| Repository | Inspected revision | Relevant evidence |
| --- | --- | --- |
| [jellyfin/jellyfin](https://github.com/jellyfin/jellyfin/tree/ca0f16eb7c195f720a1493ed469a27c4657db0c6) | `v12.2`, `ca0f16eb7c195f720a1493ed469a27c4657db0c6` | User data, library queries, permissions, controllers, deletion, playlists |
| [jellyfin/jellyfin-web](https://github.com/jellyfin/jellyfin-web/tree/61b1f890365ad15138e943e694af723c1d47df2a) | `v12.2`, `61b1f890365ad15138e943e694af723c1d47df2a` | Detail views, context menus, bulk deletion, confirmation and ApiClient |
| [jellyfin/jellyfin-plugin-template](https://github.com/jellyfin/jellyfin-plugin-template/tree/c93225a0a5a76d3843db05b4b5b77fcfc482fba3) | `c93225a0a5a76d3843db05b4b5b77fcfc482fba3` | Plugin discovery, configuration pages, service registration and controllers |
| [shemanaev/jellyfin-plugin-media-cleaner](https://github.com/shemanaev/jellyfin-plugin-media-cleaner/tree/bafbfd33a69c96834f4f076d579090cde6d8ee89) | `bafbfd33a69c96834f4f076d579090cde6d8ee89` | Native playback reading and direct library deletion from a plugin |
| [n00bcodr/Jellyfin-JavaScript-Injector](https://github.com/n00bcodr/Jellyfin-JavaScript-Injector/tree/2758804c987d490ef32fc2fbdb8a73a44facdf2c) | `2758804c987d490ef32fc2fbdb8a73a44facdf2c` | Programmatic registration, authenticated script delivery, response-time injection |

`MediaBrowser.Controller.csproj` at v12.2 targets **net10.0** with package version **12.2.0**. The NuGet flat-container indexes for [Jellyfin.Controller](https://api.nuget.org/v3-flatcontainer/jellyfin.controller/index.json) and [Jellyfin.Model](https://api.nuget.org/v3-flatcontainer/jellyfin.model/index.json) confirm published 12.0.0, 12.1.0 and 12.2.0 packages. The proposed initial validation target is matching server/web 12.2; support for older 12.x versions should be declared only after testing. Do not copy old framework/package versions from template examples.

## 1. Native playback storage and access

Jellyfin owns persistent per-user playback data in its database. The current [`UserData` entity](https://github.com/jellyfin/jellyfin/blob/v12.2/src/Jellyfin.Database/Jellyfin.Database.Implementations/Entities/UserData.cs) includes `PlaybackPositionTicks`, `Played`, `PlayCount`, `LastPlayedDate`, and `IsFavorite`. Its [composite key](https://github.com/jellyfin/jellyfin/blob/v12.2/src/Jellyfin.Database/Jellyfin.Database.Implementations/ModelConfiguration/UserDataConfiguration.cs) is `(ItemId, UserId, CustomDataKey)`. `CustomDataKey` participates in Jellyfin's own item/user-data key resolution; it is not an arbitrary plugin watchlist field. WatchGuard should neither query this schema directly nor add watchlist rows to it.

Use [`IUserDataManager`](https://github.com/jellyfin/jellyfin/blob/v12.2/MediaBrowser.Controller/Library/IUserDataManager.cs) through dependency injection:

| Native API | Proposed use |
| --- | --- |
| `GetUserData(User, BaseItem)` | Read an item's played/resume state; respect the nullable interface contract |
| `GetUserDataBatch(IReadOnlyList<BaseItem>, User)` | Read episode state in batches; avoid a custom per-episode database query loop |
| `GetUserDataDto(BaseItem, User)` | Obtain native UI-oriented state, including alternate-version resume handling |
| `GetResumeUserData` / `GetResumeUserDataBatch` | Reuse native alternate-version selection when evaluating a title's playback |
| `UserDataSaved` | Optional future cache invalidation; unnecessary for an uncached MVP |

The [implementation](https://github.com/jellyfin/jellyfin/blob/v12.2/Emby.Server.Implementations/Library/UserDataManager.cs) resolves current and older user-data keys. The single-item read uses the item's loaded user-data rows; the batch path can query missing rows. Prefer the batch service when aggregating loaded episode lists. Native `UpdatePlayState` applies configured resume/completion thresholds, so do not invent a second completion percentage or write playback state from WatchGuard.

For clients, current endpoints include `GET /UserItems/{itemId}/UserData`, `GET /UserItems/Resume`, and item DTOs with `UserData`. Legacy `/Users/{userId}/…` forms remain in the inspected source, but should not be the default for new client code. [`TvShowsController`](https://github.com/jellyfin/jellyfin/blob/v12.2/Jellyfin.Api/Controllers/TvShowsController.cs) exposes `GET /Shows/{seriesId}/Episodes` and `/Shows/NextUp`. Server-side plugin logic can use the injected services directly instead of making HTTP requests back to Jellyfin.

## 2. Proposed interest rules

These rules are WatchGuard product decisions built on native state, not native watchlist semantics:

- **Watchlisted:** an explicit `(UserId, ItemId)` membership exists. Completion never clears it.
- **Partially watched movie:** native effective state is `Played == false` and `PlaybackPositionTicks > 0`.
- **In-progress series:** at least one currently available episode is played or has a resume position, and at least one available episode is not played. An empty or completely unstarted series contributes no inferred interest.
- **Currently watching:** a native session reports the movie, or an episode of the series, as its now-playing item. Include additional session users; a paused session can still count. This is reported session state, not proof of attention.

Enumerate current users through `IUserManager.GetUsers()` and resolve display names with `GetUserById()`. Use `ILibraryManager.GetItemById<BaseItem>(id, user)` for native visibility checks. For series, use a user-scoped `InternalItemsQuery` with episode type, series ancestor, and exclusion of virtual/missing episodes, then `GetUserDataBatch`. Count specials if they are part of the available episode set. New episodes can make a previously complete series in progress again. Removed episodes cease contributing to the set.

Use `Played` as authoritative for completion even if a position remains. The native DTO/resume services consider alternate versions; reading only the primary item's raw position can miss a resumed alternate. Validate multi-version behavior and the actual deletion scope together before claiming coverage. Explicit watchlist IDs remain local Jellyfin item IDs; independently imported copies are not automatically the same watchlist title.

Use `ISessionManager.Sessions` for active state. Deduplicate by user ID and return all applicable reasons. Ignore removed/disabled users and hide missing/inaccessible titles. Distinguish service/query failures from confirmed absence of interest: a failed check must not silently authorize deletion. Native Continue Watching and Next Up are useful UI features but are not a complete cross-user interest policy; their filters and viewing-order behavior should not define protection implicitly.

## 3. Personal watchlists and authentication

No inspected native API provides a general independent movie-and-series personal watchlist with the required semantics. Options:

| Option | Assessment |
| --- | --- |
| Favorites | Native and easy, but changes user meaning; excluded |
| Native playlists | Useful for stock clients, but series expand into playable descendants; not equivalent |
| Plugin configuration XML | Appropriate for small administrative settings; mutable multi-user lists would share its configuration lifecycle |
| Plugin-owned versioned JSON | Recommended: small, independent, no external database or synchronization |
| Custom tables in Jellyfin's database | Unnecessary coupling to internal migrations and schema; avoid |

Proposed storage: `BasePlugin.DataFolderPath/watchlists.json`, schema version plus unique user/item GUID pairs. Resolve names at request time. Use one singleton writer lock, same-directory temporary files, flushed writes, and atomic replacement. Publish in-memory changes only after durable replacement. Reject unknown schema versions and corruption without overwriting the store. Filter stale references from results; permit users to remove their own stale entries. Do not automatically clear manual entries on playback completion.

The [base plugin](https://github.com/jellyfin/jellyfin/blob/v12.2/MediaBrowser.Common/Plugins/BasePluginOfT.cs) derives this data folder from `IApplicationPaths.PluginsPath` and the assembly name. Do not assume it is under `/config/data`: with the official container it can be `/config/plugins/Jellyfin.Plugin.WatchGuard`. Use the supplied property. This is a single-server-process design.

Use native plugin service registration and ASP.NET controller discovery. `[Authorize]` invokes Jellyfin's default authentication/authorization policy. Resolve the current enabled user from the native authenticated principal; v12.2's claim name is [`Jellyfin-UserId`](https://github.com/jellyfin/jellyfin/blob/v12.2/Jellyfin.Api/Constants/InternalClaimTypes.cs). Prefer the native accessor where available through appropriate references; otherwise isolate this verified claim dependency in a small adapter. Never accept a caller-supplied user ID for list mutation. API keys without a user should not own a watchlist.

Proposed operations: list own entries, get own membership, idempotently add/remove own membership, and get administrator-only protection status. Check item visibility before exposing or adding a title. Check administrator permission against the current native user, not a JavaScript flag. No cross-user names, counts, or interest booleans should be returned to non-admins under the existing privacy requirement. That means a cross-user detail badge must also be admin-only. Responses should be non-cacheable.

## 4. Web extension without a source fork

Native `IHasWebPages` supplies plugin dashboard pages, not arbitrary movie/series detail-page extension slots. The template establishes backend extension conventions but does not provide a public pre-delete Web hook.

Use Injector's documented [`PluginInterface.RegisterScript(JObject)`](https://github.com/n00bcodr/Jellyfin-JavaScript-Injector/blob/2758804c987d490ef32fc2fbdb8a73a44facdf2c/Jellyfin.Plugin.JavaScriptInjector/PluginInterface.cs), with a stable script ID, plugin identity, embedded JavaScript and `requiresAuthentication=true`. Its documented reflection approach can avoid a hard assembly dependency; constructing the expected payload through the discovered type can also avoid adding a direct Newtonsoft dependency. Registration needs startup-order handling and visible failure logging. Plan for script update/unregistration because persisted registrations can outlive the plugin.

The inspected Injector uses [`IStartupFilter` response middleware](https://github.com/n00bcodr/Jellyfin-JavaScript-Injector/blob/2758804c987d490ef32fc2fbdb8a73a44facdf2c/Jellyfin.Plugin.JavaScriptInjector/Services/ScriptInjectionStartupFilter.cs) to inject its loader into the served Web index. It also has legacy disk-rewrite/File Transformation fallback paths. Prefer response-time injection to satisfy the no-source-modification objective. Injector requires a Jellyfin 12 build; the inspected source's jf12 package default is still an RC version, so verify the selected release artifact independently.

Proposed detail integration: native view events and a narrowly scoped, source-verified placement anchor; ordinary DOM controls and native button styling. The legacy view currently has `itemDetailPage`, `.detailPagePrimaryContent` and `viewshow` parameters. These are internal DOM conventions, not a stable plugin contract. Modern React layout needs a separate placement assessment. Insert user/title names as text, handle account/server changes, and avoid generic fetch/XHR patches or a page-wide mutation observer.

## 5. Manual deletion pipeline and interception

### Server

[`LibraryController`](https://github.com/jellyfin/jellyfin/blob/v12.2/Jellyfin.Api/Controllers/LibraryController.cs) exposes `DELETE /Items/{itemId}` and `DELETE /Items?ids=…`. It resolves a user/API-key context, gets the item with applicable visibility, checks `CanDelete(user)` for user requests, then calls `ILibraryManager.DeleteItem` with `DeleteFileLocation=true`. API-key handling is distinct; do not replace or simplify these native permission semantics in a custom delete endpoint.

[`LibraryManager`](https://github.com/jellyfin/jellyfin/blob/v12.2/Emby.Server.Implementations/Library/LibraryManager.cs) removes file paths before persistence removal and `ReportItemRemoved`. The `ItemRemoved` handler runs after removal and its exceptions are caught/logged. [`ILibraryManager`](https://github.com/jellyfin/jellyfin/blob/v12.2/MediaBrowser.Controller/Library/ILibraryManager.cs) exposes added/updated/removed notifications but no cancellable “before delete” event. It also exposes `DeleteItemsUnsafeFast`.

General ASP.NET middleware/action filters could reject matching HTTP requests before the controller executes, but that would be custom HTTP gating, not a native library veto. It would need a client warning/override protocol and would miss direct library calls. Media Cleaner's [`JellyfinMutationAdapter`](https://github.com/shemanaev/jellyfin-plugin-media-cleaner/blob/bafbfd33a69c96834f4f076d579090cde6d8ee89/MediaCleaner/Adapters/JellyfinMutationAdapter.cs) demonstrates the direct plugin deletion path. Do not represent an after-delete event, exception from that event, or HTTP-only middleware as universal prevention.

### Web

The source-observed sequence is:

1. Context menu selects delete.
2. [`deleteHelper.deleteItem`](https://github.com/jellyfin/jellyfin-web/blob/v12.2/src/scripts/deleteHelper.js) shows native confirmation.
3. On confirmation, `ServerConnections.getApiClient(item.ServerId).deleteItem(item.Id)` sends deletion.
4. Success triggers native navigation/refresh; rejection triggers native error handling.

[`multiSelect`](https://github.com/jellyfin/jellyfin-web/blob/v12.2/src/components/multiSelect/multiSelect.js) confirms once, then invokes `apiClient.deleteItem` separately for each selected ID using `Promise.all`. Neither that flow nor the server bulk endpoint is transactional.

The modern [`MoreCommandsButton`](https://github.com/jellyfin/jellyfin-web/blob/v12.2/src/apps/modern/features/details/components/buttons/MoreCommandsButton.tsx) also delegates to the shared `itemContextMenu`; modern Web is not categorically a bypass. However, each actual path and client instance must be checked. Future/direct SDK calls need not use this method.

### Proposed warning adapter

The narrow candidate is a wrapper around the relevant `ApiClient.deleteItem` instance. [`ServerConnections`](https://github.com/jellyfin/jellyfin-web/blob/v12.2/src/lib/jellyfin-apiclient/ServerConnections.js) assigns the local client to `window.ApiClient`. It is necessary to prove that the client used by the selected deletion path is the wrapped instance; the global alone is not a guarantee for all servers or views.

After native confirmation, but before invoking the original method, resolve the affected movie/series and fetch fresh protection status. Exclude the acting user's own interest. When another user is interested, show names/reasons and **Cancel / Delete Anyway**. Cancel/Escape rejects without invoking native deletion; override invokes the original method exactly once with its original receiver and arguments. Network errors, invalid responses and account changes should reject. Keep the native permission checks and deletion request unchanged.

A rejected wrapper promise can trigger Jellyfin's generic deletion-error alert even for deliberate cancellation. Do not return success to hide that alert: native code would then navigate/refresh as though the item were deleted. Validate whether this UX is acceptable before implementation.

Bulk cancellation must be described precisely: a method wrapper controls each item, not the whole batch. Serializing prompts does not make deletion atomic; a later cancellation cannot undo earlier approved items. If one Cancel must abort the entire selection before any file is removed, this integration point is insufficient without a separate, validated batch-level integration.

Non-admins cannot receive detailed interest under the privacy rule. Proposed MVP: a generic, clearly labelled “status unavailable to this account” confirmation for non-admin users who have native delete permission. It is not a successful protection check. Alternatively defer non-admin warning support; do not silently reveal cross-user state or claim equivalent coverage. This policy needs agreement with the advisory scope.

## 6. Reuse and dependency choices

| Native capability | Reuse recommendation |
| --- | --- |
| User/library/session services and batch playback reads | Use directly; do not duplicate playback persistence |
| Native deletion confirmation and permissions | Preserve; add the interest check before the original delete call |
| Web [`confirm.ts`](https://github.com/jellyfin/jellyfin-web/blob/v12.2/src/components/confirm/confirm.ts) and dialog components | Internal bundled modules, not a stable injected-script import API; avoid webpack/runtime extraction merely to reuse them |
| Browser `<dialog>` and Jellyfin button styling | Small fallback for the extra warning; verify accessibility, Escape and focus return |
| Native own-list navigation/detail links | Reuse item pages instead of creating a frontend framework |
| Native playlist ownership/sharing | Useful future option only if playlist semantics become the sole source of truth |

[`Playlist.GetPlaylistItems`](https://github.com/jellyfin/jellyfin/blob/v12.2/MediaBrowser.Controller/Playlists/Playlist.cs) expands folder inputs, including series, into playable descendants. JSON-to-playlist mirroring would add reconciliation for client edits, new episodes and removed items. A future movie-only mode could use one private native playlist per user as the sole store, but it is not a drop-in solution for title-level movie/series lists. Do not maintain two writable representations in the MVP.

Proposed dependencies: .NET 10, matched/pinned Jellyfin Controller and Model packages with runtime assets excluded, shared ASP.NET runtime, and Jellyfin-12-compatible JavaScript Injector for Web UI. Use `System.Text.Json`; no external database, Seerr, automation integrations or frontend framework. Keep test-only packages separate from plugin deployment. Backend endpoints should remain usable when Injector is absent, with an explicit indication that no web warning is active.

## Limitations

- Direct REST clients, native/mobile/TV clients without the injected script, cleanup plugins and filesystem deletion bypass the web adapter.
- Deletion before script installation, on an unwrapped client instance, or after another script replaces the method bypasses it.
- Folder/library deletion, unsupported types and alternate-version deletion scope require separate analysis. Movie/series coverage must not imply recursive protection for every container.
- Check-to-delete races remain: another user can express interest while the warning is open. There is no atomic server transaction binding the check to deletion.
- Scripts and DOM/global conventions can change across upgrades. Injector persistence/caching can leave stale scripts installed.
- Per-user episode aggregation costs grow with users and episodes. Use native batches, measure, and add caching only with a defined freshness policy.

## Recommended MVP and required validation

**Proposed scope:** personal movie/series membership; own-list API and small Web controls; administrator-only interest detail; native playback/session aggregation; conditional Web deletion warning. No new delete endpoint, automatic deletion, metadata tags, Favorites reuse, automatic clearing, or playlist synchronization.

Before implementing that MVP, validate the deletion adapter on disposable media with the chosen **12.2 server, matching Web build and Injector artifact**:

1. Trace legacy detail/context-menu, modern More Commands and multi-select deletion to the exact client instance and method.
2. Verify native confirmation remains first, the latest status is fetched, and no DELETE is sent before explicit approval.
3. Cancel, Escape, dialog close, network failure, malformed status and logout during the check must issue no DELETE for that action.
4. Delete Anyway must issue exactly one unchanged native request; native permission denial must still win.
5. Validate multiple simultaneous deletions and agree on per-item versus whole-batch cancellation semantics.
6. Test startup, delayed injection, restored views, server switches, base URLs, script duplication and plugin replacement of the method.
7. Exercise partial/completed movies, series episode availability, current sessions, alternate versions, manual-entry retention, missing media and removed users.
8. Verify non-admin privacy, names rendered as text, keyboard focus and the native error alert after cancellation.
9. Demonstrate and document bypass paths rather than treating their absence from the UI test as protection.

Source review establishes feasibility, not browser reliability. Prior 12.0 server/adapter tests in this repository do not close this 12.2 validation gate. **Recommended decision: conditionally accept an advisory web-only MVP after the above proof; do not claim server-enforced protection.**
