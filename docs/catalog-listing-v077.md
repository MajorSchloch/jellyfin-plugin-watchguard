# Native catalog listing — v0.7.7

## Maintained content

[catalog/content.json](../catalog/content.json) owns the catalog overview, description, immutable image URL and per-version user-visible summaries with documentation links. Historical summaries were reviewed against the matching published release bodies and versioned repository notes. The exact installed `Plugin.Description` is checked against this source in catalog tests; change both together.

Run `python3 scripts/catalog.py --refresh-editorial` after editing the source. This updates descriptions and changelogs only and never advertises a new version. Generation rejects missing summaries, empty bullets and placeholder changelogs. A new release still requires an already-public stable GitHub asset, anonymous download equality with the qualified ZIP and a matching SHA-256 sidecar.

`preserve_history` protects package identity and every version field except `changelog`, including unknown future fields. Existing version numbers, source URLs, MD5 checksums, timestamps and target ABI cannot change or disappear. The publishing preflight uses the same check against current public master; editorial corrections are permitted. Regression tests exercise each protected field, removal, duplication, placeholders, source drift and repeat generation. Published binaries and tags are untouched.

## Artwork and native handling

The supplied [PNG](../Jellyfin.Plugin.WatchGuard/WatchGuard.png) is retained. [watchguard-v1.webp](../assets/watchguard-v1.webp) is its optimized catalog encoding: 1672 × 941, 23,782 bytes versus 1,232,289 bytes (98.1% smaller). No crop, resizing, redrawing or text replacement. Reproduce with `cwebp -q 85 -m 6 Jellyfin.Plugin.WatchGuard/WatchGuard.png -o assets/watchguard-v1.webp`.

The public `imageUrl` pins artwork commit `77ab0ead33ab133e44800aea57c0b9ff4b9c75af`, so it works before a new release is tagged and cannot drift with branch edits. Future artwork uses a new versioned filename and commit. Jellyfin’s native catalog installer populates `meta.json` with a downloaded local `imagePath`; the native `/Plugins/{id}/{version}/Image` endpoint serves it after restart. No plugin image controller, custom details page, CSS injection or extra runtime dependency is added. `IHasEmbeddedImage` is documented for integrated/bundled server plugins, not this external catalog plugin.

Upgrading and restarting is necessary for the installed runtime description. Catalog metadata alone cannot override an older executing assembly. Image download requires public GitHub access; offline/manual DLL-only installations can retain the native placeholder until their catalog image is available. Jellyfin’s details layout hides its image below its large-screen breakpoint; mobile catalog and installed-plugin cards display the artwork. We retain that native behavior.

## Verification

Native browser checks cover Available catalog cards/details before installation (public image URL), then All/Installed cards/details after a real catalog install and restart (cached native image endpoint). They expand all 25 revisions, check the exact description, image bytes/dimensions, repository link and version at 1280 and 390 px. Final package evidence is recorded here after the checks finish. All fixtures use disposable accounts and synthetic media; no production server is involved.
