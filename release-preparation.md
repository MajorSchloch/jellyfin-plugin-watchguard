# WatchGuard v0.7.9 preparation

Unpublished. Published v0.7.8 remains the installation release. Public catalog and existing packages remain unchanged.

This candidate integrates Watchlists with native Legacy navigation. Publication copy lives in [docs/releases/v0.7.9.md](docs/releases/v0.7.9.md); findings and qualification are recorded in [docs/navigation-v079.md](docs/navigation-v079.md).

Unified qualification passed on `6ebe2517eadc9552ee3bbc3b6485629748ea2d97`: 39 suite reports across Jellyfin Server/Web 12.2.0, 12.3.0 and 12.4.0; 20 required jobs passed with `publish=false`, `proxy_matrix=true`; publication skipped. [Run and evidence](docs/navigation-v079.md#validation).

Package SHA-256: `75caecd64bcd3b8137ba33e199ab04fc75c0becfd613cd8904cde95cd8239c6a`. Minimum ABI and dependencies remain 12.2. Native browser evidence is Chromium viewport/touch emulation, not physical-device testing.

Do not merge, publish or deploy as part of preparation.
