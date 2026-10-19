# Activity index qualification

Review branch after published v0.5.2; no publication or production deployment. Corrected runtime: `50039a0793c7fa666d3c1e9cc6090ca392780db6`. Its full qualification is recorded below; pre-review evidence on `66733b0` remains separately labelled. The supplied 7,772.52 ms / 680 episode queries / seven-account production observation is not our benchmark. Existing protection/approval services and standalone loading remain unchanged.

## PR #39 review corrections

Review baseline: `c638515`. Focused tests reproduced incomplete owner pagination (three 1,000-episode series, seven owners and a separate administrator; also one series with 25 owners), idle checkpoint writes, a poll/Load more race and 401/403 retention of cross-user results. These defects were not covered by the earlier passing matrix.

- Continuations now preserve the first unfinished owner, with a bounded title/owner identity snapshot. Every page rechecks current rows, native policy and episode visibility. The 20,000-row visibility budget is unchanged; oversized titles progress over multiple pages without dropping eligible owners.
- Poll replacement and Load more use one in-flight slot. Explicit refresh fences old responses. Deferred-response tests cover both operation orders and both refresh/old-page response orders; repeated titles merge owners without replacing posters.
- Authorization denial clears every protected result, owner directory and continuation, invalidates competing responses and stops polling. Tests cover initial load, refresh, polling and pagination with both 401 and 403, including denial before/after a concurrent refresh response. Ordinary service failure retains usable results.
- Persisted-state revisions prevent idle rewrites. Tests use actual checkpoint files to verify unchanged idle timestamps/bytes, cursor-only deadlines/final flush, row/queue consistency across restart, debounced queue recovery and dirty state after a failed atomic write.

Local checks after the corrections: **250 backend, 132 JavaScript/bootstrap/approval/readiness, 14 Python and 4 catalog tests passed**. **Build and all eleven hosted integration suites passed** in [39250890240](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/39250890240) on exact commit `50039a0793c7fa666d3c1e9cc6090ca392780db6`, with `publish=false`, `proxy_matrix=true`; publication was skipped. [Structured qualification evidence](evidence/activity-index/review-fixes-qualification.json) records every job outcome and focused regression. No qualification jobs were retried; a local status-monitor connection timeout was resolved by resuming read-only monitoring of the same run. No deletion, approval, protection or standalone-loader code was changed.

### Corrected-runtime native comparison

The completed [activity-index suite evidence](evidence/activity-index/hosted-review-summary.json) is from commit `50039a0793c7fa666d3c1e9cc6090ca392780db6`, run [39250890240](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/39250890240). The fixture and exact published v0.5.2 checksum are unchanged: seven accounts, 120 completed movies and one 300-episode continuing series, on the same disposable native database.

| Scope | Published v0.5.2 median / 100 titles | Indexed first-page median / 25 titles | All 121 indexed titles |
| --- | ---: | ---: | ---: |
| One viewing user | 149.44 ms | 12.42 ms | 55.15 ms |
| All users | 765.12 ms | 29.58 ms | 115.35 ms |

Cold population took **278.51 s**, with 62 discovery pages, 726 verified pairs, six episode queries, 1,800 episode rows and 228 playback batches. Manual unplayed activity settled in **3.25 s**. Exact overlapping item/owner IDs, reasons, counts, dates and extras matched the published baseline; all 121 indexed titles were reached. Native scheduled-task start/cancel and uninstall passed. This is a movie-heavy native regression fixture, not a reproduction of the three-series visibility-budget model or a production performance guarantee. Three measured first-page samples follow one warm-up; full pagination is measured once.

## Pre-review native comparison

[Measured evidence](evidence/activity-index/native-final-summary.json): exact checksum-verified published v0.5.2 DLL versus the candidate on the same disposable database, official pinned Jellyfin 12.2 image, .NET 10, Docker Desktop. Seven accounts, 120 completed movies and one continuing 300-episode series; six accounts have playback data. One warm-up and three measured first-page requests; full pagination measured separately once.

