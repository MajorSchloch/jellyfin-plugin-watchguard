# Shared enforcement baseline

Qualification [42468878414](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/42468878414), attempt 1, failed before native enforcement tests began. The 12.4/enforcement, 12.3/enforcement and 12.4/platforms jobs each received HTTP 504 from the same public v0.4.8 ZIP URL. The platforms job includes base-path and LinuxServer suites; its first suite failed before the second could run.

## Setup and consumers

The qualification build job now fetches v0.4.8 once with `scripts/enforcement_baseline.py`. It reuses PR #72's anonymous fallback transport: one public attempt, then at most three API attempts per asset. ZIP and checksum share a 120-second deadline, with a 10-second connection limit and 30-second attempt limit. Both asset IDs come from one verified public release. API byte requests use `Accept: application/octet-stream` without credentials. Publisher public-URL checks are unchanged.

The fixed ZIP SHA-256 remains `06f33f62d06d864b63c879213ec1b3536d81c8ebb0ab7ac186b6820580aa24d5`. Setup checks it against the release digest, then verifies actual bytes, ZIP structure, checksum sidecar and catalog installation metadata. Only successful verification creates the shared artifact.

The build job uploads `WatchGuard-enforcement-baseline-attempt-N` and passes its exact artifact ID to the three consumers. These downloads use the same run's build output; there is no latest-artifact lookup. The platforms job retains the input between its two sequential suites.

Each enforcement invocation reads the local ZIP and checks the fixed pin **before** opening it or extracting the DLL. Missing or corrupt input stops the suite. Consumers cannot download this baseline from GitHub. Their results record the ZIP/DLL identity, pin verification and input artifact ID. Enforcement, approvals, permissions, catalog upgrade, data preservation and rollback assertions remain intact.

For a local enforcement fixture, run `python3 scripts/enforcement_baseline.py` once before `python3 tests/run_shard.py enforcement` or `platforms`. Use the pinned tools documented in [fixture setup](fixture-lifecycle.md). A local consumer needs only the verified ZIP at `artifacts/enforcement-baseline/Jellyfin.Plugin.WatchGuard-v0.4.8.zip`; it does not need API credentials or network access for that file.

## Active-download audit

The audit follows `scripts/qualification-policy.json`, the suite runner and the branches in `tests/docker-smoke.py`.

| Download | Active path and result |
|---|---|
| v0.4.8 enforcement baseline | Four suite invocations across three jobs. Centralized by this patch; all consumers verify the pin locally. |
| Previous stable, currently v0.7.16 | Already fetched and verified once by `scripts/previous_stable.py`; shared with both direct-upgrade jobs. PR #72's fallback remains unchanged. |
| v0.5.2 activity comparison | Retained optional code in `activity-index-native.py`. Required activity-index sets `WATCHGUARD_CURRENT_ONLY=1`, so it does not fetch this release. |
| v0.6.0 activity comparison | Retained optional code in `activity-browser-native.py`. The activity-index suite invokes its comparator with `WATCHGUARD_CURRENT_ONLY=1`, so no historical download occurs. The separate activity-browser suite uses `prepare_browser` and `activity-browser-ui.cjs`. |
| Old Injector, standalone catalog and preference ladders | Optional flags are absent from the current policy. These paths use separately supplied historical inputs and remain outside mandatory qualification. |
| Native catalog listing / candidate upgrade | Uses the exact local candidate through a disposable fixture HTTP server. No hardcoded GitHub package fetch. |
| Chromium 79 / Docker images / browser dependencies | Still external setup dependencies, with existing version/digest checks. They are not WatchGuard release downloads and are unchanged. |

No other hardcoded WatchGuard release download is active in the required suites. Optional historical fixtures and their evidence remain available. This patch does not reduce the matrix or change test requirements.

## Validation

Fast regressions check the shared fallback, immediate pin/catalog conflicts, corruption before extraction, missing-input recovery instructions, offline consumer reads and artifact retention between suites.

For a hosted transport proof, dispatch **Build and test WatchGuard** with `enforcement_baseline_probe=true`. It injects public 504s but downloads the real API bytes, verifies the unchanged pin, exercises four offline reads and rejects controlled corruption before extraction. Native suite results are separate evidence.

Hosted probe results, affected integration jobs and unchanged candidate hashes will be recorded here after validation. No plugin version, published catalog, release asset, approval or permission changes.
