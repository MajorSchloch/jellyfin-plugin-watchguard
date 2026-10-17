> **v0.4.10 isolated security candidate:** [deployment policy](docs/deployment-agnostic-security-v0410.md), [proxy compatibility](docs/proxy-compatibility-v0410.md), and [regression evidence](docs/security-regression-v0410.md). Not published; security review is required. Existing published installation instructions below remain the v0.4.9 baseline.

# Jellyfin WatchGuard v0.4.9 — release candidate

Personal movie/series watchlists, shared viewing activity and advisory deletion warnings for **Jellyfin Server/Web 12.2 / .NET 10**. Watchlists stay separate from Favorites. Native playback data remains authoritative; completed movie/ended-series history alone never protects a title from deletion.

**One plugin:** WatchGuard includes its own authenticated Web loader. JavaScript Injector is neither required nor bundled. No feature flag, environment variable, Web-file modification, external database or frontend framework is needed.

**Not published yet.** The public catalog and published v0.4.8 release remain unchanged. Installing from the public catalog today does not install this candidate. The normal Jellyfin catalog installer is tested using a disposable local repository containing the exact RC ZIP.

## Installing and upgrading

After a v0.4.9 release is explicitly approved and published, use Dashboard → Plugins → Repositories with the existing WatchGuard repository:

`https://raw.githubusercontent.com/MajorSchloch/jellyfin-plugin-watchguard/master/manifest.json`

Install/update WatchGuard, restart Jellyfin and fully reload all Web clients. No manual DLL operations are needed for normal catalog updates. On LinuxServer.io, discovery is under `/config/data/plugins`.

**Upgrading from v0.4.8:** server enforcement is **off by default**. Existing Web warnings remain. Administrators may opt in through WatchGuard settings, then restart and reload clients. The single assembly adds no plugin dependency. See [server enforcement](docs/server-enforcement-v049.md), [security boundaries](docs/server-enforcement-security-v049.md) and [upgrade/rollback](docs/server-enforcement-upgrade-v049.md).

**Upgrading from v0.3.1:** first follow [migration and rollback](docs/migration-v040.md). A persisted Injector `watchguard-v1` entry blocks standalone delivery. Remove only that entry explicitly; keep unrelated scripts and Injector itself if other plugins need it. WatchGuard never edits Injector configuration or uninstalls it.

Open Dashboard → Plugins → WatchGuard to verify the server loader, bootstrap responses, authenticated script availability and the adapter in the current browser. Server process health alone does not establish deletion protection. See [deployment checks](docs/deployment.md).

## Behavior and limitations

The Watchlists overview uses a compact coverage disclosure, visible safety warnings, labeled responsive controls and colored user status icons. See [overview UI polish](docs/watchlists-ui-v045.md).

Administrator series details include a compact, expandable [viewing activity panel](docs/ui-polish-v044.md), independent of watchlist membership. It expands below the native header, with colored status chips, aligned user rows, valid-coverage progress and native playback dates. Title and action placement remain stable.

The deletion dialog identifies the exact target, separates your interest from other users and presents reasons in a responsive, keyboard-accessible layout. Cancel receives initial focus. Both confirmations and Jellyfin’s generic cancellation error remain; [native integration research](docs/native-confirmation-options.md) explains why.

- Personal memberships and preferences retain their schema-1 JSON files. Settings, user IDs, media IDs and plugin GUID are unchanged.
- Watchlists navigation, activity dates/history, filters, native context-menu actions, detail controls and administrator-only cross-user information are preserved.
- Supported movie, series, season and episode deletion uses fresh per-title protection for **all interested users, including you**. Watchlist, unfinished viewing and active playback warn. Verified Caught Up interest in a continuing series also warns by default; administrators can disable only that reason. Completed ended-series history alone does not protect. Cancel sends no DELETE; override calls native deletion once. Native permissions are unchanged. Jellyfin's generic cancellation error remains.
- Default protection remains advisory and Web-only. Opt-in server enforcement covers only the two verified native HTTP item-deletion routes; protected requests require a fresh, single-use administrator approval. Clients without approval support are rejected for protected media, and API keys cannot delete through the enabled guard. Filesystem changes and internal/external cleanup remain outside coverage. Unsupported scopes fail closed. Settings must show actual compatible attachment, not merely a checked checkbox.
- The authenticated loader uses Blob script execution. CSP must permit it; a missing CSP response header alone is not proof of browser execution. Loading failure means no adapter, not successful protection.
- Only native Jellyfin 12.2 Web entry responses and tested layouts/pipeline are qualified. Custom Web bundles, future Jellyfin releases and unusual proxy/middleware/CSP policies need revalidation. Old tabs require a full reload after every upgrade/rollback.
- Continuing series with verified watched aired episodes show **Caught Up** under the existing Watching filter. Missing coverage or unknown air dates prevent this classification; ended/unknown-status behavior is retained.
- Activity discovery is bounded; completed history does not become a permanent watchlist entry. Favorites and media metadata are never used for persistence.

The qualified LinuxServer image and Caddy HTTPS/compression results, plus remaining uncertainty about `jellyfin.dave-cave.com`, are recorded in [standalone release notes](docs/standalone-release.md). No production changes were made.

## Build and test

Use the SDK pinned by `global.json` (10.0.302):

```sh
python3 scripts/build-release.py
dotnet test Jellyfin.Plugin.WatchGuard.slnx -c Release
node --test tests/web.test.cjs tests/standalone-bootstrap.test.cjs tests/server-enforcement.test.cjs
python3 tests/catalog_test.py
python3 scripts/catalog.py --zip artifacts/Jellyfin.Plugin.WatchGuard-v0.4.9.zip
```

Outputs: `artifacts/Jellyfin.Plugin.WatchGuard-v0.4.9.zip` and `.zip.sha256`. The deterministic archive contains only `Jellyfin.Plugin.WatchGuard.dll` and `LICENSE`; Web assets are embedded. Package/assembly version is `0.4.9.0`, target ABI `12.2.0.0`, GUID `a3c6bc84-783d-4ba8-a0db-89bfb83ab486`.

Docker/browser regressions use disposable configuration and generated media. See [v0.4.9 qualification](docs/server-enforcement-v049.md), [catalog workflow](docs/plugin-repository.md), and [deployment](docs/deployment.md). The release workflow defaults to validation only; this task does not publish, update the public manifest or deploy.

For v0.4.8 performance results, timing-field definitions, unchanged safety limits and memory tradeoffs, see [episode queries](docs/episode-query-performance-v048.md). Synthetic native results are not production latency guarantees.
