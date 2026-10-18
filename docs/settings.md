> **Current v0.5.0 settings (unchanged from v0.4.10):** See the [published installation and server-enforcement guide](../README.md#server-side-deletion-protection) and [current validation](validation.md). Earlier sections below describe the version in their heading; the final section documents the v0.4.10 approval/proxy diagnostic distinction.

> **v0.4.3:** `ProtectCaughtUpSeries` defaults to true; saves apply immediately to fresh protection requests. Existing XML without the property gets true; explicit false is retained. It adds only verified continuing-series Caught Up protection. See [policy and rollback](caught-up-protection.md). Standalone integration diagnostics remain unchanged. Historical registration descriptions below apply to v0.3.1 only.

> v0.3.1 reference. v0.4.0 keeps these settings and native persistence; standalone integration diagnostics replace registration diagnostics. See [current deployment checks](deployment.md#verify-loading-and-operation).

# WatchGuard v0.3.1 settings and diagnostics

Target: Jellyfin Server/Web 12.2, .NET 10. Dashboard → Plugins → WatchGuard opens the embedded native configuration page. It implements `IHasWebPages`, follows the template's `pluginConfigurationPage` lifecycle, and uses Jellyfin's existing `getPluginConfiguration` / `updatePluginConfiguration` API. There is no separate settings store or framework.

| Setting | Default | Effective range / behavior |
| --- | --- | --- |
| ActivityWindowDays | 30 | Integer, 1–90 days |
| ActivityLimit | 100 | Integer, 1–100 returned activity titles and completed-movie candidates per user (v0.4.6; other safety budgets remain) |
| ProtectCaughtUpSeries | true | Warn for verified Caught Up continuing series; current protection remains fresh |
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

## v0.4.9 opt-in server enforcement

`EnableServerEnforcement` is a native administrator-only Boolean setting, default false, including older XML with no field. It uses the existing configuration file. Changing it requires restart in either direction; the immutable startup activation remains effective until then. Dashboard distinguishes configured preference, attached actions, compatibility, runtime state, native-session/proxy observations and restart requirement. It never infers protection from the checkbox alone. See [server enforcement](server-enforcement-v049.md) before enabling: unsupported clients cannot approve protected deletion, API keys are restricted, and external file changes remain outside coverage.

## v0.4.10 approval compatibility versus Jellyfin native proxy networking

The v0.4.10 settings page reports two **independent** findings:

- **WatchGuard approval POST readiness:** an authenticated administrator's browser can reach the current approval endpoint under the origin policy. This does not grant approval, create a challenge or verify the media target's deletion permission.
- **Jellyfin client-IP forwarding and remote-access classification: NOT VERIFIED:** WatchGuard does not audit how Jellyfin applies its own trusted-proxy forwarding or native `EnableRemoteAccess` policies. A successful approval request through `HttpsProxySameOrigin` may coexist with native Jellyfin treating an external user as local.

The second finding is informational, not a heuristic that claims to detect the proxy topology or native network-policy health. **When Jellyfin is behind a reverse proxy**, configure that proxy under **Jellyfin Dashboard → Networking → Known Proxies**, and ensure it forwards the actual client address. Direct Jellyfin connections do not require proxy configuration. Never trust an entire unverified network or arbitrary `X-Forwarded-*` headers just to clear the warning.

See [proxy compatibility](proxy-compatibility-v0410.md) and the [official Jellyfin reverse-proxy security guidance](https://jellyfin.org/docs/general/post-install/networking/reverse-proxy/). The optional disposable `--proxy-matrix` fixture independently tests Jellyfin's real local/remote user authorization with a synthetic external address; successful WatchGuard protocol tests alone cannot establish this behavior.
