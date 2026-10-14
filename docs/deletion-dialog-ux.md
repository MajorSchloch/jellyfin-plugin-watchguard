# WatchGuard v0.4.2 — deletion confirmation UX

Release candidate for Jellyfin Server/Web **12.2**, .NET **10**. Version **0.4.2.0**, stable plugin GUID `a3c6bc84-783d-4ba8-a0db-89bfb83ab486`, target ABI **12.2.0.0**. No publication or production deployment.

## Presentation

The existing fresh protection check now hands structured presentation data to the dialog: the resolved native target, optional verified parent-series name, authenticated requester ID and validated interested users/reasons. This is an internal JavaScript change; no API response or protection service changes.

The native HTML modal dialog presents:

- The exact target name and movie/series/season/episode type. Episodes also show native season/episode numbers when available; a missing title falls back to its item ID.
- The parent series for seasons and episodes, explicitly labelling the interest as series-wide. The original child remains the actual deletion target.
- A short explanation that deletion removes library media/files, may remove other people's access and cannot be undone here.
- **Your interest**, with the requester's name and personal explanation, followed by **Other people’s interest**. Each user appears once with compact Watchlisted, Watching and/or Currently Playing labels.
- Cancel and Delete Anyway, using Jellyfin's existing `emby-button raised` styling. Destructive text is differentiated without making it the default.

All target names, parent names, user names and labels are built with DOM nodes and `textContent`. No untrusted HTML, Markdown conversion, external images or template interpolation enters an HTML parser. Reasons remain restricted to the existing protection allowlist.

The dialog uses a constrained fluid width, viewport-bounded height, normal-flow wrapping and internal vertical scrolling. The action row remains sticky within the scroll container. Long uninterrupted names wrap rather than expanding the viewport. Scoped backdrop/focus styles affect only this dialog; no native controls or React trees are replaced. There is no additional framework or dependency.

## Interaction and accessibility

The visible heading supplies `aria-labelledby`; the explanatory paragraph supplies `aria-describedby`. The native `showModal()` supplies modal behavior and an inert background. A dialog-scoped Tab/Shift+Tab handler cycles its two actions (only Cancel for errors), because Chromium otherwise allowed focus to reach browser chrome after the last button. No global keyboard handler is patched. Cancel has `autofocus` and receives explicit initial focus. Both controls are `type=button`, with no form/default-submit behavior. Delete Anyway requires activation of its own button; Tab then Enter is supported. Buttons have visible keyboard focus and touch-sized height.

Cancel, Escape, native dialog close and the existing identity-lifetime AbortSignal all settle false, remove the dialog and restore the previously focused connected element. Native Jellyfin may immediately open its generic error and take focus afterward. If navigation removed the previous element, no detached element is focused.

A document-scoped guard rejects a second simultaneous dialog. The existing adapter queue still serializes bulk operations and rechecks identity before/after confirmation. Settling twice cannot produce another native call. A failed dialog creation or failed/malformed protection check remains a rejection. Error-only dialogs retain Cancel without an override button.

## Safety and scope

The standalone loader, backend services, interest rules, authorization, preferences and both schema-1 stores are unchanged. No additional lookup is introduced. Self and other users retain equal protection for Watchlisted, InProgress and CurrentlyPlaying. Watched and CaughtUp remain invalid protection reasons; history alone does not warn.

Fresh checks, account/token checks, original receiver/arguments/results/errors, zero DELETE on cancellation, exactly one native call on approval and parent-series scope are preserved. Native permissions remain authoritative. The native confirmation still precedes WatchGuard; [native-confirmation-options.md](native-confirmation-options.md) explains why neither consolidation nor generic-error suppression is implemented.

## Validation and evidence

Screenshots from disposable fixtures:

- [Self-protection dialog](screenshots/v0.4.2/deletion-self.png)
- [Long, hostile text on desktop](screenshots/v0.4.2/deletion-long-desktop.png)
- [Narrow viewport, wrapping and visible actions](screenshots/v0.4.2/deletion-long-mobile.png)
- [Episode target and parent series](screenshots/v0.4.2/parent-Episode-warning.png)
- [Season target and parent series](screenshots/v0.4.2/parent-Season-warning.png)

Local validation on 2026-10-14: **83 .NET tests, 49 JavaScript/bootstrap tests and 4 catalog tests passed**. The five parallel integration jobs passed: standalone catalog/Caddy, v0.3.1 migration, official-image base path, legacy catalog/browser and WebSocket/header probes. Each final full Web run recorded **13 native DELETE requests with zero ordering violations**. Cancel/Escape/close and bulk cancellation retained zero DELETE assertions; overrides called the native method once per approved item. Self-only, other-user, multiple-reason, no-interest, history-only, failed lookup and parent-series cases remain covered.

