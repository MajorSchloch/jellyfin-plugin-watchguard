# Qualification execution and coverage

This change preserves the v0.7.8 runtime, package, server limits and every scenario in [baseline run 40557055801](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/40557055801). It changes scheduling, disposable fixture ownership and measurement. Test-tier reductions and reuse of packages from other runs are deferred.

## Coverage mapping

Every row runs on Jellyfin 12.2, 12.3 and 12.4. The build creates one package; all integration jobs and the publication gate verify that exact ZIP and DLL. Each command creates its own isolated disposable fixture. No state is shared between jobs.

| Former suite | New suite | Retained scenarios and ordering |
|---|---|---|
| activity-index | activity-index | Same 120 movies, 300 episodes and six viewing accounts; checksum-verified v0.5.2 comparison → candidate cold population and index pagination/events/task cancellation → checksum-verified v0.6.0 comparison → candidate filtered, sorted, searched and live queries → native permission revocation. Historical/candidate comparisons remain together. |
| activity-index | activity-browser | Recreates the previous comparison's ending fixture state: same inventory/accounts, six memberships, one unplayed movie and one stopped partial playback. Waits for native population before the unchanged browser scenarios: initial population → search → automatic preparation → watched/unwatched polling → playback start/stop → deeper-page checks and 503 recovery → ordering → responsive presentation/focus/disclosures/error retention. Actual polling and background limits remain unchanged. |
| basepath | basepath | Existing full standalone/settings/browser checks through `/jellyfin` and the reverse proxy, including watchlist actions, account switching and deletion warnings. |
| basepath | basepath-navigation | Existing native catalog fixture → separate drawer/navigation fixture → separate startup/reload/failure-recovery fixture. No fixtures are combined or skipped. |
| standalone-caddy | standalone-caddy | LinuxServer native catalog install, historical upgrades/rollback, preference round trips, HTTPS/Caddy, standalone/settings/browser checks. |
| migration | migration | Injector migration and rollback, with the pinned Injector build. |
| legacy | legacy | Legacy catalog fixture → separate legacy browser fixture. |
| websocket | websocket | LinuxServer Caddy, trusted certificates, native WebSocket and resource measurements. |
| discovery | discovery | Existing v0.4.5 discovery comparison. |
| verification | verification | Default verification fixture → policy verification fixture → v0.4.7 discovery comparison fixture. |
| server-enforcement | server-enforcement | Official image, all native enforcement/approval/permission/account-isolation assertions and requested full proxy matrix. |
| server-enforcement-basepath | server-enforcement-basepath | Same enforcement suite with `/jellyfin`. |
| server-enforcement-linuxserver | server-enforcement-linuxserver | Same enforcement suite on LinuxServer. |

The gate requires **13 suites × 3 versions = 39 suite reports**, scheduled in **6 balanced shards × 3 versions = 18 runner jobs**, down from 33 jobs. Base-path command times in the baseline were 181s catalog, 483s full browser, 156s navigation and 168s startup; the new groups are approximately 483s and 505s before setup. These are historical measurements, not a prediction of identical future timing. Activity splitting adds a separate seed/population cost, measured independently from the browser checks.

The first measured revision used 39 separate jobs with long suites listed first. [Run 40662499032](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/40662499032) showed that GitHub still queued some activity jobs behind shorter scenarios. It also exposed the existing same-version private catalog duplication after v0.7.8 publication. That run is superseded and is not qualification evidence.

The final shard plan fits below the observed 20-runner concurrency instead of depending on matrix ordering:

| Shard (one job per host) | Suites, sequential within that job |
|---|---|
| activity-native | activity-index |
| activity-browser | activity-browser → websocket |
| standalone-discovery | standalone-caddy → discovery |
| verification-navigation | verification → basepath-navigation |
| migration-browser | migration → basepath |
| enforcement-legacy | server-enforcement → server-enforcement-basepath → server-enforcement-linuxserver → legacy |

Each suite still creates fresh fixtures. Its complete diagnostics are moved into its own `artifacts/suites/<suite>/` directory before the next suite starts, so common report filenames cannot overwrite prior evidence. Candidate/rollback inputs remain available. A failed suite stops that shard immediately, retains its diagnostics, and is never retried. Other shards continue collecting evidence. GitHub still owns admission, and other workflows can consume runner capacity; before/after results include that delay.

