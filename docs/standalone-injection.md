> Historical research/PoC record. The normal v0.4.0 release candidate now uses standalone loading without flags. See [current release](standalone-release.md) and [migration](migration-v040.md); old mode-switch/build commands below are historical.

# WatchGuard v0.4.0 standalone-loader proof of concept

**Historical proof-of-concept results; follow-up hardening and LinuxServer/Caddy qualification are documented in [standalone qualification](standalone-qualification.md).**

Research/validation: 2026-10-12. Target: Jellyfin Server/Web 12.2, .NET 10. **Experimental only; retain JavaScript Injector for production for now.** The proof met its functional success criterion on the pinned official image: a native catalog installation containing WatchGuard alone loaded the Web integration and passed the existing browser/deletion regressions. This does not establish a supported Jellyfin Web extension API or compatibility with every deployment.

The published v0.3.1 ZIP, its checksum, public manifest, plugin GUID, `watchguard-v1`, watchlist/preference storage, playback aggregation, deletion adapter and existing Injector implementation are unchanged. No release/public catalog update or production deployment was performed.

## Isolation and test modes

The experiment is excluded from ordinary builds by default, including its controllers and embedded bootstrap. Compile it explicitly:

```sh
python3 scripts/build-standalone-poc.py
```

This passes `-p:WatchGuardStandalonePoc=true` and writes `artifacts/StandalonePoC/`. It never calls the release packager or overwrites released ZIPs. The proof retains baseline assembly metadata **0.3.1.0** intentionally; it is not a v0.4.0 release and must not be substituted for the published v0.3.1 asset. The native catalog test generates a temporary local-only fixture ZIP/manifest with matching assembly metadata, serves it to the disposable installer, and removes it afterward. No future public download URL is invented.

For this experimental assembly only, select exactly one mode at server startup:

| Mode | Environment | Services |
| --- | --- | --- |
| A — known integration | unset or `WATCHGUARD_EXPERIMENTAL_STANDALONE=0` | Existing `InjectorRegistration` hosted service; no standalone middleware; experimental asset routes return 404 |
| B — standalone proof | `WATCHGUARD_EXPERIMENTAL_STANDALONE=1` | Standalone `IStartupFilter`; Injector registration service is not started |

Selection is fixed for the process; recreate/restart the disposable container when changing it. Standard builds ignore the variable because the experimental code is absent. No new persisted settings/schema are introduced.

## Pipeline and response handling

Jellyfin's native `IPluginServiceRegistrator` registers the ASP.NET Core `IStartupFilter`. The filter wraps the host's pipeline before its configured BaseUrl map, response compression and static-file handling. It derives the prefix from Jellyfin's network configuration, not a request-supplied host or forwarded-prefix header.

Only exact configured `<BaseUrl>/web/` and `<BaseUrl>/web/index.html` GET/HEAD requests are candidates. Native redirects such as `/web` still run normally. API responses, other HTML, assets and error bodies are not injected.

For candidates, the filter temporarily removes compression negotiation, cache validators and range headers so downstream static-file handling can produce a complete uncompressed representation. It restores request headers afterward. A GET response is changed only when status is 200, headers have not started, content type is HTML, there is no Content-Encoding, the captured body is at most 1 MiB, it decodes as UTF-8 and contains `</head>`. It inserts one external, deferred script reference with the marker `watchguard-standalone-loader`. A response already containing that marker is left unchanged.

Modified responses receive their exact new UTF-8 Content-Length, `Cache-Control: no-store`, and no old ETag, Last-Modified, Content-Range or Accept-Ranges. HEAD emits no body, omits representation length/validators and uses no-store. Errors, encoded/unrecognized bodies, missing insertion markers and invalid UTF-8 pass through without injection. The original response stream and request headers are restored even if downstream processing throws. Existing exception behavior is not hidden.

