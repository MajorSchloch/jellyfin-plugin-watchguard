# Watchlists to native item details

The installed v0.7.12 report came from LG webOS 6.5.3-47. This fix concerns departure from Watchlists. Publisher recovery and the preferences-initialization race remain separate work.

## Reproduction and cause

The disposable Jellyfin 12.4 fixture reproduced the flash in real Chromium 79.0.3945.0. The test activated a real series card with remote Enter/OK and held native destination requests. It sampled rendered frames and native lifecycle events, rather than only the final page.

At `hashchange`, the old runtime removed the Watchlists panel and `watchguard-page-open`. Native Home remained visible before `viewbeforehide` and the detail view's `viewbeforeshow`/`viewshow`. The initial observation recorded two Home frames. With the detail-chunk request held, the published package exposed Home in 53 of 60 sampled frames. The same assertion fails before the fix and passes after it.

The native detail controller also starts its item-data load from `viewshow`. Thus, `viewshow` alone does not establish that the requested item's controls are ready. The inspected native Web assets use the same detail structure on supported Jellyfin versions: `itemDetailPage`, `.nameContainer` and `.mainDetailButtons .btnPlaystate` with item/server attributes.

## Handoff contract

WatchGuard places a neutral, scoped “Loading item…” cover before it removes Watchlists. It then aborts the Watchlists lifetime immediately. Poll/search timers, queued work and owned listeners stop; response-generation and account fences reject late results. Already dispatched native ApiClient requests can finish because that API exposes no transport abort handle. The cover makes no data requests and retains no titles, owners, progress or membership data.

Native content stays laid out behind the cover. No ancestor is hidden for a visibility check, so WatchGuard cannot prevent its own readiness condition.

Release requires all of these conditions:

- The current route is the exact pending detail route.
- The ApiClient object, user, access token and server still match the captured account.
- A native `viewshow` identifies the pending item on the connected `itemDetailPage`. An explicit server parameter must match. Native links that omit it use the captured current ApiClient server; that server identity is required and the rendered control must still match it.
- That view is not hidden, has layout boxes and contains its rendered title.
- Its native play-state control carries the matching item and server IDs.

A generic event, unrelated item, stale route, detached view or old rendered control cannot clear the cover. Mutation observation handles item rendering after the matching lifecycle event. The cover does not use an elapsed delay as a success condition.

The native focus manager can select its detail control while the cover is present. WatchGuard temporarily keeps covered content out of remote focus, then restores that same native control. Header focus remains undisturbed. The visible return link remains available during loading. Native Back/Forward and history continue to own routing.

A navigation sequence has one 15-second cleanup deadline. Retargeting does not extend it. On expiry, WatchGuard removes the full cover, stops its observer/listener and shows a compact failure notice with a return link. This is failure recovery, not a declaration that the destination is ready. Account changes, logout, navigation away and document exit clear owned temporary state. A return to Watchlists uses the existing incoming handoff.

## Validation

`tests/outgoing-browser.cjs` runs against a disposable server and actual packaged scripts. It uses Puppeteer 2 with a real Chromium 79 binary when `WATCHGUARD_CHROMIUM79` is set; otherwise it uses the pinned Playwright browser. It is part of the existing base-path navigation qualification scenario on Jellyfin 12.2, 12.3 and 12.4. Existing startup and navigation suites remain required.

The cases cover TV, Desktop Legacy, Mobile Legacy, Modern and Auto; movie and series cards; remote OK, mouse and touch; held destination requests; Back/Forward; cancelled navigation followed by another selection; failure cleanup; authenticated account switching and logout. Tests assert prompt Watchlists teardown, no Home frames, matching native detail readiness and TV destination focus.

Unit tests independently reject mismatched lifecycle/item/server/account state, missing native layout and extended deadlines. They check listener/observer cleanup, failure recovery and preservation of header focus.

Browser emulation is not physical-TV validation. On the LG device, open a movie and a series with OK, use Back during loading, then repeat with a slow server connection. Confirm that loading stays inside the transition, focus reaches the detail controls, and Back returns to Watchlists. Pointer remote behavior, firmware-specific input handling and suspend/resume still require the physical device.

