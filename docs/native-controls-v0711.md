# Native detail actions and Watchlists controls — v0.7.11

## Reference and implementation

The starting point is published v0.7.10 on master `eb6e120`. Disposable, digest-pinned Jellyfin Server/Web 12.2.0, 12.3.0 and 12.4.0 fixtures establish the baseline before editing the runtime. The shared native detail template uses `emby-button`, `detailButton`, `detailButton-content` and `detailButton-icon` even under Modern. Normal detail geometry already matches; the baseline’s WatchGuard button has no visible keyboard focus outline in all twelve layout/width combinations per version.

The installed Web implementation supplies the native checkbox’s real input, caption, decorative outline and checked icon. WatchGuard uses that structure without instantiating native custom elements or copying event handlers. The real checkbox retains Space, Tab, change, checked and focus semantics. Browser pointer tests click or tap its visible native label and still assert the real input state; they never force a click through the decorative caption or set checked state with script. The status disclosure retains Enter, Escape with focus return, and outside-pointer dismissal. Its summary children now survive query renders and polling.

Native shared form classes provide field labels, typography and theme presentation. A low-priority CSS layer supplies the select base rules when native pages have not yet loaded their lazy select stylesheet. Native theme rules take precedence. The page background and filter popup use the native `backgroundContainer` and `paperList` theme contracts; scoped layout rules preserve Watchlists positioning. Native button hover colors are no longer suppressed by a competing toolbar color rule. No generated CSS hashes, MUI runtime, copied IDs, handlers or ripple internals are introduced.

The detail action is a direct sibling of native actions. Its geometry and icon scale remain native. An explicit keyboard outline complements native hover styling. Saved membership uses the native `button-link` accent class (including Legacy themes without palette variables) and `bookmark_remove`; unsaved membership uses `bookmark_add`. The same button survives writes. Disabled/busy state blocks repeated mutations; failures retain membership and permit retry. Navigation/account fencing and focus restoration remain in place.

Save and Reset remain focusable while busy, expose `aria-disabled`/`aria-busy`, and serialize preference writes against each other. Existing success/error feedback and stored preference semantics remain unchanged. This serialization covers repeated clicks, keyboard activation and direct invocation, without extra requests.

## Validation and coverage

`tests/native-controls-browser.cjs` runs within the existing isolated `basepath-navigation` fixture in each supported-version qualification shard. It adds no new fixture or qualification suite, and failures propagate through the existing required command. The existing navigation, drawer, startup, activity, native deletion/approval, permission, catalog, account-isolation and historical-package scenarios remain required. The exact seven-digit timestamp oracle and native dialog-close synchronization remain unchanged apart from the candidate’s version label.

The new browser checks explicitly select Auto, Modern, Desktop Legacy and Mobile Legacy at 390, 1280 and 2048 pixels, using separate mouse and touch contexts. They compare native detail geometry and styles, visible keyboard focus, native field theme contracts, overflow, Escape/focus return, outside dismissal, keyboard checkboxes and delayed rapid search. A frame observer asserts that filtering does not replace the panel or search node, lose focus, or expose Home. Existing action tests retain delayed/failed writes, duplicate prevention, same-node/focus assertions, other-user membership and native media/user-data preservation.

Built-in theme coverage uses the real native Display settings form: Dark, Light, Purple Haze, Blue Radiance, Apple TV and WMC. Screenshots and computed theme comparisons cover the controls; this is not a card or dialog redesign. The retained palette simulation supplies both native primary and secondary text variables and retains all contrast assertions. Tests use pinned Playwright Chromium and viewport/touch emulation, not physical devices. Qualification uses the existing pinned browser container.

## Limits

Watchlists remains a plugin-owned native HTML form surface using Jellyfin’s shared form contracts. Its selects keep browser-native option popups, rather than impersonating React/MUI Select behavior. Modern Display settings use MUI filled fields; Watchlists does not mount a second React runtime to copy that implementation. Third-party themes, TV layouts and other browser engines are outside this presentation qualification. Existing cards and deletion/approval dialogs are separate work.

## Evidence

Before/after [rendered measurements](evidence/native-controls-v0711/native-contracts.json) and [screenshots](screenshots/native-controls-v0711/after-auto-390-filters.png) cover the actual native fixtures. The first qualification dispatch [41044097612](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/41044097612) was canceled after focused testing exposed the old direct-input click fixture assumption. Native label interaction and complete native palette simulation retain the original checked-state, routing, focus, contrast and security assertions. No retries, forced clicks, reload recovery or safety-limit changes were added. Final qualification is recorded after the corrected commit passes; no publication or deployment is part of this change.
