# Native detail actions and Watchlists controls — v0.7.11

## Reference and implementation

The starting point is published v0.7.10 on master `eb6e120`; the baseline DLL was extracted from the unchanged published ZIP (`fd4e0301c312406e4ada3301e64bcb504aa29fd16c80157beb735b5ddc2b0681`). Disposable, digest-pinned Jellyfin Server/Web 12.2.0, 12.3.0 and 12.4.0 fixtures establish the published baseline; final baseline captures use explicit rendered-layout assertions. The shared native detail template uses `emby-button`, `detailButton`, `detailButton-content` and `detailButton-icon` even under Modern. Normal detail geometry already matches; the baseline’s WatchGuard button has no visible keyboard focus outline in all twelve layout/width combinations per version.

The installed Web implementation supplies the native checkbox’s real input, caption, decorative outline and checked icon. WatchGuard uses that structure without instantiating native custom elements or copying event handlers. The real checkbox retains Space, Tab, change, checked and focus semantics. Browser pointer tests click or tap its visible native label and still assert the real input state; they never force a click through the decorative caption or set checked state with script. The status disclosure retains Enter, Escape with focus return, and outside-pointer dismissal. Its summary children now survive query renders and polling.

Native shared form classes provide field labels, typography and theme presentation. A low-priority CSS layer supplies the select base rules when native pages have not yet loaded their lazy select stylesheet. Native theme rules take precedence. The page background and filter popup use the native `backgroundContainer` and `paperList` theme contracts; scoped layout rules preserve Watchlists positioning. Native button hover colors are no longer suppressed by a competing toolbar color rule. No generated CSS hashes, MUI runtime, copied IDs, handlers or ripple internals are introduced.

The detail action is a direct sibling of native actions. Its geometry and icon scale remain native. An explicit keyboard outline complements native hover styling. Saved membership uses the native `button-link` accent class (including Legacy themes without palette variables) and `bookmark_remove`; unsaved membership uses `bookmark_add`. The same button survives direct writes and successful membership changes from the native More menu. Menu changes apply the acknowledged personal membership state to the existing action without an extra membership read. Disabled/busy state blocks repeated mutations; failures retain membership and permit retry. Navigation/account fencing and focus restoration remain in place.

Save and Reset remain focusable while busy, expose `aria-disabled`/`aria-busy`, and serialize preference writes against each other. Existing success/error feedback and stored preference semantics remain unchanged. This serialization covers repeated clicks, keyboard activation and direct invocation, without extra requests.

## Validation and coverage

`tests/native-controls-browser.cjs` runs within the existing isolated `basepath-navigation` fixture in each supported-version qualification shard. Each layout starts a fresh document and asserts the actual native header and mobile-layout class before measuring controls. It adds no new fixture or qualification suite, and failures propagate through the existing required command. The existing navigation, drawer, startup, activity, native deletion/approval, permission, catalog, account-isolation and historical-package scenarios remain required. The exact seven-digit timestamp oracle remains unchanged apart from the candidate’s version label. The native error-dialog close/history wait is preserved and reused for the new menu interactions.

The new browser checks explicitly select Auto, Modern, Desktop Legacy and Mobile Legacy at 390, 1280 and 2048 pixels, using separate mouse and touch contexts. They compare native detail geometry and styles, visible keyboard focus, native field theme contracts, overflow, Escape/focus return, outside dismissal, keyboard checkboxes and delayed rapid search. A frame observer asserts that filtering does not replace the panel or search node, lose focus, or expose Home. Existing action tests retain delayed/failed writes, duplicate prevention, same-node/focus assertions, other-user membership and native media/user-data preservation.

The twelve layout/width combinations use Dark. Separate Modern/1280 theme coverage uses the real native Display settings form and compares saved detail accents with native hover accents: Dark, Light, Purple Haze, Blue Radiance, Apple TV and WMC. Screenshots and computed theme comparisons cover the controls; this is not a card or dialog redesign. The retained palette simulation supplies both native primary and secondary text variables and retains all contrast assertions. Tests use pinned Playwright Chromium and viewport/touch emulation, not physical devices. Qualification uses the existing pinned browser container.

## Limits

Watchlists remains a plugin-owned native HTML form surface using Jellyfin’s shared form contracts. Its selects keep browser-native option popups, rather than impersonating React/MUI Select behavior. Modern Display settings use MUI filled fields; Watchlists does not mount a second React runtime to copy that implementation. Third-party themes, TV layouts and other browser engines are outside this presentation qualification. Existing cards and deletion/approval dialogs are separate work.

## Evidence

