# Activity index qualification

Status: validation in progress on `feature/background-activity-index`. No publication, deployment or production benchmarks. Final measured results will replace this working record before review.

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