The new browser checks verify separate ownership groups, six reason labels across two users, literal hostile target/user text without image/script nodes or execution, initial Cancel focus, Tab/Shift+Tab cycling, Enter cancellation, deliberate keyboard approval, focus restoration and desktop/mobile bounds. An additional full base-path browser run cleared native ApiClient authentication while the dialog was open: the lifetime signal closed it, the promise rejected with AbortError and no DELETE occurred; restoring identity loaded the normal controls again. Original account-switch, privacy, lifecycle, permissions and stale-response tests remain. These are Chromium checks at 1280×900 and 390×700; physical devices, other browsers and screen-reader speech output were not separately tested.

Catalog installation used the exact ZIP without Injector and exercised v0.4.2 → v0.4.0 → v0.4.1 → v0.4.2, preserving both JSON stores and settings bytes. The retained Injector migration/rollback, missing-Injector legacy tests, native configuration, authentication, Caddy HTTPS gzip/zstd, HEAD/cache/range/CSP, WebSocket, restart/uninstall and unchanged Web-file checks passed. The native WebSocket status helper still reports false despite the observed 101/open connection, as in the baseline; the independent authenticated ping/pong test passed.

A forced rebuild produced the same ZIP SHA-256. [Machine-readable results](performance-data/release-v042.json) record final counts and catalog/proxy evidence. The standalone loader and backend protection/activity source files are unchanged. The base-path fixture's client-disconnect BrokenPipe/ConnectionReset messages during navigation did not fail assertions.

```text
SHA-256 c4902b23a1125fe3db26ffe77520a0a14eeca54bff946879cc4a3a73044858a5
MD5     4f205ee6190487d41549543d955bff10
```

The browser fixture uses synthetic media and hostile display strings only in test-scoped API responses. It exercises the actual installed adapter/dialog, without replacing the adapter or approving deletion under failed status. Literal-text assertions use DOM text content because rendered innerText normalizes trailing whitespace.

The CI workflow retains five independent integration suites: standalone catalog/Caddy, retained Injector migration, official-image base path, legacy catalog/browser, and WebSocket/header probes. No workflow was dispatched or release published during local validation. Locally the same suite commands run concurrently against separate disposable containers.

### Fixture scheduling correction

A retained migration run exposed the native plugin updater racing an explicit package installation: the server logged an IOException because the candidate DLL was in use, while its metadata was already Restart-pending. Jellyfin's native PluginUpdateTask has a StartupTrigger and a daily trigger. Before adding test repositories, the fixture now clears **only that disposable server's** plugin-update triggers through the native scheduled-task API, restarts to finish any prior task, and asserts Idle with no triggers. Explicit catalog checks, checksums, executing version, one-active-plugin and persisted-data assertions remain intact. This does not alter WatchGuard or production scheduling.

## Packaging, upgrade and rollback

Build using SDK 10.0.302:

```sh
python3 scripts/build-release.py
dotnet test Jellyfin.Plugin.WatchGuard.slnx -c Release
node --test tests/web.test.cjs tests/standalone-bootstrap.test.cjs
python3 tests/catalog_test.py
python3 scripts/catalog.py --zip artifacts/Jellyfin.Plugin.WatchGuard-v0.4.2.zip
```

The archive contains only `Jellyfin.Plugin.WatchGuard.dll` and `LICENSE`. Web assets remain embedded. The SHA-256 sidecar verifies downloads; native catalog MD5 remains separate. Repeated forced builds must yield the same SHA-256. The public manifest and published v0.4.1 assets stay unchanged; no speculative v0.4.2 entry is added. The parallel release workflow validates before its separately authorized publishing job.

No data/config migration is required from v0.4.1. After separately authorized publication, update through the normal Jellyfin catalog, restart and fully reload every Web client. Verify the current build/adapter in the native settings page, then test Cancel and Delete Anyway using disposable media. Old tabs keep the older dialog until reloaded.

Retain the v0.4.1 ZIP and a stopped-server backup of the configuration volume, including memberships, preferences and settings. Roll back via native uninstall/restart and the retained v0.4.1 catalog version, then restart/reload clients. If native uninstall leaves an old version folder discoverable, stop Jellyfin and retire only that versioned runtime folder outside plugin discovery; preserve the separate JSON data folder and XML. Keep exactly one active assembly. Rollback restores the plain dialog while retaining self-protection and Caught Up. See [deployment.md](deployment.md) for LinuxServer.io/Compose paths and existing loader/CSP/client limitations.
