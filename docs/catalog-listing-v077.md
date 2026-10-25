# Native catalog listing — v0.7.7

## Maintained content

[catalog/content.json](../catalog/content.json) owns the catalog overview, description, immutable image URL and per-version user-visible summaries with documentation links. Historical summaries were reviewed against the matching published release bodies and versioned repository notes. The exact installed `Plugin.Description` is checked against this source in catalog tests; change both together.

Run `python3 scripts/catalog.py --refresh-editorial` after editing the source. This updates descriptions and changelogs only and never advertises a new version. Generation rejects missing summaries, empty bullets and placeholder changelogs. A new release still requires an already-public stable GitHub asset, anonymous download equality with the qualified ZIP and a matching SHA-256 sidecar.

`preserve_history` protects package identity and every version field except `changelog`, including unknown future fields. Existing version numbers, source URLs, MD5 checksums, timestamps and target ABI cannot change or disappear. The publishing preflight uses the same check against current public master; editorial corrections are permitted. Regression tests exercise each protected field, removal, duplication, placeholders, source drift and repeat generation. Published binaries and tags are untouched.

## Artwork and native handling

The supplied [PNG](../Jellyfin.Plugin.WatchGuard/WatchGuard.png) is retained. [watchguard-v1.webp](../assets/watchguard-v1.webp) is its optimized catalog encoding: 1672 × 941, 23,782 bytes versus 1,232,289 bytes (98.1% smaller). No crop, resizing, redrawing or text replacement. Encoded with libwebp 1.5.0 (libsharpyuv 0.4.1). Reproduce with `cwebp -q 85 -m 6 Jellyfin.Plugin.WatchGuard/WatchGuard.png -o assets/watchguard-v1.webp`.

The public `imageUrl` pins artwork commit `77ab0ead33ab133e44800aea57c0b9ff4b9c75af`, so it works before a new release is tagged and cannot drift with branch edits. Future artwork uses a new versioned filename and commit. Jellyfin’s native catalog installer populates `meta.json` with a downloaded local `imagePath`; the native `/Plugins/{id}/{version}/Image` endpoint serves it after restart. No plugin image controller, custom details page, CSS injection or extra runtime dependency is added. `IHasEmbeddedImage` is documented for integrated/bundled server plugins, not this external catalog plugin. See Jellyfin’s [native manifest population](https://github.com/jellyfin/jellyfin/blob/master/Emby.Server.Implementations/Plugins/PluginManager.cs) and [embedded-image interface](https://github.com/jellyfin/jellyfin/blob/master/MediaBrowser.Controller/Plugins/IHasEmbeddedImage.cs); the fixture verifies the behavior in the pinned released images, rather than inferring it from current upstream source alone.

Upgrading and restarting is necessary for the installed runtime description. Catalog metadata alone cannot override an older executing assembly. Image download requires public GitHub access; offline/manual DLL-only installations can retain the native placeholder until their catalog image is available. Jellyfin’s details layout hides its image below its large-screen breakpoint; mobile catalog and installed-plugin cards display the artwork. We retain that native behavior.

## Verification

Native browser checks cover Available catalog cards/details before installation (public image URL), then All/Installed cards/details after a real catalog install and restart (cached native image endpoint). They expand all 25 revisions, check the exact description, image bytes/dimensions, repository link and version at 1280 and 390 px. The browser fixture uses `en-US` and UTC for reproducible native revision dates. An initial hosted attempt inherited `en-us@posix`; Jellyfin’s native date formatter rejected that invalid language tag before the details page rendered. The [failed report](evidence/catalog-v077/native-locale-failure.json) and [screenshot](evidence/catalog-v077/native-locale-failure.png) are retained. Only the browser locale/timezone setup changed; the runtime, native page, timeout and assertions did not. All fixtures use disposable accounts and synthetic media; no production server is involved.


## Final qualification

Tested commit: `b7a69f2907990fce396e1cb97e3a11c86eac7194`. [Unified qualification](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/40235856139) completed with `publish=false`, `proxy_matrix=true`: build, all **22 integration suites** and the package/commit evidence gate passed; publication was skipped. No jobs were retried. The earlier two preparation runs were superseded, and the invalid-locale attempt above was retained separately; none is counted as a passing qualification.

- **354 backend, 193 JavaScript, 26 infrastructure and eight catalog tests passed.**
- One identical package tested on Server/Web **12.2.0 and 12.3.0**, official and LinuxServer images; all six enforcement fixtures passed 77 cases each, including permissions, approvals and proxy checks.
- Eight native listing cases: two versions × desktop/mobile × available/installed. Each expands all 25 revisions (24 published plus the disposable candidate), verifies image bytes and dimensions, description, repository link, status/version and native navigation. Available cards use the public image URL; installed cards/details use the native cached endpoint. The candidate repository is local to the fixture; no unpublished package URL is added to the public manifest.
- Both versions retain the drawer (six cases), in-place navigation (36 transitions, zero Home exposure, overlays, panel replacement or focus loss), startup (24 initial-document cases, four Refresh and 14 recovery cases, zero Home frames), activity, polling, account-isolation, migration and rollback regressions.
- Two clean local builds and the hosted ZIP are byte-identical. ZIP SHA-256: `1e8d4dbeb02c3ae2379b35263a02a6b274ef4b493414f018becb2832b6d0d831`. DLL SHA-256: `80e371f38ab459259460a3bbe12127a6b60f86150f35fda0de87c97373553a4d`. Archive remains exactly the DLL and LICENSE; minimum ABI remains `12.2.0.0`.
- All **24 historical installation records** are unchanged. Their canonical projection SHA-256 is `9655011c7de4b5e03d83d3677feaaa595fb5c8d208d098fa70d75a16e94f2833`. Only overview, description, image URL and changelog text change in the catalog.

[Qualification and exact image references](evidence/catalog-v077/qualification.json) · [Metadata comparison and artwork checksum](evidence/catalog-v077/metadata.json). Follow-up evidence/documentation commits do not alter the qualified package.

## Native screenshots

These are unmodified native Jellyfin pages. The browser uses en-US/UTC; accounts, repository and media are disposable. The repository link names the local test catalog. Mobile details intentionally retain Jellyfin’s hidden-image layout; available and installed cards show the artwork.

| Server / Web | Available catalog | Installed details | Installed mobile card |
| --- | --- | --- | --- |
| 12.2.0 | [Desktop](screenshots/catalog-v077/12.2-catalog-1280.png) · [390 px](screenshots/catalog-v077/12.2-catalog-390.png) | [Desktop](screenshots/catalog-v077/12.2-details-1280.png) · [390 px](screenshots/catalog-v077/12.2-details-390.png) | [Card](screenshots/catalog-v077/12.2-installed-390.png) |
| 12.3.0 | [Desktop](screenshots/catalog-v077/12.3-catalog-1280.png) · [390 px](screenshots/catalog-v077/12.3-catalog-390.png) | [Desktop](screenshots/catalog-v077/12.3-details-1280.png) · [390 px](screenshots/catalog-v077/12.3-details-390.png) | [Card](screenshots/catalog-v077/12.3-installed-390.png) |
