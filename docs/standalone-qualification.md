> Historical research/PoC record. The normal v0.4.0 release candidate now uses standalone loading without flags. See [current release](standalone-release.md) and [migration](migration-v040.md); old mode-switch/build commands below are historical.

# Standalone loader qualification

2026-10-12 · Jellyfin Server/Web 12.2 · .NET 10 · isolated experimental build.

**Recommendation: conditional GO for the tested LinuxServer.io/Caddy configuration; NO-GO for an unconditional production replacement or declaring vm622 itself qualified.** The single-plugin installation passed native catalog, authentication, UI, activity, account privacy and deletion regressions on the image family and reverse-proxy shape requested. vm622's exact digest, Caddy configuration and CSP were not supplied or accessed. Confirm those match the conditions below before a separately authorized deployment. Retain v0.3.1 + Injector as the production rollback. No release was published, catalog changed, or production configuration/media mounted.

The main remaining compatibility condition is CSP: authenticated source is executed using a temporary Blob script. A policy excluding Blob scripts prevents installation. WatchGuard does not weaken that policy or provide deletion warnings when its adapter never loads. This is an advisory Web integration, not a server-side deletion authorization hook.

## Qualified environment

The actual LinuxServer release tag was discovered from its published release list, then pulled and pinned; `12.2.0` is not the image tag.

| Component | Pinned test reference |
| --- | --- |
| LinuxServer.io | `lscr.io/linuxserver/jellyfin:12.2ubu2604-ls53@sha256:1bb4f88d822a0510bb3604b68aacb80d77c1d2a30181e500090c65111b98723b` |
| Official Jellyfin regression | `jellyfin/jellyfin:12.2@sha256:357724bf0ae27a672c7cbaa899db2d9abeb13dbd8657ccce750258a4c059d037` |
| Caddy | `caddy:2@sha256:f2a1290d0463aad60660d4ec134943f183ee2a5f6c3eb7bf32dd984f2f020772`, reported `v2.11.7` |
| Existing Injector comparison | Published `4.0.0.0` jf12 DLL, separate plugin, never bundled |

The LinuxServer image's `/build_version` reports `12.2ubu2604-ls53`, built 2026-10-06; the running `/System/Info/Public` reports `12.2.0`. Tests use native s6 startup, PUID/PGID, and the unmodified `abc` service account. The startup script sets data to `/config/data`, configuration to `/config`, and Web to `/usr/share/jellyfin/web`. Native catalog installations appear under `/config/data/plugins/WatchGuard_<version>`. The fixture checks `abc` UID/GID and assigns only synthetic media to it so real native deletion permission checks can execute. It never overrides LinuxServer's entrypoint or uses Docker's `--user` override for the running service.

Caddy runs in a private disposable Docker network, publishes HTTPS to an ephemeral loopback port and proxies to Jellyfin port 8096. The tested configuration is:

```caddyfile
https://localhost {
    tls internal
    encode zstd gzip
    reverse_proxy <disposable-jellyfin-container>:8096
}
```

The test CA is ephemeral. Python and Node requests trust that CA explicitly; Playwright uses `ignoreHTTPSErrors` only for this disposable browser fixture. This verifies TLS termination, not public certificate issuance, vm622's certificate chain, or certificate renewal. There is no response-cache plugin, CDN, custom CSP, prefix stripping or production Caddy configuration in this fixture. Standard Caddy does not introduce a response cache here; browser/conditional caching is tested through HTTP headers and reloads. Caches that disregard `no-store` are unsupported.

## Loader hardening

