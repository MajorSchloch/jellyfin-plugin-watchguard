# WatchGuard v0.7.16 preparation

Unpublished patch for TV menu and detail-panel focus. See [behavior and validation](docs/tv-focus-v0716.md) and [publication copy](docs/releases/v0.7.16.md).

Published v0.7.15 assets, catalog entries and historical evidence remain unchanged. The direct upgrade baseline is published v0.7.15.

After merge, the existing workflow automatically qualifies the exact master package under the [current policy](scripts/qualification-policy.json). Publication requires that sealed record and approval of the existing release environment. Branch checks do not authorize publication.

The policy retains Jellyfin 12.4 full coverage, 12.3 core coverage, current Chromium and real Chromium 79. The minimum catalog ABI remains 12.2.0.0. Physical LG TV confirmation follows installation; browser tests do not certify the webOS application wrapper.