The deadline cannot repair a native destination failure. It provides a visible return action. Native ApiClient transport completion remains bounded by Jellyfin; WatchGuard cancels subsequent work and rejects stale results without replacing that transport.

## Local evidence

[Before-fix report](evidence/outgoing-handoff/baseline.json), [Chromium 79 report](evidence/outgoing-handoff/chromium79.json) and [current-browser report](evidence/outgoing-handoff/current-browser.json) retain sampled frame counts and lifecycle order. Both corrected browsers passed ten movie/series cases, with zero Home exposures during departure, Back and Forward. Authenticated account switching, logout, cancellation and bounded failure recovery passed.

| Published v0.7.12, destination held | Corrected runtime, destination held |
|---|---|
| ![Home exposed before the fix](evidence/outgoing-handoff/before-home.png) | ![Neutral loading cover after the fix](evidence/outgoing-handoff/after-tv-loading.png) |

[Native TV detail and focus](evidence/outgoing-handoff/after-tv-detail.png), [mobile loading](evidence/outgoing-handoff/after-mobile-loading.png) and [failure recovery](evidence/outgoing-handoff/failure-recovery.png) show the remaining states.

The initial local package contained the first handoff runtime but retained version 0.7.12 pending the candidate-version decision. ZIP SHA-256: `6808ae967ac25f945fde70c2e16c959616b6ed3f69be0afaf6d5fc8295a7afaa`. DLL SHA-256: `f08da50ba8b578ce28c33f3c6e81de57644cd06a3d26a201c7378426b3a902cd`. These are development artifacts, not replacements for the published v0.7.12 assets.

The retained incoming-startup suite passed 48 transition cases and 14 recovery cases. The existing navigation suite passed 72 control-transition cases. Fast checks passed 214 JavaScript tests, 94 Python tests, eight catalog tests and 376 backend tests. The initial fast run exposed stale current-release labels on master after v0.7.12 publication; those labels now match the existing catalog. No catalog entry changed.

## First CI attempt and fixture correction

[Run 41239515881, attempt 1](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/41239515881) tested commit `aeb86547668d85bc9254c7b2e2f62a48cb7bc819`. Its CI package artifact `13057155527` matched the local ZIP and DLL hashes above. All integration jobs except the three navigation jobs passed; the complete evidence gate did not run. This attempt is not a successful qualification.

The first native card transition timed out on each version. A local reproduction in the pinned Linux browser image found its default language was `en-US@posix`. Jellyfin's native `Number.toLocaleString` rejected that language tag during control construction, before the detail lifecycle. The new test now selects `en-US`, as the existing native suites do. [The original Linux reproduction](evidence/outgoing-handoff/linux-fixture-failure.json) retains the error and lifecycle evidence.

The added diagnostics also found that a fabricated `viewshow` event invoked Jellyfin controllers without their required view/options data. The browser suite now uses only actual native lifecycle events. Isolated unit tests retain the malformed and unrelated event rejection assertions. The browser test records script/request errors and failed-transition frames, and rejects script errors during normal card navigation. Neither correction changes runtime code, package bytes, timeouts or the strict Home/focus assertions.

After the fixture correction, the pinned Linux Chromium 141 browser and real Chromium 79 each passed all ten cases on Jellyfin 12.3 with the base path. Every normal departure, Back and Forward sample had zero Home exposures. The Linux browser used `en-US`; normal card transitions had no script errors. The intentional HTTP 503 case still exercised the native chunk-load failure and bounded recovery.

## Current-server link regression

The corrected-fixture [run 41241472584](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/41241472584) passed the new outgoing cases on 12.4, with zero Home exposures. The existing native-controls theme test then exposed a runtime edge case: native current-server links use `#/details?id=...` and omit `serverId` from their lifecycle parameters. The cover incorrectly waited for that optional parameter, although the native detail controls had rendered. [Failure evidence](evidence/outgoing-handoff/current-server-route-failure.json) is retained.

The handoff now accepts that native link form while requiring the active server identity and the rendered control's server ID to match the captured account. Explicit mismatches still fail. A focused unit test covers omitted, mismatched and unknown server identity. The native suite also holds and observes a current-server detail link from Watchlists. No deadline or timeout was increased.

## Current-server correction validation

