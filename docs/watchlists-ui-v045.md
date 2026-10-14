# WatchGuard v0.4.5 — Watchlists overview polish

UI-only candidate for Jellyfin Server/Web 12.2 and .NET 10. Native playback discovery, authorization, protection APIs, deletion adapter, standalone loader, configuration and both schema-1 stores remain unchanged. No new dependency. Nothing is published or deployed.

## Coverage disclosure

A native `details/summary` displays “Completed activity: last N days · current interest · not exhaustive.” Enter/Space toggles it; the full server `Notice` remains verbatim inside. The window applies to completed history, not all ongoing interest. No extra settings request is made.

The existing response has no structured window or episode-coverage field. The UI recognizes only the exact routine preamble emitted by `InterestOverviewService`. Any suffix, including incomplete episode coverage and safety-limit explanations, remains visible **outside** the disclosure. An unfamiliar notice is also displayed in full outside it. `LimitReached:true` without explanatory text gets an explicit omission warning. `IsComplete:false` remains required by the existing validator: it indicates bounded, non-exhaustive discovery even below the safety limits. No warning is interpreted as confirmed zero interest. Future server wording changes therefore degrade to visible text rather than hidden warnings.

Loading and failed-source errors remain separate and visible. The activity spinner and already loaded memberships retain their progressive behavior. The disclosure's open state survives local sorting/filtering and response rendering.

## Toolbar and cards

Owner and Sort by have visible labels as well as accessible names. Status filters retain native disclosure, labeled checkboxes, selected count, Escape handling and saved-default controls. Controls wrap at narrow widths and have at least 44px touch targets. Owner remains hidden for ordinary users. Owner changes retain the existing authorized scoped requests; status and sort changes operate locally, preserving saved-default and explicit URL precedence.

The eight-column desktop / two-column narrow grid, media links, lazy image loading, stable card/image identities and current-user removal behavior remain. User rows align icons, ellipsized names and optional episode counts; localized last-played calendar dates retain full timestamp tooltips and accessible labels. Full names are keyboard focusable. Multiple users have subtle separators and a bounded, scrollable list instead of unlimited card growth. No permanent progress bars or fake dates are introduced.

Status icons reuse the v0.4.4 palette and labels: amber Watchlisted, blue Watching, teal Caught Up, green Watched, purple Currently Playing. Unknown coverage remains textual and muted. Icons use a small fixed dark tile, preserving accent contrast even on a light surface; the page uses Jellyfin text/background palette variables with paired dark fallbacks. Color is supplementary to accessible icon labels and full row descriptions. Focus outlines, hover/pressed bookmark states and 44px removal buttons remain visible. All server names, titles and notices use safe DOM text properties.

## Validation

Validated locally against the final ZIP using disposable generated media:

- **87 backend**, **52 JavaScript/bootstrap** and **4 catalog** tests passed.
- All five parallel CI job equivalents passed: LinuxServer native catalog + Caddy HTTPS, v0.3.1 migration, official-image base-path proxy, legacy catalog/browser, and Caddy WebSocket measurement. GitHub Actions was prepared, not dispatched.
- Four complete browser runs each recorded **13 approved native media DELETEs**, **zero ordering violations**. Cancel/Escape/close, failed/malformed checks, identity changes, parent-series protection, self-protection and exact native call-count assertions remain intact.
- Coverage tests verify the exact notice, configured window, keyboard disclosure, visible episode/safety warnings, unfamiliar text and missing limit wording. Browser tests verify 1280/390px layout, 44px controls, filter popup bounds, no overflow, multi-user cards, untrusted/long names, colors, focus and light-palette text contrast.
- Existing local filtering/sorting, preference/URL precedence, progressive memberships, card identity, loading/failures, ordinary-user privacy, stale responses, context actions, native settings and series-detail layout tests passed. Responsive shell geometry is allowed to settle before measuring expansion; the existing **<1px** title/metadata/action/ribbon stability assertion is retained.
- Native catalog round trip: **0.4.5 → 0.4.0 → 0.4.1 → 0.4.2 → 0.4.3 → 0.4.4 → 0.4.5**. Both schema-1 stores and XML bytes survived with one active assembly and no Injector. Separate v0.3.1 conflict/migration/rollback tests preserved unrelated registrations.
- Authentication, stale tabs, CSP, HEAD, range/cache/compression semantics, Caddy HTTPS gzip/zstd, restart/uninstall and Web-file integrity passed. The previously documented native-browser WebSocket helper discrepancy remains unchanged; authenticated Caddy 101 and persistent ping/pong checks passed.
- Only the embedded Web script changes runtime implementation; C# backend and standalone files are unchanged. Deletion functions, interest selection/merge, membership and preference functions compare identically with v0.4.4.

[Machine-readable release results](performance-data/release-v045.json). Dark modern/legacy Chromium shells were exercised; the light-palette screenshot is a controlled Jellyfin CSS-variable override, not certification of arbitrary custom themes. Other browsers and TV layouts require separate visual qualification. Initial test iterations exposed a broad filter locator and missing membership setup; both were corrected without weakening safety assertions. Visual inspection also identified and corrected inherited light-theme text contrast before final qualification.

| View | Desktop | Narrow |
| --- | --- | --- |
| Overview | [1280px](screenshots/v0.4.5/overview-polish-1280.png) | [390px](screenshots/v0.4.5/overview-polish-390.png) |
| Expanded coverage | [1280px](screenshots/v0.4.5/overview-coverage-1280.png) | [390px](screenshots/v0.4.5/overview-coverage-390.png) |
| Filters | [Desktop](screenshots/v0.4.5/status-filters-desktop.png) | [Narrow](screenshots/v0.4.5/status-filters-narrow.png) |

[Visible coverage/safety warning](screenshots/v0.4.5/overview-warning-390.png) · [Light-palette contrast](screenshots/v0.4.5/overview-light-1280.png).

Two forced Release builds produced identical ZIP bytes. Runtime payload: plugin DLL only, with LICENSE; Web assets are embedded.

- SHA-256: `ebe3827470e439bd0a15f7fb65edfa330c6ecf2d1f8ec4112402680f109f709f`
- Jellyfin catalog MD5: `60aaf3f6fc37d03e3c47e6596eefc808`

No public release asset or manifest entry was modified; no production configuration/media was accessed.

## Upgrade and rollback

Version `0.4.5.0`, stable GUID `a3c6bc84-783d-4ba8-a0db-89bfb83ab486`, ABI `12.2.0.0`. Use the existing catalog workflow only after separate approval/publication. No preference, configuration or watchlist migration is needed. Restart Jellyfin after the plugin upgrade and fully reload every Web client.

Keep the published v0.4.4 ZIP, plugin XML, `watchlists.json` and `preferences.json` for rollback. Reinstall v0.4.4 with one active plugin assembly, restart and reload clients. No Injector or Web-file modification is required. Existing published assets and manifest entries are unchanged. The release workflow prepares/validates by default; publication still requires explicit approval and complete public catalog history.
