# WatchGuard v0.4.0 — standalone release candidate

Prepared 2026-10-12 for Jellyfin Server/Web 12.2 and .NET 10. **Not published or deployed.** The normal build is now a single catalog-installable plugin with its own Web loader. JavaScript Injector is neither a runtime dependency nor bundled. Public v0.3.1 release assets and manifest entries remain unchanged.

## Changes

The qualified loader moved into `Standalone/` and is included unconditionally. There is no `WatchGuardStandalonePoc` compile flag or `WATCHGUARD_EXPERIMENTAL_STANDALONE` environment requirement. Native service registration installs the startup filter and authenticated asset controller in every normal build. Obsolete Injector registration/status service code was removed after Rider safe-delete reference checks; v0.4.0 never calls Injector registration APIs.

The existing watchlist/preference stores (both schema 1), playback/activity aggregation, API authorization, Web actions/navigation and deletion adapter are unchanged. Stable plugin GUID is `a3c6bc84-783d-4ba8-a0db-89bfb83ab486`. Existing settings and defaults remain; diagnostics default false. Completed history alone still does not protect a title.

The normal assembly retains qualified bounded buffering, native SendFile handling, exact entry-document scope, GET/HEAD/conditional/range/cache/encoding policy and safe fallback. Embedded bootstrap loads anonymously but retrieves the complete script only through native authenticated headers. Private responses are no-store and never contain generated credentials. Blob execution is required; no CSP weakening or generic fetch/XHR interception was added. See the [qualification implementation record](standalone-qualification.md).

A read-only Inspector detects any loaded Injector's `watchguard-v1` registration (including disabled entries) or an unrecognized configuration interface. These block standalone activation; the old configuration is never removed or overwritten. Administrator diagnostics distinguish discovery, interface compatibility, conflict, middleware readiness, completed bootstrap/private responses, current authenticated availability, and current-browser adapter/build. Counters are not proof of browser execution. [Explicit migration and rollback](migration-v040.md) preserves other plugins' scripts and the installed Injector.

## Release artifacts

- `artifacts/Jellyfin.Plugin.WatchGuard-v0.4.0.zip`
- `artifacts/Jellyfin.Plugin.WatchGuard-v0.4.0.zip.sha256`
- SHA-256: `439fdc1accf4922e7f6eb8d01451e8d83f3343d656ef65d778f5dc99163bda4d`
- Native catalog MD5: `83025bb9b85dfc03d91a1875aabc9926`
- Assembly/package `0.4.0.0`, product `0.4.0`, target ABI `12.2.0.0`.
- ZIP contents: one runtime DLL and LICENSE only; all Web resources embedded.

Two forced release builds using SDK 10.0.302 generated identical ZIP bytes/checksums. The normal catalog installer consumed this exact RC ZIP in a temporary local repository. The public manifest has no candidate entry; a future authorized workflow derives URLs/timestamps only from an actually published, anonymously verified release.

## Validation

Normal-build backend/loader tests: **74 passed**. JavaScript/bootstrap: **44 passed**. Catalog unit tests: **4 passed**, including immutable published history. No experimental configuration was used.

| Disposable fixture | Coverage/result |
| --- | --- |
| LinuxServer, no Injector, native catalog, Caddy HTTPS | Exact RC install/restart, backend/auth/settings, modern/legacy Web and full deletion suite; PASS |
| LinuxServer, published v0.3.1 + Injector → RC → rollback → RC | Native catalog, invalid-MD5 rejection, conflict refusal, unchanged Injector XML until explicit cleanup, sentinel preservation, byte-identical JSON/XML, one active plugin, full RC browser suite; PASS |
| Official image, `/jellyfin`, gzip proxy | Normal standalone build, full backend/settings/browser/deletion and removal; PASS |
| Retained published v0.3.1 | Existing Injector Web suite and legacy native catalog upgrade/rollback/missing-Injector checks retained |
| Caddy HTTP/WebSockets | Identity/gzip/zstd, trusted disposable CA, HEAD, fresh conditional/range HTML, authenticated no-store, persistent WebSocket ping/pong and native browser connection probes |
| CSP/authentication/stale clients | Blob-blocking CSP gives no adapter; anonymous/invalid/API-key/disabled/deleted callers rejected; stale fetch/build and unavailable protection block unsafe assumptions |
| Restart/uninstall | No new HTML marker or standalone routes after removal; native index hashes unchanged; old tabs explicitly require reload |

