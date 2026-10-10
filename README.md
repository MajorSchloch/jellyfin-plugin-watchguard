# Jellyfin WatchGuard v0.1.0

Deployment-test build for **Jellyfin Server and Web 12.2 / .NET 10**. Personal movie/series watchlists remain separate from Favorites. Administrators can see interest based on watchlists, unfinished playback and active sessions.

Movie and series detail pages provide a Watchlist toggle and **My Watchlist**, with native detail links and removal. Before supported Web deletion, WatchGuard checks fresh status. Other users' interest prompts **Cancel / Delete Anyway**; zero or self-only interest adds no warning. Episodes and seasons check their verified parent series and explain that scope. Native deletion permissions still apply.

Start with the [deployment checklist, Docker Compose installation, verification and rollback instructions](docs/deployment.md). No production deployment or GitHub release has been performed.

## Release artifact and build

- `artifacts/Jellyfin.Plugin.WatchGuard-v0.1.0.zip`
- `artifacts/Jellyfin.Plugin.WatchGuard-v0.1.0.zip.sha256`

The ZIP contains **one runtime DLL** and `LICENSE`. The Web adapter is embedded in the DLL. It does not contain Jellyfin assemblies, test dependencies, loose JavaScript, configuration, watchlists or JavaScript Injector.

Release packaging requires .NET SDK **10.0.302** and Python 3.10+. Node 24+ and Docker are needed for the tests; Playwright is pinned in the test lock file.

```sh
python3 scripts/build-release.py
(cd artifacts && shasum -a 256 -c Jellyfin.Plugin.WatchGuard-v0.1.0.zip.sha256)
dotnet test Jellyfin.Plugin.WatchGuard.slnx -c Release --no-restore
node --test tests/web.test.cjs
npm ci --prefix tests/browser
(cd tests/browser && npx playwright install chromium)
python3 tests/docker-smoke.py --injector-dll /path/to/Jellyfin.Plugin.JavaScriptInjector.dll
```

The release script uses locked NuGet dependencies, forced deterministic Release compilation, normalized source paths and fixed ZIP metadata. It also extracts the packaged DLL to `artifacts/WatchGuard/` for integration tests. Two complete compilations produced identical ZIP checksums.

Open `Jellyfin.Plugin.WatchGuard.slnx` in Rider. `Jellyfin.Plugin.Template.slnx` remains an equivalent compatibility entry point for existing workspaces. Historical PoC documents and test filenames remain as evidence; the runtime `WatchGuardPoc` diagnostic object and `watchguard-v1` script ID are retained compatibility identifiers.

## Install into a test Jellyfin container

Use the official **12.2** image and a matching **JavaScript Injector jf12/.NET 10** build. The [deployment guide](docs/deployment.md#javascript-injector-dependency) pins the tested Injector revision and build command. Keep its **response-time middleware enabled** (`DisableScriptInjectionMiddleware=false`). Do not use its legacy Web-file rewrite mode or install File Transformation for WatchGuard.

With Jellyfin stopped, copy only the WatchGuard DLL into `/config/plugins/WatchGuard/` and the separate Injector DLL into `/config/plugins/JavaScriptInjector/`. Keep `/config` persistent and writable by the Jellyfin process. Start Jellyfin and fully reload Web tabs. Neither installation nor uninstall requires editing Jellyfin Web files.

Verify the exact log **`WatchGuard web script registered with JavaScript Injector.`**, then check Injector's **Plugin Scripts** entry: name `WatchGuard`, ID `watchguard-v1`, version `0.1.0`, enabled and requiring authentication. Finally, in a newly loaded signed-in Web tab, `window.WatchGuardPoc?.isInstalled()` must return `true`. Full registration and functional checks are in [deployment.md](docs/deployment.md#verify-registration-and-operation).

**Diagnostics default to off.** Existing installations retain their saved setting; set `DiagnosticMode=false` before routine deployment testing if earlier tests enabled it. The automated disposable browser fixture deliberately enables diagnostics for ordering assertions.

## Data, upgrades and removal

Membership lives at **`/config/plugins/Jellyfin.Plugin.WatchGuard/watchlists.json`** in the official container. This is distinct from the DLL installation directory. Back up the entire persistent `/config` while Jellyfin is stopped, including this file and plugin configuration XML. Preserve it during upgrades; playback completion never removes manual entries. Corrupt or unsupported storage returns an error instead of silently resetting lists.

When uninstalling, remove the DLL and also delete the persisted **`watchguard-v1`** entry from Injector's **Plugin Scripts**. Reload all Web tabs. Removing the DLL alone does not remove that registration or an adapter already loaded in a browser. Keep watchlists for rollback unless you deliberately intend to discard them. Detailed upgrade, uninstall and rollback steps are in [deployment.md](docs/deployment.md).

## Compatibility and limitations

| Area | v0.1.0 scope |
| --- | --- |
| Server/runtime | Jellyfin **12.2**, .NET **10**; other server versions are not validated. |
| Web layouts | Explicit modern and legacy desktop shells tested in Chromium; both use the legacy detail template in 12.2. |
| Dependency | JavaScript Injector's tested response-time middleware build; absent/failed injection means no Web warning. |
| Supported deletion targets | Movie, series, episode and season; episode/season interest is series-wide. |
| Unsupported or failed checks | Block deletion through the installed wrapper; folders, collections, playlists and unknown types are not permitted. |
| Permissions | Only administrators can read cross-user interest; non-admin deletion attempts are blocked by the protection check even if native deletion permission exists. |
| Cancellation | Zero DELETE for the cancelled operation, followed by Jellyfin's generic deletion-error dialog. |
| Bulk operations | Independent per-item checks; not transactional and cancelling one does not cancel the entire batch. |
| Coverage boundary | Advisory Web integration, **not server-enforced protection**. Native clients, direct API requests, cleanup plugins and filesystem deletion bypass it. |

Unwrapped client instances, another plugin replacing the method, requests before injection, stale tabs and future Web changes can bypass warnings. There is a check-to-delete race. Mobile/TV layouts, other browsers, base-path/multi-server setups and alternate-version deletion semantics are not validated. My Watchlist is a detail-page dialog, not a sidebar page; labels are English. No Seerr, automation-service or playlist integration is included.

## Validation

v0.1.0: **26 backend tests and 23 JavaScript tests passed**, plus the complete disposable Docker backend/browser suite. Both layouts, parent-series scope, Cancel/override, failed checks, bulk deletion, account isolation and list controls passed. Release registration and persisted-script removal passed; the on-disk Web index remained identical to the pristine official image. See [final results](docs/deployment.md#automated-results).

Further references: [architecture](docs/architecture.md), [backend API/storage](docs/backend.md), [Web integration](docs/web-ui.md), [compatibility hardening](docs/hardening.md), and the historical [deletion PoC](docs/deletion-poc.md).
