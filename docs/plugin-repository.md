# WatchGuard v0.3.0 — plugin repository preparation

## Publication status

**Nothing is published by this task.** The configured source repository is `MajorSchloch/jellyfin-plugin-watchguard`. Authenticated GitHub inspection on 2026-10-11 confirmed it is **private and has no releases**; anonymous release lookup returns 404. Jellyfin's ordinary catalog downloader cannot use the maintainer's GitHub credentials. Therefore checked-in `manifest.json` is the valid empty repository array `[]`. It deliberately advertises no nonexistent or private download. A first-class public catalog becomes usable only after the owner authorizes public distribution and a public release asset actually exists.

The release ZIP and SHA-256 are prepared locally. A separate fixture manifest containing an actual local ZIP URL is generated and consumed by the real Jellyfin installer during tests. This proves the package/catalog contract without pretending a public release has been published.

## Jellyfin 12.2 contract

Pinned sources: [PackageInfo](https://github.com/jellyfin/jellyfin/blob/ca0f16eb7c195f720a1493ed469a27c4657db0c6/MediaBrowser.Model/Updates/PackageInfo.cs), [VersionInfo](https://github.com/jellyfin/jellyfin/blob/ca0f16eb7c195f720a1493ed469a27c4657db0c6/MediaBrowser.Model/Updates/VersionInfo.cs), [InstallationManager](https://github.com/jellyfin/jellyfin/blob/ca0f16eb7c195f720a1493ed469a27c4657db0c6/Emby.Server.Implementations/Updates/InstallationManager.cs), [PackageController](https://github.com/jellyfin/jellyfin/blob/ca0f16eb7c195f720a1493ed469a27c4657db0c6/Jellyfin.Api/Controllers/PackageController.cs).

A repository is an array of package objects (`guid`, `name`, `description`, `overview`, `owner`, `category`, `versions`). Each version supplies `version`, `changelog`, `targetAbi`, `sourceUrl`, `checksum` and `timestamp`.

- Plugin GUID: `a3c6bc84-783d-4ba8-a0db-89bfb83ab486`, unchanged.
- Package name: `WatchGuard`; assembly version `0.3.0.0`, product/script version `0.3.0`.
- `targetAbi`: `12.2.0.0`. Jellyfin treats it as a **minimum**, not an upper compatibility bound. Only 12.2 is validated; pin the server and revalidate before upgrading.
- Native catalog `checksum` is **MD5 of the exact downloaded ZIP**, compared case-insensitively. SHA-256 is an additional downloadable verification sidecar, not a substitute in this field. MD5 is used for contract compatibility, not as a signature/authenticity claim; use trusted HTTPS distribution.
- `sourceUrl` must end in `.zip`. The generator uses the actual public GitHub asset URL returned for an existing release, never a predicted URL.
- `timestamp` is the real release's `published_at` in UTC; no future release timestamp is invented. Package history is sorted newest first and previous versions remain. Existing version metadata/assets are treated as immutable.
- Installer checks compatibility/checksum, extracts into `PluginsPath/WatchGuard_0.3.0.0`, writes native `meta.json` and requires restart for loaded code/services. `meta.json` is installer-owned and is not shipped in the ZIP.

ZIP contents remain exactly `Jellyfin.Plugin.WatchGuard.dll` and `LICENSE`. No Injector DLL, Jellyfin/runtime dependencies, PDB, loose script, configuration, metadata manifest or private data is included.

## Build, validate and later publish

```sh
python3 scripts/build-release.py
python3 tests/catalog_test.py
python3 scripts/catalog.py --zip artifacts/Jellyfin.Plugin.WatchGuard-v0.3.0.zip
```

Builds use pinned SDK 10.0.302, locked dependencies, forced deterministic compilation, normalized paths and fixed ZIP metadata. The additional release workflow builds/tests twice, compares SHA-256, runs backend/JavaScript/catalog tests, builds the pinned Injector, runs browser regressions, rebuilds the verified v0.2.4 rollback fixture from commit `37e2c0f16a1da1d1495ce1a4ae3b8438aea2fdc7`, then exercises native catalog installation/migration. A rollback hash mismatch fails rather than silently skipping migration.

`.github/workflows/release.yaml` is manual-only. `publish=false` is the default and uploads Actions artifacts only. Before later publication, the owner must configure the GitHub **release** environment with required reviewers, make the distribution repository public, review this release, and run the workflow from the default branch with `publish=true`. These repository settings are not changed by this task. A boolean alone is not an enforced reviewer policy; configure the environment accordingly.

The publish job checks public visibility, creates a draft release at the validated commit, uploads the ZIP/SHA-256, then publishes it. It refuses to replace an existing release. Only afterward does `scripts/catalog.py --from-release "$GITHUB_REPOSITORY" v0.3.0 --zip ...` anonymously retrieve the real release metadata, download both assets, verify exact ZIP bytes and SHA-256, compute MD5, preserve history, and update `manifest.json`. It commits the verified manifest back to the source branch. Branch protection may require manually committing/merging that generated manifest instead; a failed manifest update does not justify editing unverified URLs into it. No tag, release, repository visibility or remote branch has been changed here.

After publication and manifest merge, obtain and anonymously verify the actual raw manifest URL from GitHub; add that verified URL under Dashboard → Plugins → Repositories. Refresh Catalog, install WatchGuard, restart and verify registration and browser operation. There is intentionally no advertised installation URL while the repository is private/empty.

## JavaScript Injector dependency

The real published **4.0.0.0** release provides a jf12 artifact named `Jellyfin.Plugin.JavaScriptInjector_12.0.0.zip` (its native target ABI is 12.0.0.0). See the [actual release](https://github.com/n00bcodr/Jellyfin-JavaScript-Injector/releases/tag/4.0.0.0) and the upstream [Jellyfin 12 catalog](https://raw.githubusercontent.com/n00bcodr/jellyfin-plugins/main/12/manifest.json). Its catalog MD5 is `E9B247E1CBD473B02CC71BD6E3DAE369`; the package contains only its DLL. The released jf12 artifact and the pinned 12.2 source build are tested separately against Jellyfin 12.2. Do not install its 10.11/.NET 9 variant.

Install/enable Injector separately; Jellyfin's catalog contract does not automatically resolve this dependency. Preserve response-time middleware (`DisableScriptInjectionMiddleware=false`). WatchGuard validates the public static `RegisterScript(JObject)` boolean interface, retries startup ordering, and emits an actionable warning if registration fails. Missing Injector is explicitly tested; WatchGuard APIs can work while **no Web deletion confirmation is active**. Even a successful registration log is not proof of browser execution: check exactly one authenticated/enabled `watchguard-v1` at version `0.3.0`, reload clients, and verify `window.WatchGuardPoc?.isInstalled()`. Full checks remain in [deployment.md](deployment.md#verify-registration-and-operation).

## Installation evidence and rollback

`tests/docker-smoke.py --catalog --injector-dll /path/to/Injector.dll` uses the actual `/Repositories`, `/Packages` and `/Packages/Installed/WatchGuard` APIs, a temporary release-only HTTP server, and disposable Jellyfin config/media. It checks rejected bad MD5 before extraction, clean discovery with no WatchGuard DLL, native versioned folder/meta generation, exact packaged DLL, restart loading, a real v0.2.4 manual-to-catalog transition, byte-preserved memberships/settings, one discoverable WatchGuard assembly, one Injector registration, and missing-Injector diagnostics. The temporary HTTP server binds a random host port and serves only test ZIP/manifests; never point this harness at production. It closes and the container is removed afterward.

See [manual migration and rollback](manual-to-catalog.md), including the LinuxServer.io `/config/data/plugins` layout. These tests use the pinned official Jellyfin image; LinuxServer.io paths are documented from the supplied production layout/native path rules, not claimed as a live production migration.
