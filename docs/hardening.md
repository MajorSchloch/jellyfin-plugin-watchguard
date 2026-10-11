# Phase 4: compatibility and UX hardening

For v0.2.0 navigation, toolbar placement and series-scope detail controls, see [navigation.md](navigation.md). The Phase 3/4 observations below describe the original UI; deletion policies remain unchanged.

Target: **Jellyfin Server/Web 12.2, .NET 10**. This extends [Phase 3](web-ui.md), using the unchanged [backend](backend.md) and the validated instance-method deletion boundary. No new runtime dependencies, persistence, media automation or server deletion endpoint were added.

## Deletion scope

The wrapper still receives Jellyfin's actual deletion ID and passes that exact ID, original arguments and original receiver to the original `ApiClient.deleteItem` method once on approval. Only the **protection lookup scope** changes:

| Native target | Protection lookup |
| --- | --- |
| Movie | That movie ID |
| Series | That series ID |
| Episode | Its verified parent series ID |
| Season | Its verified parent series ID |
| Folder, collection, playlist or unknown type | Blocked; semantics have not been validated |

For an episode or season, resolve the target using native authenticated `getItem`, read its `SeriesId`, and fetch that ID with the same native API. The returned parent must have the matching ID and type `Series`. Missing IDs, failed lookups, mismatched IDs and non-series parents fail closed. There is no guess based on names, filesystem paths or an arbitrary `ParentId` chain.

Jellyfin's [12.2 DTO service](https://github.com/jellyfin/jellyfin/blob/v12.2/Emby.Server.Implementations/Dto/DtoService.cs) populates `SeriesId` for both episodes and seasons. Interest remains entirely in the server-side protection endpoint. JavaScript does not aggregate episodes, watchlists or playback states.

When other users are interested, the warning names the actual deletion target and explains the scope, for example:

```text
WatchGuard: This item may still be in use.

Deleting episode: Example episode
These users are interested in the parent series: Example series. Interest is series-wide.

Tom — Watchlist, Watching
```

This deliberately warns for interest anywhere in the parent series, even if the particular season or episode was completed. It does not assert that each named user is interested in that exact episode. Titles and names are rendered as text, never HTML.

Confirmed zero-other-user interest still skips the extra WatchGuard warning. Self-only interest does not trigger it. Native confirmation and permission checks remain unchanged. All lookup/authorization/validation errors show the blocked-check explanation with only Cancel. No error can be overridden as if it were a successful protection result. Non-admin users can own watchlists but cannot complete the administrator-only protection check, even if Jellyfin grants them native media-deletion permission.

## Cancellation finding