In the original proof, the response buffer was a MemoryStream. The 1 MiB check limits **modification**, not allocation before that check. That original implementation was appropriate only for the tested, small bundled index; large/replaced entry documents and middleware that commits headers early remain limitations. This is not claimed as a hardened general HTML-rewriting component. The measured successful paths do not edit a Web file. **The current experimental implementation supersedes this limitation with bounded capture and native SendFile handling; see the qualification document.**

## Authentication and execution

The injected external URL is `<BaseUrl>/WatchGuard/Standalone/bootstrap.js`. It is deliberately anonymous, static bootstrap code with no private functionality, user data or embedded credential. It waits for the real native global ApiClient to have a user/session. Its timer checks at one-second intervals until loading succeeds; failed requests back off for ten seconds. It does not patch fetch/XHR, read browser credential stores, replace modules or modify React trees.

The bootstrap verifies the native API URL exactly matches its same-origin, same-base-path script endpoint. It uses native `ApiClient.ajax` to request **`GET /WatchGuard/Standalone/script.js`** with native authentication headers, never credentials in URLs. The controller rejects anonymous, API-key-only, removed and disabled identities. Both successful script responses and unauthorized responses are non-cacheable; the authenticated route varies on Authorization. It serves the existing embedded WatchGuard adapter, with the existing diagnostic substitution, without user-specific JavaScript generation.

A fetched script is executed through a temporary Blob script element; the element and object URL are removed afterward. This avoids copying a bearer token into a script URL or creating a new authentication cookie/session mechanism. A stale fetch is discarded if its account/API/token changed. Once loaded, the unchanged WatchGuard adapter handles login/logout, account changes, navigation and fresh per-delete authorization as before. Already delivered JavaScript cannot be revoked from an old tab; backend authorization remains authoritative.

A native `<script src>` cannot attach Jellyfin's bearer header. This authenticated-fetch/Blob bridge is therefore the central compatibility tradeoff. A CSP allowing only same-origin external scripts **blocks the Blob execution**. The test adds `script-src 'self' 'unsafe-inline' 'unsafe-eval'` and verifies that native Web still loads but WatchGuard reports failure and never installs. The loader does not weaken CSP, use eval as a fallback, or claim warnings are active. Existing Injector also has its own inline-script/CSP constraints; this test is not a claim that Injector works under every restrictive policy.

Browser-only diagnostic: `window.WatchGuardStandalone?.status()` returns a phase string, without account data. `window.WatchGuardPoc?.isInstalled()` checks the installed adapter on the current ApiClient. Neither proves all deletion paths are protected. At the time of the original proof, the dashboard integration-status page remained Injector-oriented; do not interpret its waiting-for-registration state as a standalone health report. Standalone-specific status UI and stale-build checks have since been implemented and tested in the qualification follow-up.

## Coexistence, migration and rollback

Standalone mode checks loaded Injector configuration before HTML/asset delivery. If **any** `watchguard-v1` registration remains, or the loaded Injector's configuration contract cannot be inspected, it declines injection and its bootstrap/private route returns 409. An existing Injector may continue delivering its own registration, but the standalone loader does not run alongside it. Other Injector scripts and settings are not modified. This read-only reflection guard is version-specific, not a public registration-query API.

Explicit disposable migration procedure:

1. Back up the complete configuration and both WatchGuard JSON files; retain the actual v0.3.1 release ZIP.
2. Test mode A and inspect exactly one `watchguard-v1` registration.
3. Stop/recreate with the experimental assembly and mode B. Verify the conflict is refused while the persisted entry remains. No WatchGuard hosted registration service runs in this mode.
4. In Injector's Plugin Scripts/native configuration API, delete **only** `watchguard-v1`. Keep Injector installed/enabled and preserve other entries. Do not delete the whole configuration or disable its middleware for other plugins.
5. Fully reload Web clients. Confirm the standalone marker, authenticated script delivery, installed adapter and disposable Cancel/override behavior. Restart and verify the removed registration does not return.
6. If Injector was removed before cleaning the registration, restore it temporarily and perform cleanup; an unloaded Injector cannot be inspected. Do not leave stale registration XML to reactivate on a later installation.

