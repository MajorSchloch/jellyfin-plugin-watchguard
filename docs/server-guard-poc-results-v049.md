# Server deletion guard PoC qualification results

Date: 2026-10-15. **Decision: 1 — Feasible for the two tested native HTTP item-deletion actions on the pinned Jellyfin 12.2 build.** Both actions were intercepted before mutation; protected disposable files and native library records survived. This is not universal deletion enforcement, a production feature, or an approved confirmation protocol.

See [implementation and disposable installation/removal](server-guard-poc-v049.md). The unchanged published v0.4.8 DLL was downloaded and SHA-256 verified. No v0.4.9 production ZIP, public catalog change, production deployment or override endpoint was created.

## Evidence

- [Direct HTTP structured results](../experiments/ServerGuardPoC/evidence/direct/results.json) and [sanitized guard log](../experiments/ServerGuardPoC/evidence/direct/guard.log).
- [Base-path structured results](../experiments/ServerGuardPoC/evidence/basepath/results.json) and [sanitized guard log](../experiments/ServerGuardPoC/evidence/basepath/guard.log).
- Commands, image digest and published artifact checksum are in the implementation document and fixture.

**31 recorded scenarios passed in each deployment**, plus browser, unrelated-request, disable/re-enable, environment opt-out, uninstall and data-preservation assertions. The fixture checks the native item API and original filesystem paths before and after every applicable veto. Series/season assertions expand the original record snapshot to descendants, including all 300 episode files and records for the long series. This is stronger than an HTTP-status-only test. Missing-ID cases check that the existing companion targets survive; no file is invented for an ID that never existed.

| Scenario | Observed result in both deployments |
| --- | --- |
| Protected movie, series, season, episode | 409 `WatchGuardProtectionRequired`; files and records retained |
| Protected 300-episode series | 409; all original episode files/records retained |
| Unprotected movie | Native 204, one controller continuation; file/record gone |
| Unprotected two-item bulk | Native 204, one bulk-controller continuation, both files/records gone |
| Ordinary user without deletion permission | 401 before protection evaluation; media retained |
| Ordinary user with deletion permission | Generic 409 without usernames/history; media retained |
| User restricted from the library | 404 before protection evaluation; media retained |
| Unauthenticated | Native 401; media retained |
| API key, single and bulk | 403 `ApiKeyDeletionUnsupported`; no human identity substitution |
| Protected target last in native bulk | 409 before first mutation; earlier clear target retained |
| Duplicate IDs, parent/child overlap, empty/malformed bulk | 400; existing targets retained |
| Missing last bulk target | 404; earlier existing target retained |
| Unsupported native library root | Native CanDelete preflight rejects with 401 before scope evaluation |
| Corrupt watchlist JSON | 503 `ProtectionUnavailable`; clear target retained; original fixture JSON restored by test |
| Four simultaneous protected requests | Four 409s; media retained |
| Restart | Both action filters attached again; veto still preserves media |
| Native folder disable/re-enable | After restart: no new attachment and native deletion restored; re-enable/restart restores veto |
| Environment opt-out | Fresh process registers no guard; native deletion restored |
| Companion DLL removal | After restart no guard; baseline WatchGuard remains installed; native deletion restored |
| Watchlist/preferences data | Byte-identical after tests, restarts, disable and removal |

The allowed-path native-call claim is deliberately bounded: unit tests assert `next()` once, native tests record exactly one `ContinueNative` for each successful request and verify deletion of the expected files/records. Bulk contains two native target operations inside one native action. This is **not** an exactly-once distributed guarantee across request retries or process crashes. Four simultaneous *protected* requests were tested; racing clear deletions retain native semantics and were not claimed transactional.

## Browser qualification with the veto guard active

The fixture uses the actual Jellyfin Web detail menu, native confirmation and unchanged WatchGuard dialog. It observes a fresh Protection request for each attempt:

- Cancel: **zero DELETE requests**, generic native error, media preserved.
- Delete Anyway: **one DELETE request**, server 409, generic native error, media preserved.

The adapter was not disabled or replaced. The server PoC intentionally makes protected Delete Anyway unsuccessful. A secure approval protocol is required before this could replace production Web-only protection.

## Measured added work

The guard's stopwatch covers authorization-info retrieval, native visibility/permission preflight, scope resolution and fresh InterestService work, stopping **before** native action execution. It excludes native deletion, transport and post-test file/record assertions. These are small disposable SQLite fixture measurements, not production latency estimates or a before/after optimization claim.

