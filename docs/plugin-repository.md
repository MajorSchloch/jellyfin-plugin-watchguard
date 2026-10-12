# WatchGuard v0.4.0 catalog preparation

**Release candidate only.** Neither the public manifest nor any published v0.3.1 asset is changed. The catalog currently serves existing releases. No v0.4.0 public source URL or publication timestamp is invented during preparation.

## Native contract and package

- Stable GUID `a3c6bc84-783d-4ba8-a0db-89bfb83ab486`, package name `WatchGuard`.
- Assembly/package version `0.4.0.0`; product version `0.4.0`.
- Jellyfin target ABI `12.2.0.0`. This is the installer's minimum, not a tested upper bound. Only Server/Web 12.2 is qualified.
- Archive root contains exactly `Jellyfin.Plugin.WatchGuard.dll` and `LICENSE`; embedded Web/settings/bootstrap resources ship in the DLL. No Injector, Jellyfin assemblies, data, XML, PDB or installer metadata is bundled.
- Native catalog checksum is **MD5 of the ZIP**. SHA-256 is a separate verification artifact; it cannot replace the native checksum field.
- Manifest is an array of packages with `guid`, `name`, `overview`, `description`, `owner`, `category`, and `versions`. Versions carry four-part version, changelog, ABI, real ZIP URL, checksum and timezone-qualified timestamp.
- `scripts/catalog.py --from-release` anonymously retrieves an already-public stable release, verifies exact downloaded ZIP bytes and SHA-256 sidecar, uses its actual asset URL and `published_at`, and appends the new version while preserving previous version objects. Existing version metadata is immutable. Unit tests explicitly check v0.3.1 history preservation and rejected mutation.

After publication, package-level description changes to standalone loading and migration guidance. Prior per-version URLs, timestamps, checksums and metadata stay untouched. Until then the checked-in manifest remains byte-for-byte unchanged.

## Reproducible validation

```sh
python3 scripts/build-release.py
python3 tests/catalog_test.py
python3 scripts/catalog.py --zip artifacts/Jellyfin.Plugin.WatchGuard-v0.4.0.zip
```

The packager requires SDK 10.0.302, locked restoration, forced compilation, normalized source paths, deterministic compilation, fixed ZIP metadata and an allowlist. Build twice and compare `.zip.sha256`. Native local-catalog tests install the **exact generated ZIP**, verify native metadata/restart, and run the full browser/deletion suite with no Injector. Migration tests install the actual published v0.3.1 baseline and then the RC through the same native package APIs. Incorrect MD5 is rejected before extraction.

The temporary test catalog has a real, fixture-only HTTP ZIP URL and timestamp; it is not the public repository. Tests bind disposable configuration/media and close/delete their containers and local catalogs afterward.

## GitHub Actions

`build.yaml` builds/tests the normal assembly, JavaScript/bootstrap, allowlisted ZIP and catalog validation for push/PR/manual runs. `release.yaml` is manually dispatched, defaults to `publish=false`, and performs:

1. Normal release build, all backend/JavaScript/catalog unit checks, a forced second build and checksum comparison.
2. Pinned LinuxServer/Caddy native catalog install with **no Injector**, full browser/deletion/auth/CSP/settings tests, base-path regression and WebSocket/header probes.
3. Verified published v0.3.1 rollback download, catalog upgrade/rollback with preserved JSON/XML, conflict refusal and explicit single-entry cleanup. Injector is built only for these retained legacy/migration fixtures, never packaged or required by the RC.
4. Retained v0.3.0 → v0.3.1 catalog and published v0.3.1 browser regressions, plus diagnostic/test artifacts upload.

Publishing is a separate job gated by successful validation, explicit `publish=true`, the repository default branch and the `release` environment. Configure that environment's required reviewers in GitHub; this workflow file alone cannot enforce repository approval settings. No workflow was dispatched by this task.

On a later authorized publish run, the job verifies public repository visibility, creates a new draft `v0.4.0` release at the validated commit, uploads ZIP/SHA-256, then publishes it. It never uses asset replacement/clobber flags. Only afterward does the manifest generator verify anonymous public assets and append the entry. The verified manifest is committed back to the source branch; branch protection may require a reviewed manual merge instead. Existing v0.3.1 release/manifest entries must remain unchanged.

Catalog-managed users then install/update normally and restart; no DLL copying is needed. Existing Injector users must follow [migration-v040.md](migration-v040.md). Native clients/direct API/filesystem deletion remain outside Web warning coverage.

Contract source: pinned Jellyfin [PackageInfo](https://github.com/jellyfin/jellyfin/blob/ca0f16eb7c195f720a1493ed469a27c4657db0c6/MediaBrowser.Model/Updates/PackageInfo.cs), [VersionInfo](https://github.com/jellyfin/jellyfin/blob/ca0f16eb7c195f720a1493ed469a27c4657db0c6/MediaBrowser.Model/Updates/VersionInfo.cs), and [InstallationManager](https://github.com/jellyfin/jellyfin/blob/ca0f16eb7c195f720a1493ed469a27c4657db0c6/Emby.Server.Implementations/Updates/InstallationManager.cs). See [release results](standalone-release.md) and [deployment](deployment.md).
