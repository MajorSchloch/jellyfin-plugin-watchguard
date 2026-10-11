# Manual v0.2.4 to catalog v0.3.0 — LinuxServer.io

**Planning instructions only. No production files or server settings were changed.** Production is Jellyfin 12.2 in LinuxServer.io Docker, with plugins at `/config/data/plugins`, manual WatchGuard v0.2.4 and existing JavaScript Injector. Do not copy the official-image `/config/plugins` paths blindly.

## Prerequisites and path inventory

The public catalog is not yet available: the source repository is private with no releases. Complete and verify the separately authorized publication described in [plugin-repository.md](plugin-repository.md) before attempting catalog migration. Keep the validated v0.2.4 ZIP/SHA-256 offline for rollback.

[LinuxServer.io documentation](https://docs.linuxserver.io/images/docker-jellyfin/) specifies persistent `/config` and PUID/PGID ownership. Jellyfin's [BasePluginOfT](https://github.com/jellyfin/jellyfin/blob/ca0f16eb7c195f720a1493ed469a27c4657db0c6/MediaBrowser.Common/Plugins/BasePluginOfT.cs) derives the plugin data directory from `ApplicationPaths.PluginsPath` and the **assembly filename**, not the versioned install folder. Keep the existing assembly name and GUID.

For the supplied layout, expected paths are:

| Purpose | Container path |
| --- | --- |
| Discovery root | `/config/data/plugins` |
| Membership store | `/config/data/plugins/Jellyfin.Plugin.WatchGuard/watchlists.json` |
| Settings | `/config/data/plugins/configurations/Jellyfin.Plugin.WatchGuard.xml` |
| Injector settings/scripts | `/config/data/plugins/configurations/Jellyfin.Plugin.JavaScriptInjector.xml` |
| Catalog binary after installation | `/config/data/plugins/WatchGuard_0.3.0.0/Jellyfin.Plugin.WatchGuard.dll` |

Inspect the actual volume mapping, server paths/logs, matching DLLs, `meta.json` files and every existing `watchlists.json` before moving anything. The store may not exist for a genuinely unused installation. If an established watchlist appears missing or multiple candidate files exist, stop and resolve the real data location; do not create an empty replacement. Backups must preserve native Jellyfin user/item IDs as well as plugin files.

## Migration sequence

1. Schedule an upgrade window and close all Web clients. Record the current plugin/Injector versions, GUID, own-list contents, data-file hash and registration ID. Disable only WatchGuard's `watchguard-v1` entry in Injector's Plugin Scripts before retiring the binary, so an old script is not served during the plugin-free interval. Keep other registrations and middleware settings unchanged.
2. Stop Jellyfin (`docker compose stop jellyfin`, using the actual service name). Back up the **entire persistent `/config` volume** while stopped to a location outside plugin discovery. Retain the manual DLL, its `meta.json`, both plugin XMLs, membership file, old ZIP/checksum and ownership/modes.
3. Retire **all old WatchGuard assemblies and their installation `meta.json`** outside `/config/data/plugins`. Do not merely overwrite a DLL under an old catalog/version folder: stale metadata, including prototype `1.1.0.0`, can influence selection. Move an entire manual installation folder only if it contains no membership data or unrelated files. If the DLL shares the data directory, move just its DLL and installation metadata; preserve `watchlists.json` in place. Do not retire Injector, its metadata, configuration directories or the assembly-named WatchGuard data directory.
4. Start Jellyfin. WatchGuard is temporarily absent; do not perform media deletion during the migration window. Add the **verified public manifest URL**, refresh Catalog and install WatchGuard v0.3.0. Its GUID must be `a3c6bc84-783d-4ba8-a0db-89bfb83ab486`. The native installer creates `WatchGuard_0.3.0.0` with a fresh `meta.json`; keep that new metadata.
5. Restart Jellyfin. Verify exactly one active WatchGuard version, no duplicate manual assembly, the expected membership file/hash and unchanged settings. Native catalog-managed older versions can be marked Superseded; retire obsolete manual/prototype binaries instead of relying on that policy to fix duplicate manual installations.
6. Confirm the success log and exactly one enabled/authenticated Injector registration `watchguard-v1` at `0.3.0`. Startup upserts the existing ID and enables the new script; it must not add another entry. Fully reload every Web client (close stale tabs), verify `WatchGuardPoc.isInstalled()`, personal lists, normal-user privacy and admin indicators. Perform Cancel/override tests only on disposable media. A loaded plugin without working injection does not provide Web warnings.

No schema migration, rename, metadata-tag rewrite or playback conversion is needed. Membership data and configuration stay in their existing locations. Never copy a test fixture's watchlists or Injector configuration over production. Keep LinuxServer's existing PUID/PGID and volume ownership.

## Rollback to v0.2.4

Stop Jellyfin and close clients. Back up the current state; retire the v0.3.0 installation folder and its metadata outside discovery. Restore the verified v0.2.4 DLL to a single manual installation folder. Do not retain a higher-version `meta.json` beside it: restore matching v0.2.4 metadata or let Jellyfin regenerate metadata from the assembly. Keep the current schema-1 membership file and native Jellyfin database IDs; no reverse data migration is required. Restore the prior compatible Injector/configuration only if those were changed.

Start Jellyfin; the older plugin re-registers its own embedded script at the same ID. Verify exactly one registration at `0.2.4`, fully reload all clients, and repeat functional checks on disposable media. New v0.3.0 scoped endpoints are absent after rollback, so stale v0.3.0 tabs must not be kept open. Rollback does not restore media deliberately deleted during testing.

For complete removal, remove the WatchGuard binary **and** its persisted Injector registration, then reload clients. Preserve data for later reinstall unless intentionally discarding memberships. No Jellyfin Web file modification is needed.

## Evidence and limits

The disposable native-installer test loads the actual v0.2.4 DLL, lets Jellyfin generate old installation metadata, retires that installation, installs v0.3.0 through the catalog API and restarts. It verifies byte-identical JSON/XML, exact package bytes, unique discovery and registration. It also tests a clean catalog install and missing Injector. The harness uses the official image and temporary paths; no claim is made that the production LinuxServer container was accessed or migrated. Its stop/backup steps above are operational instructions for the production owner, not actions performed by the test harness.