Successful full Web runs each observe **13 media DELETE requests and zero ordering violations**. They cover movie/series/episode/season native paths, context menus, bulk selection, self-only/zero interest, failed protection checks, Cancel/override, account changes/logout, shared-admin privacy, activity and preferences. Cancellation's existing generic Jellyfin error remains; no fake successful deletion or suppressed unrelated errors is introduced.

Final machine-readable results are in [release validation](performance-data/release-v040.json); detailed fixture reports/screenshots are under `artifacts/v040/`, with migration results in `artifacts/migration-v040.json`. Unit and fixture logs were captured locally. GitHub Actions is prepared and syntax-checked, not remotely dispatched/published.

## Production-specific limits

Qualified LinuxServer image:

`lscr.io/linuxserver/jellyfin:12.2ubu2604-ls53@sha256:1bb4f88d822a0510bb3604b68aacb80d77c1d2a30181e500090c65111b98723b`

Running fixture reports server `12.2.0`, native s6/`abc` PUID/PGID and `/config/data/plugins`. Caddy is pinned to `caddy:2@sha256:f2a1290d0463aad60660d4ec134943f183ee2a5f6c3eb7bf32dd984f2f020772` (`v2.11.7`), root-path HTTPS with `encode zstd gzip`. The fixture trusts a disposable internal CA; it does not test public certificate renewal, vm622 configuration or browser policy. Playwright ignores certificate errors only in this disposable CA fixture; HTTP/Node clients verify its CA explicitly.

Production uses LinuxServer.io Jellyfin 12.2, Compose, Caddy HTTPS at `jellyfin.dave-cave.com`, and `/config/data/plugins`. Supplied running image ID `sha256:fbd967af0187a569b0c18d2db6cb311fdf0df4aeb520102c63f19320aadf964d` is **not a registry manifest digest**, and was not used in a pull reference. Absence of an observed CSP header does not establish successful Blob execution. An authorized post-install browser check on that host remains necessary; production was not contacted or modified.

Global ApiClient WebSocket status can differ from Chrome's observed live native connection in both old and new integrations; probes use actual accepted connections/frames and wire ping/pong rather than treating that helper as authoritative. Future Jellyfin versions, custom Web bundles, unknown middleware order, caches ignoring no-store and restrictive CSP need separate qualification. Native clients, direct APIs and filesystem deletion remain unprotected. A browser that never loaded the adapter has no WatchGuard warning.

**Recommendation:** candidate is suitable for a separately authorized deployment test on the stated production image family/proxy shape, with [migration steps](migration-v040.md), backup and v0.3.1 rollback ready. Do not infer approval to publish or deploy from passing tests.

## Reproduce

```sh
python3 scripts/build-release.py
dotnet test Jellyfin.Plugin.WatchGuard.slnx -c Release
node --test tests/web.test.cjs tests/standalone-bootstrap.test.cjs
python3 tests/catalog_test.py
python3 tests/docker-smoke.py --linuxserver --catalog --caddy
python3 tests/docker-smoke.py --linuxserver --migration --injector-dll /path/to/published-jf12-Injector.dll
python3 tests/docker-smoke.py --base-path /jellyfin --proxy
python3 tests/docker-smoke.py --linuxserver --caddy --measure
```

Install pinned Playwright using `npm ci --prefix tests/browser` and its Chromium installer; the fixture's zstd decoder is a test-only CLI dependency. For retained legacy regressions, extract the verified published v0.3.1 DLL into `artifacts/RollbackV031`, retain published v0.3.0 and v0.3.1 ZIPs, then run `docker-smoke.py --legacy-injector` and `--legacy-injector --catalog` with the Injector DLL. These flags select old **test artifacts**, never a v0.4.0 production loader mode.
