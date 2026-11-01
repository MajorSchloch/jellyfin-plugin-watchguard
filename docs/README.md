# WatchGuard documentation index

Current published version: see the [public catalog](../manifest.json) and [published release](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/releases/latest). Current CI policy: [required qualification](qualification-policy.md).

**Published activity browser:** [v0.7.0 notes](release-v070.md). **Published usability:** [v0.7.1 notes](release-v071.md). **Published navigation:** [v0.7.2 notes](release-v072.md), [qualification](navigation-validation-v072.md). **Published compatibility:** [v0.7.3 notes](release-v073.md), [qualification](compatibility-v073.md). **Published startup:** [v0.7.4 notes](release-v074.md), [qualification](startup-validation-v074.md). **Published drawer/qualification:** [v0.7.5 notes](release-v075.md), [qualification](drawer-qualification-v075.md). **Published capabilities:** [v0.7.6 notes](release-v076.md), [qualification](qualification-v076.md), [compatibility policy](compatibility-capabilities.md). **Published listing:** [v0.7.7 notes](release-v077.md), [native catalog qualification](catalog-listing-v077.md). **Published v0.7.8:** [release notes](release-v078.md), [12.4 and action verification](compatibility-v078.md).

**Published v0.7.11:** [release record](release-v0711.md), [native controls](native-controls-v0711.md), [catalog recovery](catalog-recovery.md).

Start with the repository [README](../README.md) for features, installation, limitations, and the non-mutating status/approval checks. The repository includes historical design experiments and release-candidate reports. Their *as-of-version* statements (for example, “not published” or “requires Injector”) describe historical candidates, **not the current public release**.

## Current reference material

Unpublished compatibility work: [older browsers, Chromium 79 validation and TV test procedure](browser-compatibility.md).

| Question | Reference |
| --- | --- |
| How do I install, upgrade or verify the published plugin? | [README](../README.md), [upgrade/rollback fundamentals](server-enforcement-upgrade-v049.md) |
| What does server-side protection cover? | [Qualified HTTP routes and operation flow](server-enforcement-v049.md), [security boundaries](server-enforcement-security-v049.md) |
| Why can browser approval work without `KnownProxies`? | [v0.4.10 request-origin design](deployment-agnostic-security-v0410.md) |
| How should Jellyfin proxies be configured safely? | [v0.4.10 proxy matrix and limitations](proxy-compatibility-v0410.md), [Jellyfin reverse-proxy guide](https://jellyfin.org/docs/general/post-install/networking/reverse-proxy/) |
| What has actually been validated? | [Current verification summary](validation.md), [v0.4.10 security-regression evidence](security-regression-v0410.md) |
| Why aren't all activity or episode results complete? | [Interest discovery and limits](interest-overview.md), [episode query performance](episode-query-performance-v048.md), [Caught Up coverage](caught-up-protection.md) |
| What are the published v0.5.1 changes? | [v0.5.1 release overview and qualification](release-v051.md) |

## Watchlist-added dates

- [v0.5.0 watchlist-added timestamp design](watchlist-dates-v050.md) — sidecar provenance, schema-1 rollback compatibility, unknown old dates, URL sorting and migration hazards.
- [v0.5.0 published release notes](release-v050.md) — available through the public Jellyfin catalog; includes verified release results.

## Saved Recently added defaults

- [v0.5.1 saved Recently added defaults](saved-sort-v051.md): compatible sidecar, downgrade fallback, corruption and partial-write behavior.
- [v0.5.1 published release validation](release-v051.md): publication and all ten integration suites passed.

## Additional available episode progress (v0.5.2)

- [Additional available episode progress](extra-episodes-v052.md): aired counts, user-specific extras, date boundary, compatibility and validation.
- [v0.5.2 published release notes](release-v052.md).

## Maintainer and developer notes

- [Release operation](release-automation.md): automatic qualification, approval, exact-artifact publication and recovery.

- [Build/package/catalog history](plugin-repository.md): includes historical candidate-specific procedures; use current `.github/workflows/build.yaml`, `.github/workflows/release.yaml` and `scripts/build-release.py` as the executable source of truth.
- [Disposable fixture lifecycle](testing/fixture-lifecycle.md), [browser contracts](testing/browser-contracts.md), [CI reliability findings](testing/reliability-analysis.md).
- [Standalone Web loader](standalone-injection.md) and [native Web confirmation limitations](native-confirmation-options.md).
- [Historical v0.4.9 approval protocol](server-approval-protocol-v049.md), [threat model](server-approval-threat-model-v049.md) and [deletion coverage](deletion-coverage-matrix-v049.md).
- [Migration from Injector to standalone](migration-v040.md); required only for old installations with an Injector `watchguard-v1` registration.

## Preserved historical material

The versioned `docs/*-v0XX.md`, `docs/performance-data/`, `docs/evidence/`, `docs/screenshots/` and `experiments/` directories are deliberately retained for reproducibility, threat-model context, comparison and rollback. Their snapshot dates, old release states and measurements must not be silently rewritten as present-day claims. The **production plugin does not load, build or package** the research-only companion assemblies under `experiments/`.

Do not delete checksum-pinned previous releases, old regression fixtures or historical data merely because they are not executed in every PR build. A cleanup affecting release logic, binary packaging, historical checksum validation or deletion authorization requires its own reviewed PR and complete qualification.

## Repository structure

- `Jellyfin.Plugin.WatchGuard/` — production C#, embedded standalone Web scripts and settings.
- `tests/` — .NET and JavaScript checks, native disposable Docker and browser fixtures.
- `experiments/` — isolated archived proof-of-concept companions; **never deploy**.
- `scripts/` — deterministic release ZIP builder and catalog validator.
- `manifest.json` — public catalog version history; entries are immutable once published.
- `.github/workflows/` — ordinary CI and manually approved release workflow.

To propose new behavior, start with the [README compatibility boundaries](../README.md#activity-and-compatibility-boundaries), add tests using disposable media, and avoid expanding the native DELETE interception surface without security review.