`scripts/qualification-plan.json` is the shared command inventory for execution and the gate; `scripts/qualification-shards.json` assigns each suite to exactly one shard. Schema 2 evidence includes each scenario ID, exact command and scenario environment in execution order. Missing, extra, duplicated, reordered, failed, retried or mismatched scenarios fail qualification, as do missing/duplicate hosts/suites, mixed commits/packages, mismatched shard assignments, and omitted requested proxy coverage. Publication still requires all jobs plus the gate, the default branch, an explicit request and release-environment approval; its global lock is unchanged.

## Timing definitions

- **Elapsed time:** workflow creation to completion. An in-progress report ends at the last completed job and identifies jobs excluded from execution totals.
- **Combined job execution:** sum of completed job start/end intervals, including setup and teardown. Parallel intervals count separately. This is not elapsed time or GitHub billable-minute rounding.
- **Ready-to-start delay:** workflow creation to build start; build completion to integration start; all integrations complete to gate start. This includes scheduler delay and runner provisioning. GitHub does not expose a separate exact runner-queue timestamp.
- **Step timings:** setup, downloads, fixtures/checks and evidence/cleanup from the Actions API. Browser install/pull remains separately visible.
- **Fixture timings:** creation/authentication/media scan, historical downloads/comparisons, current population/query checks, browser polling and uninstall/teardown. Browser phase timings are nested inside the browser fixture interval and must not be added to that parent again.

The gate uploads an interim timing report. After completion, obtain final timing with `python3 scripts/ci/timings.py --run RUN_ID --output artifacts/final-timings.json`. Reports contain timings and public job metadata, not fixture credentials or request bodies.

Automatic development checks run once per PR update, on master pushes and on manual dispatch. A PR/ref concurrency group cancels superseded development checks. Branch pushes without a PR no longer run a duplicate build. Full qualification/publication retain their existing non-cancelling lock.

## Browser environment experiment

The benchmark compares ordinary Ubuntu installation with Microsoft's official Playwright **1.56.1 Noble** image pinned to `sha256:f1e7e01021efd65dd1a2c56064be399f3e4de00fd021ac561325f2bfbb2b837a`. The npm lock and Node 24.22.0 are unchanged. The image supplies browser/system dependencies; it does not replace the repository's Playwright package.

Fixture creation, Docker ownership and .NET/Python remain on the host. Only native browser scripts run in the image, with the same absolute repository and `/tmp` paths, the pinned host Node executable, Linux host networking and the disposable proxy CA. GitHub tokens and the Docker socket are not passed into that container. This is a Linux CI adapter, not a Docker Desktop networking change. [Playwright documents the supplied dependencies and version-matching requirement](https://playwright.dev/docs/docker).

[Benchmark run 40661175942](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/40661175942) used two clean Ubuntu runners per environment. All four jobs passed the same 24 startup/direct/reload cases, four Refresh cases, 14 failure recoveries, trusted native Caddy checks and persistent WebSocket checks on Jellyfin 12.4. Each independently built package had the same SHA-256 as the full qualification candidate.

| Measurement | Host install samples | Pinned image samples |
|---|---|---|
| Browser setup, including cold download | 48s / 34s | 26s / 26s |
| Complete job, including both native fixtures | 346s / 338s | 314s / 330s |

The image is adopted for qualification: this small experiment improved median setup by 15s and median complete-job execution by 20s, while avoiding the Ubuntu package mirror involved in the baseline's slow installs. Two samples do **not** establish long-term tail latency or reliability. The baseline browser-install median was already 21s; an image pull can be slower than a healthy host install. Full-run results below must distinguish this variability from the scenario split.

There is no custom image build, registry publication or cross-run package promotion. Maintenance consists of updating one upstream image digest together with the existing locked Playwright dependency; qualification additionally verifies the actual Chromium version, mounted Node version and Python support for sanitized failure diagnostics. The manual benchmark workflow remains available for remeasurement. The initial branch-only benchmark trigger was removed after the experiment; it is not an extra PR check.

[Benchmark evidence](evidence/ci-efficiency/browser-benchmark.json), [benchmark job timings](evidence/ci-efficiency/browser-benchmark-timings.json), and [baseline job timings](evidence/ci-efficiency/baseline-timings.json) are retained. No production version or public catalog change is part of this PR.

## Same-version fixture repairs

Current master already published v0.7.8 without updating the current-release documentation index. Existing hygiene assertions failed; the documentation pointers are corrected without a version or catalog change. Native catalog qualification also previously appended the candidate even when that version was already published. The private fixture now replaces only that version's local install entry, validates the unchanged public input first, and preserves every other revision. Native available/installed checks still expand all 26 revisions at both widths. These repairs permit CI-only changes to qualify the current version without inventing a new release.
