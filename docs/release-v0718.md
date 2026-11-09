# WatchGuard v0.7.18 preparation

This release adds the TV Watchlists zoom animation from [PR #75](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/pull/75). It matches native Favorites with a 200ms `ease` transform transition on both focus and blur. The focused size remains 1.3×, and reduced motion disables the animation.

See [behavior and browser validation](tv-tab-animation.md), [publication copy](releases/v0.7.18.md), and the current [preparation status](../release-preparation.md). The earlier browser evidence identifies the animation patch package before this version increase. It is not qualification evidence for the v0.7.18 package.

The direct upgrade baseline is published v0.7.17. The minimum ABI remains 12.2.0.0. Desktop, mobile and series-detail focus styles are unchanged.

After merge, the existing workflow qualifies the exact master package under the [current policy](qualification-policy.md). Publication follows the existing release-environment approval. The published catalog changes only after the workflow verifies the public package. Physical LG confirmation follows installation.

## Local release checks

The version increase passed 376 backend tests, 307 JavaScript tests, 141 Python tests and eight catalog tests. Publication-copy, qualification-policy and packaged ES2019 checks passed. The release plan selects published v0.7.17 as the direct upgrade baseline.

Two package builds produced identical ZIP bytes. The ZIP contains only the runtime DLL and LICENSE.

ZIP SHA-256: `0268c9d705a135c250193428c140ed4a84b0b054565cca291c263b0c1faff8e4`.

DLL SHA-256: `7a2ebc468cff3bf138b0ec1394ca1d6262428155934b32dc775189c7d4ee1ec1`.

These local checks prepare the release PR. The complete qualification matrix must still pass on the exact merged master package.