The original opt-in compile flag and process-fixed mode selection remain. Ordinary builds exclude the experimental middleware/controllers/bootstrap. Mode A starts the existing Injector registration service; mode B starts the standalone filter and does not register with Injector. See [build/mode instructions](standalone-injection.md#isolation-and-test-modes).

Only exact configured `<BaseUrl>/web/` and `<BaseUrl>/web/index.html`, GET/HEAD, are eligible. The native network BaseUrl determines the prefix. Redirects, APIs, other HTML and unrelated static files stay on their native paths.

- **Bounded capture:** `EntryDocumentBuffer` retains at most 1 MiB before selecting passthrough. It checks each write before growing the buffer, stops buffering on overflow, forwards retained bytes exactly once and streams subsequent bytes directly. There is no disk spill or unbounded full-response capture. MemoryStream capacity growth remains below 2 MiB; the retained payload limit is 1 MiB. Decode/re-encode allocations are bounded by that same small input limit.
- **Native file delivery:** ASP.NET Core's `StreamResponseBodyFeature.SendFileAsync` implicitly starts/flushes the stream. Simply treating every flush as a bypass disabled injection in the first LinuxServer test. A request-local `EntryDocumentBodyFeature` now captures the native file transfer in 16 KiB chunks without that implicit pre-transfer flush. Explicit Start, Flush, DisableBuffering, oversized output and already-started responses select passthrough. Original body features/request headers are restored in `finally`. This wraps one response, not a global file-serving or JavaScript API.
- **Eligibility:** only unstarted HTTP 200 `text/html` with absent/UTF-8 charset and no Content-Encoding is decoded. Invalid UTF-8, other charsets, missing insertion point, encoded bodies and HTTP errors are unchanged. Duplicate marker detection keeps one loader reference. Fallback can leave WatchGuard unavailable; it never pretends injection succeeded.
- **Compression/ranges:** temporarily remove Accept-Encoding, If-None-Match, If-Modified-Since, Range and If-Range for entry-document generation, then restore them. This avoids rewriting compressed, partial or 304 representations. Caddy may compress the final transformed response. Identity, gzip and zstd were verified byte-for-byte after decoding.
- **Validators/length:** transformed HTML is `Cache-Control: no-store`; ETag, Last-Modified, Accept-Ranges and Content-Range are removed, and GET Content-Length reflects its new bytes. Conditional/range requests return a fresh complete 200, not a stale 304 or partial 206. HEAD has no body, old length or validators. Unmodified fallback preserves native response headers/body; unit tests also cover an unexpected downstream 304 without injection.
- **Lifecycle:** no background server task, retained per-user state or file mutation is added by the loader. Removal/restart eliminates routes and injection; before/after Web file hashes match. Older browser tabs remain executable until reloaded, as with Injector.

Tests include boundary sizes, incremental overflow, explicit flush/start, already-started HTML/assets, native SendFile, HEAD, duplicate injection, charset/encoding errors, restoration after exceptions, and non-entry paths. Arbitrary third-party middleware order, custom Web bundles and server versions other than 12.2 are not promised compatible. Requalify the native static-file path after a Jellyfin/.NET upgrade.

## Authentication and diagnostics

The anonymous bootstrap is static and harmless without native login. The private script uses native ApiClient header authentication; no credentials are generated into JavaScript or URLs. Anonymous, invalid, disabled, deleted and API-key identities cannot retrieve the private script. Responses are no-store/private and vary by Authorization. Account changes during an in-flight fetch discard its result. Existing adapter account isolation and fresh protection queries remain unchanged.

Dashboard → Plugins → WatchGuard now distinguishes:

| Diagnostic | What it establishes |
| --- | --- |
| Plugin loaded/version | Administrator endpoint is executing this server assembly |
| Standalone loader active | Middleware registered, standalone selected, no detectable Injector conflict; not proof of insertion into this browser's HTML |
| Bootstrap responses completed | Process-local aggregate HTTP completion counter; not client acknowledgment or execution |
| Authenticated script responses completed | Process-local successful authenticated responses; no user identities recorded |
| Authenticated script available now | This browser can make the authenticated request; source is fetched but not executed again |
| Browser adapter installed | Existing adapter reports installation on the current ApiClient; requires current standalone build ID and active loader, not just server uptime |

Server counters reset at restart. `BrowserExecutionVerified` remains false in server JSON. The bootstrap carries an assembly build ID; settings compare it with the current server's ID even when both have the same experimental version. An old build, mode change, backend failure or unavailable script produces a reload/unavailable message instead of a successful integration claim. Browser tests simulate a differing server build and verify that warning. This check runs when opening/refreshing settings, not as continuous telemetry. An already-loaded old settings page cannot be remotely rewritten: close or fully reload **all** clients after migration/rollback.

`window.WatchGuardStandalone.status()` describes bootstrap execution only; `loaded` is not a current server health guarantee. `window.WatchGuardPoc.isInstalled()` alone cannot establish freshness. A retained adapter whose protection endpoint is unavailable rejects deletion; the stale-tab browser test observes zero DELETE requests. A browser that never loaded an adapter, direct APIs, native clients and filesystem deletions are not protected.

## Observed validation

All media and user accounts were synthetic. Full browser regressions exercise modern/legacy layouts, bookmarks, Watchlists, context menus, activity/history, preferences, account changes/logout, native movie/series/season/episode deletion, zero/self-only interest, failures, permissions, Cancel, Delete Anyway and bulk selection.

| Test | Result |
| --- | --- |
| Ordinary backend build | 53 passed; experimental sources excluded |
| Experimental backend build | 73 passed, including 20 loader response cases |
| JavaScript | 44 passed, including bootstrap privacy/stale-fetch/CSP cases |
| Catalog unit tests | 3 passed |
| LinuxServer direct, WatchGuard alone | Full backend/auth/settings/browser/deletion suite; removal and unchanged Web file passed |
| LinuxServer + Caddy HTTPS, WatchGuard alone | Native catalog installation, restart, full backend/settings/browser/deletion suite, gzip/zstd and removal passed |
| Real native catalog upgrade | Local 0.3.1 → experimental-metadata 0.4.0; one active plugin, native meta.json; JSON/XML bytes preserved |
| Binary rollback | Published v0.3.1 ZIP loaded, memberships/preferences still readable; experimental routes absent; standalone restored for remaining tests |
| Official image, `/jellyfin` + gzip proxy | Full settings/browser/deletion suite passed; 37 HTML gzip responses |
| Retained Injector mode | Full existing settings/browser/deletion suite; unique registration and persisted registration cleanup passed |
| Existing catalog suite | MD5 rejection, clean install, 0.3.0 → 0.3.1 upgrade/rollback, missing Injector diagnostics passed |
| LinuxServer A → B → A | Conflict refuses standalone; remove only WatchGuard registration; unrelated sentinel registration survives restart/rollback |
| CSP excluding Blob | Expected failure; no installed adapter, no CSP weakening |
| Caddy WebSocket | Authenticated header-based upgrade 101 and three ping/pong exchanges on one connection while serving HTML passed |

Every full successful browser run recorded **13 DELETE requests and zero ordering violations**. Cancellation retains the existing safe rejection and Jellyfin generic error dialog. Neither the deletion adapter nor protection service changed.

Native browser WebSocket observation is recorded separately from the explicit wire test: Chrome observed an accepted connection and received frames in both standalone/Caddy and Injector/direct runs. The global ApiClient `isWebSocketOpen()` helper nevertheless returned false in both; failed/closed socket attempts also occurred in both. Do not use that helper as sole connection-health evidence. The reports preserve counts only, not credential-bearing URLs or message payloads. This is baseline behavior, not a demonstrated standalone regression, and is not a claim that every Jellyfin real-time feature was exhaustively tested.

Machine-readable results: [qualification summary](performance-data/standalone-qualification.json). Detailed local reports/screenshots are under `artifacts/standalone/{linuxserver,official}/`; Caddy HTTP/socket/index reports are directly under `artifacts/standalone/`. No credentials are retained in reports; temporary fixture credentials/configuration disappear with the fixtures.

## Migration and rollback (not executed on production)

1. Verify exact Jellyfin Server/Web versions, image digest, native config/plugin paths and effective browser CSP. Reproduce any additional Caddy middleware/cache/security headers in a disposable fixture. If Blob scripts are prohibited, retain Injector; do not weaken CSP merely to force this experiment through.
2. Back up stopped-server `/config`, or at minimum native plugin configuration plus `/config/data/plugins/Jellyfin.Plugin.WatchGuard/{watchlists.json,preferences.json}` and their corruption/recovery backups. Preserve ownership and permissions. These data folders are independent of native versioned installation folders. Retain the actual published v0.3.1 archive/checksum and compatible Injector.
3. In Injector's native configuration UI, remove **only** the `watchguard-v1` Plugin Scripts entry. Preserve all unrelated entries, Injector settings, and the Injector plugin. Do not delete the entire configuration. For an uninstalled/disabled Injector with retained configuration, restore it temporarily for deliberate cleanup so its old registration cannot reactivate later.
4. Stop/recreate the server with the explicitly built experimental assembly and `WATCHGUARD_EXPERIMENTAL_STANDALONE=1`. Keep LinuxServer's normal PUID/PGID, volumes, entrypoint and production Caddy configuration unchanged. This is a test-mode requirement, not a public v0.4.0 catalog entry. Ordinary published v0.3.1 ignores that variable.
5. Use the native catalog installer for versioned installs once an actual release is authorized. The local qualification catalog proved that mechanism; do not substitute this experiment into the public v0.3.1 asset. Remove duplicate manual assemblies from discovery while stopped. Never blindly copy an old `meta.json` into a different-version installation. Jellyfin removed the superseded catalog folder in our upgrade; keep independent rollback backups rather than assuming the old folder survives.
6. If a loaded Injector still has `watchguard-v1`, or its configuration cannot be inspected, standalone HTML delivery is refused and asset routes return 409. Diagnose and clean that entry explicitly; don't disable the coexistence guard. The old Injector may still deliver its old script while the standalone guard is blocked—this is not successful standalone operation.
7. Fully reload or close every Web tab. Check the settings diagnostics above, exactly one HTML marker, authenticated script availability and the current browser build. Test Cancel on disposable media (zero DELETE), then deliberate override (one native call). Confirm Watchlists/preferences/activity, logout and another account's privacy. Restart once and repeat registration/status checks.

Rollback: stop, remove only the experimental installation(s) from discovery, restore the actual known-good v0.3.1 assembly/install metadata and unset the standalone variable. Keep both JSON stores and plugin XML untouched. Keep/reinstall compatible Injector if needed; v0.3.1 upserts one `watchguard-v1`. Restart and fully reload all clients. Verify Injector registration and disposable Cancel/override again. No Web file restoration is needed. Uninstalling standalone also requires a restart and old-tab reload; retained data can remain for later restoration. Never automatically uninstall Injector, which may serve other plugins.

## Comparison and decision

| Dimension | Existing Injector | Standalone qualification |
| --- | --- | --- |
| Runtime dependency | Separate compatible plugin and persisted script registration | One plugin, small extra bootstrap, no runtime library/service/database dependency |
| Delivery | Existing registration/authenticated delivery | Own request-local HTML capture, anonymous bootstrap, authenticated fetch, temporary Blob |
| Security | Injector's delivery/CSP contract | Same native authentication/privacy; no URL credentials; Blob CSP compatibility must be checked |
| Restart/update | Registration upsert at startup; stale tabs need reload | No registration to maintain in standalone; process mode and conflict guard; stale tabs need reload |
| Maintenance | Injection machinery maintained upstream | WatchGuard owns bounded capture, native SendFile handling, cache/HEAD/compression policy and bootstrap tests |
| Install/upgrade | Two catalog plugins and cleanup on removal | Tested single-plugin native catalog install/upgrade; deliberate one-time Injector entry cleanup |
| Version sensitivity | Injector + WatchGuard/Web compatibility | WatchGuard depends directly on actual Web entry response and native ApiClient behavior |

The experimental code is original; no Injector source was copied/adapted or bundled. The ASP.NET source was inspected to understand the implicit SendFile flush; the local bounded file-copy wrapper is original. No new runtime dependency or frontend framework is added.

Small warm index sample (ten sequential **direct backend** requests on separate LinuxServer fixtures, identity encoding): standalone median 1.056 ms/max 2.435 ms/5,540 bytes; Injector median 1.072 ms/max 4.127 ms/7,437 bytes. These measurements exclude Caddy, authentication, browser rendering and load; they do not justify a speed claim. Complete UI integration is unchanged. Standalone removes an installation dependency at the cost of owning response-rewriting maintenance.

Adopt standalone only for a separately approved release/deployment whose image, Web bundle and CSP meet these tested conditions. This qualification removes the earlier LinuxServer/TLS/compression/WebSocket and unbounded-buffer blockers. It does not create a supported Jellyfin global-Web-script extension API, broaden deletion guarantees, or authorize vm622 migration.

## Reproduce

Prerequisites: Docker, .NET SDK from `global.json`, Node/Playwright as pinned in `tests/browser/package-lock.json`, Python 3, and a `zstd` CLI for the compressed-response test only. Caddy and LinuxServer image digests are pinned in the fixture. Commands use fresh temporary configuration and generated two-second media.

```sh
python3 scripts/build-standalone-poc.py
python3 scripts/build-standalone-poc.py --upgrade-fixture
dotnet test Jellyfin.Plugin.WatchGuard.slnx -c Release
dotnet test Jellyfin.Plugin.WatchGuard.slnx -c Release -p:WatchGuardStandalonePoc=true
node --test tests/web.test.cjs tests/standalone-bootstrap.test.cjs
python3 -m unittest discover -s tests -p 'catalog_test.py'
python3 tests/docker-smoke.py --standalone --linuxserver
python3 tests/docker-smoke.py --standalone --linuxserver --standalone-catalog --qualification-upgrade --caddy
python3 tests/docker-smoke.py --standalone --base-path /jellyfin --proxy
python3 tests/docker-smoke.py --injector-dll /path/to/Injector.dll --artifact artifacts/StandalonePoC/Jellyfin.Plugin.WatchGuard.dll
python3 tests/docker-smoke.py --injector-dll /path/to/Injector.dll --artifact artifacts/StandalonePoC/Jellyfin.Plugin.WatchGuard.dll --catalog
python3 tests/docker-smoke.py --injector-dll /path/to/Injector.dll --artifact artifacts/StandalonePoC/Jellyfin.Plugin.WatchGuard.dll --linuxserver --migration
python3 tests/docker-smoke.py --standalone --linuxserver --caddy --measure
python3 tests/docker-smoke.py --injector-dll /path/to/Injector.dll --artifact artifacts/StandalonePoC/Jellyfin.Plugin.WatchGuard.dll --linuxserver --measure
```

The upgrade fixture alone uses local `0.4.0.0` metadata in `artifacts/StandaloneUpgradePoC/`. The ordinary PoC retains `0.3.1.0` metadata for existing regressions; neither replaces the published ZIP. Local catalogs/archives are discarded after tests, never published. The existing catalog regression also requires the retained v0.3.0 and v0.3.1 archives described in deployment documentation.

## Sources

- [LinuxServer release tags](https://github.com/linuxserver/docker-jellyfin/releases) and [native container setup/PUID/PGID](https://docs.linuxserver.io/images/docker-jellyfin/); actual downloaded startup script/build label and running API version verified above.
- [Caddy encode](https://caddyserver.com/docs/caddyfile/directives/encode), [reverse_proxy and WebSockets](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy), and [internal TLS](https://caddyserver.com/docs/caddyfile/directives/tls).
- [ASP.NET Core 10 StreamResponseBodyFeature](https://github.com/dotnet/aspnetcore/blob/v10.0.0/src/Http/Http/src/StreamResponseBodyFeature.cs) for implicit Start/Flush and native feature behavior.
- [Pinned Jellyfin pipeline and original architecture sources](standalone-injection.md#sources-and-attribution). No production server was inspected.
