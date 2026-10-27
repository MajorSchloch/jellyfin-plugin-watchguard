# WatchGuard v0.7.8 preparation

**Unpublished.** Published v0.7.7 remains the current release. The public catalog and published binaries are unchanged.

Final tested commit: `292f65b742ba5fac25c71aefa20f489ec85ba924`. [Unified qualification](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/40557055801) passed build, all 33 integration suites across Jellyfin Server/Web 12.2.0, 12.3.0 and 12.4.0, and the evidence gate with `publish=false`, `proxy_matrix=true`. Publication was skipped. All jobs used one identical package.

- ZIP SHA-256: `fd4a0aba1232c4d5b57b80c336e50ed27cdd12502b31e5fd2ccc44e67aede7c3`
- DLL SHA-256: `a19bd559f8515db062f4debce1447a88f296e4ca1b69b5b3e44cb4c2ee959e5c`
- 376 backend, 194 JavaScript, 26 infrastructure and eight catalog tests passed.

See [native screenshots, image digests, exact evidence, superseded runs and limitations](docs/compatibility-v078.md). Runtime last changed in `3a4ca3d4759137c84ed364262d95c37f8e6ad115`; the tested commit includes the catalog assertion correction. Evidence/documentation commits after qualification leave the runtime and test code unchanged. Publication copy is separate in [docs/releases/v0.7.8.md](docs/releases/v0.7.8.md).

No merge, publication or deployment was performed. Publication remains a separate maintainer action. Historical [v0.7.7 qualification](docs/catalog-listing-v077.md) is preserved.
