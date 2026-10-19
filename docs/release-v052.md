# WatchGuard v0.5.2 — Additional available episode progress

**Published v0.5.2.** [Publication run 39219433132](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/39219433132) succeeded on commit `9a3aa7d046863687b671f316da0a138cb4f6be21`: build, all ten integration suites and publication passed.

Target: Jellyfin Server/Web 12.2.0, .NET 10; stable GUID and ABI unchanged.

- Keep aired progress as the main fraction and show additional available episodes with a compact, accessible **+N** button, such as **3/3 +1**.
- Open episode details with click/tap or keyboard: season/number/title, date and each user's watched state. Future-dated, release-day and unknown-date entries are distinguished.
- Clarify **Caught up on aired episodes** when that user has unwatched extras. Preserve incomplete-coverage notices and existing classification/protection rules.
- Apply the same presentation to Watchlists cards and the Series viewing panel, with safe text rendering and older-payload fallback.

See [design, API fields, limits and rollback](extra-episodes-v052.md). No storage schema, watchlist timestamp, preference, loader, deletion or approval-policy changes. The first commit separately synchronizes current documentation with published v0.5.1 and its successful publication run.

## Validation

- 212 backend tests passed, including date boundaries, mixed per-user watched flags, native alternate-version completion, visibility changes, missing/virtual exclusions, privacy, and unchanged fresh protection results.
- 112 JavaScript/bootstrap/server-enforcement/browser-readiness tests passed, including older payloads, malformed extras, safe names, progress merging, dialog closure/focus and all existing deletion/approval checks.
- 14 Python infrastructure/hygiene tests and four catalog tests passed.
- Interface-model comparison against checksum-verified published v0.4.7 passed: every original item/user/count/date/reason and coverage field still matches; model playback batch and episode-work counts remain equal. Only the additive presentation DTO is excluded from that legacy comparison.
- The complete disposable official-image and LinuxServer/Caddy HTTPS browser suites passed: new extra-episode API assertions and both UI surfaces at 1280/390 px, Enter/Space/Escape and focus restoration, plus existing saved preferences, account changes, native movie/series/episode/season/context-menu/bulk deletion, zero DELETE on cancellation, and uninstall/data/Web-file checks.
- The complete disposable official-image server-enforcement suite passed 77 cases, including Caddy HTTPS, old Web tabs, expiry/replay/concurrency, permission and session changes, native single/bulk continuations and preservation of files/records on veto.
- Two Release builds produced identical ZIP SHA-256 `62af61f98b9d914f7890967048986f8c4641b8f3417edc2f08756bd15df7b3ec` (`Jellyfin.Plugin.WatchGuard-v0.5.2.zip`, plugin DLL + LICENSE only).

The hosted publication run also passed base-path, migration, legacy/rollback, WebSocket, discovery, verification, standalone/Caddy and all three server-enforcement profiles. Local results above precede that successful full qualification; published assets and checksums remain unchanged.

Environment: .NET SDK 10.0.302, Python 3.12.0 and Playwright 1.56.1. The initial direct official-image run used local Node 25.9.0; the JavaScript suite, LinuxServer/Caddy browser suite and complete server-enforcement suite were also run with CI’s pinned Node 24.22.0. See [structured local evidence](evidence/v052-validation.json).


## Browser evidence

Generated disposable media only; screenshots from the passing official-image run.

| View | Desktop | Narrow (390 px) |
| --- | --- | --- |
| Series viewing progress | [1280 px](screenshots/v052/extra-series-inline-1280.png) | [390 px](screenshots/v052/extra-series-inline-390.png) |
| Watchlists extra details | [1280 px](screenshots/v052/extra-card-1280.png) | [390 px](screenshots/v052/extra-card-390.png) |
| Series extra details | — | [390 px](screenshots/v052/extra-series-390.png) |

Initial new browser assertions exposed two fixture assumptions: completed episodes had no air dates (now explicitly asserted as `0/0 +4` with four “Date unknown · Watched” rows), and externally changed metadata requires an explicit Refresh followed by readiness before opening details. The corrected tests wait for that refresh to settle so they do not assert focus on a replaced owner row. These were fresh disposable reruns; no DELETE or approval was retried, and existing deletion assertions were preserved.