Source was rechecked in [deleteHelper](https://github.com/jellyfin/jellyfin-web/blob/v12.2/src/scripts/deleteHelper.js), [itemContextMenu](https://github.com/jellyfin/jellyfin-web/blob/v12.2/src/components/itemContextMenu.js), and [multiSelect](https://github.com/jellyfin/jellyfin-web/blob/v12.2/src/components/multiSelect/multiSelect.js).

The clean cancellation path is inside native confirmation, before the nested `deleteItem` promise/error handler is installed. That confirmation is an imported bundled module, not an exposed Injector extension point. Once the wrapped API method is called, its rejection enters Jellyfin's generic deletion-error handler. The modern `MoreCommandsButton` source also delegates to the same context menu; it provides no separate injected-script cancellation callback.

No narrowly scoped public hook was found that covers detail pages, context menus and bulk selection before those handlers run. Patching private bundled modules, intercepting many translated menu/button clicks, returning fake deletion success or filtering global alerts would weaken reliability or misrepresent the result. None was introduced.

**Safe cancellation is retained:** Cancel, Escape and closure invoke zero native DELETE requests for that operation. Jellyfin subsequently shows its generic “There was an error deleting the item from the server…” dialog. Failed checks have the same native error aftermath. Unrelated server and permission errors retain native handling. A small abort-listener cleanup also prevents a failed dialog opening from retaining its listener.

## Modern and legacy Web

The pinned 12.2 source has separate modern and legacy **application shells**, but both route `#/details` to `itemDetails/index` and its legacy HTML template:

- [RootAppRouter](https://github.com/jellyfin/jellyfin-web/blob/v12.2/src/RootAppRouter.tsx) selects routes using `layoutManager.modern`.
- [Modern legacy-route table](https://github.com/jellyfin/jellyfin-web/blob/v12.2/src/apps/modern/routes/legacyRoutes/user.ts) maps `details` to the legacy item controller/template.
- [ViewManagerPage](https://github.com/jellyfin/jellyfin-web/blob/v12.2/src/components/viewManager/ViewManagerPage.tsx) loads those legacy view files.
- [LayoutManager](https://github.com/jellyfin/jellyfin-web/blob/v12.2/src/components/layoutManager.js) reads the saved `layout` setting; `modern` and `desktop-legacy` select different shells.

A `modern/features/details/.../MoreCommandsButton.tsx` file exists, but its existence is not evidence of a separate reachable React detail route. No such route was found in this revision. WatchGuard therefore keeps **one** placement adapter at `#itemDetailPage .detailPagePrimaryContent`; it does not append a competing React-specific adapter or modify the React tree.

The browser harness selects the source-verified local `layout` preference in its disposable browser profile and reloads. It verifies that `.skinHeader` is visible in legacy mode and hidden in modern mode, then uses the same native detail and deletion controls. This changes a client preference only; the harness does not inject WatchGuard or replace Web modules. A future genuinely different detail implementation will need its own source review and testing.

No extra timer or MutationObserver was added. The existing 500 ms discovery timer and view/hash/input events continue to reconcile the route and account, with no repeated network lookup on an unchanged route.

## My Watchlist

Open a supported movie or series detail page and select **My Watchlist** beside its existing Watchlist toggle. A small browser dialog uses Jellyfin button/link styling and the existing `GET /WatchGuard/Watchlist` response:

- Loading, empty, populated and failed-load states are explicit.
- Movie/series names link directly to native details for the current server.
- Remove calls the current user's existing DELETE membership endpoint. It removes the row only after success; failure leaves the row present with a retryable error.
- Refresh reloads the list; it also recovers from load errors. No list cache, synchronization or alternate persistence is introduced.
- Close/Escape restores focus when possible and refreshes the detail controls. Navigation closes the dialog. Account changes abort it; closed-dialog and changed-credential responses cannot render stale private results.
- All names are text, links use a fixed native route with encoded IDs, and backend authorization remains authoritative.

There is no native navigation registration API for an injected script in the inspected route/menu code. Rewriting React navigation or appending persistent items into its managed menus would add an unstable integration. This phase uses the simpler detail-page entry point. **There is no home/sidebar entry or bookmarkable WatchGuard route**, and the view requires opening an available movie/series first. These are deliberate limits, not an attempt to replace Jellyfin's navigation.

## Verification

Tests use the pinned official Docker image and Injector build already recorded in [deletion-poc.md](deletion-poc.md#test-environment-and-evidence). The fixture generates movies plus separate interested/clear series with two seasons; only disposable configuration and synthetic media are mounted. Real backend APIs seed memberships and native playback data. Only explicit failure cases use browser routing to simulate HTTP 503 or a missing parent 404.

Automated validation on **2026-10-10**:

- **23 JavaScript unit tests passed**, including parent-scope resolution, wrong/missing/failed parents, unchanged native target/arguments/results, unsupported types, clear/self-only decisions, cancellation, account changes, safe text rendering and late private-list responses after abort/credential changes.
- **25 backend tests passed**; backend implementation and storage schema remain unchanged. The existing live backend HTTP regression also passed.
- The final browser results below cover real native deletion requests and subsequent item existence checks. Report and screenshots are generated under `artifacts/poc/`.

| Browser scenario | Observed result |
| --- | --- |
| Explicit `desktop-legacy` and `modern` | Correct shell visibility verified; watchlist add/remove, My Watchlist and native Cancel/Delete Anyway passed in both. Both used the shared legacy detail template. |
| Movie and series deletion | Other-user warning appeared; Cancel/Escape sent zero DELETE; override sent one native DELETE per target. |
| Episode and season, interested parent | Dialog identified target type/name and parent series; cancellation preserved the target; override deleted only the requested target, with the series still accessible. |
| Episode and season, clear parent | Native deletion completed without an extra WatchGuard warning; parent series remained accessible. |
| Parent lookup failure | Simulated parent 404 blocked with no override and zero DELETE; target survived. |
| Failed status and permissions | Simulated protection 503 and real non-admin protection denial blocked deletion. The non-admin had native deletion permission and could reach native confirmation; WatchGuard exposed no cross-user details. |
| Bulk selection | Both per-item cancellations preserved media; separately approving both produced exactly one DELETE each. |
| My Watchlist | Empty state, movie/series names and native links, removal, failed removal/load and Refresh recovery passed. List and warning screenshots were visually inspected. |
| Existing UI/account lifecycle | Reload persistence, title navigation, back/forward, no duplicate controls, administrator indicator, normal-user privacy and same-browser account switch passed. The switched user received their own list. |

Final browser totals: **26 interceptions**, **10 cancellations**, **three blocked checks**, **four confirmed-clear operations**, **nine overrides**, and **13 media DELETE requests**, with **zero diagnostic ordering violations**. Each approved native request returned HTTP 204 and the target subsequently returned 404. Cancelled/blocked targets remained accessible. These counts exclude watchlist-membership DELETE requests, which do not remove media.

Evidence: `artifacts/poc/report.json`, `my-watchlist.png`, `parent-Episode-warning.png`, `parent-Season-warning.png` and the existing detail/cancellation screenshots. The generic native error after cancellation remained observable in both explicit layouts. There is no claimed validation of a separate pure-React detail page because none is routed in this 12.2 source.

Reproduce:

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

See [README installation instructions](../README.md#install-into-a-test-jellyfin-container). No production deployment was performed.

## Remaining limits

The warning is still web-only and requires the relevant client instance to be wrapped. Native clients, direct APIs, filesystem operations, cleanup plugins, unwrapped instances, method replacement and pre-injection calls can bypass it. Other browsers, TV/mobile layouts and base-path/multiple-server installations have not been validated by this fixture.

Bulk deletion is still per-item, not atomic. Cancelling one cannot undo earlier approved/clear items or cancel the remaining queue. Interest can change after a fresh lookup or while confirmation is open. Scope validation does not solve this check-to-delete race or alternate-version deletion semantics. A missing/unauthorized parent blocks rather than granting permission. Collection, playlist and general folder semantics remain unvalidated and blocked at the wrapper.

The list is a snapshot until refreshed/reopened; labels remain English, there is no paging, and large-library performance was not benchmarked. The simpler entry point and the generic error after cancellation remain the main UX limitations.
