# WatchGuard v0.4.8 deployment candidate

Target: Jellyfin Server/Web 12.2, .NET 10. Standalone loading is compiled and enabled in the normal plugin. There is no JavaScript Injector dependency or special environment variable. **The candidate is not published; the public catalog still advertises existing releases.**

## Native catalog installation and upgrades

After authorized publication, use the existing repository URL in Dashboard → Plugins → Repositories:

`https://raw.githubusercontent.com/MajorSchloch/jellyfin-plugin-watchguard/master/manifest.json`

Install/update WatchGuard through Catalog and restart. Jellyfin creates `WatchGuard_0.4.8.0` and matching `meta.json`; do not manually copy DLLs into additional discovery folders or edit native metadata for a normal update. See [v0.3.1 migration](migration-v040.md) before upgrading an installation that has Injector's persisted `watchguard-v1` entry.

For **unpublished RC validation**, use `python3 tests/docker-smoke.py --linuxserver --catalog --caddy` after building the ZIP and installing test prerequisites. This creates a real temporary local repository/ZIP URL, calls Jellyfin's native installer, restarts, and tests the exact packaged DLL. It never updates the public manifest or points at production.

## LinuxServer.io Compose layout

A separate disposable Compose project may use:

```yaml
services:
  jellyfin:
    image: lscr.io/linuxserver/jellyfin:12.2ubu2604-ls53@sha256:1bb4f88d822a0510bb3604b68aacb80d77c1d2a30181e500090c65111b98723b
    environment:
      PUID: "${JF_UID}"
      PGID: "${JF_GID}"
      TZ: Europe/Vienna
    ports:
      - "127.0.0.1:8097:8096"
    volumes:
      - ./config:/config
      - ./disposable-media:/media
```

Use test-owned paths and a suitable UID/GID; keep native s6 startup. Do not override entrypoint, mount writable Web files, or use world-writable permissions. The running native service uses `abc`. Caddy may proxy the service's port 8096 at the root path with normal HTTPS termination and `encode zstd gzip`. The automated fixture uses its own pinned Caddy container and disposable internal CA; it does not edit production Caddy.

The provided production local image ID is not a registry digest. Only the pinned qualified image above is used for release regressions. `https://jellyfin.dave-cave.com` still needs a browser smoke test after a separately authorized deployment, despite no CSP header being observed. See [release limitations](standalone-release.md).

## Data and backup

| Purpose | LinuxServer.io path |
| --- | --- |
| Catalog runtime | `/config/data/plugins/WatchGuard_0.4.8.0/` |
| Schema-1 memberships | `/config/data/plugins/Jellyfin.Plugin.WatchGuard/watchlists.json` |
| Schema-1 preferences | `/config/data/plugins/Jellyfin.Plugin.WatchGuard/preferences.json` |
| Settings XML | `/config/data/plugins/configurations/Jellyfin.Plugin.WatchGuard.xml` |

The official Jellyfin fixture instead uses `/config/plugins`. Data paths come from native plugin data-directory services and are independent of versioned installation folders. Back up the entire stopped `/config` volume outside plugin discovery to preserve user/library IDs, XML, both JSON stores and recovery copies. A watchlist file alone is not portable to an unrelated server. Protect backups as private user data. Restore corrupt stores from backup; do not delete them to silence errors.

## Verify loading and operation

1. Dashboard → Plugins: one active WatchGuard `0.4.8.0`; no required Injector. Settings remain ActivityWindowDays 30 (1–90), ActivityLimit 100 (1–100), DiagnosticMode false and ProtectCaughtUpSeries true by default. Existing XML is retained; settings apply without restart, but script diagnostic changes require client reload.
2. Dashboard → Plugins → WatchGuard: check server version, standalone loader active, Injector conflict absent, and completed bootstrap/private-script responses. Counters are aggregate server observations since restart, not proof of execution in this browser.
3. Refresh the settings browser check: authenticated script available now and adapter installed on current ApiClient, with matching build ID. A stale build, unavailable script or conflict must not show healthy. An administrative server endpoint cannot remotely certify arbitrary browsers.
4. In Network tools, the Web entry contains one `watchguard-standalone-loader` script reference. Anonymous bootstrap is safe; `/WatchGuard/Standalone/script.js` is retrieved only with native authentication and is no-store. Do not share authorization headers. CSP excluding Blob execution prevents loading; do not weaken CSP as a workaround.
5. Confirm Watchlists, bookmark add/remove, persisted preferences, activity and account isolation. Use both your own and another disposable user's explicit membership and begin native deletion: Cancel must send **zero DELETEs**; Delete Anyway sends one. Repeat supported movie/series/episode/season and bulk paths. The existing generic Jellyfin cancellation error remains expected.
6. Restart and fully reload every tab. Recheck settings and disposable deletion. Native clients, direct APIs, filesystems and browsers that never loaded the adapter remain outside Web protection.

