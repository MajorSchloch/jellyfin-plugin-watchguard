# WatchGuard v0.3.1 settings and diagnostics

Target: Jellyfin Server/Web 12.2, .NET 10. Dashboard → Plugins → WatchGuard opens the embedded native configuration page. It implements `IHasWebPages`, follows the template's `pluginConfigurationPage` lifecycle, and uses Jellyfin's existing `getPluginConfiguration` / `updatePluginConfiguration` API. There is no separate settings store or framework.

| Setting | Default | Effective range / behavior |
| --- | --- | --- |
| ActivityWindowDays | 30 | Integer, 1–90 days |
| ActivityLimit | 100 | Integer, 1–100 automatic candidates |
| DiagnosticMode | false | Optional server timings and token-free browser adapter events |

The form validates integer ranges before saving. Configuration property setters also clamp numeric values from XML or direct native API updates, retaining the existing effective-range behavior. Existing property names, configuration type and XML filename are unchanged. Missing fields in old XML retain defaults. The native `/Plugins/{guid}/Configuration` endpoints require elevated administrator access; WatchGuard does not add a second writable configuration API.

Activity settings apply to the next uncached activity request. Saving configuration notifies the registration service, which updates the same `watchguard-v1` registration with the current diagnostic setting. No server restart is required. Fully reload Web tabs to receive a changed script; already loaded tabs retain their old diagnostic setting. Save cannot weaken deletion checks: configuration never changes `Protection/{id}` or the adapter's policy.

## Integration status

`GET /WatchGuard/IntegrationStatus` requires a currently enabled authenticated administrator (not an API key). It returns plugin/server versions, tested compatibility, Injector discovery and signature compatibility, and the result/version of WatchGuard's most recent server registration attempt. It never returns scripts, tokens, paths, user lists or credentials. It reports `BrowserExecutionVerified: false` unconditionally.

The page explains missing/incompatible Injector and provides a refresh/browser-check button. Install **JavaScript Injector 4.0.0.0 jf12** separately, enable its response-time middleware, and inspect exactly one enabled/authenticated `watchguard-v1` in Plugin Scripts. Backend APIs continue to work without Injector.

A successful registration is a point-in-time result, not continuous inspection of Injector's persisted configuration. If an administrator subsequently disables/deletes the script or middleware, this status cannot detect that. Confirm delivery and run the browser check after any integration change. `window.WatchGuardPoc?.isInstalled()` checks only this tab's current ApiClient wrapper; it cannot prove all routes/clients are protected. Test Cancel using disposable media. Native clients/direct API/filesystem deletion remain unprotected.

Registration retries startup ordering for approximately 60 seconds. A failed attempt is not reported as success. A later configuration save retries; installing a new plugin assembly still requires Jellyfin's normal restart. Browser settings requests capture account identity and page generation and discard stale responses.

## Native sources

Pinned 12.2 sources: [base configuration persistence/event](https://github.com/jellyfin/jellyfin/blob/ca0f16eb7c195f720a1493ed469a27c4657db0c6/MediaBrowser.Common/Plugins/BasePluginOfT.cs), [administrator configuration controller](https://github.com/jellyfin/jellyfin/blob/ca0f16eb7c195f720a1493ed469a27c4657db0c6/Jellyfin.Api/Controllers/PluginsController.cs), [embedded dashboard pages](https://github.com/jellyfin/jellyfin/blob/ca0f16eb7c195f720a1493ed469a27c4657db0c6/Jellyfin.Api/Controllers/DashboardController.cs). See [deployment](deployment.md) for verification results and rollback.
