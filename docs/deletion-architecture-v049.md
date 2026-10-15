# v0.4.9 investigation: deletion architecture

Research date: 2026-10-15. Baseline: v0.4.8. This is a research deliverable, not a v0.4.9 release or a server-side enforcement implementation. Production, source behavior, storage, loader, version and catalog remain unchanged.

## Source pins and evidence

Server: [`ca0f16eb7c195f720a1493ed469a27c4657db0c6`](https://github.com/jellyfin/jellyfin/tree/ca0f16eb7c195f720a1493ed469a27c4657db0c6). Web: [`61b1f890365ad15138e943e694af723c1d47df2a`](https://github.com/jellyfin/jellyfin-web/tree/61b1f890365ad15138e943e694af723c1d47df2a). These are the repository's pinned Jellyfin 12.2 sources; observations below concern these commits, not historical APIs or a promise about future Jellyfin versions. Both source archives were inspected locally. ASP.NET Core references concern .NET 10.

## HTTP item deletion

[`Jellyfin.Api/Controllers/LibraryController.cs`](https://github.com/jellyfin/jellyfin/blob/ca0f16eb7c195f720a1493ed469a27c4657db0c6/Jellyfin.Api/Controllers/LibraryController.cs#L362):

| Route | Signature | Before mutation |
| --- | --- | --- |
| `DELETE /Items/{itemId}` | `ActionResult DeleteItem(Guid itemId)` | `[Authorize]`, resolve caller, native user-scoped item lookup, `item.CanDelete(user)` for a user principal |
| `DELETE /Items?ids=...` | `ActionResult DeleteItems([FromQuery, ModelBinder(typeof(CommaDelimitedCollectionModelBinder))] Guid[] ids)` | `[Authorize]`, resolve caller, then lookup and `CanDelete` separately inside each iteration |

Both invoke `ILibraryManager.DeleteItem(item, new DeleteOptions { DeleteFileLocation = true }, true)` and return 204 on success. Missing items return 404; failed inline deletion permission returns 401. Ordinary users with native deletion permission can use these routes: they are not intrinsically administrator-only.

Bulk deletion is sequential and **not transactional**. There is no whole-request preflight: an early item may already be deleted before a later item fails lookup, permission or I/O. Duplicate IDs can also encounter an already removed item. Server enforcement would have to cover both actions and explicitly define bulk preflight and duplicate handling.

API keys require separate consideration. [`DefaultAuthorizationHandler.HandleRequirementAsync`](https://github.com/jellyfin/jellyfin/blob/ca0f16eb7c195f720a1493ed469a27c4657db0c6/Jellyfin.Api/Auth/DefaultAuthorizationPolicy/DefaultAuthorizationHandler.cs) accepts an API-key principal. Single deletion can resolve a null user for an API key with an empty user ID; bulk deletion uses a null user for API keys. The controller then skips the user-specific `CanDelete` branch. An API key is not an enabled human administrator identity for WatchGuard's cross-user API. A proposed guard must not manufacture such an identity or disclose playback history to arbitrary key callers.

[`BaseItem`](https://github.com/jellyfin/jellyfin/blob/ca0f16eb7c195f720a1493ed469a27c4657db0c6/MediaBrowser.Controller/Entities/BaseItem.cs#L844) implements:

- `virtual bool CanDelete()` — file protocol or channel-provider deletion support.
- `virtual bool IsAuthorizedToDelete(User user, List<Folder> allCollectionFolders)` — native content-deletion permission or allowed collection-folder/channel IDs.
- `bool CanDelete(User user, List<Folder> allCollectionFolders)` and `virtual bool CanDelete(User user)` — combine those checks, resolving collection folders when needed.

These virtual methods are not a registration interface for a plugin to replace behavior on native movie/series instances. Visibility and native deletion permission must remain distinct from WatchGuard's interest assessment.

## Internal deletion and event order

[`MediaBrowser.Controller/Library/ILibraryManager.cs`](https://github.com/jellyfin/jellyfin/blob/ca0f16eb7c195f720a1493ed469a27c4657db0c6/MediaBrowser.Controller/Library/ILibraryManager.cs#L401) declares:

```csharp
void DeleteItem(BaseItem item, DeleteOptions options);
void DeleteItem(BaseItem item, DeleteOptions options, bool notifyParentItem);
void DeleteItem(BaseItem item, DeleteOptions options, BaseItem parent, bool notifyParentItem);
void DeleteItemsUnsafeFast(IReadOnlyCollection<BaseItem> items, bool deleteSourceFiles = false);
```

[`LibraryManager.DeleteItem`](https://github.com/jellyfin/jellyfin/blob/ca0f16eb7c195f720a1493ed469a27c4657db0c6/Emby.Server.Implementations/Library/LibraryManager.cs#L347) delegates through the overloads. In the four-argument implementation:

1. Channel-provider deletion can occur early through `ChannelManager.DeleteItem` when `DeleteFromExternalProvider` applies.
2. Descendants/linked versions and metadata paths are handled. Metadata directory deletion can precede media-file deletion.
3. `DeleteItemPath` calls filesystem deletion for applicable paths. `DeleteFileLocation = false` is not a blanket guarantee that nothing is mutated: internal items and external/metadata handling have separate behavior.
4. External item files and persisted library records are removed, caches and parent state invalidated.
5. `ReportItemRemoved` announces descendants and then the item **after these mutations**.

[`ReportItemRemoved(BaseItem item, BaseItem parent)`](https://github.com/jellyfin/jellyfin/blob/ca0f16eb7c195f720a1493ed469a27c4657db0c6/Emby.Server.Implementations/Library/LibraryManager.cs#L2810) catches and logs event-handler exceptions. [`ItemChangeEventArgs`](https://github.com/jellyfin/jellyfin/blob/ca0f16eb7c195f720a1493ed469a27c4657db0c6/MediaBrowser.Controller/Library/ItemChangeEventArgs.cs) has item, parent and update reason; no cancellation result. `DeleteItemsUnsafeFast` also performs removal before notifications. **ItemRemoved cannot prevent or roll back deletion.** There is no cancellable pre-delete interface in the inspected library service.

Other callers bypass the item HTTP actions:

- [`Folder`](https://github.com/jellyfin/jellyfin/blob/ca0f16eb7c195f720a1493ed469a27c4657db0c6/MediaBrowser.Controller/Entities/Folder.cs) reconciles missing library items using `DeleteItem` with file-location deletion disabled.
- [`CleanDatabaseScheduledTask`](https://github.com/jellyfin/jellyfin/blob/ca0f16eb7c195f720a1493ed469a27c4657db0c6/Emby.Server.Implementations/Data/CleanDatabaseScheduledTask.cs) removes stale records. Internal metadata validators also use `DeleteItemsUnsafeFast`.
- [`RecordingsManager`](https://github.com/jellyfin/jellyfin/blob/ca0f16eb7c195f720a1493ed469a27c4657db0c6/src/Jellyfin.LiveTv/Recordings/RecordingsManager.cs#L714) has recording-retention deletion and direct filesystem deletion paths.
- [`ISupportsDelete.DeleteItem(string id, CancellationToken cancellationToken)`](https://github.com/jellyfin/jellyfin/blob/ca0f16eb7c195f720a1493ed469a27c4657db0c6/MediaBrowser.Controller/Channels/ISupportsDelete.cs) is a channel-provider operation, not a global pre-delete observer.

## Other routes must not be conflated with item deletion

[`LibraryStructureController.RemoveVirtualFolder(string name, bool refreshLibrary = false)`](https://github.com/jellyfin/jellyfin/blob/ca0f16eb7c195f720a1493ed469a27c4657db0c6/Jellyfin.Api/Controllers/LibraryStructureController.cs#L120) handles `DELETE /Library/VirtualFolders` under `FirstTimeSetupOrElevated`. [`LibraryManager.RemoveVirtualFolder`](https://github.com/jellyfin/jellyfin/blob/ca0f16eb7c195f720a1493ed469a27c4657db0c6/Emby.Server.Implementations/Library/LibraryManager.cs#L4028) deletes the virtual-folder definition under `DefaultUserViewsPath`, not the external media directory, and can refresh the library. Removing a configured library/path is different from deleting a folder *item* through `/Items/{id}`, which may remove descendant files.

[`LiveTvController.DeleteRecording(Guid recordingId)`](https://github.com/jellyfin/jellyfin/blob/ca0f16eb7c195f720a1493ed469a27c4657db0c6/Jellyfin.Api/Controllers/LiveTvController.cs#L778) handles `DELETE /LiveTv/Recordings/{recordingId}` with `LiveTvManagement`, native user-scoped lookup and `DeleteFileLocation = false`. It is a separate operation; an item-action filter would not cover it. Its channel/internal-item effects require separate qualification.

Deleting collection membership, playlist entries, playback state, alternate-source associations or subtitle/image sidecars is not equivalent to deleting a movie. An interceptor must not match all DELETE requests or infer semantics from the verb alone.

## Plugin and framework extension points

[`IPluginServiceRegistrator.RegisterServices(IServiceCollection serviceCollection, IServerApplicationHost applicationHost)`](https://github.com/jellyfin/jellyfin/blob/ca0f16eb7c195f720a1493ed469a27c4657db0c6/MediaBrowser.Controller/Plugins/IPluginServiceRegistrator.cs) is the native service-registration interface. [`PluginManager.RegisterServices`](https://github.com/jellyfin/jellyfin/blob/ca0f16eb7c195f720a1493ed469a27c4657db0c6/Emby.Server.Implementations/Plugins/PluginManager.cs#L206) invokes it. This permits standard framework registrations; it does not itself define deletion veto semantics.

[`AddJellyfinApi`](https://github.com/jellyfin/jellyfin/blob/ca0f16eb7c195f720a1493ed469a27c4657db0c6/Jellyfin.Server/Extensions/ApiServiceCollectionExtensions.cs#L111) registers MVC and native/plugin controller application parts. Standard [.NET 10 application-model conventions](https://learn.microsoft.com/en-us/aspnet/core/mvc/controllers/application-model?view=aspnetcore-10.0) can attach a filter to exact controller/action identities. An [`IAsyncActionFilter.OnActionExecutionAsync(ActionExecutingContext, ActionExecutionDelegate)`](https://learn.microsoft.com/en-us/aspnet/core/mvc/controllers/filters?view=aspnetcore-10.0) can set a result without calling the delegate, preventing that action from running. This is a supported **ASP.NET Core mechanism**, not a documented Jellyfin pre-delete plugin contract. Action filters execute after framework authorization/model binding but before the controller's inline item permission checks. That ordering matters for information disclosure and permission preservation. No such filter is implemented or runtime-qualified here.

[`Startup.Configure`](https://github.com/jellyfin/jellyfin/blob/ca0f16eb7c195f720a1493ed469a27c4657db0c6/Jellyfin.Server/Startup.cs#L168) maps the configured base URL, then installs Web/static delivery, authentication, routing, authorization, IP validation, WebSocket/startup handling and controller endpoints. A standard [`IStartupFilter`](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/startup?view=aspnetcore-10.0) can surround startup pipeline construction, as WatchGuard's existing loader does. Middleware inserted before that pipeline runs before native route/auth resolution; middleware appended after terminal endpoint execution is too late. Inspecting the response after `next` cannot undo deletion. There is no exposed Jellyfin plugin slot specifically between `CanDelete` and `DeleteItem`.

[`ApplicationHost`](https://github.com/jellyfin/jellyfin/blob/ca0f16eb7c195f720a1493ed469a27c4657db0c6/Emby.Server.Implementations/ApplicationHost.cs#L577) registers `ILibraryManager` as a singleton. DI replacement is technically possible but is not a supported deletion-decoration contract. Replacing the broad core service, its events, overloads and internal calls would require invasive compatibility work and could affect scans/playback. It is rejected for this investigation. Adding an authorization policy to WatchGuard endpoints does not attach it to existing native actions; globally replacing authorization is also rejected.

## Web path and independent audit

The pinned [`createApiClient.ts`](https://github.com/jellyfin/jellyfin-web/blob/61b1f890365ad15138e943e694af723c1d47df2a/src/utils/jellyfin-apiclient/createApiClient.ts) creates the legacy `jellyfin-apiclient` instance; the Web package pins 1.11.0. [`deleteHelper.deleteItem(options)`](https://github.com/jellyfin/jellyfin-web/blob/61b1f890365ad15138e943e694af723c1d47df2a/src/scripts/deleteHelper.js#L51) invokes native confirmation, then `apiClient.deleteItem(item.Id)`. [`itemContextMenu`](https://github.com/jellyfin/jellyfin-web/blob/61b1f890365ad15138e943e694af723c1d47df2a/src/components/itemContextMenu.js) gates Delete with `CanDelete` and delegates to this helper. [`multiSelect.deleteItems(apiClient, itemIds)`](https://github.com/jellyfin/jellyfin-web/blob/61b1f890365ad15138e943e694af723c1d47df2a/src/components/multiSelect/multiSelect.js#L164) confirms, maps separate `deleteItem` calls and awaits `Promise.all`; it does not use the bulk REST endpoint. Both native flows report generic errors on rejection. No public confirmation-extension/cancellation contract was found; see [native confirmation research](native-confirmation-options.md).

Current [`watchguard.js`](../Jellyfin.Plugin.WatchGuard/Web/watchguard.js) wraps that actual instance method, captures receiver/arguments/identity, serializes checks/dialogs and invokes the original once on explicit approval (or verified zero interest). It validates fresh Protection responses, includes self-interest and resolves episode/season parent series. Errors, malformed responses, unsupported scopes, account changes and Cancel/Escape/close reject before the native method. Safe text construction, initial Cancel focus, focus restoration and single settlement remain intact.

Boundaries found in the audit:

- Bulk cancellation is per operation, not batch-wide rollback. Already approved items remain deleted; later queued operations have their own checks.
- Two independently submitted calls for the same ID are separate operations, not a server idempotency guarantee. Double activation of one dialog cannot approve it twice.
- Same-account navigation does not retarget an already captured deletion; account/token/client changes invalidate it. Do not claim every navigation cancels every operation.
- Adapter installation, later replacement, stale builds and other client instances remain coverage boundaries. Browser installation diagnostics are needed; server loader status alone is not evidence of execution.
- A fresh check precedes deletion, but interest can change while a dialog is open or between check and DELETE. There is no atomic server transaction.
- Native clients/direct requests do not pass through this JavaScript. Supported Web behavior must not be advertised as universal enforcement.

No reproducible defect justifying a behavior change was found in this audit.
