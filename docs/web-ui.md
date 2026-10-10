# Phase 3: Jellyfin Web integration

Target: Jellyfin Server and bundled Web **12.2**, .NET 10. The [backend](backend.md) remains unchanged. This phase adds plain JavaScript detail controls and connects the previously validated [instance deletion adapter](deletion-poc.md) to fresh protection checks. No framework, dependency, Jellyfin source modification, metadata tag or Favorites integration was added.

## Detail controls

The existing JavaScript Injector programmatic registration delivers the embedded script to authenticated Web users. On the legacy `#/details?id=…` route it resolves the item using the current native `ApiClient.getItem(userId, itemId)`. Only movies and series receive controls. A supplied `serverId` must match the current client.

Controls attach to `#itemDetailPage .detailPagePrimaryContent`, a source-verified anchor in [the 12.2 detail template](https://github.com/jellyfin/jellyfin-web/blob/v12.2/src/apps/legacy/controllers/itemDetails/index.html). They use Jellyfin's `emby-button raised` classes and material bookmark icons. The button is disabled until `GET /WatchGuard/Watchlist` supplies membership. `PUT` adds and `DELETE` removes the current user's entry; successful responses update the label and pressed state without reloading. Failed mutations show an inline alert and allow retry. A failed initial list lookup leaves the button disabled with instructions to reopen the page.

Native `ApiClient.ajax` and `getUrl` handle authentication and the server base URL; no token is embedded in a URL or diagnostic log. No new API routes were needed.

The native current-user policy controls whether the UI requests protection details. Administrators see each interested user once with all returned reasons, including their own interest:

- `Watchlisted` → Watchlist
- `InProgress` → Watching
- `CurrentlyPlaying` → Currently Playing

The backend remains the authorization authority. Normal-user detail pages do not request cross-user status. Administrators see a status-unavailable message on lookup failure. Names and labels are inserted with `textContent`, never HTML. Interest refreshes when the view opens/restores and after a successful local mutation; it is not a live subscription to other users. Deletion always makes a separate fresh request.

## Deletion boundary and conservative policy

The script still wraps only the current `window.ApiClient.deleteItem` instance. It retains the original receiver, arguments, fulfillment value and rejection object, and invokes the original method at most once per approved call. Native permission checks and native confirmation remain in place. No fetch/XHR patch, prototype patch, custom delete endpoint or fake success was introduced.

Queued operations run this sequence independently:

1. Verify the captured account/token and current client context.
2. Resolve the exact deletion ID through native `getItem`. It must be a **movie or series**.
3. Request `GET /WatchGuard/Protection/{id}`. Validate the response ID, boolean fields, users, supported reasons, uniqueness and consistency of the interest flags.
4. Exclude the current user by normalized ID. If there are no other interested users, invoke native deletion without an additional WatchGuard dialog.
5. Otherwise show “WatchGuard: This item may still be in use.” followed by other users and their reasons. Cancel, Escape or dialog closure rejects without invoking deletion; Delete Anyway invokes the original once after another context check.

An HTTP/network failure, unauthorized response, missing item or malformed status is **not** zero interest. WatchGuard shows an explanation with only Cancel and blocks deletion. There is no failure override. Non-administrators can manage their watchlist but cannot complete a protected deletion check, even if Jellyfin separately gives them deletion rights.

**Unsupported types are blocked** with the same status-unavailable explanation and no Delete Anyway button. This includes episodes, seasons, folders, collections, playlists and other types. The script does not guess a parent or claim that a movie/series response covers an arbitrary recursive deletion. Deleting an episode requires a future explicitly designed policy; users should not mistake this limitation for confirmed absence of interest.

Bulk selection remains per-item, not transactional. Each queued item is checked immediately before its own warning/native call. Cancelling one does not cancel other queued calls or restore already deleted items. A mixed batch may delete confirmed-clear or separately approved items while rejecting others.

## Cancellation investigation

The 12.2 [deleteHelper](https://github.com/jellyfin/jellyfin-web/blob/v12.2/src/scripts/deleteHelper.js) calls the bundled native confirmation, then `ServerConnections.getApiClient(...).deleteItem(...)`. Its rejection handler displays the generic deletion error. [multiSelect](https://github.com/jellyfin/jellyfin-web/blob/v12.2/src/components/multiSelect/multiSelect.js) likewise treats rejected per-item promises as failures.

These are imported bundled modules; the inspected code exposes no cancellable pre-delete UI extension hook to Injector. An earlier DOM click interception would need separate detail/context/bulk handling and could miss non-click callers; extracting webpack modules or replacing global alerts would be more invasive. The implementation therefore preserves the validated method boundary.

**Observed:** after WatchGuard Cancel or a blocked failed check, Jellyfin displays its existing “There was an error deleting the item from the server…” dialog with Got It. No media DELETE is sent for that operation. The adapter does not return success to hide the alert and does not suppress unrelated native errors.

## Lifecycle and privacy

Native `viewshow` events (including restored views), hash changes and a lightweight 500 ms discovery timer reconcile the current detail route. The timer does not repeatedly fetch API state on an unchanged route. There is no page-wide mutation observer. Capture listeners preserve the Phase 1 early binding of the delete wrapper.

One owned section is removed/replaced when the title or account changes. A revision counter discards late responses for old views. The current client, user ID and token define the account context; changes clear the controls, invalidate pending rendering and abort open WatchGuard dialogs. Pending deletion compares the captured identity again before native execution. Credentials are compared only in memory and never logged or rendered. Account changes are detected on native view/input events and the discovery timer; there is no claim of an instantaneous cross-tab session notification contract.

No WatchGuard API calls are made without a current user ID and access token. A native item lookup must succeed before adding controls. Buttons remain separate from Jellyfin's Favorite controls. There is no native-client watchlist UI.

## Validation

Use the build and disposable Docker instructions in [backend.md](backend.md#validation-and-reproduction). `tests/docker-smoke.py` now runs the existing backend checks followed by the extended `tests/browser-poc.cjs`. All media, accounts and configuration are generated for that run; no production volume is mounted.

The browser script uses native login forms, detail controls, menus and selection UI. Real native backend APIs seed a second user's memberships. Only the explicit failure scenarios use Playwright routing to return a simulated 503; successful membership and deletion checks use the actual server. The injected production script comes solely from Injector registration.

Results on **2026-10-10**, using the pinned official 12.2 Docker image and Injector build described in the Phase 1 document:

| Verification | Observed result |
| --- | --- |
| Backend regression | All 25 unit tests and the existing live HTTP checks passed; backend implementation unchanged. |
| JavaScript contracts | All 19 tests passed, including original arguments/results, cancel/override, fresh lookups, malformed/failed status, unsupported types, self-only interest, identity changes and safe text rendering. |
| Movie/series controls | Add/remove worked without reload; movie membership survived reload; series mutation affected the correct series ID after navigation. |
| Privacy and indicators | Admin saw the second user's membership; normal-user details made zero protection requests and displayed no cross-user names. |
| Lifecycle | No duplicate controls across title navigation and browser back/forward. Sign-out removed old controls; same-browser login as the normal user showed no cross-user indicator. |
| Failed mutation | Simulated 503 produced an inline error and retained button state. |
| Failed protection | Simulated 503 showed the blocked-check explanation, no Delete Anyway button and zero media DELETE requests. |
| Zero/self-only interest | Each deleted successfully after native confirmation with no extra WatchGuard dialog. |
| Other-user interest | Movie/series details, right-click context menu and two-item bulk selection showed names/reasons before native deletion. Cancel/Escape sent no corresponding DELETE; each override sent exactly one native DELETE with HTTP 204. |
| Cancellation UX | Native generic error remained visible on cancellation and blocked lookup, as expected. |

The final browser run recorded **14 intercepted operations**, **six user cancellations**, **one blocked failed lookup**, **two confirmed-clear operations**, and **five explicit overrides**. The seven resulting media DELETE requests had zero diagnostic ordering violations. Deleted items subsequently returned 404; cancelled items remained accessible. Bulk cancellation was tested by cancelling both prompts, then approving both in a separate attempt.

Evidence is generated under `artifacts/poc/`, including `report.json`, a visually inspected detail screenshot and warning/cancellation screenshots. Success applies to the tested installed client instance, not all clients or deletion paths.

## Remaining limitations

- Validated detail placement is the legacy desktop Web layout in Chromium. Modern React details, other browsers, mobile/TV layouts, base-path deployments and multi-server navigation are not covered by the live test fixture. Unsupported layouts may have no detail controls; the wrapper protects only calls on its installed instance.
- Missing/disabled Injector, requests before installation, other ApiClient instances, another script replacing the method, direct SDK/API deletion, native clients, server cleanup and filesystem deletion can bypass this web-only warning.
- There is no atomic check-to-delete transaction. A different user's interest can change after the fresh check or while confirmation is open.
- Displayed interest is a view snapshot; see backend limitations for session activity, available episodes and alternate versions. Unsupported deletion types deliberately block at this boundary.
- English labels are currently fixed. No full localization or large-library performance work is included.
- Existing loaded tabs retain their old adapter. After upgrading, restart the test server and reload tabs. The stable Injector registration ID remains `watchguard-v1`; the historical `WatchGuardPoc` diagnostics object and log prefix remain compatible. `clear` records a confirmed no-other-interest decision; `check-failed` records a rejected lookup. Logs contain fixed events/counters only.

No production deployment was performed.
