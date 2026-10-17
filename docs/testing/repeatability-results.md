# Repeatability qualification

Status: **PASS — three consecutive complete hosted validations on one unchanged candidate.**

Qualified source commit: `d37ea34ed01bf8c1a6266b006e0fcbc307b8ac2a` on `test/reliability-v049`. The follow-up report commit changes documentation only; the qualified executable/test source remains this commit.

| Run | Result | Total workflow seconds | Publish |
|---|---|---:|---|
| [39021321550](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/39021321550) | All 11 required jobs PASS | 647 | Skipped |
| [39022040613](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/39022040613) | All 11 required jobs PASS | 864 | Skipped |
| [39022944599](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/39022944599) | All 11 required jobs PASS | 651 | Skipped |

Total workflow duration includes orchestration; job durations below include setup and artifact transfer. Native fixture phases are measured separately. All runs used `publish=false` on 2026-10-17. No code changed between them.

## Full job matrix

| Job | Run 1 seconds | Run 2 seconds | Run 3 seconds |
|---|---:|---:|---:|
| build | 53 PASS | 53 PASS | 57 PASS |
| Integration / websocket | 129 PASS | 122 PASS | 124 PASS |
| Integration / discovery | 291 PASS | 303 PASS | 307 PASS |
| Integration / verification | 588 PASS | 807 PASS | 588 PASS |
| Integration / legacy | 352 PASS | 354 PASS | 377 PASS |
| Integration / server-enforcement-linuxserver | 290 PASS | 269 PASS | 312 PASS |
| Integration / server-enforcement | 247 PASS | 273 PASS | 282 PASS |
| Integration / basepath | 251 PASS | 273 PASS | 268 PASS |
| Integration / server-enforcement-basepath | 257 PASS | 259 PASS | 265 PASS |
| Integration / standalone-caddy | 480 PASS | 475 PASS | 488 PASS |
| Integration / migration | 315 PASS | 315 PASS | 291 PASS |

## Retained phase measurements

Ranges across the three runs, in seconds. Setup ends at indexing. Scenario time is the sum of recorded scenario phases, not isolated CPU time. Verification and legacy profiles intentionally execute multiple fixtures; individual setup/indexing values are not added together below. Browser values cover the labeled readiness contracts, including expected CSP-block transitions.

| Profile | Setup range | Indexing range | Browser readiness range | Scenario phase sum range |
|---|---:|---:|---:|---:|
| basepath | 19.620–21.213 | 2.526–3.620 | 0.334–1.220 | 154.792–159.115 |
| discovery | 17.285–21.493 | 2.439–3.622 | n/a | 180.159–205.564 |
| legacy | 19.936–21.580 | 2.512–3.646 | 0.480–0.808 | 223.925–233.297 |
| migration | 18.271–25.348 | 2.364–3.583 | 0.367–1.484 | 183.877–215.765 |
| server-enforcement | 13.879–19.190 | 9.633–14.208 | 1.458–3.334 | 145.624–179.730 |
| server-enforcement-basepath | 18.045–19.646 | 13.177–14.235 | 2.374–3.427 | 153.735–156.733 |
| server-enforcement-linuxserver | 17.941–22.073 | 10.689–14.271 | 1.334–3.324 | 161.732–196.709 |
| standalone-caddy | 21.291–25.723 | 2.427–3.620 | 0.418–1.199 | 362.344–380.101 |
| verification | 14.857–21.204 | 2.314–2.585 | n/a | 445.731–660.255 |
| websocket | 19.762–25.047 | 2.365–2.592 | 0.932–1.131 | 20.493–22.295 |

Every profile recorded zero browser setup retries, zero suite retries and one image-pull attempt. No destructive retry exists. Full structured measurements are in [repeatability-evidence.json](repeatability-evidence.json); per-run GitHub artifacts retain inventory, phase, browser, catalog and benchmark evidence. Local downloaded copies are under ignored `artifacts/reliability/qualification-d37/`.

## Build and security gates

Each hosted build passed 147 backend tests, 86 JavaScript/bootstrap/server-enforcement tests, six infrastructure tests and four catalog tests, plus published-baseline model comparisons and reproducible packaging. The full native enforcement suites retained 74 cases per image/path profile and their browser/rollback checks. All previous deletion, privacy, replay, expiry, file/record survival and exact native continuation assertions remain in place.

All three downloaded ZIPs match their mandatory checksum file and the locally reproduced SHA-256:

`5cc5cd51e1a9f666a4abdbda07b1ad08b8d8ab9480edbad0dbd23fc53440be6d`

Production plugin source and `manifest.json` are unchanged relative to task baseline `1331f9b053c889b7e3b520400692e39363b99b49`. No release was published and no production configuration, media or catalog was changed.

## Earlier failures and local qualification

Runs [39018184819](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/39018184819) and [39018516426](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/39018516426) passed diagnostic matrices on earlier commits; they do not count toward the three-run gate. First frozen attempt [39020241837](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/39020241837) failed the settings refresh completion assertion. Its artifacts remain retained. The test completion contract was corrected, focused LinuxServer migration/native UI passed, and the sequence restarted at the qualified commit. It was not rerun unchanged to hide the failure.

Local investigation also completed official/LSIO/base-path enforcement, native UI, migration/rollback, legacy, standalone/Caddy, WebSocket, discovery and verification profiles. Those working-tree runs establish focused evidence but are not claimed as three immutable-candidate passes. Hosted results above are the repeatability evidence.

## Recommendation and remaining uncertainty

The requested repeatability gate is met; lifting the **test-infrastructure release freeze** is reasonable for this qualified source. Publication and production deployment still require explicit approval. Three passes demonstrate improved stability, not absence of future flakes or a new production security review.

Historical logs cannot establish every original render/scan failure cause. One local native package-install timeout during investigation remains causally unexplained; it was not retried, and subsequent diagnostic plus all three qualifying catalog/migration matrices passed. Preserve that residual risk and investigate any recurrence from first-failure evidence. See [reliability-analysis.md](reliability-analysis.md) for confirmed findings versus hypotheses.
