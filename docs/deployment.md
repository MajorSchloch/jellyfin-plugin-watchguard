# WatchGuard v0.3.1 deployment testing

Native-style Watchlists and detail toolbar UI, packaged for **Jellyfin Server/Web 12.2, .NET 10**. Deletion semantics, permission policies, Injector registration ID and schema-1 membership data remain compatible with v0.2.0. These instructions use a separate Docker Compose test stack and disposable media; do not point them at production configuration or media. Nothing has been published to GitHub.

## Native catalog installation and upgrades

v0.3.0 is published and installed through the catalog. v0.3.1 remains local/unpublished until explicit release authorization. `manifest.json` retains the verified public v0.3.0 metadata and download URL; release preparation never advertises a future asset.

Add `https://raw.githubusercontent.com/MajorSchloch/jellyfin-plugin-watchguard/master/manifest.json` in Dashboard → Plugins → Repositories. Separately add Injector's `https://raw.githubusercontent.com/n00bcodr/jellyfin-plugins/main/12/manifest.json`, install its **4.0.0.0 jf12** release, then install WatchGuard and restart. Confirm dependency middleware is enabled. Normal catalog updates use Jellyfin's installer and restart workflow: **do not manually copy DLLs or delete installer-owned meta.json**. Jellyfin may retain older version directories as superseded; this is different from duplicate manually installed assemblies. Keep manual copies out of discovery using the one-time [migration guide](manual-to-catalog.md).

Open Dashboard → Plugins → WatchGuard for [settings and integration diagnostics](settings.md). Verify one current enabled/authenticated `watchguard-v1`, then fully reload Web clients and run the browser check. Existing settings XML, plugin GUID and script ID are preserved. Never infer browser execution from registration alone.

Back up the whole persistent `/config` with Jellyfin stopped, including `watchlists.json`, new `preferences.json` and plugin XML. Both JSON files are under `BasePlugin.DataFolderPath`: `/config/data/plugins/Jellyfin.Plugin.WatchGuard/` in the supplied LinuxServer.io layout, `/config/plugins/Jellyfin.Plugin.WatchGuard/` in the official fixture. Restore corrupt preferences from backup; failed reads never reset data.

### v0.3.1 rollback to v0.3.0