| Scope | v0.5.2 median / returned titles | Indexed first-page median / titles | Indexed full view / titles |
| --- | --- | --- | --- |
| One viewing user | 185.63 ms / 100 | 15.45 ms / 25 | 65.08 ms / 121 |
| All users | 664.65 ms / 100 | 27.89 ms / 25 | 109.36 ms / 121 |

Every overlapping item ID, owner ID, reason, episode count, native playback date and extra-episode object matched the published result exactly. Later discovery pages reached 21 additional titles without duplicate IDs. The final snapshot prioritizes live/current interest before history, so the first page includes the continuing series and its native visibility work.

These are API response timings including serialization/network transfer, not browser paint timings. First-page and full-view response sizes differ. This fixture is movie-heavy with one long series, not the supplied heterogeneous production library. No production latency guarantee or production-scale SQL claim is made. Browser layout, progressive rendering, identity and lifecycle behavior are tested separately.

Cold population including restart: **280.87 seconds**. Across 62 discovery pages and 726 user/title verifications, the worker recorded six episode queries, 1,800 episode rows, 228 playback batches and 993.32 ms of verification. Deliberate two-second pacing dominates wall-clock population time. Retained serialized row size was 444,356 bytes; this is not measured managed heap allocation.

Warm reads performed no playback batches or classification. Full pagination still performed two native episode visibility queries for one owner and seven for all users. Permissions are not inferred from a visible parent or from another account's policy.

A native manual unplayed update settled in **3,004.55 ms**, without Refresh. The scheduled task was discovered, started, observed running, cancelled and observed idle. Uninstall retained personal JSON and the stopped worker's derived checkpoint, removed the loader/asset endpoint, and left Web files unchanged. Full-view repeated-run variation and heterogeneous large-library heap usage remain unmeasured.

### Pre-review hosted repetition

[Independent hosted evidence](evidence/activity-index/hosted-final-summary.json), same `66733b0` runtime and fixture, Ubuntu runner:

| Scope | v0.5.2 median / 100 titles | Indexed median / first 25 | All 121 indexed titles |
| --- | ---: | ---: | ---: |
| One viewing user | 155.53 ms | 18.18 ms | 76.21 ms |
| All users | 936.66 ms | 37.39 ms | 152.48 ms |

Cold population: 279.96 s; incremental manual unplayed update: 2.89 s. Exact classification comparison, native task cancellation and uninstall passed. Different host load and native timings produce different absolute numbers; these repeated fixtures still do not establish production latency.

## Pre-review automated results

- Local backend: **243 passed**, including 31 index cases (theory rows included): later discovery, exact fresh classifications/progress/dates/extras, native policy and episode visibility changes, live sessions, primary versions and ancestry, active-first paging, history expiry, corruption, atomic-write failure, restart, cancellation, overlapping worker calls, repeated/missed events, stale-result fencing, removed items/accounts, pagination binding/expiry and truthful coverage flags.
- JavaScript/bootstrap/approval/readiness: **116 passed**. New indexed cases cover range URLs, no implicit preference saves, local sorting, stable cards, late account responses, loading, malformed status, retained cards on refresh failure and clearing denied activity. Existing deletion assertions remain unchanged.
- Python infrastructure/hygiene: **14 passed**. Catalog: **4 passed**.
- Local LinuxServer/Caddy WebSocket and stopped-worker uninstall checks passed. Local official-image base-path browser scenarios passed native movie/series/context/bulk deletion, fresh checks, zero-delete cancellation and the new range controls; its subsequently exposed uninstall-test race is documented below.
- [Final hosted matrix 39244025441](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/39244025441), runtime `66733b0`, `publish=false`, `proxy_matrix=true`: **build and all eleven integration suites passed; publication skipped**. This qualified the pre-review runtime; it does not qualify the subsequent PR #39 corrections.

The matrix retains official/LinuxServer, Caddy HTTPS, base path, native catalog, migration/rollback, WebSocket, discovery and verification suites, plus the new activity-index job. Earlier [39239256322](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/39239256322) passed the build and all eleven integration suites on `05e0c0a`, publication skipped. That pass includes batching/policy/account-cache changes, but is not attributed retroactively to the subsequent fixes. [39235289437](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/39235289437) also passed all eleven suites on the earlier `fcdaa81` implementation. Superseded queued/running validations were cancelled and are not counted as passes.