Rollback: unset the mode variable and restore the known-good v0.3.1 binary (or use mode A in the proof). Restart; its unchanged registration service upserts one `watchguard-v1`. Fully reload clients. Watchlist/preference files and native playback state require no migration. Retire duplicate manual experimental assemblies before catalog operations. No Web file restoration is necessary.

Uninstall: stop the test server, remove the experimental plugin installation and restart. New HTML has no marker; asset routes return 404; the Web index hash is unchanged. Close/reload old tabs: they can retain the earlier adapter in memory. Tests simulate an unavailable backend in a retained tab and verify failed protection results in zero DELETE requests. This cannot prevent a different native/API client from deleting media.

## Validation matrix

Pinned official image: `jellyfin/jellyfin:12.2@sha256:357724bf0ae27a672c7cbaa899db2d9abeb13dbd8657ccce750258a4c059d037`. All configuration/media is disposable; container port 8096 is mapped to an ephemeral loopback port.

| Scenario | Observed result |
| --- | --- |
| Default compilation | 53 existing backend tests pass; experimental sources/resources excluded |
| Explicit experimental compilation | 61 backend tests pass, including response/path/cache/HEAD/duplicate/failure checks |
| JavaScript | 41 existing tests plus 3 bootstrap authentication/stale-response/CSP tests pass |
| Mode A with published Injector 4.0.0.0 jf12 | Settings and full existing browser/deletion suite pass |
| Mode B, WatchGuard alone, direct access | HTTP contracts, full Web/deletion suite, restart/removal pass |
| Native local catalog installation, no Injector | Installer writes native metadata, restart loads standalone, full Web/deletion suite passes |
| Mode B through HTTP reverse proxy with `/jellyfin` BaseUrl | Authentication, hard reload, navigation, account/privacy and complete deletion suite pass; proxy compressed 33 HTML responses with gzip |
| Anonymous and invalid authentication | No anonymous private-script fetch; private endpoint returns 401; valid authenticated responses are no-store |
| Cache/range/compression negotiation | Conditional/range index requests return complete modified 200; stale validators removed; correct body length; HEAD has no body; normal API/other asset paths remain native |
| Multiple users, logout, account changes | Existing full browser suite passes; bootstrap unit test discards an in-flight old-account script |
| Restrictive CSP without Blob permission | Expected failure: no adapter; failure diagnostic; no policy bypass |
| A → B → A | Conflicting registration blocks B; explicit cleanup persists; unrelated sentinel script and Injector middleware preserved; rollback restores exactly one WatchGuard registration |
| Stale browser tab/backend unavailable | Existing wrapper rejects deletion; zero DELETE; reload needed for actual unload |
| LinuxServer.io 12.2 | **Not verified:** registry lookup for `lscr.io/linuxserver/jellyfin:12.2.0` returned `manifest unknown`; no different version substituted |

The proxy fixture tests ordinary HTTP forwarding and downstream gzip with a matching, preserved Jellyfin BaseUrl. It is not an Nginx/TLS/WebSocket/load-balancer qualification. Prefix-stripping proxies with no matching Jellyfin BaseUrl, restrictive CSP deployments, noncanonical index paths, custom Web bundles, arbitrary middleware ordering and other browsers remain unvalidated. Playwright Chromium exercised both supported modern/legacy shells using the same unchanged UI adapter.

The original suite checks Watchlists, personal bookmarks, context-menu Add/Remove, activity, native movie/series and episode/season deletion, zero/self-only interest, failed lookups, bulk operations, Cancel and Delete Anyway. Each successful full run recorded 13 media DELETE requests and zero ordering violations. Cancellation's existing generic Jellyfin error remains; deletion policies are unchanged.

## Small local comparison

Ten sequential index GETs per separately seeded local fixture, identity encoding, warm running server:

| Mode | Median index delivery | Maximum | HTML bytes |
| --- | ---: | ---: | ---: |
| Existing Injector | 1.147 ms | 12.355 ms | 7,437 |
| Standalone | 1.333 ms | 3.106 ms | 5,540 |

