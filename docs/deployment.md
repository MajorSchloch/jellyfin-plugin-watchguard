# WatchGuard v0.1.0 deployment testing

Approved Phase 4 behavior, packaged for **Jellyfin Server/Web 12.2, .NET 10**. No deletion semantics or permission policies changed during release preparation. These instructions use a separate Docker Compose test stack and disposable media; do not point them at production configuration or media. Nothing has been published to GitHub.

## Release contents and reproducibility

`artifacts/Jellyfin.Plugin.WatchGuard-v0.1.0.zip` contains:

```text
Jellyfin.Plugin.WatchGuard.dll   # only runtime file; Web script is embedded
LICENSE                        # repository's GPLv3 license text
```

No Jellyfin/runtime libraries, test DLLs, PDB, deps.json, loose script, external service, user data or secret is shipped. JavaScript Injector is installed separately. The official Jellyfin process supplies the shared framework and Jellyfin assemblies. Manual DLL installation does not need a plugin catalog or manifest. Jellyfin assembly/file version is `0.1.0.0`; product and Injector registration version is `0.1.0`.

Use the unchanged source checkout and NuGet lock files, SDK **10.0.302**, and Python 3.10+:

```sh
python3 scripts/build-release.py
(cd artifacts && shasum -a 256 -c Jellyfin.Plugin.WatchGuard-v0.1.0.zip.sha256)
```

Linux may use `sha256sum -c` instead of `shasum -a 256 -c`. The script checks the SDK, restores in locked mode, forces a new Release compilation, maps source paths, omits debug symbols, publishes to a temporary directory and packages an explicit allowlist. ZIP entries have fixed timestamps, modes, ordering and no compression variability. Tests consume a DLL extracted from that ZIP at `artifacts/WatchGuard/`. Two forced rebuilds produced byte-identical archives on the validation machine; cross-platform byte identity is not separately claimed. Keep the matching source checkout and lock files with your build record.

SHA-256:

```text
0d153a649264d5839e9d44021fc8bd398f1966e944f5715ef362dc95a7109f21
```

## JavaScript Injector dependency

