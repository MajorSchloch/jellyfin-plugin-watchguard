# Phase 1: deletion interception proof of concept

Target: **Jellyfin Server and bundled Web 12.2**, .NET 10. This document records Phase 1, which tested the deletion boundary only. Phase 2 added the [backend](backend.md). [Phase 3](web-ui.md) now connects it to this same interception boundary and adds detail controls. The unconditional behavior and results below are the historical Phase 1 record. The design reference remains [architecture.md](architecture.md).

## Exact interception mechanism

1. The template-based `BasePlugin<Configuration>` plugin registers an `IHostedService` through `IPluginServiceRegistrator`.
2. The service locates Injector's documented `Jellyfin.Plugin.JavaScriptInjector.PluginInterface.RegisterScript(JObject)` through reflection. It loads the embedded `Web/watchguard.js`, builds the documented payload, and registers it with `requiresAuthentication=true`. The stable ID `watchguard-v1` intentionally replaces the earlier prototype registration. Startup registration retries for up to approximately 60 seconds; failure logs that no confirmation is active.
3. The injected script inspects **the current `window.ApiClient` object** and replaces only that instance's `deleteItem` method. It does not modify the ApiClient prototype, global property accessors, fetch, XHR, or Jellyfin source files. A WeakMap prevents duplicate wrappers. Capture listeners on view and user-input events bind the current instance before ordinary native handlers; a 500 ms discovery poll handles delayed availability.
4. Native Web context menus call `deleteHelper`, which first displays Jellyfin's original confirmation. On approval, its `ServerConnections.getApiClient(item.ServerId).deleteItem(item.Id)` call reaches the wrapper **when that is the wrapped instance**. Native bulk selection makes one method call per selected item.
5. Each wrapped call is queued, then opens a browser `<dialog>` with exactly **“WatchGuard: This item may still be in use.”**, **Cancel**, and **Delete Anyway**. No item/user details are fetched. Cancel receives initial focus. Escape and dialog-close settle as cancellation. Double activation cannot settle twice.
6. Cancellation rejects with an `AbortError` and never invokes the original method. Dialog failures and an account change before approval also reject. No native deletion request is constructed by this adapter.
7. Explicit approval invokes `Reflect.apply(original, receiver, args)` once. The wrapper preserves the call receiver, argument values/object identities, native promise fulfillment value and exact native rejection object. It necessarily returns a new asynchronous promise, not the same promise object; synchronous native exceptions become promise rejections. The existing server permission checks still run unchanged.
8. After settlement, the next queued call can run. A cancellation does not permanently disable subsequent deletion attempts. If another script replaces an installed method, the adapter reports `adapter-replaced` and does **not** repeatedly patch it back.

