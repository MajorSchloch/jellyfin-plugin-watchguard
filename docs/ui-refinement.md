# WatchGuard v0.2.4 — Watchlists UI refinement

Target: Jellyfin Server/Web **12.2**, .NET **10**. This release changes the embedded Web UI and release metadata. Native playback queries, activity discovery, watchlist schema 1, protection endpoints and deletion interception are unchanged. No new dependency or configuration migration is required.

## Status selection and navigation

The existing Watchlists header link and namespaced Home route remain. A compact native HTML `details`/`summary` disclosure contains labeled checkboxes styled with Jellyfin buttons, typography and theme colors. It is a small anchored popover, not a replacement for native React navigation. Enter/Space opens it, Tab reaches the checkboxes and Reset to Defaults, Space toggles a checkbox, and Escape closes it and restores summary focus. Pointer interaction outside closes it. The listener is removed with the page's abort signal. On narrow screens the popover is anchored to the toolbar to stay inside the viewport.

Defaults enable **Watchlisted, Watching and Currently Playing**; **Watched** is disabled. Watching matches `InProgress`, Currently Playing matches `CurrentlyPlaying`. Selecting several statuses uses OR. Both owner and status conditions must match **the same user**: another user's watching state cannot make a selected user's completed-only record match. Matching owners retain all their reasons, so a completed movie with explicit membership remains visible and can show both icons. Clearing every checkbox intentionally shows no matches once loading succeeds.

The existing `interest` URL parameter now stores comma-separated `watchlisted,watching,playing,watched` values; `none` means no selections. Missing/invalid values use defaults. Existing `interest=all` bookmarks enable all four; individual old values remain recognized (Watching now means unfinished playback specifically; select Currently Playing as well for the former combined view). User and sort parameters are unchanged. Each change enters native hash history; back/forward and reload restore the selection. Reset changes only statuses, preserving user and sort. There is no browser preference database; opening the bare Watchlists link starts at defaults.

Filtering never fetches new backend data. Explicit memberships still paint before bounded automatic discovery; filters and sorting update the current merged snapshot, retaining card/image nodes. Loading, independent errors and non-exhaustive coverage notices remain. Empty states wait for successful completion of both sources. Account/navigation guards invalidate late responses and remove the old account's UI.

## Cards and detail headers

Desktop widths at least 1100 px use eight poster columns; smaller widths use an adaptive grid and widths at most 480 px use two columns. Native images, item-detail URLs, lazy loading, own-membership removal and title/playback-recency sorting remain unchanged. Titles truncate with ellipsis and retain the full title on hover.

Each matching user appears once with small, labeled Material Icons:

| Native reason | Icon | Accessible label |
| --- | --- | --- |
| Watchlisted | `bookmark` | Watchlist |
| InProgress | `play_circle` | Watching |
| CurrentlyPlaying | `sensors` | Currently Playing |
| Watched | `check_circle` | Watched |

Multiple reasons produce adjacent icons, not repeated usernames or cards. Names truncate safely, with full names on hover; available series counts stay beside the name (`Tom · 7/12`). A native last-played calendar date appears once below that user, formatted through `Intl.DateTimeFormat` in the browser's locale/time zone. The focusable `time` element retains the API timestamp in `datetime` and exposes the full localized date/time, seconds and time zone through its accessible label and hover title. Dates are never invented for membership or active-session start time. Existing native dates are last-played dates, not completion timestamps.

Detail headers reuse the same status icons beside administrator-visible usernames in the existing `.infoWrapper`, between metadata and actions. Episode/season interest is still labeled with the verified parent series. The bookmark remains independent beside native Favorite/More. Successful zero-interest lookups leave an empty, hidden indicator instead of prominent “No current interest” text. Loading/errors remain visible. Regular users do not receive cross-user details. No optional “Previously watched” detail lookup was added: history remains available in the overview without another per-title request or any change to protection semantics.

All names and dates use text nodes/properties, never interpolated HTML. Status icons use a fixed allowlist. Native permissions, backend privacy checks, Injector ID `watchguard-v1` and plugin GUID are unchanged.

## Compatibility and safety

The version-specific DOM anchors described in [navigation.md](navigation.md) remain; there is still no public Jellyfin plugin tab API. Both tested desktop shells share the legacy detail template. No Jellyfin files, React trees, generic fetch/XHR or native error handling are patched. Custom themes, non-Chromium browsers, TV layouts and other Web versions require revalidation.

The activity overview remains bounded and non-exhaustive; see [activity.md](activity.md). It is never used as a deletion decision. Completed history alone does not protect media; explicit membership, unfinished playback and active sessions retain their existing protection rules. Each supported Web deletion still uses a fresh protection request. Cancel sends zero media DELETE requests but can still produce Jellyfin's generic error dialog. Native clients, direct API calls, other cleanup plugins and filesystem deletion bypass this advisory Web integration.

## Validation and deployment

**Validated on 2026-10-11:** 44 backend and 35 JavaScript tests passed, together with the full disposable Docker backend/browser suite. It recorded 27 intercepted deletions, 11 cancellations, three blocked checks and 13 media DELETE requests with zero ordering violations. Two forced Release compilations produced identical ZIP hashes. See [deployment.md](deployment.md#automated-results) for the final release validation. The regression suite covers default exclusions, completed explicit membership, OR/same-user matching, keyboard checkboxes/reset, URL history/reload, compact dates and accessible icons, multiple/long usernames, desktop/narrow layout, loading/errors, local filtering, removal, normal-user privacy, stale responses and all previous native deletion paths.

Screenshots use only disposable generated media:

- [Desktop overview](screenshots/v0.2.4/interest-overview.png) and [narrow overview](screenshots/v0.2.4/interest-overview-narrow.png)
- [Desktop filter popover](screenshots/v0.2.4/status-filters-desktop.png) and [narrow popover](screenshots/v0.2.4/status-filters-narrow.png)
- [Multiple detail users, desktop](screenshots/v0.2.4/inline-users-1280.png) and [narrow](screenshots/v0.2.4/inline-users-390.png)
- [Completed history and dates](screenshots/v0.2.4/activity-watched.png)

The prior [performance measurements](performance.md) describe unchanged backend queries; no new backend speed claim or cache is introduced. The browser suite asserts zero extra discovery requests when filters/sort change.

Install the separate v0.2.4 ZIP using the [Docker deployment guide](deployment.md), verify exactly one Injector registration at version `0.2.4`, and fully reload Web tabs. Retain v0.2.3's ZIP/checksum for rollback; replace only the DLL while stopped, preserve `watchlists.json`, restart and reload all tabs. No production deployment or publication is performed.
