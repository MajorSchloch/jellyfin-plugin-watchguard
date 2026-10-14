# WatchGuard v0.4.4 — series activity UI polish

Release candidate for Jellyfin Server/Web 12.2 and .NET 10. UI only: InterestService, InterestOverviewService, protection APIs and policies, configuration, schema-1 stores, preferences and standalone loader are unchanged. Nothing is published or deployed.

## Stable placement

The pinned 12.2 legacy detail template is also used by the modern shell. Its `.detailRibbon` holds `.infoWrapper` and `.mainDetailButtons`; desktop styles give it a fixed height alongside the floated poster. Putting an expanding list inside that ribbon changed its layout and narrowed the title.

The owned series activity section now sits **first inside `.detailPagePrimaryContent`**, the existing padded content region immediately below the ribbon. Its collapsed summary remains near the top. Native `details/summary` expands downward as a dedicated panel; it never changes the ribbon's height. Title, metadata, native actions and the personal bookmark remain in their original containers. Seasons/episodes retain their verified parent-series labels. Movie interest placement is unchanged.

The existing narrow-screen header adaptation is retained for series independently of whether the panel is open. This matters when Jellyfin's desktop shell is resized to mobile widths without switching its layout mode. The detail-content container uses Jellyfin's native mobile 5% side padding at those widths, giving the panel usable horizontal space without changing the header or action containers. No absolute offsets, React replacements, native node reordering, MutationObservers or extra polling are added. Placement is still a version-specific DOM integration, not a public Jellyfin extension API; if the expected content container is absent, controls are not attached to an unverified location.

Source references: [native detail template](https://github.com/jellyfin/jellyfin-web/blob/61b1f890365ad15138e943e694af723c1d47df2a/src/apps/legacy/controllers/itemDetails/index.html), [native ribbon/content styles](https://github.com/jellyfin/jellyfin-web/blob/61b1f890365ad15138e943e694af723c1d47df2a/src/styles/librarybrowser.scss).

## Visual language and accessibility

| State | Accent | Presentation |
| --- | --- | --- |
| Watchlisted | Amber | Labelled chip / bookmark icon |
| Watching | Blue | Labelled chip / play icon |
| Caught Up | Teal | Labelled chip / existing Caught Up icon |
| Watched | Green | Labelled chip / check icon |
| Currently Playing | Purple | Labelled chip / activity icon |
| Unknown / incomplete | Gray | Explicit text, never color alone |

Accents are bright text with low-opacity backgrounds/borders on the dark surface. Against a conservative #303030 surface plus the 10% chip tint, calculated text contrast ranges from 5.21:1 (purple) to 6.53:1 (amber). Labels remain readable independently of hue; light/custom themes require separate visual validation. Existing overview/detail status icons share the same palette. Deletion dialog chips share it too; user rows have subtle borders and spacing. Dialog title, descriptions, grouping, focus, buttons, queue, cancellation and native DELETE contract are unchanged.

The series summary retains its native disclosure marker and a visible keyboard focus ring. Desktop rows align username, chips and episode metrics; narrow rows stack. “You” is explicit, dates remain localized with full timestamps in native tooltips, and progress bars have accessible labels. A bar appears only when `CoverageComplete` is true and the available count is positive. Unknown counts are labelled incomplete, without invented percentages. The full coverage notice remains in the accessible label and tooltip of the shorter, focusable explanation.

All item/user text uses DOM textContent or safe attribute assignment. Existing account/navigation cancellation and administrator privacy boundaries remain. Expansion/collapse makes no network request. The scrollable list bounds unusually large user counts. Native header and content spacing are reused; no frontend dependency is added.

## Validation and screenshots

All five existing parallel CI jobs passed locally against the final candidate: LinuxServer catalog + Caddy HTTPS, v0.3.1 migration, official-image base-path proxy, legacy catalog/browser rollback, and Caddy WebSocket measurement. GitHub Actions was prepared, not dispatched.

- **87 backend tests**, **51 JavaScript/bootstrap tests**, **4 catalog tests** passed.
- Four full browser runs each recorded **13 approved native DELETEs**, with **zero ordering violations**. Cancel, Escape, dialog close, bulk queues, identity changes, permissions and failed protection checks retain their existing assertions.
- At 1280 and 390 px, keyboard expansion/collapse preserves title, metadata, action-container and ribbon geometry within the strict **<1 px** tolerance. Tests also assert that the panel lives outside the ribbon, the title stays visible, the panel fits horizontally, and computed chip colors match their labels.
- Safe text/long-name, all-six-status, missing-coverage/no-progress, valid progress, account privacy, settings, preferences and navigation regressions passed. Existing dialog focus and mobile overflow assertions remain intact.
- Native catalog round trip: v0.4.4 → v0.4.0 → v0.4.1 → v0.4.2 → v0.4.3 → v0.4.4. Both schema-1 stores and XML bytes were retained, with one active assembly and no Injector. Historical v0.3.1 migration/rollback and legacy dependency checks also passed.
- HEAD, conditional GET, compression, range, authenticated/no-store delivery, CSP, restart/uninstall and native Web-file integrity checks passed. The existing native-browser WebSocket helper/frame-error discrepancy remains unchanged; authenticated Caddy 101 and persistent ping/pong checks passed, as documented in standalone qualification.
- Backend, configuration, stores and standalone sources are byte-for-byte unchanged. `createAdapter`, `protectionCheck`, `validateStatus` and `resolveScope` function bodies are unchanged.

| View | Desktop | Narrow |
| --- | --- | --- |
| Collapsed | [Screenshot](screenshots/v0.4.4/series-activity-collapsed-1280.png) | [Screenshot](screenshots/v0.4.4/series-activity-collapsed-390.png) |
| Expanded | [Screenshot](screenshots/v0.4.4/series-activity-expanded-1280.png) | [Screenshot](screenshots/v0.4.4/series-activity-expanded-390.png) |
| Deletion dialog | [Screenshot](screenshots/v0.4.4/deletion-polish-desktop.png) | [Screenshot](screenshots/v0.4.4/deletion-polish-mobile.png) |

[Machine-readable release results](performance-data/release-v044.json).

Two forced Release builds produced identical ZIP bytes:

- SHA-256: `516f29160d4e6efb7296867d7a00848124306af804586dedceea9e6828d2e679`
- Jellyfin catalog MD5: `a2958238a470c618a0a0ca4f8c4d1855`

Chromium dark-theme modern/legacy shells were exercised. Other browsers, TV layouts and custom/light themes remain outside this visual qualification.

## Installation and rollback

Version `0.4.4.0`, stable GUID `a3c6bc84-783d-4ba8-a0db-89bfb83ab486`, target ABI `12.2.0.0`. The deterministic ZIP contains the plugin DLL and LICENSE only.

After explicit release approval/publication, update through the native catalog, restart Jellyfin and fully reload Web clients. No configuration, watchlist or preference migration is required; `ProtectCaughtUpSeries` retains its existing value/default. Preserve the v0.4.3 ZIP plus plugin XML and both JSON files for rollback. Reinstall v0.4.3 with one active assembly, restart and fully reload clients; policy and data remain compatible. No Injector, environment variable or Web-file modification is required.

The published v0.4.3 archive and checked-in manifest are retained unchanged. The publishing workflow still requires explicit approval and refuses stale catalog history. The RC is not advertised at an invented public URL.
