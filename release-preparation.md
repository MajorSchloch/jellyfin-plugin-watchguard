# WatchGuard v0.7.6 preparation

Unpublished. Compatibility capabilities only; no menu styling or cleanup-review page. Published catalog and existing releases remain unchanged.

Runtime commit: `72d0973035cd02caafc9ba6464b3d421ec942ec9`.

ZIP SHA-256: `fb39974d66d93d56959c5b97d6b0fca77a6bc1e8b9803db17dfb56eac36c950b`.

Packaged DLL SHA-256: `c9f94ee475886b73d1ed847c7cdb8ee9a75ed7b6c10101aeb3158b3b7ac8734d`.

[Unified qualification](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/40204322776) **passed** with **publish=false**, **proxy_matrix=true**, both supported Server/Web versions and one identical package. All 22 integration suites and the final evidence gate passed; the publish job was skipped. Backend 354, JavaScript 193, infrastructure 26 and catalog 4 checks passed. See [validation and limitations](docs/qualification-v076.md).

Qualified release set: Jellyfin Server/Web 12.2.0 and 12.3.0. Same .NET 10 / 12.2 dependency and minimum ABI. Patch-version tests are simulations, not real future-release qualification. Publication copy is maintained separately in [docs/releases/v0.7.6.md](docs/releases/v0.7.6.md).