The packaged current-server correction passed real Chromium 79 and pinned Linux Chromium 141: ten movie/series cases each, plus the current-server link case, with zero Home exposures on departure, Back and Forward. The unchanged native-controls suite passed all 12 layout/width cases and all six built-in themes (Light, Purple Haze, Blue Radiance, Apple TV, WMC and Dark). [Its retained summary](evidence/outgoing-handoff/native-controls-final.json) records the focus, write and interaction checks.

Fast checks passed 215 JavaScript tests, 94 Python tests, eight catalog tests and publication-note checks. Packaging verified the actual embedded scripts and settings code against ES2019/Chromium 79 syntax. Final local ZIP SHA-256: `e55f2aa67c51e029f6769dc5a3a3d8d7e749a0cb6c6ecc72a41374fbf8473ec2`. DLL SHA-256: `5c633ad7d5fa15e95dc76b7b71715a97b5c651083b8d8ff91255239f1ff5530a`. Version remains 0.7.12 in this development branch; published assets and the catalog are unchanged.

## Scope review and separate activity failure

[Run 41243499835](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/41243499835) tested commit `db59c2d5d34edddd0f27ab0857a0e15e61cb9821`, package artifact `13058705301` (the `e55f2a…` ZIP above). Its 12.4 migration/browser job failed an existing episode-extras assertion at `tests/browser-poc.cjs:785`. [Evidence](evidence/outgoing-handoff/activity-loading-failure.json) and [screenshot](evidence/outgoing-handoff/activity-loading-failure.png) show Watchlists in background population with no verified matches and no outgoing cover. The cause is not established; this is not a successful full qualification. The activity/preferences-initialization follow-up remains separate, without retries or weaker assertions.

A scope review also narrowed the newly added native lifecycle hooks to detail routes. They prepare outgoing navigation only; incoming Watchlists mounting, queries and preference initialization remain on their existing route path. An unrelated checkbox-focus specificity edit was removed. No activity or preference implementation changed.

## Final scoped package

The departure-only lifecycle package passed both native outgoing suites (Chromium 79 and pinned Linux Chromium 141), including the current-server route. All ten movie/series cases per engine had zero Home exposures on departure and Back/Forward. The retained native-controls suite passed all 12 layout/width cases and six themes again. The linked browser summaries and after screenshots now describe this final package.

ZIP SHA-256: `36d67f77f6721a029c9ed21bb17ed16b826ae7e41d53cf98b15cc19fbaa87ba8`. DLL SHA-256: `6943145dee6b3be8613255072d3ea30271cb389b526a91ae605c3bbd59b97f4e`. Packaged ES2019/Chromium 79 checks and all 215 JavaScript tests passed. Version/catalog metadata remain unchanged. Physical LG firmware validation is still required.

## Final qualification

[Run 41245891354, attempt 1](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/41245891354) tested source commit `9f5f8702a83d2031f66ac7bdaeecacc1c5fb492f` with `publish=false` and `proxy_matrix=true`. All 39 suites passed on Jellyfin Server/Web 12.2.0, 12.3.0 and 12.4.0, and the strict **Verify complete compatibility evidence** gate passed. The package was byte-identical to the final local scoped package above. [Retained summary](evidence/outgoing-handoff/qualification.json) records every suite, image digest and native handoff result.

- Package artifact: [13058538512](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/41245891354/artifacts/13058538512).
- Original qualification record: [13060590895](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/41245891354/artifacts/13060590895).
- Native outgoing reports: 30 movie/series card cases plus three current-server link cases, with zero Home exposures during departure and Back/Forward. Recovery, account switching, logout and remote destination focus passed on each version.

The workflow's overall result is **failure**, solely because the separate read-only publication rehearsal correctly rejected `Qualified ZIP conflicts with the completed public release.` This development branch retains version 0.7.12 with changed runtime bytes. The rehearsal used `write=false`; public releases and catalog metadata were not changed. The runtime qualification passed, but this is not a publication-ready candidate or authority to replace v0.7.12.

The earlier activity-loading assertion passed in this final run. Its cause remains unconfirmed and its original failure is retained; this PR does not claim to fix the separate preferences/activity-initialization race. The earlier superseded run was cancelled after its recorded failure; its unfinished navigation jobs are not counted as passes. Physical-TV validation and native ApiClient's lack of a transport-abort handle remain the limits described above.
