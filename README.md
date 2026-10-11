# Jellyfin WatchGuard v0.3.0

Deployment-test build for **Jellyfin Server and Web 12.2 / .NET 10**. Personal movie/series watchlists remain separate from Favorites. Administrators can see interest based on watchlists, unfinished playback and active sessions.

**Watchlists** combines personal memberships, native viewing interest and bounded recent viewing history in a responsive poster grid. A checkbox popover defaults to Watchlisted, Watching and Currently Playing; enable Watched to include completed-only history. User filters and title/playback-recency sorting remain. Compact cards show status icons, matching users, localized calendar dates and available episode counts. Filters persist in URL history and across reloads. See [UI refinement and screenshots](docs/ui-refinement.md). Explicit entries appear first; an inline spinner remains while automatic activity loads. Regular users see only their own data. Automatic activity is never persisted as membership. See [activity semantics, configuration and coverage](docs/activity.md) and [performance measurements](docs/performance.md).

Detail headers show compact status icons beside administrator-visible usernames and a separate personal bookmark toggle; seasons/episodes refer to their verified parent series. Before supported Web deletion, WatchGuard still checks fresh protection. **Recently watched history alone never triggers a warning.** Explicit watchlist membership, unfinished playback and active sessions retain their existing semantics and native permissions.

Supported native movie/series menus now offer personal Add/Remove beside collection/playlist actions. Filters use a compact icon/count. My list and individual-user activity requests are scoped on the server; all-users aggregation stays bounded and uncached. The measured default view settled in 82.4 ms versus 214.2 ms in the disposable baseline. See [native actions and deliberate hover-control limitation](docs/native-actions.md) and [measurement details](docs/performance-v030.md).

**Catalog preparation:** the source repository is private and has no public release yet. The checked-in manifest is valid but empty; no speculative download URL is advertised. Release tooling and real native catalog installation/migration tests are included. See [plugin repository](docs/plugin-repository.md) and [LinuxServer.io manual-to-catalog migration](docs/manual-to-catalog.md) for `/config/data/plugins`. Publication and production migration remain separate actions.

Start with the [deployment checklist, Docker Compose installation, verification and rollback instructions](docs/deployment.md). No production deployment or GitHub release has been performed.

## Release artifact and build

- `artifacts/Jellyfin.Plugin.WatchGuard-v0.3.0.zip`
- `artifacts/Jellyfin.Plugin.WatchGuard-v0.3.0.zip.sha256`

The ZIP contains **one runtime DLL** and `LICENSE`. The Web adapter is embedded in the DLL. It does not contain Jellyfin assemblies, test dependencies, loose JavaScript, configuration, watchlists or JavaScript Injector.

Release packaging requires .NET SDK **10.0.302** and Python 3.10+. Node 24+ and Docker are needed for the tests; Playwright is pinned in the test lock file.

```sh
python3 scripts/build-release.py
(cd artifacts && shasum -a 256 -c Jellyfin.Plugin.WatchGuard-v0.3.0.zip.sha256)
dotnet test Jellyfin.Plugin.WatchGuard.slnx -c Release --no-restore
node --test tests/web.test.cjs
python3 tests/catalog_test.py
python3 scripts/catalog.py --zip artifacts/Jellyfin.Plugin.WatchGuard-v0.3.0.zip
npm ci --prefix tests/browser
(cd tests/browser && npx playwright install chromium)
python3 tests/docker-smoke.py --injector-dll /path/to/Jellyfin.Plugin.JavaScriptInjector.dll
```

The release script uses locked NuGet dependencies, forced deterministic Release compilation, normalized source paths and fixed ZIP metadata. It also extracts the packaged DLL to `artifacts/WatchGuard/` for integration tests. Two complete compilations produced identical ZIP checksums.

Open `Jellyfin.Plugin.WatchGuard.slnx` in Rider. `Jellyfin.Plugin.Template.slnx` remains an equivalent compatibility entry point for existing workspaces. Historical PoC documents and test filenames remain as evidence; the runtime `WatchGuardPoc` diagnostic object and `watchguard-v1` script ID are retained compatibility identifiers.