Native source anchors: [deleteHelper](https://github.com/jellyfin/jellyfin-web/blob/v12.2/src/scripts/deleteHelper.js), [itemContextMenu](https://github.com/jellyfin/jellyfin-web/blob/v12.2/src/components/itemContextMenu.js), [multiSelect](https://github.com/jellyfin/jellyfin-web/blob/v12.2/src/components/multiSelect/multiSelect.js), [ServerConnections](https://github.com/jellyfin/jellyfin-web/blob/v12.2/src/lib/jellyfin-apiclient/ServerConnections.js), and [server LibraryController](https://github.com/jellyfin/jellyfin/blob/v12.2/Jellyfin.Api/Controllers/LibraryController.cs).

## Diagnostics

Diagnostics are off by default. Set `<DiagnosticMode>true</DiagnosticMode>` in Jellyfin's `plugins/configurations/Jellyfin.Plugin.WatchGuard.xml` with the server stopped, restart, and reload the browser. Alternatively, for the current page only:

```js
window.WatchGuardPoc.setDiagnostics(true);
window.WatchGuardPoc.isInstalled(); // Boolean for the current global client only.
```

Browser logs contain a fixed prefix, a fixed event name and a local operation counter:

```text
[WatchGuard PoC] installed 0
[WatchGuard PoC] intercepted 1
[WatchGuard PoC] confirmation-opened 1
[WatchGuard PoC] cancelled 1
```

Approval emits `override`, `native-called`, then `native-resolved` or `native-rejected`. Additional fixed events include `context-changed`, `confirmation-failed`, `installation-failed` and `adapter-replaced`. The adapter never logs arguments, IDs, names, URLs, tokens, API objects or native error payloads. The operation counter is only a local diagnostic correlation number. It is not an authorization token or a server audit trail.

## Test environment and evidence

The automated test harness creates a fresh localhost-only official Jellyfin 12.2 container, random disposable credentials, and generated two-second videos. It does not mount existing media. The image is pinned to `sha256:357724bf0ae27a672c7cbaa899db2d9abeb13dbd8657ccce750258a4c059d037`.

Injector source: `2758804c987d490ef32fc2fbdb8a73a44facdf2c`, built with `-p:JellyfinVersion=12.2.0`. It uses its response-time injection middleware. No Jellyfin source or bundled JavaScript is modified.

Unit tests exercise the wrapper and dialog event handling. Browser tests sign in through the actual login form and operate native buttons, menus and checkboxes. They do **not** inject the adapter through Playwright or call `deleteItem` directly. The only adapter installation comes from plugin registration and Injector delivery. Browser network observation records outgoing DELETE requests without modifying network functions. Real HTTP 204 responses and subsequent item 404 responses confirm native server deletion on approved operations; successful item GETs verify survival after cancellation.

The browser test writes `artifacts/poc/report.json` and screenshots. Its request paths refer only to generated fixture IDs. It never saves tokens or credentials in that report; temporary credentials are restricted to the disposable fixture directory, which is removed on completion.

## Observed behavior

**Observed on 2026-10-10:** the complete fresh-fixture browser run passed with headless Chromium 141 (Playwright 1.56.1), the official server/Web 12.2 image, and the Injector revision above. No interception failure was observed in the following paths.

| Native Web path | Cancel result | Delete Anyway result | Generic error after Cancel |
| --- | --- | --- | --- |
| Movie detail → More → Delete media | 0 DELETE; movie still readable | 1 DELETE; HTTP 204; subsequent GET 404 | Yes |
| Series detail → More → Delete Series | 0 DELETE; series still readable | 1 DELETE for series; HTTP 204; subsequent GET 404 | Yes |
| Library card right-click → Delete media | 0 DELETE; movie still readable | 1 DELETE; HTTP 204; subsequent GET 404 | Yes |
| Movie detail, Escape in WatchGuard dialog | 0 DELETE; movie still readable | Not applicable | Yes |
| Native two-item selection → options → Delete | 0 DELETE after cancelling both prompts; both items readable | 2 DELETE total, one per separately approved item; both HTTP 204 and subsequent GET 404 | Yes |

Across this run: **11 intercepted operations, 6 cancellations and 5 approved DELETE requests**. The native confirmation remained first. The browser received the adapter through authenticated Injector delivery, and diagnostic events demonstrated that each exercised native path reached the installed instance wrapper. Both bulk calls were intercepted before the first bulk prompt completed; their confirmations/native execution were serialized. No whole-batch cancellation guarantee follows from this.

The 14 unit tests also passed, covering exact receiver/arguments/results, propagation of native permission errors, duplicate approval, account changes, diagnostics redaction, replacement detection, dialog failure and close/Escape handling. Permission-denial propagation was tested at the method contract level; it was not a separate live low-privilege browser scenario.

Not covered by this browser run: separate modern React detail layout, other browsers, mobile/TV layouts, remote/multiple-server client instances, base-path deployments, method replacement by another plugin and requests made before script installation. These remain unsupported/unverified, even where source suggests the same helper may be used.

**Cancellation UX:** Jellyfin's native confirmation appears first. The WatchGuard confirmation appears before any DELETE request. Cancel emits zero DELETE requests and leaves the item accessible. Jellyfin then displays its generic error:

> There was an error deleting the item from the server. Please check that Jellyfin has write access to the media folder and try again.

The alert's dismissal button is **Got It**. This is expected from `deleteHelper`'s rejection handler: it cannot distinguish WatchGuard cancellation from server deletion failure. The PoC deliberately does not return success, suppress native error handling, or patch the helper to hide that alert.

## Limits and interpretation

- This is a **web-only test gate**, not server-side deletion prevention. Native clients, direct API calls, filesystem operations and server-side cleanup plugins are not protected.
- Coverage starts only after the injected script binds the relevant client instance. A missing/disabled Injector, script execution failure, an unwrapped alternate client, or method replacement can bypass the gate.
- `isInstalled()` only checks the current global instance. It does not prove that every other client instance or future generated-SDK call uses it.
- The confirmation is unconditional and applies to every `deleteItem` call on that instance, regardless of item type. It does not claim that interest exists.
- Bulk deletion is a set of independent operations. Each approved item can be deleted before the next prompt. Cancelling one item cannot restore earlier approved items and is not “Cancel the entire batch.” Native generic errors may coexist with queued prompts.
- Native-client permissions remain authoritative. WatchGuard adds no delete endpoint, elevated credential, or server override.
- The captured account ID is compared only in memory to abort an account switch; it is not persisted, aggregated or logged.
- No race-free guarantee exists before injection or on future Jellyfin upgrades. Revalidate the native call sites, instance identity and Injector behavior on every supported version.
- A new promise and cancellation rejection are necessary to defer native execution. Code depending on promise object identity or synchronous exceptions is outside the tested native Promise-based contract.

The success criterion passed for the explicitly tested native Web paths **while the adapter is installed on their client instance**. This establishes a limited PoC, not a universal guarantee. It must not be generalized to all deletion paths or all clients. No increasingly invasive interception workaround was added: the only application patch remains that one instance method.

## Reproduce

```sh
dotnet restore Jellyfin.Plugin.WatchGuard.slnx --locked-mode
dotnet build Jellyfin.Plugin.WatchGuard.slnx -c Release --no-restore
node --test tests/web.test.cjs
dotnet publish Jellyfin.Plugin.WatchGuard/Jellyfin.Plugin.WatchGuard.csproj \
  -c Release --no-restore -o artifacts/WatchGuard
npm ci --prefix tests/browser
(cd tests/browser && npx playwright install chromium)
python3 tests/docker-smoke.py --injector-dll /path/to/Jellyfin.Plugin.JavaScriptInjector.dll
```

Uninstalling the plugin does not necessarily remove an already persisted Injector registration. Remove/disable the `watchguard-v1` entry in Injector and reload test tabs when ending the PoC.

The smoke test destroys its own container and generated media when finished. `--serve` keeps a disposable fixture available for manual examination until Ctrl+C. Do not point the browser harness at a production server. After changing the embedded script, republish and reload; an existing browser session retains its already-installed adapter.