The validated dependency is [JavaScript Injector source revision `2758804c987d490ef32fc2fbdb8a73a44facdf2c`](https://github.com/n00bcodr/Jellyfin-JavaScript-Injector/tree/2758804c987d490ef32fc2fbdb8a73a44facdf2c), reporting assembly version 4.0.0.0, built for Jellyfin 12.2/.NET 10. Do not substitute a jf10/.NET 9 DLL. A reproducible source selection/build command is:

```sh
git clone https://github.com/n00bcodr/Jellyfin-JavaScript-Injector.git injector-source
git -C injector-source checkout --detach 2758804c987d490ef32fc2fbdb8a73a44facdf2c
dotnet build injector-source/Jellyfin.Plugin.JavaScriptInjector/Jellyfin.Plugin.JavaScriptInjector.csproj \
  -c Release -p:JellyfinTarget=jf12 -p:JellyfinVersion=12.2.0
```

Copy only `injector-source/Jellyfin.Plugin.JavaScriptInjector/bin/Release/net10.0/Jellyfin.Plugin.JavaScriptInjector.dll`. Its embedded resources are already inside that DLL; the tested official image supplies its shared dependencies. Injector is not bundled into WatchGuard's ZIP. The upstream dependency does not have WatchGuard's locked-build guarantee; the pinned source/build above is the combination tested here.

**Keep `DisableScriptInjectionMiddleware=false`**, the default at this revision. Its request-time middleware adds the loader to the HTTP response, without modifying Web files on disk. Do not enable legacy rewrite mode or install File Transformation for this deployment. If reusing test configuration where the flag is true, stop Jellyfin and set that element to false in `plugins/configurations/Jellyfin.Plugin.JavaScriptInjector.xml`, preserving other settings. For containers previously altered by old Injector builds, recreate from the pristine official image with the backed-up configuration and no Web-directory bind mount instead of manually editing Web files.

## Docker Compose installation

Create a **new test directory** such as `watchguard-test`, separate from any existing Compose project. Save the following as its `compose.yaml`:

```yaml
name: watchguard-test
services:
  jellyfin:
    image: jellyfin/jellyfin:12.2@sha256:357724bf0ae27a672c7cbaa899db2d9abeb13dbd8657ccce750258a4c059d037
    user: "${JF_UID:-1000}:${JF_GID:-1000}"
    ports:
      - "127.0.0.1:8097:8096"
    volumes:
      - ./config:/config
      - ./cache:/cache
      - ./media:/media
```

Create `config/plugins/WatchGuard`, `config/plugins/JavaScriptInjector`, `cache` and `media` inside that directory. Set `JF_UID`/`JF_GID` in a local `.env` to a user/group that owns those directories (for example, the values from `id -u` and `id -g` on Linux). Do not use recursive world-writable permissions. This image needs neither a custom Dockerfile nor writable Web mounts.

Verify/extract the release into a staging directory on the host:

```sh
unzip /absolute/path/to/artifacts/Jellyfin.Plugin.WatchGuard-v0.1.0.zip -d /tmp/watchguard-v0.1.0
```

From the new test directory, with the service stopped:

```sh
docker compose stop jellyfin
cp /tmp/watchguard-v0.1.0/Jellyfin.Plugin.WatchGuard.dll config/plugins/WatchGuard/
cp /absolute/path/to/Jellyfin.Plugin.JavaScriptInjector.dll config/plugins/JavaScriptInjector/
docker compose up -d jellyfin
```

On first installation there may be no service to stop. Retain the extracted license with the distribution. Copy only the two specified DLLs, each to its own plugin directory. Complete Jellyfin setup at `http://localhost:8097`, create an administrator and a second test user, and scan **disposable copies/generated media** under `/media`. Nothing should mount a production media/configuration path. Keep `/config` persistent; `/cache` is not the membership store.

## Verify registration and operation

Check all layers; a server log alone does not prove that a browser instance is wrapped.

1. **Loaded plugins:** Dashboard → Plugins lists WatchGuard version `0.1.0.0` (some UI formatting may show `0.1.0`) and the jf12 Injector without load errors. There should be only one installed WatchGuard DLL/version.
2. **Registration log:** run `docker compose logs jellyfin` and look for the exact line **`WatchGuard web script registered with JavaScript Injector.`** Registration retries for about one minute if startup ordering delays Injector. The warning **`WatchGuard web script was not registered. No deletion confirmation is active...`** means registration failed; do not treat the Web warning as installed.
3. **Persisted Injector configuration:** Dashboard → Plugins → JavaScript Injector → **Plugin Scripts** must contain one enabled **WatchGuard** entry from WatchGuard, version **0.1.0**, requiring authentication. The stable ID is **`watchguard-v1`** and plugin ID is **`a3c6bc84-783d-4ba8-a0db-89bfb83ab486`**. Verify middleware is not disabled. If the UI does not expose those fields, this read-only console command in a signed-in admin tab prints only relevant metadata:

   ```js
   ApiClient.ajax({
     url: ApiClient.getUrl('Plugins/f5a34f7b-2e8a-4e6a-a722-3a216a81b374/Configuration'),
     type: 'GET', dataType: 'json'
   }).then(c => {
     console.log('Middleware disabled:', c.DisableScriptInjectionMiddleware);
     console.table(c.PluginJavaScripts.filter(s => s.Id === 'watchguard-v1').map(s => ({
       id: s.Id, pluginId: s.PluginId, version: s.PluginVersion,
       enabled: s.Enabled, authenticated: s.RequiresAuthentication
     })));
   });
   ```

   Expected: middleware disabled **false**; exactly one row with the IDs/version above and both flags **true**. Do not print tokens or the full script/configuration object.
4. **Delivery and execution:** fully reload a signed-in Web tab. In browser Network tools, `/JavaScriptInjector/private.js` should return 200 and its response contain the WatchGuard script. Do not share request authentication headers. Run `window.WatchGuardPoc?.isInstalled()`; it must return **true**. This checks only the current global ApiClient, not every possible client instance. If absent/false, do not rely on warnings. Inspect console/network errors, stale tabs, Injector state and server logs before proceeding.
5. **Functional fixture:** add a disposable movie to the second user's watchlist. As admin, verify that user's interest indicator; start native deletion and cancel WatchGuard. The item must survive and no `/Items/...` DELETE should be sent. The generic Jellyfin error afterward is expected. Separately test Delete Anyway on a disposable copy; it should send one native DELETE. Verify own-only/zero-interest behavior, episode/season scope and My Watchlist as required by the checklist below.

`DiagnosticMode` defaults to **false** in a fresh installation; no configuration file is packaged. Upgrades preserve saved XML, so explicitly set `<DiagnosticMode>false</DiagnosticMode>` in `config/plugins/configurations/Jellyfin.Plugin.WatchGuard.xml` while stopped if an old PoC enabled it. To diagnose only the current tab, use `window.WatchGuardPoc.setDiagnostics(true)`, then `false` when finished; this does not persist. Logs contain fixed event names and operation counters, not IDs/names/tokens. The historical object/prefix and script ID remain to avoid breaking existing integrations; they are not a separate obsolete adapter.

## Data and backup

| Purpose | Container path | Host path in this Compose example |
| --- | --- | --- |
| WatchGuard DLL | `/config/plugins/WatchGuard/Jellyfin.Plugin.WatchGuard.dll` | `config/plugins/WatchGuard/...` |
| Membership data | `/config/plugins/Jellyfin.Plugin.WatchGuard/watchlists.json` | `config/plugins/Jellyfin.Plugin.WatchGuard/watchlists.json` |
| WatchGuard settings | `/config/plugins/configurations/Jellyfin.Plugin.WatchGuard.xml` | `config/plugins/configurations/...` |
| Injector settings and persisted scripts | `/config/plugins/configurations/Jellyfin.Plugin.JavaScriptInjector.xml` | `config/plugins/configurations/...` |

The data directory comes from native `Plugin.DataFolderPath`, not the DLL installation folder. The JSON is created on the first effective write and stores schema version 1 and user/item GUID pairs. It contains private membership data; protect backups accordingly.

Stop Jellyfin and back up the entire `config` directory to a location **outside** `config/plugins` before install/upgrade/removal. Keep the old binaries, settings, checksum and source/build record. Whole-configuration backup preserves the native user/library IDs that the JSON references. A watchlist file alone is not a portable migration to an unrelated server. Do not delete the file to clear corruption errors: preserve the damaged copy, restore a known-good file while stopped and verify list/protection responses. Missing JSON is treated as a fresh empty store. The plugin does not create automatic backups.

## Upgrade

1. Close old Web tabs. Stop the Compose service and take the backup above.
2. Check for duplicate `Jellyfin.Plugin.WatchGuard.dll` files under `config/plugins`. Retire old DLLs/version folders outside the plugin discovery tree; do not delete `Jellyfin.Plugin.WatchGuard/watchlists.json`. Old development builds advertised `1.1.0.0`, so this `0.1.0.0` release requires deliberate manual replacement rather than relying on catalog version ordering.
3. Replace the DLL in `config/plugins/WatchGuard/`. Preserve WatchGuard and Injector configuration, including other plugins' scripts. For an old generated `meta.json` in this manual installation directory, back it up and remove it while stopped so Jellyfin can regenerate metadata from the new assembly. Do not remove metadata for unrelated plugins.
4. Ensure the tested jf12 Injector is installed, middleware remains enabled and diagnostics are off unless deliberately needed. v0.1.0 uses the existing version-1 JSON schema; no migration is needed.
5. Start the stack. WatchGuard re-registers the same `watchguard-v1` ID with its current embedded script/version. Verify a single enabled entry and all registration/functional checks. Remove any separately pasted obsolete custom WatchGuard script. Fully reload every client tab so it cannot retain the previous in-memory wrapper.

## Uninstall and persisted registration cleanup

Removing a DLL does **not** automatically remove its persisted Injector script. No automatic unregister-on-shutdown feature was added, because normal restarts should keep the registration.

1. Close WatchGuard Web tabs; stop Jellyfin and back up `config`.
2. Remove WatchGuard's DLL/manual installation folder and any duplicate WatchGuard binary from plugin discovery. Keep its data folder and XML if rollback is desired. Do not remove the separate Injector if other plugins use it.
3. Start Jellyfin with Injector still installed. In its **Plugin Scripts** section, delete the **WatchGuard** entry whose ID is `watchguard-v1` and plugin ID matches the ID above; confirm the removal. This persists through the native plugin-configuration API. Also remove any old manually pasted custom WatchGuard script. Do not erase other registered/custom scripts. The unloaded WatchGuard plugin can no longer register itself on restart.
4. Verify the read-only configuration query above returns zero matching rows and authenticated `private.js` no longer includes WatchGuard. Close/reload every Web tab; `typeof window.WatchGuardPoc` should be `"undefined"` and detail controls should be absent. WatchGuard API routes should return 404. Already loaded tabs retain their wrapper until reloaded, even after registration removal.
5. Optionally remove WatchGuard settings/data **only after explicitly deciding to discard memberships**. They need not be removed to uninstall the runtime.

Offline alternative: with Jellyfin stopped, back up Injector's XML and remove only the `PluginJavaScriptEntry` element containing both `<Id>watchguard-v1</Id>` and the WatchGuard `<PluginId>` above. Leave all other entries and middleware settings intact; start and verify absence. Do not replace the whole Injector configuration with an empty example.

If Injector itself is no longer needed, remove its DLL after removing all registrations that depend on it, stop/start and reload tabs. In the tested middleware mode there is no Web file edit to undo. Recreate a previously modified legacy container from the pristine official image rather than manually repairing `index.html`.

## Deployment checklist

- [ ] Separate Compose project, loopback port and disposable media/config paths confirmed.
- [ ] Official pinned Jellyfin 12.2 image and matching bundled Web; tested jf12 Injector built/obtained.
- [ ] ZIP SHA-256 verified; only the WatchGuard DLL installed, no duplicate versions or dependency DLLs.
- [ ] Stopped-server `/config` backup, old binary/checksum and restore location recorded.
- [ ] Injector middleware enabled; no Web-folder edits, Web bind mount or File Transformation dependency.
- [ ] Diagnostics off; both plugins loaded; exact success log present.
- [ ] One enabled/authenticated `watchguard-v1` registration at version 0.1.0; browser delivery/`isInstalled()` verified.
- [ ] Add/remove, reload persistence and My Watchlist work separately for two accounts.
- [ ] Normal users see only their own data; admin interest names/reasons work.
- [ ] Disposable movie/series and episode/season tests confirm Cancel sends zero DELETE and override sends one; failed parent/status checks block.
- [ ] Zero/self-only interest and per-item bulk semantics understood; cancellation's generic error accepted.
- [ ] Recheck after restart and in both supported desktop layout settings; close stale tabs.
- [ ] Rollback and persisted-script cleanup steps understood; no claim of native/API/filesystem protection.

## Rollback

Stop the test stack and close tabs. Preserve the failed deployment's configuration/data separately for diagnosis. Restore the previous known-good WatchGuard DLL and its installation metadata from backup, keeping only one discoverable version. Restore its compatible settings and Injector build/configuration if changed. Keep the current version-1 membership file when the prior build supports it; otherwise restore the stopped-server configuration backup as a unit and accept loss of changes since that backup. Never convert an unreadable store to an empty file as a rollback shortcut.

Start and fully reload Web. Re-run the registration checks: an older binary should re-register its own script at the same ID. If the rollback removes WatchGuard entirely, perform persisted-script cleanup rather than leaving the v0.1.0 script behind. If Jellyfin cannot start, stop it, remove just the newly installed plugin binaries and restore the known-good configuration before trying again. No Web files need modification. A backup of configuration does not restore media deliberately deleted during tests; recreate the disposable fixtures if needed.

## Automated results

Validated on 2026-10-10 against the packaged DLL:

- Release build: 0 warnings/errors; two forced compilations produced identical ZIP SHA-256 values.
- Backend: **26/26 passed**, including all prior 25 tests plus version, embedded-script and diagnostics-off checks.
- JavaScript: **23/23 passed**; deletion adapter behavior was not changed during release preparation.
- Live Docker: existing backend HTTP suite passed; full browser suite passed in explicit modern/legacy layouts, including list/account lifecycle, parents, clear/self-only interest, failures, permissions and bulk cancellation/override.
- Browser totals: **26 intercepted operations, 10 cancellations, three blocked checks, four clear decisions, nine overrides, 13 media DELETE requests, zero diagnostic ordering violations**.
- Deployment assertions: exact v0.1.0 registration name/version/enabled/authenticated flags and success log verified; middleware enabled; removal of the persisted registration stopped WatchGuard delivery. On-disk `index.html` SHA-256 after install/use/registration cleanup matched the pristine official image.

The disposable fixture enables diagnostic mode only for event ordering assertions and cleans up its container/config/media. No production configuration or media was accessed, and no GitHub release was published. These tests establish the documented Web-only scope, not universal deletion prevention. Remaining compatibility/UX limitations are summarized in [README](../README.md#compatibility-and-limitations) and [hardening.md](hardening.md).