Retain the published v0.3.0 ZIP and SHA-256 `4ce9f89924391e9842ba444b7dd0d2fcf509a23845497b45f601c2f3c18339a6`. Downgrades are deliberate: stop Jellyfin, back up configuration, retire the newer WatchGuard installation directory outside plugin discovery, and restore the known-good v0.3.0 assembly/metadata (or regenerate only that installation's metadata). Preserve the separate data directory and configuration XML. Restart and fully reload clients; confirm one loaded version and one `watchguard-v1` at 0.3.0. v0.3.0 ignores `preferences.json`; keep it for later re-upgrade. Never roll back playback/media or change watchlist schema. See historical rollback instructions below only for older releases.

The rest of this guide retains manual local-test installation instructions. They are not required for an ordinary catalog update.

## Catalog status and LinuxServer.io

The repository and v0.3.0 release are public. Use the verified catalog URL above; the manifest retains v0.3.0 while v0.3.1 is under preparation. This task does not publish a release.

For the supplied production LinuxServer.io layout, plugins/data live under `/config/data/plugins`, not the official-image paths below. Follow [manual-to-catalog migration](manual-to-catalog.md), preserving the existing data directory, configuration and Injector. Do not apply these test Compose paths to production.

## Release contents and reproducibility

`artifacts/Jellyfin.Plugin.WatchGuard-v0.3.1.zip` contains:

```text
Jellyfin.Plugin.WatchGuard.dll   # only runtime file; Web script is embedded
LICENSE                        # repository's GPLv3 license text
```

No Jellyfin/runtime libraries, test DLLs, PDB, deps.json, loose script, external service, user data or secret is shipped. JavaScript Injector is installed separately. The official Jellyfin process supplies the shared framework and Jellyfin assemblies. Manual DLL installation does not need a plugin catalog or manifest. Jellyfin assembly/file version is `0.3.1.0`; product and Injector registration version is `0.3.1`.

Use the unchanged source checkout and NuGet lock files, SDK **10.0.302**, and Python 3.10+:

```sh
python3 scripts/build-release.py
(cd artifacts && shasum -a 256 -c Jellyfin.Plugin.WatchGuard-v0.3.1.zip.sha256)
```

Linux may use `sha256sum -c` instead of `shasum -a 256 -c`. The script checks the SDK, restores in locked mode, forces a new Release compilation, maps source paths, omits debug symbols, publishes to a temporary directory and packages an explicit allowlist. ZIP entries have fixed timestamps, modes, ordering and no compression variability. Tests consume a DLL extracted from that ZIP at `artifacts/WatchGuard/`. Two forced rebuilds produced byte-identical archives on the validation machine; cross-platform byte identity is not separately claimed. Keep the matching source checkout and lock files with your build record.

SHA-256:

```text
c4ac915c3f35a28e6737bd68580f712cd0e0e113735a6d399c2a889c7ae7b2f2
```

## JavaScript Injector dependency

The published **4.0.0.0 jf12** artifact (`Jellyfin.Plugin.JavaScriptInjector_12.0.0.zip`) is also validated against 12.2; its [actual release and catalog](plugin-repository.md#javascript-injector-dependency) are documented separately. The source build below remains reproducible. Injector is always installed separately.

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
unzip /absolute/path/to/artifacts/Jellyfin.Plugin.WatchGuard-v0.3.1.zip -d /tmp/watchguard-v0.3.1
```

From the new test directory, with the service stopped:

```sh
docker compose stop jellyfin
cp /tmp/watchguard-v0.3.1/Jellyfin.Plugin.WatchGuard.dll config/plugins/WatchGuard/
cp /absolute/path/to/Jellyfin.Plugin.JavaScriptInjector.dll config/plugins/JavaScriptInjector/
docker compose up -d jellyfin
```

On first installation there may be no service to stop. Retain the extracted license with the distribution. Copy only the two specified DLLs, each to its own plugin directory. Complete Jellyfin setup at `http://localhost:8097`, create an administrator and a second test user, and scan **disposable copies/generated media** under `/media`. Nothing should mount a production media/configuration path. Keep `/config` persistent; `/cache` is not the membership store.

## Verify registration and operation

Check all layers; a server log alone does not prove that a browser instance is wrapped.

1. **Loaded plugins:** Dashboard → Plugins lists WatchGuard version `0.3.1.0` (some UI formatting may show `0.3.1`) and the jf12 Injector without load errors. There should be one loaded WatchGuard version, with no duplicate manual assemblies.
2. **Registration log:** run `docker compose logs jellyfin` and look for the exact line **`WatchGuard web script registered with JavaScript Injector.`** Registration retries for about one minute if startup ordering delays Injector. The warning **`WatchGuard web script was not registered. No deletion confirmation is active...`** means registration failed; do not treat the Web warning as installed.
3. **Persisted Injector configuration:** Dashboard → Plugins → JavaScript Injector → **Plugin Scripts** must contain one enabled **WatchGuard** entry from WatchGuard, version **0.3.1**, requiring authentication. The stable ID is **`watchguard-v1`** and plugin ID is **`a3c6bc84-783d-4ba8-a0db-89bfb83ab486`**. Verify middleware is not disabled. If the UI does not expose those fields, this read-only console command in a signed-in admin tab prints only relevant metadata:

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
5. **Functional fixture:** add a disposable movie to the second user's watchlist. As admin, verify that user's interest indicator; start native deletion and cancel WatchGuard. The item must survive and no `/Items/...` DELETE should be sent. The generic Jellyfin error afterward is expected. Separately test Delete Anyway on a disposable copy; it should send one native DELETE. Verify own-only/zero-interest behavior, episode/season scope, Watchlists filters and toolbar placement as required by the checklist below.

`DiagnosticMode` defaults to **false** in a fresh installation; no configuration file is packaged. Upgrades preserve saved XML, so explicitly set `<DiagnosticMode>false</DiagnosticMode>` in `config/plugins/configurations/Jellyfin.Plugin.WatchGuard.xml` while stopped if an old PoC enabled it. To diagnose only the current tab, use `window.WatchGuardPoc.setDiagnostics(true)`, then `false` when finished; this does not persist. Browser logs contain fixed event names and operation counters, not IDs/names/tokens. Server diagnostic mode also logs fixed overview stage names and elapsed milliseconds; these timings contain no identifiers. It remains disabled by default. The historical object/prefix and script ID remain to avoid breaking existing integrations; they are not a separate obsolete adapter.

## Data and backup

| Purpose | Container path | Host path in this Compose example |
| --- | --- | --- |
| WatchGuard DLL | `/config/plugins/WatchGuard/Jellyfin.Plugin.WatchGuard.dll` | `config/plugins/WatchGuard/...` |
| Membership data | `/config/plugins/Jellyfin.Plugin.WatchGuard/watchlists.json` | `config/plugins/Jellyfin.Plugin.WatchGuard/watchlists.json` |
| WatchGuard settings | `/config/plugins/configurations/Jellyfin.Plugin.WatchGuard.xml` | `config/plugins/configurations/...` |
| Injector settings and persisted scripts | `/config/plugins/configurations/Jellyfin.Plugin.JavaScriptInjector.xml` | `config/plugins/configurations/...` |

The data directory comes from native `Plugin.DataFolderPath`, not the DLL installation folder. The JSON is created on the first effective write and stores schema version 1 and user/item GUID pairs. It contains private membership data; protect backups accordingly.

Stop Jellyfin and back up the entire `config` directory to a location **outside** `config/plugins` before install/upgrade/removal. Keep the old binaries, settings, checksum and source/build record. Whole-configuration backup preserves the native user/library IDs that the JSON references. A watchlist file alone is not a portable migration to an unrelated server. Do not delete the file to clear corruption errors: preserve the damaged copy, restore a known-good file while stopped and verify list/protection responses. Missing JSON is treated as a fresh empty store. The plugin does not create automatic backups.

## Manual local-test upgrade only

For an existing catalog installation, use the native update procedure above; skip these DLL operations. The steps below apply only to manual/development fixtures.

1. Close old Web tabs. Stop the Compose service and take the backup above.
2. Check for duplicate `Jellyfin.Plugin.WatchGuard.dll` files under `config/plugins`. Retire old DLLs/version folders outside the plugin discovery tree; do not delete `Jellyfin.Plugin.WatchGuard/watchlists.json`. Old development builds advertised `1.1.0.0`, so this `0.3.1.0` release requires deliberate manual replacement rather than relying on catalog version ordering.
3. Replace the DLL in `config/plugins/WatchGuard/`. Preserve WatchGuard and Injector configuration, including other plugins' scripts. For an old generated `meta.json` in this manual installation directory, back it up and remove it while stopped so Jellyfin can regenerate metadata from the new assembly. Do not remove metadata for unrelated plugins.
4. Ensure the tested jf12 Injector is installed, middleware remains enabled and diagnostics are off unless deliberately needed. v0.3.1 uses the existing version-1 JSON schema; no migration is needed.
5. Start the stack. WatchGuard re-registers the same `watchguard-v1` ID with its current embedded script/version. Verify a single enabled entry and all registration/functional checks. Remove any separately pasted obsolete custom WatchGuard script. Fully reload every client tab so it cannot retain the previous in-memory wrapper.

## Uninstall and persisted registration cleanup

For catalog-managed WatchGuard, use Dashboard → Plugins → WatchGuard → Uninstall and restart, then remove the persisted Injector registration as described below. Preserve both JSON files if rollback is wanted. Manual DLL removal is only for manual installations.

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
- [ ] One enabled/authenticated `watchguard-v1` registration at version 0.3.1; browser delivery/`isInstalled()` verified.
- [ ] Add/remove, reload persistence and Watchlists navigation/filtering work separately for two accounts.
- [ ] Status defaults hide completed-only titles; explicit completed memberships remain visible. Check checkbox OR/same-user matching, Reset to Defaults, back/forward and reload.
- [ ] Normal users see only their own data; inline administrator names/reasons work on movies, series, seasons and episodes.
- [ ] Explicit cards appear before automatic discovery finishes; filters/sort work during loading without repeating discovery. Failed automatic lookup keeps explicit cards with an incomplete-results error.
- [ ] Narrow detail headers remain readable, with the native action row intact; long lists scroll within three lines.
- [ ] Disposable movie/series and episode/season tests confirm Cancel sends zero DELETE and override sends one; failed parent/status checks block.
- [ ] Zero/self-only interest and per-item bulk semantics understood; cancellation's generic error accepted.
- [ ] Recheck after restart and in both supported desktop layout settings; close stale tabs.
- [ ] Rollback and persisted-script cleanup steps understood; no claim of native/API/filesystem protection.

## Rollback

Use the v0.3.0 rollback procedure above. Retain its published ZIP/checksum, preserve both JSON files and plugin XML, and fully reload clients after restoring the older plugin. Older release archives remain available for historical recovery, but v0.3.0 is the tested rollback target for this release.

Stop the test stack and close tabs. Preserve the failed deployment's configuration/data separately for diagnosis. Restore the previous known-good WatchGuard DLL and its installation metadata from backup, keeping only one discoverable version. Restore its compatible settings and Injector build/configuration if changed. Keep the current version-1 membership file when the prior build supports it; otherwise restore the stopped-server configuration backup as a unit and accept loss of changes since that backup. Never convert an unreadable store to an empty file as a rollback shortcut.

Start and fully reload Web. Re-run the registration checks: an older binary should re-register its own script at the same ID. If the rollback removes WatchGuard entirely, perform persisted-script cleanup rather than leaving the v0.3.1 script behind. If Jellyfin cannot start, stop it, remove just the newly installed plugin binaries and restore the known-good configuration before trying again. No Web files need modification. A backup of configuration does not restore media deliberately deleted during tests; recreate the disposable fixtures if needed.

## Automated results

v0.3.1 validation results are recorded in `artifacts/release-validation-v0.3.1.json`, `artifacts/settings-validation.json`, `artifacts/catalog-validation.json` and `artifacts/poc/report.json`. Backend and JavaScript totals: **53** and **41**; catalog unit checks: **3**. The disposable suites exercise native settings persistence/authorization, saved-default precedence/reset, catalog upgrade/rollback with preserved files, missing Injector, context actions, account changes and all existing deletion regressions. Final packaged runs passed: 13 media DELETE requests, 0 ordering violations, one current script registration, and unchanged Web index. Live diagnostic changes re-registered without restart. Catalog rollback/re-upgrade preserved both JSON files and XML. No production configuration/media is mounted and no release is published by these tests.

## Activity settings

Use the native [settings page](settings.md). Defaults remain 30 days, 100 candidates and diagnostics off; ranges remain 1–90 and 1–100. Saving applies activity settings immediately and refreshes script registration for diagnostic changes; fully reload browsers. No XML editing or restart is needed for these changes. [Personal defaults](user-preferences.md) use a separate own-user API and JSON file. Neither changes fresh deletion protection.