A retained `window.WatchGuardPoc.isInstalled()` or bootstrap `status() === 'loaded'` alone is not a fresh integration check. Use the settings page, which also checks the server build and authenticated endpoint. Diagnostic mode defaults off; upgrades preserve a deliberately enabled value. Temporary browser diagnostics use `window.WatchGuardPoc.setDiagnostics(true)` and `false`; logs contain fixed events/counters, not tokens or names.

## Uninstall and rollback

v0.4.7 → v0.4.8 reuses bounded request-local episode metadata only after each account's native visibility query. Protection, targeted activity, settings and both JSON schemas are unchanged. Back up XML/JSON, update through the catalog after publication, restart and fully reload clients. Roll back with the checksum-verified published v0.4.7 ZIP and one active assembly. See [episode-query measurements and rollback](episode-query-performance-v048.md).

v0.4.2 → v0.4.3 adds targeted series viewing and default-enabled Caught Up protection. Both stores remain schema 1. Preserve the published v0.4.2 package and XML/JSON backups for rollback; reinstall it with one active assembly, restart and fully reload every client. See [v0.4.3 migration and rollback](caught-up-protection.md).

v0.4.0 → v0.4.1 needs no store or settings migration. Both versions use the same standalone loader. Native catalog downgrade to retained v0.4.0 plus restart/full client reload restores its original other-users-only warning behavior and Watched classification. Preserve both schema-1 stores and XML, and keep one active assembly. See [release/rollback instructions](release-v041.md).

Use native plugin Uninstall and restart. Preserve the data folder/XML if reinstall or rollback is desired. New Web documents no longer include the loader; endpoints disappear; Web files remain unchanged. Close/reload old tabs. No special Web-file cleanup or shutdown registration removal is required for fresh standalone installs.

If migrating from an older Injector-based version, complete the explicit `watchguard-v1` cleanup in [migration-v040.md](migration-v040.md), even if Injector is temporarily absent. Never delete unrelated registrations or automatically uninstall Injector. Rollback to published v0.3.1 requires that compatible Injector be available again; both schema-1 files and settings survive the tested round trip.

## Deployment checklist

- [ ] Exact package SHA-256 checked; only DLL and LICENSE in the archive.
- [ ] Stopped-server backup and published v0.4.6 rollback artifact retained.
- [ ] No duplicate manual assembly; native catalog metadata remains installer-owned.
- [ ] Only old WatchGuard Injector entry removed; other scripts preserved.
- [ ] Correct pinned/tested image family and bundled Web; production local image ID not mistaken for registry digest.
- [ ] Fresh browser verifies authenticated delivery, current build and installed adapter under effective CSP.
- [ ] Two-account privacy, memberships/preferences/activity and disposable Cancel/override pass.
- [ ] Restart, full client reload, uninstall and rollback understood.

See [v0.4.8 validation and package](episode-query-performance-v048.md) and [catalog preparation/publishing](plugin-repository.md). No production service, media, configuration or public release is changed by the test harness.

## v0.4.8 verification performance

See [before/after measurements and diagnostics](episode-query-performance-v048.md). This update keeps the v0.4.7 configuration and schema-1 stores. Back up both JSON files and plugin XML, use one active catalog assembly, restart, and fully reload clients. Rollback uses the immutable published v0.4.7 ZIP. Expect existing coverage warnings when unchanged work limits are reached; overview caching never authorizes deletion. No production migration is performed by the test suite.