## Install into a test Jellyfin container

Use the official **12.2** image and a matching **JavaScript Injector jf12/.NET 10** build. The [deployment guide](docs/deployment.md#javascript-injector-dependency) pins the tested Injector revision and build command. Keep its **response-time middleware enabled** (`DisableScriptInjectionMiddleware=false`). Do not use its legacy Web-file rewrite mode or install File Transformation for WatchGuard.

With Jellyfin stopped, copy only the WatchGuard DLL into `/config/plugins/WatchGuard/` and the separate Injector DLL into `/config/plugins/JavaScriptInjector/`. Keep `/config` persistent and writable by the Jellyfin process. Start Jellyfin and fully reload Web tabs. Neither installation nor uninstall requires editing Jellyfin Web files.

Verify the exact log **`WatchGuard web script registered with JavaScript Injector.`**, then check Injector's **Plugin Scripts** entry: name `WatchGuard`, ID `watchguard-v1`, version `0.3.0`, enabled and requiring authentication. Finally, in a newly loaded signed-in Web tab, `window.WatchGuardPoc?.isInstalled()` must return `true`. Full registration and functional checks are in [deployment.md](docs/deployment.md#verify-registration-and-operation).

**Diagnostics default to off.** Existing installations retain their saved setting; set `DiagnosticMode=false` before routine deployment testing if earlier tests enabled it. The automated disposable browser fixture deliberately enables diagnostics for ordering assertions.

## Data, upgrades and removal

Membership lives at **`/config/plugins/Jellyfin.Plugin.WatchGuard/watchlists.json`** in the official container. This is distinct from the DLL installation directory. Back up the entire persistent `/config` while Jellyfin is stopped, including this file and plugin configuration XML. Preserve it during upgrades; playback completion never removes manual entries. Corrupt or unsupported storage returns an error instead of silently resetting lists.

When uninstalling, remove the DLL and also delete the persisted **`watchguard-v1`** entry from Injector's **Plugin Scripts**. Reload all Web tabs. Removing the DLL alone does not remove that registration or an adapter already loaded in a browser. Keep watchlists for rollback unless you deliberately intend to discard them. Detailed upgrade, uninstall and rollback steps are in [deployment.md](docs/deployment.md).

## Compatibility and limitations

| Area | v0.3.0 scope |
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

Unwrapped client instances, another plugin replacing the method, requests before injection, stale tabs and future Web changes can bypass warnings. There is a check-to-delete race. Mobile/TV layouts, other browsers, base-path/multi-server setups and alternate-version deletion semantics are not validated. There is no public plugin tab/router API: Watchlists is a version-specific injected navigation link using a namespaced Home query. Modern desktop places it beside Favorites/libraries; legacy desktop uses a header link. The page hides native Home content while open; labels are English. See [navigation decisions and limitations](docs/navigation.md). No Seerr, automation-service or playlist integration is included.

## Validation

v0.3.0: **45 backend tests and 37 JavaScript tests passed**, plus the complete disposable Docker backend/browser suite. Both layouts, parent-series scope, Cancel/override, failed checks, bulk deletion, account isolation and list controls passed. Release registration and persisted-script removal passed; the on-disk Web index remained identical to the pristine official image. See [final results](docs/deployment.md#automated-results).

The separate v0.2.4 ZIP and checksum remain in `artifacts/` for rollback. Both releases use the same watchlist JSON schema; stop Jellyfin, replace the DLL and reload every Web tab as described in the deployment guide.

Watchlist-add dates are not present in the unchanged JSON schema, so date-added sorting is unavailable rather than guessed.

Catalog validation: **3 Python tests passed**, plus real native installer checksum/clean-install/manual-upgrade checks and missing-Injector diagnostics.

Further references: [architecture](docs/architecture.md), [backend API/storage](docs/backend.md), [overview semantics](docs/interest-overview.md), [timings and inline UI](docs/performance.md), [navigation architecture](docs/navigation.md), [original Web integration](docs/web-ui.md), [compatibility hardening](docs/hardening.md), and the historical [deletion PoC](docs/deletion-poc.md).
