# WatchGuard v0.7.13 preparation — seamless item navigation

**Unpublished.** This patch retains the reviewed outgoing transition implementation. The version preparation changes metadata, candidate fixture references and documentation only. Publication copy is separate in [release notes](releases/v0.7.13.md).

The minimum ABI remains 12.2.0.0. Dependencies, plugin GUID, stored data and protection rules are unchanged. The public catalog still lists v0.7.12; existing assets and historical evidence remain unchanged.

## Development regression evidence

[Run 41245891354](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/41245891354), attempt 1, passed all 39 suites and the strict compatibility evidence gate. It tested commit `9f5f8702a83d2031f66ac7bdaeecacc1c5fb492f` with `publish=false` and `proxy_matrix=true` on Jellyfin Server/Web 12.2.0, 12.3.0 and 12.4.0.

That package identifies itself as **v0.7.12**. Its ZIP SHA-256 is `36d67f77f6721a029c9ed21bb17ed16b826ae7e41d53cf98b15cc19fbaa87ba8`. The read-only publication rehearsal correctly rejected its conflict with the published release. This run is development regression evidence, not authority to publish v0.7.13. [Original evidence and remaining limitations](outgoing-handoff.md) are retained.

## Release preparation checks

Local checks passed: 215 JavaScript tests, 94 Python tests, eight catalog tests and 376 backend tests. Publication notes, candidate metadata, fixture syntax and catalog history checks passed. Two complete package builds produced identical ZIP bytes.

- ZIP SHA-256: `3969d75dea05d120e72f925ed25c0e04ca292c845d149d36c149f0f609740329`.
- DLL SHA-256: `530b6a2220717dfd4a345f385cafcc890d3f6f439623f4081a567c4c9170eac7`.
- All five packaged browser assets, settings inline code and combined startup code passed ES2019 and real Chromium `79.0.3945.0` parse checks.
- The five packaged browser assets are byte-identical to the reviewed development package from run 41245891354. This parse check does not repeat native flows or physical-TV testing.
- The public manifest is byte-identical to current master. All previous maintained summaries remain unchanged.

The first local backend run exposed a missed candidate-version assertion, which now expects `0.7.13.0`. It also exposed an existing clock-dependent test limitation: `SettledIdleSlicesNeverRewriteCheckpoint` advanced its clock across midnight in Europe/Zurich. The worker correctly invalidated the previous local day. The unchanged assertion passed with the complete backend suite in CI's UTC timezone. This metadata patch does not change that fixture or runtime behavior; the local-midnight limitation remains separate follow-up work.

No additional branch matrix is required for this metadata-only preparation. After merge, automatic master qualification must test the final v0.7.13 package on all supported hosts before publication. The publisher must consume that exact qualified artifact after release-environment approval.
