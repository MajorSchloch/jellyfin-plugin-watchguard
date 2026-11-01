# Jellyfin WatchGuard

**Current release: [latest published release](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/releases/latest)** · Published target: **Jellyfin Server/Web 12.2.0, 12.3.0 and 12.4.0 / .NET 10** · [Plugin catalog](manifest.json)

**Release validation:** [v0.7.11 native controls](docs/native-controls-v0711.md) and [catalog recovery](docs/catalog-recovery.md).

Keep track of what you want to watch and see what others on your server are watching. WatchGuard adds personal watchlists, shared viewing progress and warnings before you delete something someone still wants to watch. Optional server-side protection can also block supported Jellyfin deletions until an administrator approves them.

WatchGuard is a **single Jellyfin plugin** with an authenticated, standalone Web loader. No JavaScript Injector, Web-file edits, external database or companion service is required.

## What it does

- **Personal watchlists:** add/remove movies and series independently of Jellyfin Favorites; persist memberships per account.
- **Watchlists overview:** view your interests, filter by status, sort titles or available viewing dates, and save personal view preferences. Administrators can inspect authorized cross-user interests.
- **Viewing status:** distinguish Watchlisted, In Progress, Currently Playing, Caught Up and Watched using Jellyfin's native playback information. Series detail pages show relevant users and progress where the episode metadata is sufficient.
- **Deletion warnings:** check current watchlist/playback interest before Web deletion of a movie, series, season or episode, including the requesting user's own interest and the verified parent series.
- **Optional server enforcement (v0.4.9+):** an authenticated request to a protected native item DELETE needs an exact, one-use administrator approval. WatchGuard re-evaluates interest and native permissions when approving and redeeming it. Unapproved protected DELETEs are rejected.
- **Proxy-compatible approvals (v0.4.10):** origin validation supports properly configured direct HTTP(S) and common HTTPS reverse-proxy setups without any *WatchGuard-specific* proxy allowlist.

## Installation and upgrades

1. In Jellyfin, open **Dashboard → Plugins → Repositories** and add the WatchGuard repository if it is not already configured:

   `https://raw.githubusercontent.com/MajorSchloch/jellyfin-plugin-watchguard/master/manifest.json`

2. Open **Dashboard → Plugins → Catalog**, install or upgrade **WatchGuard** (`0.7.11.0`).
3. **Restart Jellyfin**, then **fully reload Jellyfin Web** in each browser.
4. Open **Dashboard → Plugins → WatchGuard**. Confirm the installed plugin version, standalone loader, the current browser's installed adapter and the active server-guard state. The approval **POST readiness** check is non-mutating.

Use the native catalog installer; do **not** copy DLLs into multiple plugin discovery folders. Existing memberships/preferences and configuration use the same plugin GUID and data schema when upgrading from recent standalone releases. Migrating an older Injector-based installation requires [explicit cleanup of only the old WatchGuard Injector entry](docs/migration-v040.md).

**Back up before upgrading.** On LinuxServer.io, the usual locations under `/config/data/plugins` are `Jellyfin.Plugin.WatchGuard/watchlists.json`, `Jellyfin.Plugin.WatchGuard/watchlist-dates.json` (where present), `Jellyfin.Plugin.WatchGuard/preferences.json` and `Jellyfin.Plugin.WatchGuard/preference-sorts.json` (where present), the versioned `WatchGuard_0.7.9.0` directory and `configurations/Jellyfin.Plugin.WatchGuard.xml`. Back up the actual paths used by your installation. Never delete the unversioned WatchGuard data directory to remove a version.

## Server-side deletion protection

**Off by default.** In the WatchGuard plugin settings, enable **server-side deletion enforcement**, save, **restart Jellyfin**, and fully reload clients. Integration status must report actual server enforcement as active, all required capability checks passing, `2/2` attached native DELETE actions, and no restart required. A checked preference without active hooks is not protection.

With enforcement enabled:

- **Unprotected, permitted** deletions continue through Jellyfin's normal native logic.
- **Protected** direct HTTP deletions without valid approval are refused (normally HTTP `409 ProtectionRequired`).
- In supported Jellyfin Web, an administrator may explicitly **Delete Anyway** after viewing the warning. This creates a short-lived, single-use approval and continues the native DELETE once. Cancel performs no DELETE.
- Jellyfin's native deletion permissions are never bypassed. Ordinary users cannot approve protected deletions; API keys and unsupported credential forms are not approval identities.
- The guard covers only the verified `LibraryController.DeleteItem` and `DeleteItems` HTTP actions on hosts passing the [compatibility checks](docs/compatibility-capabilities.md) (qualified on Jellyfin 12.2.0 and 12.3.0), **not** filesystem removal, Sonarr/Radarr/Tdarr changes, internal cleanup or arbitrary other APIs.

Unsupported native/TV/mobile clients may not implement the approval flow and may therefore be unable to delete protected media. Jellyfin Web's generic deletion error after clicking WatchGuard **Cancel** is a known upstream UI limitation; Cancel still issues **zero** DELETE requests.

See [server enforcement and its boundaries](docs/server-enforcement-v049.md), [security model](docs/server-enforcement-security-v049.md), and [v0.4.10 approval security](docs/deployment-agnostic-security-v0410.md).

## Networking and reverse proxies

