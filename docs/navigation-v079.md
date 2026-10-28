# WatchGuard v0.7.9 native navigation

## Reproduced cause

The released v0.7.8 runtime inserts a Legacy header link into `.headerLeft`, beside the logo, while Home/Favorites live in `.headerTabs`. On Mobile Legacy this also compresses the logo. The previous drawer tests selected Modern and narrow Desktop Legacy, never the actual `mobile-legacy` layout.

The new `navigation-shell-browser.cjs --baseline` test ran against the unchanged v0.7.8 DLL on the digest-pinned Jellyfin 12.4 fixture. Both Legacy modes failed the same-row assertion at 1280px and 390px. Auto and Modern retain their existing toolbar/drawer behavior.

## Integration choice

Packaged Jellyfin Web's `emby-tabs` controller indexes `.emby-tab-button` elements and parses `data-index` during click handling. WatchGuard therefore adds a sibling anchor alongside that controller, with no native tab class or index. Its font and padding come from the native Favorites button; scoped CSS uses Jellyfin theme variables for secondary, selected and hover colors. Home and Favorites keep indexes 0 and 1, native event handlers and scroller ownership.

Legacy has one persistent entry in each navigation surface: header and drawer. The closed native drawer hides its entry. Opening it no longer removes the header anchor or recenters the native tabs. Drawer links use native `navMenuOption`, icon/text slots and selected styling; native click delegation closes the drawer. Leaving Watchlists through a Legacy Home/Favorites button follows the corresponding existing Home URL after native click handling, including when Home was already selected beneath the overlay.

There is still no supported runtime plugin-tab registration API. This is a bounded DOM integration with known native slots, not a replacement router. No generated CSS classes, pixel positioning, native tab index changes, new polling intervals or API requests are added. The existing startup handoff, filter replaceState behavior, query lifetimes, authentication and account clearing remain intact.

## Validation

Full unified qualification passed on `6ebe2517eadc9552ee3bbc3b6485629748ea2d97` ([run 40707196201](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/40707196201)), with `publish=false` and `proxy_matrix=true`. All 20 required jobs passed; publication was skipped. The evidence gate accepted all 39 suite reports (13 suites × three supported versions), covering 54 primary fixture commands, with no retries. Tests select the actual `auto`, `desktop-legacy`, `mobile-legacy` and `modern` layout values, and assert the rendered shell and mobile layout class. Coverage includes native drawer rows, geometry, duplicate entries per surface, header identity/position through drawer opening, native tab exit behavior, direct links, reload/hard reload, Refresh, filters, rapid changes and browser Back/Forward. Existing startup frames are observed before bootstrap and during delayed requests.

| Native checks per Server/Web version | 12.2.0 | 12.3.0 | 12.4.0 |
| --- | ---: | ---: | ---: |
| Shell placement/navigation (four layouts) | 8 | 8 | 8 |
| Open-drawer geometry/navigation | 12 | 12 | 12 |
| Filter transitions observed during loading | 72 | 72 | 72 |
| Delayed direct entry/reload/hard reload | 48 | 48 | 48 |
| Refresh / startup recovery | 8 / 14 | 8 / 14 | 8 / 14 |
| Enforcement cases, three deployment fixtures | 231 | 231 | 231 |
| Native catalog fixture cases, 27 revisions each | 4 | 4 | 4 |

All 216 filter transitions and 144 delayed startup cases recorded zero Home exposure. Native Home/Favorites retain indexes 0/1; Legacy header identity and keyboard focus survive resizing, and opening the drawer leaves the header geometry unchanged. Activity filtering, historical comparisons, real polling, approvals, permissions, account isolation, native catalog and proxy/base-path regressions all passed. Local and CI checks also passed 376 backend, 194 JavaScript, 37 infrastructure and 8 catalog tests.

The one package is `Jellyfin.Plugin.WatchGuard-v0.7.9.zip`:

- ZIP SHA-256: `75caecd64bcd3b8137ba33e199ab04fc75c0becfd613cd8904cde95cd8239c6a`.
- DLL SHA-256: `a0a0518859cf5dfc62f83b363e124e554f68de85d8829b455076810105273eb1`.
- Runtime commit: `524cd3028a5857286dfacb67e112de46baa29a14`; qualification commit adds only the native drawer capture-readiness check. Later documentation/screenshots do not change the runtime.

[Machine-readable summary](evidence/navigation-v079/summary.json), [complete gate evidence and pinned image digests](evidence/navigation-v079/qualification.json), [native reports for 12.2](evidence/navigation-v079/12.2), [12.3](evidence/navigation-v079/12.3), [12.4](evidence/navigation-v079/12.4), and [timings](evidence/navigation-v079/timings.json) are retained. The final run took **29m 52s** elapsed and **5h 57m 10s** combined job execution; integration jobs began 2–10 seconds after dependencies were ready. These are separate measures; the latter start delay includes runner provisioning.

[The first run](evidence/navigation-v079/superseded-run.json) was cancelled without a failed job to strengthen screenshot readiness: removing `drawer-open` starts the native closing animation, so focus capture now waits until the drawer has left the viewport. The runtime package was identical. The entire qualification ran again on the corrected test commit.

All browser evidence is headless Chromium with viewport/touch emulation, not physical-device testing. Custom CSS/themes, other browsers and TV are not newly qualified. Both Legacy modes retain a header fallback on routes without Home/Favorites, such as item details.

Public catalog, published packages, ABI and dependencies remain unchanged. Release copy is separate in [v0.7.9 release notes](releases/v0.7.9.md).

## Before and after

Released v0.7.8 on the left; v0.7.9 candidate on the right. Synthetic Jellyfin 12.4 library, Chromium emulation.

| Layout | Before | After |
| --- | --- | --- |
| Desktop Legacy, 1280px | ![Before Desktop Legacy](screenshots/navigation-v079/before-desktop-legacy-1280-home.png) | ![After Desktop Legacy](screenshots/navigation-v079/after-desktop-legacy-1280-home.png) |
| Mobile Legacy, 390px | ![Before Mobile Legacy](screenshots/navigation-v079/before-mobile-legacy-390-home.png) | ![After Mobile Legacy](screenshots/navigation-v079/after-mobile-legacy-390-home.png) |

[Open Mobile Legacy drawer](screenshots/navigation-v079/after-mobile-legacy-390-drawer.png) · [Keyboard focus](screenshots/navigation-v079/after-mobile-legacy-390-selected-focus.png) · [Auto desktop](screenshots/navigation-v079/after-auto-1280-home.png) · [Auto drawer](screenshots/navigation-v079/after-auto-390-drawer.png).
