# WatchGuard v0.7.15 preparation

Unpublished patch for return position and focus in Watchlists. See [implementation and validation](docs/return-position-v0715.md) and [publication copy](docs/releases/v0.7.15.md).

Published v0.7.14 assets, catalog entries and qualification evidence remain unchanged. Its [release record](docs/release-v0714.md) retains the exact published package hashes.

After merge, the existing workflow automatically qualifies the exact master package under the [current policy](scripts/qualification-policy.json). Publication requires that sealed record and approval of the existing release environment. Branch checks do not authorize publication.

The policy retains Jellyfin 12.4 full coverage, 12.3 core coverage, current Chromium and Chromium 79. The direct upgrade baseline becomes published v0.7.14. The minimum catalog ABI stays at 12.2.0.0. No historical compatibility matrix is added.