[Desktop screenshot](screenshots/activity-index/desktop.png) · [390 px screenshot](screenshots/activity-index/mobile.png), from the disposable official-image base-path fixture. These show explicit memberships and the new controls before automatic playback is seeded; later scenarios exercise playback and +N details. Screenshots are not evidence of production performance.

## Failures found and corrected

| Evidence | Finding | Correction / retained assertion |
| --- | --- | --- |
| First official browser run | A selector counted the new older-interest checkbox as a status filter. | Scope it to `.watchguard-filter input:checked`; retain exact zero/three status assertions. |
| First native benchmark attempt | Local Python certificate configuration prevented the baseline download. | Use verified TLS through curl and mandatory published SHA-256 verification, before seeding. No insecure bypass. |
| Second native benchmark attempt | One-second readiness polling allocated full paging snapshots and hit the eight-per-account quota. | Separate authenticated `/ActivityIndex/Status` polling; no snapshot or episode query. Quota unchanged. |
| [39237527560](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/39237527560), WebSocket | Bootstrap assets failed with `ERR_NETWORK_CHANGED`; a duplicate login helper only recognized a rejected top-level navigation. | Reuse shared readiness, including one evidenced pre-authentication navigation retry and retained sanitized evidence. Never retry authentication, approvals or DELETE. |
| Same hosted run, Caddy browser | Ten-second empty-state assertion ran while background population was correctly visible. | Permit 45 seconds for the documented thirty-second open-page poll plus response time. Still require the exact completed empty state; no mutation retry. |
| Local base-path browser | New range summary omitted the visible “not exhaustive” caveat. | Restore wording and preserve the original browser assertion. |
| Local base-path uninstall | Generic `*.json` comparison captured a derived file while its worker could still checkpoint before shutdown. | Compare personal data from before uninstall; require derived file survival at shutdown, then byte-compare that stopped-worker checkpoint across restart. Corrected LinuxServer/Caddy check passed. |
| Focused coverage/privacy models | Finished bounded discovery could leave `DiscoveryLimited` false; one aggregate work counter was visible to ordinary users. | Keep coverage limits distinct from pass completion; all aggregate worker counters are administrator-only. |
| Focused alternate-version model | A live alternate movie produced two cards instead of one primary title. | Use v0.5.2's native primary-version selection before ancestry resolution in discovery/live reads. Check native visibility and linked-episode ancestry. |
| Focused pagination model | Arbitrary ID ordering buried current activity behind completed-history pages. | Freeze active-first snapshot ordering; local Web filtering/sorting and deterministic continuation remain intact. |

No deletion/security assertion was weakened. No failed or ambiguous DELETE or approval was retried. Failed runs remain failed evidence.

## Earlier measurements and limits

[Initial local evidence](evidence/activity-index/native-initial.json), before per-account background batch grouping: 1,452 playback batch calls for the same 726 pairs; cold population 283.19 s. Batching reduced those calls to 228 in the final local fixture. An intermediate all-user full view took 1,428.20 ms; that finding led to request-local native account lookup reuse rather than concealing the cost with a smaller first page.

[Pre-final local evidence](evidence/activity-index/native-qualified.json), runtime `0e09fb7`: cold 282.60 s, incremental 3.75 s, all-user first page 20.98 ms / 25 titles and full view 113.60 ms / 121. [Independent hosted evidence](evidence/activity-index/hosted-summary.json), run 39239256322: cold 277.76 s, incremental 3.00 s, all-user first page 19.51 ms and full view 101.64 ms; published baseline median 610.16 ms / 100 titles. Those measurements preceded active-first pagination and are not the final first-page claim.

Condensed evidence files retain original measurements and first/last population samples; only repeated intermediate samples are omitted. Full hosted samples remain in the named Actions artifacts. Models establish contracts, not native SQL improvements. Existing native verification suites retain policy/version permutations; index-specific policy changes additionally have deterministic suppression tests. A production-sized heterogeneous index and heap profiling have not been measured. See [architecture, scheduling, recovery and rollback limitations](activity-index.md).
