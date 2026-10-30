# WatchGuard v0.7.11 preparation

Published on 2026-10-30. The publication run passed qualification, then failed to download the newly public checksum while updating the catalog. The [catalog recovery record](docs/catalog-recovery.md) verifies the existing assets and records the manifest correction; no release assets are replaced.

Publication copy: [v0.7.11 release notes](docs/releases/v0.7.11.md). Implementation and validation: [native controls](docs/native-controls-v0711.md). Full qualification passed with `publish=false` and `proxy_matrix=true` on `39d79756a2729765a68ec9e47397004cda1ff684`: [run 41055032547](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/41055032547). The [qualification record](docs/evidence/native-controls-v0711/qualification-summary.json) contains the package/DLL checksums and all three supported versions. Subsequent evidence-only commits do not change the qualified runtime.

Historical v0.7.10 [navigation evidence](docs/navigation-v0710.md) and [qualification corrections](docs/native-ordering-v0710.md) remain preserved.
