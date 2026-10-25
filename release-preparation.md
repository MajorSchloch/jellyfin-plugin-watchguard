# WatchGuard v0.7.7 preparation

**Unpublished.** Published v0.7.6 remains the current release. The branch changes descriptive catalog metadata only; it advertises no v0.7.7 package. Existing release assets and installation metadata are unchanged.

Final tested commit: `b7a69f2907990fce396e1cb97e3a11c86eac7194`. [Unified qualification](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/40235856139) passed build, all 22 integration suites across Jellyfin Server/Web 12.2.0 and 12.3.0, and the evidence gate, with `publish=false`, `proxy_matrix=true`; publication was skipped. One identical package was used throughout.

- ZIP SHA-256: `1e8d4dbeb02c3ae2379b35263a02a6b274ef4b493414f018becb2832b6d0d831`
- DLL SHA-256: `80e371f38ab459259460a3bbe12127a6b60f86150f35fda0de87c97373553a4d`
- 354 backend, 193 JavaScript, 26 infrastructure and eight catalog tests passed.
- Native available/installed listing checks passed at 1280 and 390 px on both versions, including 200 revision expansions, real public/cached images, repository links and installed-version display.

See [screenshots, exact evidence and native-layout limitations](docs/catalog-listing-v077.md). The hosted invalid-POSIX-locale failure and superseded preparation runs are retained separately; they are not qualification success. Follow-up evidence/documentation commits preserve the qualified runtime. Publication copy is separate in [docs/releases/v0.7.7.md](docs/releases/v0.7.7.md).

No merge, release publication or deployment has been performed. Publication remains a separate maintainer action.
