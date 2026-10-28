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

The matrix has **13 suites × 3 versions = 39 jobs**, up from 33. Base-path command times in the baseline were 181s catalog, 483s full browser, 156s navigation and 168s startup; the new groups are approximately 483s and 505s before setup. These are historical measurements, not a prediction of identical future timing. Activity splitting adds a separate seed/population cost, measured independently from the browser checks.

Long suites are listed first, interleaved across all hosts, to avoid placing a whole host's activity work behind short suites. GitHub controls actual admission; matrix order is not a guaranteed priority mechanism. The observed runner concurrency and delays must be included when comparing runs, rather than claiming the sum of job savings as wall-time savings.

`scripts/qualification-plan.json` is the shared command inventory for execution and the gate. Schema 2 evidence includes each scenario ID, exact command and scenario environment in execution order. Missing, extra, duplicated, reordered, failed, retried or mismatched scenarios fail qualification, as do missing/duplicate hosts/suites, mixed commits/packages, and omitted requested proxy coverage. Publication still requires all jobs plus the gate, the default branch, an explicit request and release-environment approval; its global lock is unchanged.

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

Measured results and the adoption decision will be recorded after the native benchmark and full qualification complete. No production version or public catalog change is part of this PR.
