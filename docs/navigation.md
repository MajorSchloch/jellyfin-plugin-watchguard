# WatchGuard v0.2.0 navigation and detail UI

See [v0.2.1 interest overview and UI refinement](interest-overview.md) for the new playback-aware overview and count popover. Existing explicit-list API contracts and navigation anchors below remain unchanged.

Target: Jellyfin Server/Web **12.2**, .NET 10. No new runtime dependency. JavaScript Injector registration, watchlist schema 1 and deletion policies remain compatible with v0.1.0.

## Source-verified integration decisions

Inspected Web commit [`61b1f890365ad15138e943e694af723c1d47df2a`](https://github.com/jellyfin/jellyfin-web/tree/61b1f890365ad15138e943e694af723c1d47df2a):

- `src/RootAppRouter.tsx` creates a hash router from statically imported modern/legacy route tables. There is no public runtime plugin-route registration API.
- `src/apps/modern/components/AppToolbar/userViews/UserViewNav.tsx` renders Favorites (`#/home?tab=1`), native user libraries and configured menu links. Configured menu links open a new tab; there is no plugin tab registration API. WatchGuard does not change Web configuration.
- `src/scripts/libraryMenu.js` builds the legacy `.skinHeader`, `.headerLeft` and page-specific `.headerTabs`. Appending an indexed legacy tab would interfere with native tab selection, so WatchGuard uses a header link instead.
- Both shells route `/details` through `ViewManagerPage` to `apps/legacy/controllers/itemDetails/index.html`. Its `.mainDetailButtons` includes Favorite and More; the template remains the shared toolbar integration point.
- `src/components/AppBody.tsx` owns `.skinBody` content containers. `apps/modern/AppLayout.tsx` supplies the modern app bar and main region.

A true first-class plugin tab is **not supported** by these APIs. The implemented fallback adds **one owned anchor** to the modern Favorites/library navigation container. It does not replace, clone or reorder React navigation trees or install a router/webpack override. Legacy desktop gets a Watchlists header link, rather than an indexed Home/Favorites tab. Modern narrow layouts have a toolbar fallback, but mobile/TV behavior is not release-validated.

The link targets `#/home?watchguard=watchlists`; `owner=mine`, `owner=all` or `owner=<user-id>` records filter state. This uses an existing native route; the plugin does not claim ownership of an unknown route. The injected page is a separate body child. Only while this query is active, scoped CSS hides native `.skinBody` content (also removing it from keyboard/accessibility navigation). Leaving the page restores native content. The native Home controller can still load behind the hidden content; this is a deliberate tradeoff for avoiding router internals. If the plugin is absent, the link simply opens Home.

These DOM/CSS anchors are **version-specific, not a supported Jellyfin extension contract**. Revalidate against each Web upgrade and custom theme. If the anchor disappears, the existing 500 ms lifecycle check can discover a replacement; it does not fetch page data repeatedly, use MutationObservers or replace native trees. Direct navigation to the namespaced Home URL is an alternative when a theme hides the link. No Web files are changed.

## Page and detail behavior

- Native image URLs come from `ApiClient.getImageUrl(..., {type:'Primary'})`; native `#/details?id=...&serverId=...` links open items. Posters are lazy-loaded; absent artwork has an icon fallback. The small custom grid reuses Jellyfin typography, icons, buttons, select styling and theme colors, without importing internal React components.
- Administrators have My Watchlist, All Users and individual-user filters. Individual options include enabled users with at least one visible explicit entry. One card represents one item, with all visible owners underneath. An administrator can remove **only their own** membership, including from an All Users card.
- Regular users use the existing own-list endpoint, receive no usernames and cannot gain access by changing the URL filter. Loading, empty, failed-load/refresh and failed-removal states are explicit. No watchlist data is persisted in browser storage.
- The toolbar's bookmark action uses native `detailButton`, `detailButton-content` and `detailButton-icon` styles beside Favorite/More. Its accessible label and tooltip show Add/Remove from Watchlist. The previous My Watchlist dialog and entry are removed.
- Interest appears below the action row. Episode/season controls resolve the parent through the **same `resolveScope` function used by deletion**, requiring a matching target ID, nonempty distinct SeriesId and a visible matching Series item. They read/write only the series membership and label the indicator/tooltip `Series: <name>`. There are no episode/season entries.
- Administrator indicators use the existing protection endpoint, including playback and active-session reasons. The grid intentionally includes **explicit watchlists only**, not automatic interest. No aggregation logic is duplicated in JavaScript.

Navigation and filter changes use native hash history. Each page load captures API instance/user/token identity and a generation. Account changes, navigation and logout remove the old owned UI and invalidate outstanding responses; late callbacks cannot render or mutate a new account's view. Native item lookups are verified before attaching detail controls. User/title strings use `textContent`; identifiers are validated/URL-encoded. The only injected CSS is static. Authentication is required before any WatchGuard request.

## Read-only administrator API

`GET /WatchGuard/Watchlists` requires an authenticated, currently enabled **administrator account**. API keys are not a substitute for a user. Non-admin requests return 403; unauthenticated/removed/disabled callers are rejected. The server rechecks permissions on every request.

```json
[
  {
    "ItemId": "11111111-1111-1111-1111-111111111111",
    "Name": "Example Movie",
    "Users": [
      {"UserId": "22222222-2222-2222-2222-222222222222", "DisplayName": "Anna"},
      {"UserId": "33333333-3333-3333-3333-333333333333", "DisplayName": "Tom"}
    ]
  }
]
```

The endpoint reads the existing store once, groups item IDs and uses native library/user services. It omits missing/unsupported items, deleted/disabled owners and items inaccessible to either the administrator or owner. Names come from Jellyfin, never from the store. Results are materialized before returning: lookup/storage errors produce 503, never a misleading empty or partially populated success. Responses are not cached. The endpoint does not write, prune stale entries or migrate data. Existing own-list, mutation and protection routes are unchanged.

This minimal endpoint/page is unpaginated and makes native visibility lookups per membership. Large installations may need a later measured optimization. No cache or synchronized media database was added.

## Deletion and upgrade boundaries

The `ApiClient.deleteItem` wrapper, confirmation behavior, permission policy and diagnostics default remain unchanged. Extracting parent resolution into a shared function preserves its existing validation. Fresh protection checks still precede deletion; own-only/zero interest skips the extra warning; unresolved/unsupported targets and lookup failures block. Cancel still produces Jellyfin's generic deletion error. Bulk operations remain independent per item. Native clients, direct API requests, cleanup plugins and filesystem operations bypass this advisory Web integration.

Script ID `watchguard-v1` and plugin GUID stay unchanged. Startup replaces the persisted registration under that ID with version `0.2.0`; it must not create a second script. Reload all tabs on upgrade or rollback. Version-1 `watchlists.json` can be used unchanged by either release. See [deployment and rollback](deployment.md).

## Validation

See the current release results in [deployment.md](deployment.md#automated-results). The disposable browser fixture exercises both desktop shells, poster delivery/fallback, deduplicated filters, own removal, failure states, native detail links, history, toolbar geometry, parent-series controls, account isolation, and the full prior deletion suite. Tests use generated media and never mount production configuration or media. Chromium is the validated browser; other browsers, mobile/TV, custom themes and multi-server/base-path installations remain unvalidated.

Observed on 2026-10-10: **29 backend tests, 25 JavaScript tests and the complete disposable Docker backend/browser suite passed**. Modern and legacy desktop navigation opened the page; native movie posters loaded and missing series artwork used the fallback. The shared card appeared once under All Users, owner filters/history/reload worked, and normal-user pages issued no cross-user requests (including with a forged `owner=all` URL). Toolbar geometry and Favorites isolation assertions passed. Same-document logout removed the administrator page before another account signed in. Tests use the canonical `/login` route; the historical `login.html` alias produced duplicate native compatibility views and was removed from the harness.

Deletion regressions recorded 26 intercepted operations, 10 cancellations, three blocked checks and 13 native media DELETE requests (nine overrides plus four confirmed-clear decisions), with zero ordering violations. The packaged DLL registered version 0.2.0 exactly once, including after restart. Persisted-registration cleanup stopped delivery; the Web index hash remained identical to the official image. Two forced Release compilations produced identical ZIP hashes. No production deployment or GitHub release was performed.