These small samples measure HTTP index delivery, not production throughput or a statistically meaningful speed improvement. Standalone removes one installed plugin but adds an authenticated fetch plus Blob execution after login, with up to one polling interval before discovery. Browser checks observed one private-script request per authenticated load and another after hard reload; anonymous login pages requested none. Runtime compatibility matters more than the sub-millisecond median difference.

Injector already owns response rewriting, delivery lifecycle and its diagnostics. Standalone transfers those responsibilities to WatchGuard: one startup filter, two asset actions, bootstrap lifecycle, cache/auth policy, conflict inspection and corresponding tests. It adds no runtime library, database, external service or frontend framework. Supported ASP.NET plumbing does not make response rewriting a Jellyfin-supported Web extension.

**Recommendation:** retain Injector for the production release. This proof establishes a feasible single-plugin path for the tested default official image and matching base-path HTTP proxy. Before adoption, qualify the real LinuxServer.io image/proxy/CSP setup, improve standalone-specific integration status, and harden buffering/response-start/caching failure coverage. Do not broaden interception or introduce an invasive workaround merely to force compatibility.

Recorded [validation and timing summary](performance-data/standalone-poc.json); the detailed disposable browser report is in `artifacts/standalone/browser-report.json`.

## Reproduce

```sh
python3 scripts/build-standalone-poc.py
dotnet test Jellyfin.Plugin.WatchGuard.slnx -c Release -p:WatchGuardStandalonePoc=true
node --test tests/web.test.cjs tests/standalone-bootstrap.test.cjs
python3 tests/docker-smoke.py --standalone --standalone-catalog
python3 tests/docker-smoke.py --standalone --base-path /jellyfin --proxy
python3 tests/docker-smoke.py --injector-dll /path/to/Injector.dll --artifact artifacts/StandalonePoC/Jellyfin.Plugin.WatchGuard.dll
python3 tests/docker-smoke.py --injector-dll /path/to/Injector.dll --artifact artifacts/StandalonePoC/Jellyfin.Plugin.WatchGuard.dll --migration
python3 tests/docker-smoke.py --standalone --measure
python3 tests/docker-smoke.py --injector-dll /path/to/Injector.dll --artifact artifacts/StandalonePoC/Jellyfin.Plugin.WatchGuard.dll --measure
```

Mode B's fresh/catalog tests omit `--injector-dll`. `--migration` deliberately retains Injector for other plugins. Use only these disposable fixtures. No workflow/public catalog changes are needed to reproduce this proof.

## Sources and attribution

Inspected pinned [Jellyfin Startup](https://github.com/jellyfin/jellyfin/blob/ca0f16eb7c195f720a1493ed469a27c4657db0c6/Jellyfin.Server/Startup.cs), [native plugin service interface](https://github.com/jellyfin/jellyfin/blob/ca0f16eb7c195f720a1493ed469a27c4657db0c6/MediaBrowser.Controller/Plugins/IPluginServiceRegistrator.cs), [Web ApiClient publication](https://github.com/jellyfin/jellyfin-web/blob/61b1f890365ad15138e943e694af723c1d47df2a/src/lib/jellyfin-apiclient/ServerConnections.js), and [Microsoft startup/filter documentation](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/startup?view=aspnetcore-10.0). Native configuration pages remain dashboard-only; they cannot bootstrap every native Web route.

The [Injector startup filter](https://github.com/n00bcodr/Jellyfin-JavaScript-Injector/blob/2758804c987d490ef32fc2fbdb8a73a44facdf2c/Jellyfin.Plugin.JavaScriptInjector/Services/ScriptInjectionStartupFilter.cs) was studied for compatibility hazards and registration behavior. The implementation here is original; no Injector source file, helper or DLL was copied/adapted into WatchGuard. The unchanged WatchGuard script is reused. Both projects carry GPL-3.0 licenses; future source reuse would require retaining applicable notices and meeting source/distribution obligations. See the [prior alternatives research](injector-alternatives.md) and [LinuxServer.io documentation](https://docs.linuxserver.io/images/docker-jellyfin/) for deployment context.
