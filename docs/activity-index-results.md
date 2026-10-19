# Activity index qualification

Status: review branch after published v0.5.2. No publication, deployment or production benchmarks. Native measurements below are completed; the latest hosted matrix status is recorded separately.

The first separate commit synchronizes current documentation with published v0.5.2. The design and backend are separate commits. Existing protection/approval services and standalone loading are unchanged.

## Observed failures and corrections

- The first official browser run found an assertion that counted every checked input rather than the status-filter controls. The new older-interest checkbox exposed that invalid selector. Restricting the selector to `.watchguard-filter input:checked` preserves the original zero/three status assertions.
- The second complete official-image run passed settings/preferences, the existing native browser deletion and cancellation paths, and uninstall checks. Newer focused changes still require final qualification.
- The first native benchmark attempt could not download the baseline through this machine's Python certificate configuration. It produced no comparison result. The fixture now uses verified TLS through `curl`, retaining mandatory SHA-256 verification and downloading before expensive seeding. No insecure certificate bypass was added.

Unit and browser-model results are not native SQL timing claims. The user-supplied production observation remains separate from these fixtures.
- The second native run completed population but its one-second readiness polling allocated full result snapshots, exhausting the eight-per-account pagination quota. The assertion correctly failed at 25 results with `PaginationCapacity`. A separate authenticated `/ActivityIndex/Status` endpoint now reports scoped progress without allocating snapshots or querying episodes; fixtures use that endpoint. The quota was not increased.

## Initial native comparison (before background batch grouping)

The third attempt passed on the official pinned image, .NET 10, Docker Desktop, generated media only. [Raw evidence](evidence/activity-index/native-initial.json) includes repeated samples and population progression. Seven accounts, 120 completed movies and one continuing 300-episode series; six accounts have viewing data. Exact per-item/per-user reasons, counts, native dates and extra-episode payloads match every returned published-v0.5.2 result.

| Read | Published v0.5.2 median | Indexed first-page median | Coverage returned |
| --- | ---: | ---: | --- |
| One viewing user | 170.73 ms | 45.95 ms | Old: 100 titles; index: 25 first page / 121 across pages |
| All users | 685.13 ms | 237.33 ms | Old: 100 titles; index: 25 first page / 121 across pages |

These are **different response sizes**, not a claim that a full 121-title view is faster by those ratios. Cold population including restart took 283.19 seconds with deliberate two-second worker pacing. Native verification itself accumulated 1,700.43 ms, 6 episode queries / 1,800 episode rows, and 1,452 playback batch calls for 726 user/title verifications. Warm reads performed no native playback batches; native visibility checks still cost time. A manual unplayed change settled in 2,838.65 ms without a Refresh request. Native scheduled-task discovery and uninstall passed.

This measurement motivated retaining the prior per-account native playback batching inside each eight-pair background slice. The final qualification must measure that change separately and include full-view pagination timing. No claim is made about the user's much larger production library or production latency.

## Qualified native comparison

[Measured evidence](evidence/activity-index/native-qualified.json), runtime `0e09fb7cf169ac13d29cf6aa1473cb410243fdf0`, official pinned Jellyfin 12.2 image, identical database and generated media to the published DLL. One warm-up and three measured first-page requests; full pagination measured separately once. The subsequent changes to range labels/checkbox alignment do not change these server queries.

| Scope | v0.5.2 median / returned titles | Indexed first-page median / titles | Indexed full view / titles |
| --- | --- | --- | --- |
| One viewing user | 172.08 ms / 100 | 12.40 ms / 25 | 73.86 ms / 121 |
| All users | 677.01 ms / 100 | 20.98 ms / 25 | 113.60 ms / 121 |

All overlapping item IDs, owner IDs, reasons, episode counts, native playback dates and extra-episode details matched the published result exactly. Later discovery pages reached 21 more titles; no duplicate cards/IDs. These measurements are not an extrapolation to the user's seven-account production observation: this fixture is movie-heavy with one 300-episode series, not 109 varied series. No production under-five-second guarantee is made.

