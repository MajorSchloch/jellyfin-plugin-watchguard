# Older browsers and TV controls

The reported device runs webOS TV 6.5.3-47, firmware 03.53.45, and is believed to be an LG C1. The model is unconfirmed. LG lists Chromium 79 for [webOS TV 6.x](https://webostv.developer.lge.com/develop/specifications/web-api-and-web-engine). No physical-TV console output was available for this change.

Published WatchGuard scripts contain optional chaining, which Chromium 79 cannot parse. This is a confirmed compatibility gap, not proof of the only device failure. Server protection status remains independent of browser execution.

## Delivery and maintenance

Keep JavaScript sources in `Web` and `Standalone`. The MSBuild resource target transforms all four scripts and the settings page's inline script with locked esbuild 0.25.12. The target is `chrome79`; an ES2019 parser adds a stricter syntax check. Generated assets live under `obj/browser`, retain the original resource names, and are embedded in the DLL. Do not edit generated files.

Node.js and npm are now required for a source build. The build uses `scripts/browser/package-lock.json`; it installs dependencies only when that lock changes. Asset generation is incremental. A package build generates assets once, and all fixture jobs consume the same packaged DLL. No runtime transpiler, external script service or global prototype patch is added.

`scripts/build-release.py` extracts resources from its actual ZIP and runs `scripts/check-browser-assets.py`. This checks every delivered script, settings inline code, the combined inline startup code and retained server switches before expensive native qualification. The normal deterministic rebuild comparison remains required.

## Separate API and CSS fixes

- Replace `replaceAll`, `replaceChildren` and `Object.hasOwn` with supported equivalents. Own-property checks still exclude inherited properties.
- Remove the outside-dismiss listener explicitly on abort. Chromium 79 ignores the newer event-listener `signal` option.
- Replace relational `:has()` styling with reconciled WatchGuard-owned classes. Do not continuously mutate native headers during reconciliation.
- Expand `:is()` selectors. Provide scoped focus outlines, flex-gap margins, positional offsets, checkbox padding and viewport-height fallbacks. Preserve poster proportions without `aspect-ratio`, and provide chip colors without `color-mix`.
- Flatten only WatchGuard's fallback cascade layer when the engine lacks layer support. Keep native layers and style rules intact.
- Retain native `dialog`, URL, Blob, AbortController, History and MutationObserver APIs. These are separate from syntax transformation. A denied CSP still stops execution; this change does not weaken it.

## Remote interaction

Jellyfin's focus manager recognizes `.focusable`, but does not include `summary` in its native tag list. WatchGuard disclosure summaries use that convention. The open status popup uses a native focus container; closing it restores ordinary navigation. Checkbox Enter/OK toggles the native input and emits its normal change event.

On direct Watchlists entry, Jellyfin's `emby-select` component is not registered and no public module loader is available. Its [native implementation](https://github.com/jellyfin/jellyfin-web/blob/master/src/elements/emby-select/emby-select.js) avoids platform select popups on webOS. In TV layout, WatchGuard opens a scoped choice dialog for owner, sort and activity range. It uses native button presentation and Jellyfin's dialog focus navigation, while preserving the underlying select values and change events. Choice actions reject changed accounts, closed views and changed option lists. Other layouts keep their existing select interaction.

Owned open disclosures and dialogs consume Back/cancel commands and restore focus. Raw Escape/BrowserBack/GoBack and webOS Back key code 461 also close these surfaces. Closed surfaces leave Back to Jellyfin. No TV-model allowlist is used.

Membership completion restores the focused action before the separate interest refresh finishes. The existing identity, route and focus checks prevent restoration after navigation or an account change. Pending writes still prevent duplicates.

## Reproduce the engine checks

Use a disposable native fixture. Never pass production credentials or real media to test scripts.

```sh
python3 scripts/build-release.py
npm ci --ignore-scripts --prefix tests/browser79
python3 tests/docker-smoke.py --serve
# Use the private fixture path printed by the preceding command.
WATCHGUARD_CHROMIUM79=/path/to/Chromium node tests/browser79/native.cjs /path/to/fixture.json
```

The old-engine driver is pinned to puppeteer-core 2.0.0, for test use only. Current Playwright cannot create a page in Chromium 79 because it requires a newer CDP download command. This driver does not download a browser automatically and is not shipped with WatchGuard.

The local engine is Chromium **79.0.3945.0**, official snapshot **706915** (macOS Intel binary under Rosetta). [Download](https://storage.googleapis.com/chromium-browser-snapshots/Mac/706915/chrome-mac.zip). Archive SHA-256: `e6b754d211e4ad264c163b5a9e2fda9b2c07ab014402e8ee29e97de620ccefe6`. This validates an actual old engine, not a changed user agent or viewport. It does not qualify LG firmware or the webOS application wrapper.

## Physical-TV procedure

1. Record the exact TV model, Jellyfin client type and Server/Web versions.
2. Open Watchlists directly, then reload. Confirm the loading handoff clears without exposing Home.
3. Select Jellyfin’s TV layout. Use arrows and OK to enter Watchlists and reach owner, status, search, sort and activity controls. Change owner, sort and range in the choice dialogs; confirm Back cancels and restores focus.
4. Open status filters. Move through checkboxes, toggle one, then press Back. Confirm focus returns to Status.
5. Open a movie or series. Add and remove only your test membership. Confirm the icon, feedback and focused action update.
6. Open episode extras and a deletion warning on disposable media. Use Back to cancel; confirm nothing is deleted.
7. Leave Watchlists, return, and switch accounts. Confirm no prior account's cards or pending actions remain.
8. Test the LG keyboard, pointer remote, page scrolling, overscan and suspend/resume. These need physical hardware.

If a step fails, retain the route, visible message and console error without tokens or user data. Confirm whether the installed webOS app loads the server's Web assets: a bundled client may bypass the standalone loader. A successful package parse cannot prove loader integration in every client.