| Operation | Direct guard preparation (ms) | Base-path guard preparation (ms) |
| --- | ---: | ---: |
| Protected movie, first measured call | 14.50 | 18.77 |
| Unprotected movie | 9.49 | 8.89 |
| Protected series, 300 episodes | 18.64 | 19.11 |
| Two-target bulk, protected last | 15.92 | 17.35 |
| Two-target unprotected bulk | 15.28 | 17.56 |

Three additional warm HTTP measurements (request latency only, excluding subsequent survival assertions):

| Operation | Direct range / median (ms) | Base-path range / median (ms) |
| --- | ---: | ---: |
| Protected movie | 10.72–15.29 / 11.20 | 12.14–12.55 / 12.53 |
| Protected 300-episode series | 20.80–21.90 / 21.61 | 23.73–24.90 / 24.30 |

The initial movie/series timings use one enabled account; later authorization/bulk scenarios include a second, restricted account. The two runs use independently generated equivalent fixtures, not an identical production database. No cross-request protection cache was added. Library size, user count, concurrent traffic and long-series safety failures can materially change cost. These measurements cannot establish production throughput or tail latency.

Four unrelated native/plugin GET requests caused **zero guard invocations/evaluations** by log-count assertion. This measures the guard, not all work done by WatchGuard's informational APIs. Scanning successfully populated the fixture before deletion tests. Existing standalone/WebSocket/Caddy regression evidence is recorded separately; the prototype was not inserted into arbitrary streaming or scheduled-job paths.

## Compatibility findings and failed setup attempts

1. Checking `Jellyfin.Api` assembly version against 12.2.0 failed safely: that assembly reports 1.0.0.0. The corrected gate uses native `ApplicationVersion` plus exact controller/method/route identity.
2. A separate plugin folder attached the filter but request-time dependency resolution failed before the filter body: the host could not resolve the WatchGuard assembly across plugin load contexts. Attachment alone was therefore insufficient. The passing fixture co-locates the companion DLL with the published WatchGuard DLL.
3. A second `BasePlugin` instance in the same folder competed over native plugin identity/metadata. The final companion contains only its service registrator/filter, leaving the published WatchGuard plugin as the sole plugin identity. An explicit disposable manifest makes disable/re-enable address the correct native version.
4. Native disable and uninstall require restart. The passing PoC is not independently manageable as a second Dashboard plugin. Its opt-in and removable companion assembly are development isolation, not a catalog-distribution design.
5. Version mismatch and incomplete action discovery are covered by unit models; another Jellyfin server version was not runtime-tested. Unsupported startup emits critical diagnostics and does not attach; it is not an all-server lockdown.

These findings rule out treating a registration message or a second DLL copied anywhere under plugins as a success criterion.

## Regression scope and next decision

Eight isolated unit cases passed: exact action/version matching, missing action, protected/clear continuation, lookup failure, pre-cancelled request, and native exception propagation. Existing backend and Web/bootstrap suites passed **105 and 53 tests** respectively, with production source unchanged. Four existing catalog unit tests also passed. The unchanged LinuxServer.io + Caddy disposable regression (`python3 tests/docker-smoke.py --linuxserver --caddy`, without the companion assembly) exited 0: native Web deletion paths, account/permission tests, settings/preferences, HTTPS compression/cache handling, authenticated WebSocket, stale tabs, CSP and uninstall passed. Its browser report recorded 13 expected native DELETE requests and zero ordering violations. This independently verifies that normal Delete Anyway behavior remains usable without the PoC. The complete historical catalog/migration/legacy/discovery/verification suite is preserved; this experiment does not claim those jobs were rerun or that they qualify a new production server guard.

Protection classification is delegated to unchanged InterestService. The native experiment primarily exercises explicit interest and query failure, while existing backend tests cover playback/CaughtUp semantics. It does not independently establish every playback permutation in a new server deployment.

Recommend a **separate follow-up design**, not automatic implementation: scoped one-use approval challenges, native permission rechecks, identity/target/state binding, API-key policy, expiry/replay protection, race/crash behavior, bulk semantics and Web integration. Keep the existing Web adapter until that protocol is proven. Unauthenticated or ordinary users must never receive cross-user history, and unsupported clients must remain blocked rather than silently approved. Internal service deletion and filesystem changes remain outside the two-action guard.