WatchGuard does **not** require hardcoded Caddy/Nginx/Traefik container IPs of its own. It uses native Jellyfin authentication and validated browser request-origin evidence. For some HTTPS-to-HTTP proxy configurations, it can validate an approval even without Jellyfin's `KnownProxies` entry.

**That does not validate Jellyfin's networking security.** When Jellyfin is behind a reverse proxy, configure **Jellyfin Dashboard → Networking → Known Proxies** and proper forwarding of the real client address. Without native proxy trust, Jellyfin may incorrectly classify remote clients as local, affecting its remote-access permissions and other network policies. Direct connections need no trusted-proxy entry. Never trust arbitrary `X-Forwarded-*` headers to make an approval test pass.

The dashboard distinguishes approval POST readiness from **Jellyfin client-IP forwarding / remote-access restrictions: NOT VERIFIED**. See [proxy compatibility and limitations](docs/proxy-compatibility-v0410.md) and [Jellyfin's reverse-proxy guidance](https://jellyfin.org/docs/general/post-install/networking/reverse-proxy/). Cloudflare Tunnel is not independently certified by WatchGuard's tunnel-style fixture.

## Activity and compatibility boundaries

Playback-derived interest is a **bounded snapshot, not an exhaustive library audit**. Missing air dates, restricted episode visibility and safety limits can prevent a confident Caught Up classification. Missing entries in the overview never authorize deletion: deletion checks independently re-evaluate the exact target. Completed history alone is not a permanent watchlist membership.

Qualified Server/Web versions are 12.2.0 and 12.3.0. Other patch releases in those two families are compatible but untested only when the required capability checks pass. New minor/major versions, custom Web bundles, native TV/mobile apps, nonstandard proxies and restrictive CSPs require separate compatibility testing. The loader uses Blob scripts; successful server delivery alone does not prove that the current browser executed the adapter.

## Watchlist-added dates (v0.5.0)

New memberships record per-user **Added** dates, with a **Recently added** sort in the Watchlists overview. Legacy timestamps remain unknown. The new sort is retained in URLs and browser bookmarks but cannot be saved as an account default without changing the rollback-compatible preference schema. Back up the new `watchlist-dates.json` sidecar together with `watchlists.json` while Jellyfin is stopped. See [storage and rollback details](docs/watchlist-dates-v050.md) and the [published release notes and qualification results](docs/release-v050.md).

## Saved Recently added defaults (v0.5.1)

Save **Recently added** with **Save view as defaults**, with a separate, revision-bound `preference-sorts.json` so older releases still read `preferences.json`. Downgrade falls back to Title; legacy saves/resets invalidate old added overrides. See [design and compatibility limits](docs/saved-sort-v051.md) and [published release checks](docs/release-v051.md).

## Additional available episode progress (v0.5.2)

Series progress keeps aired episodes in the main fraction and exposes additional available episodes with an accessible **+N** button, for example **3/3 +1**. Details include each episode’s date and that user’s watched state. See [design, limits and validation](docs/extra-episodes-v052.md). Deletion protection and stored preferences are unchanged. Available in published v0.5.2.

## Development and verification

Build using the SDK pinned in [global.json](global.json) (**10.0.302**) and Node.js 24 with npm. MSBuild generates the embedded browser assets from the maintained sources. See [older-browser and TV compatibility](docs/browser-compatibility.md) for the Chromium 79 target and physical-TV checks.

```sh
dotnet restore Jellyfin.Plugin.WatchGuard.slnx --locked-mode
dotnet test Jellyfin.Plugin.WatchGuard.slnx -c Release
node --test tests/web.test.cjs tests/standalone-bootstrap.test.cjs tests/server-enforcement.test.cjs
python3 scripts/build-release.py
python3 tests/catalog_test.py
python3 scripts/catalog.py --zip artifacts/Jellyfin.Plugin.WatchGuard-v0.7.14.zip
```

The release packager produces a deterministic ZIP containing only the WatchGuard DLL and LICENSE; Web resources are embedded. Building and testing do **not** publish releases or modify the public catalog. The optional full GitHub Actions release workflow defaults to `publish=false`; it tests disposable Jellyfin instances and generated media. **Do not point fixture scripts at production media.**

If publication succeeds but the catalog update fails, follow [catalog recovery](docs/catalog-recovery.md) using the already validated package; do not republish the release.

See the [documentation index](docs/README.md) for the current security, deployment and test references, plus historical version-specific research retained for audit and rollback.

## License

[GPL-3.0](LICENSE).


## Activity browser — published v0.7.0

Published v0.6.0 provides the background activity index and native reconciliation. Published v0.7.0 adds a combined server query for filtering, ordering and title search before pagination. Preparation advances automatically within four requests. Visible first pages update automatically; deeper views keep their order and show when authorized checks find updates. See the [query contract](docs/activity-browser-v070.md) and [release notes](docs/release-v070.md). Published v0.7.0 is installed and manually validated on the maintainer’s server.

Published v0.7.5 includes the mobile drawer, startup handoff and in-place filter navigation fixes. See [drawer and unified qualification](docs/drawer-qualification-v075.md). Published v0.7.6 adds independent compatibility capabilities and a bounded patch-release policy; see [policy](docs/compatibility-capabilities.md) and [qualification](docs/qualification-v076.md). Published v0.7.7 polishes the native plugin listing. Published v0.7.8 clarifies the removal action and adds verified Jellyfin 12.4 compatibility; see [release notes](docs/release-v078.md).
