# WatchGuard v0.7.13 preparation

Unpublished patch for the transition from Watchlists to native item details. See [preparation and validation](docs/release-v0713.md), [implementation and TV procedure](docs/outgoing-handoff.md), and [publication copy](docs/releases/v0.7.13.md).

The reviewed transition implementation is unchanged by this version preparation. The public catalog and published v0.7.12 assets remain unchanged.

Run 41245891354, attempt 1, passed all 39 compatibility suites with a development package that still identified itself as v0.7.12. Retain it as regression evidence only. It cannot authorize v0.7.13 publication. After merge, automatic master qualification must validate the final v0.7.13 package before publication and release-environment approval.

## Published v0.7.12 record

Published on 2026-10-31. See [the retained qualification and package record](docs/release-v0712.md). Its release assets and catalog entry remain unchanged.

## Published v0.7.11 record

Published on 2026-10-30. The publication run passed qualification, then failed to download the newly public checksum while updating the catalog. The [catalog recovery record](docs/catalog-recovery.md) verifies the existing assets and records the manifest correction; no release assets are replaced.

Publication copy: [v0.7.11 release notes](docs/releases/v0.7.11.md). Implementation and validation: [native controls](docs/native-controls-v0711.md). Full qualification passed with `publish=false` and `proxy_matrix=true` on `39d79756a2729765a68ec9e47397004cda1ff684`: [run 41055032547](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/41055032547). The [qualification record](docs/evidence/native-controls-v0711/qualification-summary.json) contains the package/DLL checksums and all three supported versions. Subsequent evidence-only commits do not change the qualified runtime.

Historical v0.7.10 [navigation evidence](docs/navigation-v0710.md) and [qualification corrections](docs/native-ordering-v0710.md) remain preserved.
