# v0.3.1 + Injector → v0.4.0 standalone

These are explicit migration/rollback instructions, not permission to operate production. v0.4.0 is currently a release candidate; the public v0.3.1 release and catalog entries are unchanged.

## Before migration

- Keep the published v0.3.1 ZIP and verify SHA-256 `c4ac915c3f35a28e6737bd68580f712cd0e0e113735a6d399c2a889c7ae7b2f2`. The candidate's migration fixture downloaded this published archive anonymously and verified the hash.
- Back up the entire stopped Jellyfin `/config` volume outside plugin discovery. In the LinuxServer layout, preserve `/config/data/plugins/Jellyfin.Plugin.WatchGuard/watchlists.json`, `preferences.json`, all recovery copies, `/config/data/plugins/configurations/Jellyfin.Plugin.WatchGuard.xml`, Injector configuration and native user/library database. Keep file ownership/permissions. Both JSON schemas remain 1; no conversion is required.
- Preserve the old binary and valid installation metadata independently: native upgrades may remove superseded installation folders. Do not rely on an old `WatchGuard_<version>` folder surviving.
- Use the qualified LinuxServer.io 12.2 image for a disposable trial. Production's image ID `sha256:fbd967af0187a569b0c18d2db6cb311fdf0df4aeb520102c63f19320aadf964d` identifies its local image, **not** a registry manifest. Do not use it as a registry pull digest.
- Check the browser at `https://jellyfin.dave-cave.com` after an authorized deployment. Observed absence of a CSP response header is encouraging but does not verify execution; HTML policy, browser policy/extensions and the actual delivered Web bundle can still matter. Do not weaken CSP to force loading.

## Explicit cleanup and normal catalog upgrade

1. Open Injector's Dashboard configuration → Plugin Scripts. Identify the entry with ID **`watchguard-v1`** (WatchGuard GUID `a3c6bc84-783d-4ba8-a0db-89bfb83ab486`). Delete **only that entry** and save. Keep unrelated scripts, Injector middleware settings and the installed Injector. Removing the entry creates a temporary gap in WatchGuard Web delivery, so close existing Web tabs and perform the upgrade in a maintenance window.
2. If Injector is absent/disabled but its XML persists, deliberately clean the retained entry before later re-enabling it. Restore Injector temporarily to use its UI, or while Jellyfin is stopped back up its XML and remove only the `PluginJavaScriptEntry` containing the matching WatchGuard ID/GUID. Never replace the entire XML with an empty example.
3. Once v0.4.0 is actually published, update through the normal WatchGuard catalog and restart Jellyfin. For the unpublished RC use only the disposable local-catalog test harness. No environment variables or experimental build flags are needed. Keep LinuxServer's normal s6/PUID/PGID startup, Compose volumes and Caddy configuration unchanged.
4. Do not copy an additional DLL into a manual folder alongside the catalog installation. If a manual copy exists, stop Jellyfin and retire only that old WatchGuard installation outside `/config/data/plugins` first. Preserve the separate `Jellyfin.Plugin.WatchGuard` data folder. Native catalog `meta.json` belongs to its matching installation/version; do not transplant obsolete metadata into v0.4.0.
5. Fully reload/close **every** Web tab. Confirm Dashboard → Plugins shows one active WatchGuard `0.4.0.0`, then use the settings integration checks in [deployment](deployment.md). Test both users' lists, preferences and activity; verify Cancel sends zero DELETE requests on disposable media and override sends exactly one.
6. Restart again and verify no `watchguard-v1` entry returns. v0.4.0 has no Injector registration service and cannot recreate the entry. Keep Injector if anything else uses it; WatchGuard never uninstalls or disables it.

## If cleanup was missed

A loaded Injector with any `watchguard-v1` entry, including a disabled one, blocks standalone HTML insertion and causes the standalone asset endpoints to return 409. An unrecognized loaded Injector configuration interface also blocks activation. The native settings page identifies discovery, interface compatibility and registration conflict separately. Backend watchlist/preferences APIs continue working.

The old Injector may continue serving its persisted WatchGuard script while standalone is blocked. This is **not** successful v0.4.0 browser activation. Inspect the configuration, remove only the WatchGuard entry, then restart and fully reload. WatchGuard never silently edits the old configuration, and does not activate both loaders on new page loads. Never manually paste a second copy of its script.

The guard inspects loaded Injector assemblies; it cannot inspect an absent plugin's private future configuration contract. An old tab can also retain previously delivered code. Reload requirements and persisted-XML cleanup therefore remain mandatory. Settings detect a mismatched bootstrap build ID or missing backend; they cannot remotely rewrite old JavaScript already in a tab. The unchanged deletion adapter blocks a failed protection lookup rather than returning fake success.

## Roll back to published v0.3.1

1. Stop the Compose Jellyfin service, close browser tabs and take a fresh backup.
2. Retire the v0.4.0 installation and duplicate WatchGuard assemblies outside discovery. Restore the published v0.3.1 assembly with its matching backed-up metadata, or use native catalog installation of v0.3.1 after the newer installation has been removed/restarted. Do not restore metadata advertising `0.4.0.0` around the old DLL.
3. Preserve current schema-1 watchlists, preferences and WatchGuard XML. Restore the whole stopped-server backup only if a broader server/database rollback requires it; that deliberately loses changes after the backup.
4. Ensure compatible Injector **4.0.0.0 jf12** is installed/enabled. The [published jf12 release](https://github.com/n00bcodr/Jellyfin-JavaScript-Injector/releases/tag/4.0.0.0) and [Jellyfin 12 catalog](https://raw.githubusercontent.com/n00bcodr/jellyfin-plugins/main/12/manifest.json) remain rollback dependencies, not v0.4.0 dependencies.
5. Restart. v0.3.1 upserts one enabled/authenticated `watchguard-v1` entry. Confirm other scripts remain, fully reload all clients and verify native registration, browser adapter and disposable Cancel/override. No Web file restoration is needed.

The automated migration test performs actual native catalog v0.3.1 → v0.4.0 → v0.3.1 → v0.4.0 transitions, rejects an incorrect MD5, checks byte-identical stores/XML, verifies the conflict without automatic Injector writes, preserves an unrelated sentinel script, and then runs the complete RC Web/deletion suite. Production was not accessed.