Published-baseline measurements are retained in the adjacent `before-*.json` files. Final CI measurements are retained for [12.2](evidence/native-controls-v0711/after-12.2.json), [12.3](evidence/native-controls-v0711/after-12.3.json) and [12.4](evidence/native-controls-v0711/after-12.4.json), alongside the [native contracts](evidence/native-controls-v0711/native-contracts.json) and [screenshots](screenshots/native-controls-v0711/after-auto-390-filters.png). Baseline and candidate captures assert the actual rendered layout; a narrow desktop layout is not counted as Mobile Legacy. The screenshot pairs use local macOS fixtures with pinned Playwright Chromium; final CI measurements use the pinned Linux browser container. Each measurement compares WatchGuard with a native peer in that same environment.

[Focus transitions](evidence/native-controls-v0711/focus-transition.json) retain the same focused node while its native CSS transition reaches a 2px outline in 208–223ms. Close-ups wait for the actual animation to finish. The [menu comparison](evidence/native-controls-v0711/menu-identity.json) reproduces button replacement in an earlier candidate and retained identity after the correction. Every layout/width case now checks menu-to-detail updates with mouse/touch activation and actual native dismissal.

The [failure-state measurements](evidence/native-controls-v0711/error-contrast.json) reproduce the former pale-red text's 1.12:1 contrast in Apple TV. Inheriting the native detail foreground raises it to 9.31:1; all six themes measure 8.81:1–16.05:1 on the disposable fixture. Tests composite computed solid foreground/background colors, preserve membership on failed writes and save screenshots. Cards and deletion dialogs remain outside this change.

## Qualification

Full qualification passed on `39d79756a2729765a68ec9e47397004cda1ff684`: [run 41055032547](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/41055032547), `publish=false`, `proxy_matrix=true`. The gate verified all **39 suites / 54 primary fixture commands**, with no primary-command retries and one identical package across 12.2.0, 12.3.0 and 12.4.0. Publication was skipped. Elapsed time was 33m 35s; combined job execution was 21,708s. These are measurements of this run, not a claimed performance improvement.

[Qualification summary, image digests and results](evidence/native-controls-v0711/qualification-summary.json):

- ZIP SHA-256: `c48fc7150da44e6e37670bd2be41813ee1590c931b29a964a110fdb06e7a534b`.
- DLL SHA-256: `febca265d9dae4e638573377a94b72bd6a7124213bba9bc2f48bc41d3c87eaaa`.
- Fast checks: 376 backend, 203 JavaScript, 47 Python and 8 catalog tests; deterministic packaging and publication-copy checks passed.
- Per version: 12 control layout/width cases, six themes, 72 filter transitions, 10 history cases, 48 startup cases, 48 arrival cases, 12 drawer cases and eight navigation-shell cases passed.
- The new delayed-filter observers sampled 1,364 frames across all versions with zero panel replacements, focus losses or Home exposures. Failure feedback, pending writes, successful retry, native-menu identity and preference serialization passed.

Subsequent commits record documentation and evidence only; the exact tested runtime/test commit above remains the qualification reference. The published catalog and existing release binaries are unchanged.

Earlier attempts remain auditable:

| Run | Outcome | Reason |
|---|---|---|
| [41044097612](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/41044097612) | Canceled | Native checkbox fixtures needed to activate the visible label. Checked-state, routing and focus assertions were retained. |
| [41046047323](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/41046047323) | Canceled | The new matrix needed document reloads and rendered-layout assertions. Both baseline and candidate were recaptured. |
| [41048106974](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/41048106974) | Failed | 17/18 integration jobs passed; the 12.3 LinuxServer/Caddy poster-menu membership command was absent. |
| [41052441340](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/41052441340) | Canceled | Included the final native-menu-to-detail node-identity correction. |
| [41053721825](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/41053721825) | Canceled | Included the reproduced Apple TV failure-text contrast correction. |

The final 12.3 LinuxServer/Caddy job passed the poster-menu scenario, recording both poster triggers without source/route/caller invalidation and zero deletion-order violations. The earlier poster-menu failure's cause remains unconfirmed. Its native trigger/authorization/attachment fences are unchanged. Focused and complete disposable 12.3 LinuxServer/Caddy replays passed locally; neither the node-identity correction nor the contrast correction is claimed to fix that failure. Artifact `12974775838` retains screenshots and trace; a [local failure record](evidence/native-controls-v0711/earlier-menu-failure.json) and [screenshot](screenshots/native-controls-v0711/earlier-poster-menu-failure.png) remain in the repository. The fixture now records at most 64 structural menu events (source attachment, caller/route equality, mutations and close), excluding credentials, IDs, URLs and response bodies. No assertions, timeouts, runtime fences, safety limits or retry policy were weakened.