Cold population including restart: **282.60 seconds**. Across 62 discovery pages and 726 user/title verifications, the worker recorded 6 episode queries, 1,800 episode rows, 230 playback batches, and 1,028.74 ms in verification. It retained 444,373 serialized row bytes; this is not measured managed heap allocation. The initial implementation's 1,452 playback calls became 230 through bounded per-account batching. The worker deliberately pauses between slices; cold wall-clock duration is dominated by pacing and discovery/checkpoint overhead, not classification alone.

Warm queries did not call native playback batches or repeat classification. Full pagination still performed 2 native episode visibility queries for one user and 7 for all users. Request-local account lookup reuse reduced repeated native account queries; permissions and episode visibility still run freshly. The preceding intermediate build's all-user full view took 1,428.20 ms; that finding led to account lookup reuse rather than hiding the cost behind a smaller first-page measurement.

A manual native unplayed update settled in **3,749.37 ms**, without Refresh or restarting discovery. The native scheduled task was discovered, started, observed running, cancelled and observed idle. Uninstall retained personal JSON and left Web files unchanged. Repeated-run performance variation and the small number of full-pagination samples remain limitations.

## Regression evidence and failures retained

- Local backend: **239 passed**, including 27 index cases (theory rows included): later discovery, exact fresh classification, policy/episode visibility, live sessions, history expiry, corruption, atomic write failure, restart, cancellation, overlapping worker calls, delayed/repeated events, stale-result fencing, removed items/accounts, pagination binding and expiry. Models establish contracts, not native SQL timings.
- JavaScript/bootstrap/approval/readiness: **116 passed**. Existing deletion assertions remain unchanged. New indexed cases cover range URLs, no implicit preference saves, local sorting, stable cards, late identity responses, loading and malformed status.
- [Hosted run 39235289437](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/39235289437), earlier runtime `fcdaa81`: build and all eleven integration jobs passed, `proxy_matrix=true`, publication skipped. This preceded final batching/policy/account-cache changes and is not represented as qualification of those changes.
- [Hosted run 39237527560](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/39237527560), runtime `0e09fb7`: WebSocket browser initialization failed before authentication. Console evidence recorded failed bootstrap assets with `ERR_NETWORK_CHANGED`; its duplicate login loop only recognized a rejected top-level navigation and instead timed out waiting for the login field. The native Caddy WebSocket probe passed before that browser failure. This is preserved as a failed run, not erased by a retry.
- Test-only fix `67cf9aa` removes that duplicate loop and uses the existing shared login contract, which observes bootstrap request failures and permits precisely one evidenced pre-authentication navigation retry. Authentication, approvals and deletion are never retried. Sanitized first-attempt evidence and trace lifecycle handling remain intact. The focused LinuxServer/Caddy WebSocket suite passed locally afterward.
- The same hosted run also found an invalid initial empty-state timing assumption in the Caddy browser suite: the screenshot showed truthful background population, while the test required a completed empty view within ten seconds. The assertion now permits 45 seconds for the documented thirty-second visible-page poll plus native response time. It still requires the exact completed empty state, and performs no mutation retry.
- Local base-path validation caught the new range summary missing the visible “not exhaustive” caveat. The wording was corrected, retaining the original browser assertion.
- Superseded queued runs were cancelled, not counted as passes. Latest hosted runtime validation: [39239540985](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/39239540985), runtime `033a859`, `publish=false`, `proxy_matrix=true`; result pending at this documentation checkpoint.

Desktop and narrow screenshots from the disposable official-image base-path fixture (1280 and 390 px): [desktop](screenshots/activity-index/desktop.png), [mobile](screenshots/activity-index/mobile.png). These show independent explicit memberships with the new controls and truthful freshness/coverage, before automatic activity is seeded. Existing later browser scenarios exercise playback and extra-episode details.

## Scope of evidence

The existing full matrix retains official/LinuxServer, Caddy HTTPS, base path, native catalog, migration/rollback, WebSocket, discovery and verification suites. The new activity-index job adds exact published-DLL comparison and paced population. Existing protection/approval/standalone source is unchanged. Native policy permutations and alternate versions remain exercised by existing verification regressions; index-specific policy changes additionally have deterministic suppression tests. A production-sized heterogeneous index and heap profiling have not been measured.
