# Architecture and research

Inspected on 2026-10-10. Compatibility baseline is **server/web v12.0**, not an assumption that all future 12.x internals stay compatible. NuGet `Jellyfin.Controller` and `Jellyfin.Model` **12.0.0** restore successfully and target **net10.0**. WatchGuard builds against them with runtime assets excluded.

## Sources inspected

| Repository | Revision / result |
| --- | --- |
| [jellyfin/jellyfin](https://github.com/jellyfin/jellyfin/tree/6c073e19ddf604b2369c638716164fdab4c952dc) | `v12.0`, `6c073e19ddf604b2369c638716164fdab4c952dc` |
| [jellyfin/jellyfin-web](https://github.com/jellyfin/jellyfin-web/tree/0e83c6a724b31f3e9b5a499244331a288c060a4a) | `v12.0`, `0e83c6a724b31f3e9b5a499244331a288c060a4a` |
| [plugin template](https://github.com/jellyfin/jellyfin-plugin-template/tree/c93225a0a5a76d3843db05b4b5b77fcfc482fba3) | `c93225a0a5a76d3843db05b4b5b77fcfc482fba3`; discovery, DI and controller conventions; historical template packages were not reused |
| [Media Cleaner](https://github.com/shemanaev/jellyfin-plugin-media-cleaner/tree/bafbfd33a69c96834f4f076d579090cde6d8ee89) | `bafbfd33a69c96834f4f076d579090cde6d8ee89`; native playback reader, compatibility adapter, cleanup paths |
| [JavaScript Injector](https://github.com/n00bcodr/Jellyfin-JavaScript-Injector/tree/2758804c987d490ef32fc2fbdb8a73a44facdf2c) | `2758804c987d490ef32fc2fbdb8a73a44facdf2c`; `PluginInterface`, registration service, script controller, separate jf12/jf10 builds |

## Native versus custom

Native Jellyfin provides authentication, users, library visibility, playback state, active sessions, and all actual deletion. Custom code provides a JSON watchlist, interest aggregation, five small REST operations, and an injected JavaScript adapter. Favorites, tags, and media files are never modified by WatchGuard. No Seerr calls or data synchronization exist.

`IUserManager.GetUsers()` / `GetUserById()` provide current identities and display names. `IUserDataManager.GetUserData(User, BaseItem)` returns nullable state with `Played` and `PlaybackPositionTicks`. This is the v12 signature; older GUID-based examples are not used. `ILibraryManager.GetItemById<BaseItem>(id, user)` enforces native standalone visibility, including ancestors. A user-scoped `InternalItemsQuery` with series `AncestorIds`, episode type, `IsVirtualItem=false` and `IsMissing=false` enumerates currently available episodes. Removed and disabled users do not produce interest; unavailable titles are not returned. An episode set is evaluated per user against that user's accessible library.

A movie is incomplete when it has a nonzero position and is not played. A series is incomplete when any available episode is played or has a nonzero position, and not all available episodes are played. Zero episodes means no inferred interest. Specials count if Jellyfin exposes them as available episodes. New episodes can make an already-started series incomplete again. `Played` is authoritative even if Jellyfin retains a resume position. `ISessionManager.Sessions` adds “Currently watching” for reported now-playing items, including session additional users; paused sessions count until Jellyfin clears the item. This uses reported state, not a guarantee that someone is looking at the screen.

Each user appears once with all applicable reasons. Manual membership persists until explicitly removed. No playback-triggered writes occur. Status is computed on demand without caching; cost is proportional to users × available episodes. This favors freshness and a small implementation; very large multi-user libraries may need measurement before introducing batching.

## Watchlist storage and authorization

`BasePlugin.DataFolderPath/watchlists.json` is a version-1 document containing `(UserId, ItemId)` GUID pairs. A singleton serializes mutations, writes and flushes a same-directory temporary file, atomically replaces the old file, then publishes its in-memory snapshot. Failed writes do not change memory. Unknown schemas/corruption fail closed. Stale references remain on disk but are filtered from results, allowing temporary library unavailability without destroying explicit intent. This store is single-process, not a distributed database.

An ASP.NET controller is discovered through Jellyfin's plugin assembly discovery. `[Authorize]` applies Jellyfin's default policy. The controller additionally requires a current, enabled user resolved from the **`Jellyfin-UserId`** claim (verified in `Jellyfin.Api/Constants/InternalClaimTypes.cs`). It never accepts a target user ID. Admin checks read current native permissions, not a browser-supplied flag. API keys without users cannot access personal lists. Cross-user names, reasons, counts, and interest booleans are all admin-only. Non-admin detail pages expose only their own watchlist. This resolves the requirement conflict between a general cross-user badge and administrator-only status visibility in favor of privacy.

## Actual deletion pipeline — findings reported before UI implementation

[LibraryController](https://github.com/jellyfin/jellyfin/blob/v12.0/Jellyfin.Api/Controllers/LibraryController.cs) implements `DELETE /Items/{itemId}` and `DELETE /Items?ids=…`. It resolves the authenticated user/API key, checks visibility and `CanDelete(user)`, then calls `ILibraryManager.DeleteItem` with `DeleteFileLocation=true`. Bulk deletion loops, so native deletion is not transactional.

[LibraryManager](https://github.com/jellyfin/jellyfin/blob/v12.0/Emby.Server.Implementations/Library/LibraryManager.cs) deletes filesystem paths before persistence removal and `ReportItemRemoved`. The `ItemRemoved` event is a notification after deletion, not a cancellation hook; handler exceptions are caught/logged. The inspected `ILibraryManager` contract has no supported cancellable pre-delete event. `DeleteItemsUnsafeFast` is another internal path. General ASP.NET filters/middleware could gate some HTTP routes, but cannot guarantee protection for direct internal library calls and introduce global interception and override protocol complexity. This MVP does not install them or claim universal protection.

In [web deleteHelper](https://github.com/jellyfin/jellyfin-web/blob/v12.0/src/scripts/deleteHelper.js), the native confirmation resolves before `ServerConnections.getApiClient(...).deleteItem(item.Id)`. Context menus use that helper. [multiSelect](https://github.com/jellyfin/jellyfin-web/blob/v12.0/src/components/multiSelect/multiSelect.js) confirms and calls `apiClient.deleteItem` for every selected ID. There is no public injected-script pre-delete event or stable external module import for the bundled helper.

The narrow feasible integration wraps the current **`window.ApiClient.deleteItem` instance method**, not fetch/XHR. `ServerConnections.setLocalApiClient` assigns that global in v12. The wrapper gets fresh item/user/status data, excludes the acting user's interest, and only invokes the original method after approval. Cancel/Escape reject the promise before a delete request exists. Network/server failures also reject. The original receiver, arguments, return value and permissions are preserved. Native UI can show its generic “Error deleting item” alert on cancellation because it sees a rejected promise; this is preferable to reporting a deletion that did not happen.

Movie/series deletion is covered. Episode/season requests check their containing series when `SeriesId` is supplied. Other types pass through, including folders and collections. The wrapper rebinds on view events and polls for a replaced client every 500 ms. Prompts are queued to avoid stacked bulk dialogs. Checks happen when a queued deletion begins. Each item is an independent action; cancelling a later item cannot undo earlier approved items. There is also a normal check-to-delete race: interest can change while a warning is open. No atomic server override token is claimed.

## Injector and detail UI

Injector's documented `PluginInterface.RegisterScript(JObject)` is called via reflection by a hosted service, with an embedded script and `requiresAuthentication=true`. JObject is constructed through the interface's own parameter type, avoiding a direct Injector/Newtonsoft dependency. Registration retries for 60 seconds to tolerate startup order. Absence/failure logs a warning and leaves the backend working. The inspected Injector jf12 project still defaults to an RC package; runtime validation builds that exact source with `JellyfinVersion=12.0.0`.

The script uses v12 `viewshow` event parameters, one known detail-page ID, and `.detailPagePrimaryContent` for placement. All names are inserted with `textContent`. There is no page-wide mutation observer, generic network patch, or imported frontend framework. “My Watchlist” reads the own-list API and links to the native detail route. These DOM/global seams are **version-specific**, not official Jellyfin extension points. The modern React details UI is not validated; no claim is made that its components or direct SDK calls use this adapter.

## Known bypasses and upgrade checks

- Native/mobile/TV clients that do not load the injected web script.
- Direct REST calls, scripts, administrator API keys, alternative web clients, and server-side cleanup plugins.
- Direct `ILibraryManager`/filesystem deletion, including Media Cleaner.
- Generic folder/library deletion and unsupported item types; alternate versions with independent IDs have independent watchlists.
- Modern web or future code paths using the generated SDK rather than the wrapped legacy ApiClient.
- Requests on another client instance, or made before injection/rebinding, or after a different plugin replaces the method.
- Disabled/missing Injector, stale registered scripts after uninstall, client caching or failed script execution.

On upgrades, verify the named native APIs, claim, deleteHelper and multiSelect call sites, global assignment, detail selectors, and Injector payload. Run the tests and the disposable manual deletion checks before relying on the warning. The backend compiles against 12.0; later 12.x releases need their own compatibility validation.

## Future stock-client playlist access

Native playlists have owner/sharing semantics and are accessible to stock clients, but their item preparation is not a title-level watchlist abstraction. [`Playlist.GetPlaylistItems`](https://github.com/jellyfin/jellyfin/blob/v12.0/MediaBrowser.Controller/Playlists/Playlist.cs) expands `Folder` inputs (including series) into playable descendants. Copying JSON entries into native playlists would create a second writable representation and require reconciliation for client edits, new episodes, deleted items and completion semantics.

A future movie-only mode could make one private native playlist per user the sole source of truth. Full movie/series semantics would require a different native abstraction or a deliberate migration/design change. The MVP does not mirror playlists or infer watchlists from Favorites.
