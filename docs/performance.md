# WatchGuard v0.2.2 — detail UI and overview performance

> The v0.2.2 measurements below are retained. See the [v0.2.3 activity measurements](#v023-activity-measurements) for the additional bounded history query and current UI.

Target: Jellyfin Server/Web **12.2**, .NET 10. No production deployment. Watchlist schema 1, plugin GUID, `watchguard-v1`, native InterestService and the deletion adapter remain unchanged.

## Header placement and responsive behavior

Inspected the pinned [12.2 detail template](https://github.com/jellyfin/jellyfin-web/blob/61b1f890365ad15138e943e694af723c1d47df2a/src/apps/legacy/controllers/itemDetails/index.html) and [native layout styles](https://github.com/jellyfin/jellyfin-web/blob/61b1f890365ad15138e943e694af723c1d47df2a/src/styles/librarybrowser.scss), then verified the running Docker DOM/screenshots. Both modern and legacy shells use this template. `.detailRibbon` contains `.infoWrapper` (title and metadata) followed by `.mainDetailButtons`. Desktop uses a flex ribbon with a fixed height and a floated poster; mobile uses block flow.

WatchGuard appends one owned `.watchguard-header` inside `.infoWrapper`, after its metadata and before the native action row in document order. The separate bookmark toggle remains beside Favorite/More in `.mainDetailButtons`. No native buttons are moved, replaced or re-ordered. No numeric badge or popover remains. Admin usernames/reasons render immediately using text nodes. Episodes/seasons label their verified **Series** scope and continue to toggle only series membership.

Names/reasons wrap across available horizontal space. Long names truncate individually with their full text in a native title tooltip; reasons remain text. The region scrolls after three lines, bounding layout growth. Loading and lookup errors are explicit; zero interest is shown only after a successful protection response. Regular users receive no cross-user request or populated interest indicator. Own membership errors appear in normal header flow.

A narrow desktop viewport originally squeezed the native title column to a few characters. Below 50em, only ribbons containing WatchGuard's owned header adopt native mobile-style block flow, full container width and automatic height while retaining native poster padding. The native action container follows normally. An initial flex-wrap attempt interacted badly with the floated poster and was rejected during screenshot review. There are no absolute positions or arbitrary offsets for interest text. CSS `:has()` scopes the adjustment and automatically stops applying when the owned header is removed.

DOM anchors and CSS remain version-specific, not a public plugin UI contract. Chromium at 390/1280 px and both desktop shells are verified. Other browsers, native mobile/TV layouts, custom themes, translated layouts, multi-server/base-path configurations and unusually large action toolbars require revalidation. The existing lifecycle check is reused; no broad MutationObserver or extra polling was added.

## Profiling before changing behavior

Baseline: v0.2.1 repository commit `116c0ff7f1faee45fb6985dae8e51cb2f16ae204`, with **timing instrumentation only**, measured before implementing progressive loading. After: v0.2.2 progressive implementation. Both used the pinned official Docker image and Injector from [deployment.md](deployment.md), fresh temporary configuration, synthetic media and the same seeded dataset:

- Four enabled accounts: administrator plus three viewing users.
- Ten movies, three series, ten available episodes; 39 explicit memberships.
- Each viewing user has one resumed movie and one completed episode in each incomplete series.
- Seven serial HTTP samples per endpoint after one warm-up; five Chromium page visits at 1280 × 900.

`OverviewTiming` records fixed stage names and elapsed milliseconds only when **DiagnosticMode=true**. Discovery timings include native query plus candidate ID/parent/visibility resolution, summed across accounts. Verification includes all series/user aggregation, native episode and playback reads, result construction and sorting. Store read is separate. `SerializationAndWrite` is measured around actual MVC result execution: **serialization plus response writing**, not isolated CPU serialization, and not a second artificial serialization. Explicit retrieval includes the store read and native per-owner visibility/name lookups; authorization and miscellaneous request overhead are outside these stage totals.

Client timing uses test-only Resource/MutationObservers: navigation to first card insertion and response-end to first insertion. The latter includes native client promise/JSON handling and DOM construction; it is not a pure layout/paint benchmark. Production uses neither observer. Diagnostic logs are aggregated only during isolated serial requests; overlapping production requests cannot be reliably correlated with these intentionally identifier-free logs.

Raw results: [before](performance-data/before.json), [after](performance-data/after.json). Milliseconds below are mean server-stage time per request or median HTTP/client time as labelled.

| Measurement | v0.2.1 | v0.2.2 |
| --- | ---: | ---: |
| Explicit membership retrieval, server | 67.49 | 71.46 |
| Membership store read inside overview | 0.30 | 0.00 — skipped in automatic mode |
| Native resume discovery, server | 18.95 | 23.88 |
| Played-episode discovery, server | 14.99 | 16.86 |
| Series/user verification, server | 99.54 | 41.25 |
| Overview serialization + response writing | 0.15 | 0.20 |
| Explicit-list serialization + response writing | 0.10 | 0.22 |
| Explicit endpoint HTTP round trip | 77.58 | 81.72 |
| Combined overview / automatic-only HTTP round trip | 156.35 | 104.83 |
| Navigation to first cards, browser | 169.60 | 95.60 |
| Response-end to first card insertion, browser | 3.50 | 2.20 |
| Server requests on filter/sort change | 1 overview each | 0 |

Baseline verification dominated. The new automatic request verifies only playback/session candidates, avoiding explicit-only titles; the existing explicit endpoint handles membership visibility without playback aggregation. Serialization/rendering were small costs. Native query timings varied slightly between fresh containers; this is a small warm fixture, not a production-scale throughput claim.

**Perceived loading improves, not every end-to-end metric.** Median first cards arrive about 44% earlier. Completing both sequential sources took a median 222 ms in the after browser run; baseline first cards already contained the combined result at roughly 170 ms. The extra explicit request has a cost, deliberately paid to show useful memberships sooner and keep expensive discovery off filter changes. Playback-only results must wait for discovery. There is no claim that all automatic results arrive sooner on every server.

## Progressive request and merge contract

1. Resolve the current native account. Administrators request unchanged `GET /WatchGuard/Watchlists`; regular users request unchanged `GET /WatchGuard/Watchlist`.
2. Validate and render explicit memberships immediately, with a **Loading viewing interest…** status. Do not show a final empty state yet.
3. Request `GET /WatchGuard/InterestOverview?automaticOnly=true`, or `/InterestOverview/Me?automaticOnly=true` for a regular user. Issuing this after the membership response prevents competing native database work from delaying first cards.
4. Merge validated items/users by GUID, union reasons, retain available native playback dates. Reuse card/poster nodes and the existing grid. Filter/sort changes update the current in-memory snapshot and hash history, without reloading the page or issuing another discovery request.

The optional `automaticOnly` flag defaults to **false**; callers of the existing v0.2.1 endpoint retain its original contract. In automatic mode the service skips membership reads and explicit-only candidate seeding, while reusing the unchanged InterestService with an empty request-local membership snapshot. It returns only `InProgress`/`CurrentlyPlaying`. Automatic results cannot recreate a removed membership or convert playback into JSON entries.

All existing candidate/user/episode budgets, native visibility checks, session interpretation and account restrictions remain. The automatic response is always `IsComplete:false`; `LimitReached` and its notice survive the merge. The explicit endpoint is independent of automatic candidate caps. Native candidate discovery remains bounded and non-exhaustive for the reasons in [interest-overview.md](interest-overview.md).

A failed source shows a specific error and leaves the successfully loaded source visible. In particular, automatic failure cannot be mistaken for zero interest, and explicit storage failure does not label available playback results as a healthy watchlist. Empty states appear only after both requests finish successfully. Refresh can show the prior snapshot while retrieval is pending; completed sources replace their own previous snapshot, and a failed source is discarded with an error. No stale result is silently described as current.

Own membership removal updates only the explicit snapshot after confirmed server success; automatic reasons remain. No discovery repeat is needed. Leaving the page/account changes abort the view lifecycle and invalidate generations; late callbacks cannot render, mutate a new view or start the next source request. Already-issued native AJAX requests can finish on the server; this is cancellation of their UI work, not a guarantee of transport-level abortion. Nothing is persisted in browser storage. Refresh/re-entry reloads current source data.

**No server cache was introduced.** The measured verification reduction and local filtering address the observed costs without TTL, invalidation or cross-account cache risks. The page snapshot lasts only for that authenticated view. The deletion gate never reads it: every deletion still uses the unchanged fresh per-target protection request. Cancellation, native generic error, overrides, unsupported targets, parent resolution, native permissions and bypass limitations are unchanged.

## Reproduce measurements and validation

```sh
python3 scripts/build-release.py
# Isolated profiling instead of destructive browser deletion tests:
python3 tests/docker-smoke.py --injector-dll /path/to/Jellyfin.Plugin.JavaScriptInjector.dll --profile after
# Full fixture, including real native deletion paths using only generated media:
python3 tests/docker-smoke.py --injector-dll /path/to/Jellyfin.Plugin.JavaScriptInjector.dll
node --test tests/web.test.cjs
dotnet test Jellyfin.Plugin.WatchGuard.slnx -c Release --no-restore
```

The profiler writes `artifacts/performance/after.json`. For a baseline comparison, use a separate checkout of the baseline revision with the same instrumentation-only changes (`OverviewTiming`, service stage scopes and explicit endpoint scope), build its v0.2.1 DLL, start its disposable `docker-smoke.py --serve`, then run this release's `tests/profile-overview.cjs <fixture.json> before`. Stop the fixture with Ctrl+C. Never enable diagnostics or seed accounts/media against production for this harness. Only one profiling fixture may run at a time.

JavaScript tests cover deferred responses, same-node merging, user/reason filtering, sorting during arrival, no extra filter/removal queries, late account/navigation results, independent source failures, privacy and literal text. Backend tests preserve the combined API contract and prove automatic mode omits explicit-only items/reasons while fresh protection retains membership. Browser tests hold the automatic response, verify early explicit cards and loading notices, then release it and check node identity. They also cover five interested users, long names, all three reasons, parent-series labels, errors, history/account changes, modern/legacy shells and every existing deletion regression.

See [deployment results](deployment.md#automated-results) for release validation and rollback to v0.2.1. Screenshots are generated under `artifacts/poc/` and selected release captures are included below.

- [Movie header](screenshots/v0.2.2/watchlist-detail.png)
- [Multiple users, desktop](screenshots/v0.2.2/inline-users-1280.png)
- [Multiple users, narrow viewport](screenshots/v0.2.2/inline-users-390.png)
- [Series](screenshots/v0.2.2/inline-series.png), [episode](screenshots/v0.2.2/inline-episode.png), [season](screenshots/v0.2.2/inline-season.png)
- [Explicit cards while automatic discovery is pending](screenshots/v0.2.2/progressive-memberships.png)

## v0.2.3 activity measurements

The [activity projection](activity.md) adds a bounded completed-movie query and reuses existing episode verification for whole-series completion and counts. No new per-poster or second series-episode query is issued. Native InterestOverview routes remain available for comparison.

Measured on the same disposable 12.2 image and host, using the same four-account, ten-movie, three-series, ten-episode, 39-membership fixture. Each viewing user additionally had **one completed movie and one fully completed series**, with native dates within the window. Seven serial HTTP samples per route after warm-up; five browser visits. The two endpoint columns below are from **the same v0.2.3 binary and seeded fixture**: the retained v0.2.2-compatible interest-only contract versus the new activity contract. This isolates the feature cost without claiming a separate old-binary benchmark. Earlier v0.2.2 measurements above remain historical and use a different completion mix.

[Raw activity run](performance-data/activity-v0.2.3.json). Server stages are means; round trips and browser timings are medians, in milliseconds. Serialization includes response writing as explained above.

| Measurement | Interest-only automatic endpoint | Activity endpoint |
| --- | ---: | ---: |
| Resume discovery | 23.95 | 24.75 |
| Played-episode discovery | 19.17 | 19.57 |
| Completed-movie discovery | — | 16.96 |
| Series/user verification | 45.01 | 57.46 |
| Serialization + write | 0.21 | 0.25 |
| HTTP round trip | 113.22 | 136.93 |

Explicit retrieval averaged **86.03 ms** on the server, **89.87 ms** median HTTP round trip. Browser first cards appeared at **99.50 ms** median; both sources settled at **254.60 ms**. Response-end to first card insertion was **2.20 ms** median. Initial/late samples varied, so these small warm-fixture figures are not production-scale promises or a new claim of acceleration.

The extra native completed-movie query and verification of its additional title are the main added costs: about **24 ms** median endpoint latency in this run. Episode progress/completion is computed from arrays already loaded by verification; a backend test asserts one episode query per eligible account, not a second query for progress. The spinner makes the additional automatic work visible while explicit posters remain usable. Filtering/sorting still makes zero discovery requests, and no cache was justified or added. Fresh deletion checks never use an overview cache or history.

Reproduce with:

```sh
python3 scripts/build-release.py
python3 tests/docker-smoke.py --injector-dll /path/to/Jellyfin.Plugin.JavaScriptInjector.dll --profile activity
```

The runner writes `artifacts/performance/activity.json`, verifies registration/restart/cleanup and removes the fixture. Use the normal runner without `--profile` for the destructive disposable browser regression suite. Diagnostic mode is enabled only inside the fixture; the release default remains false.


## v0.4.1 scope and release regression

Caught Up reuses the existing bounded series query and batch playback/resume reads. Only Continuing-series activity verification includes virtual/missing rows to assess coverage, then restricts completion/counts to available aired episodes. The 1,000-row probe and 20,000-unit request budget remain; virtual rows can now hit a series cap sooner. Unit tests verify one episode query per verified series/user, with no extra per-poster request. Fresh protection keeps its original query, no cache and no additional network calls. No activity performance improvement is claimed from this classification change.

The final release's local direct-index probe measured 0.913 ms median / 1.908 ms maximum over 10 samples (5,540 bytes) on the pinned LinuxServer image; Caddy HTTPS gzip/zstd and native WebSocket checks passed separately. This is a loader regression measurement, not an activity benchmark or production capacity estimate. See [release-v041.json](performance-data/release-v041.json) and [qualification details](release-v041.md). Historical activity measurements above are retained unchanged.

## v0.4.3 targeted series activity

The series detail request skips global activity discovery and uses bounded target-specific native batches. Disposable four-episode measurements were 19 ms direct, 21 ms through Caddy HTTPS, and 22 ms through the base-path proxy during parallel release validation. These single-request measurements do not establish production or large-series latency. Caps are 50 accounts, 1,000 episode rows per user and 20,000 total read units; unit tests exercise limits. Informational responses disclose truncation; protection returns 503 instead of using truncated results. No cache or persistent calculated state was added. See [full results and limits](series-viewing-activity.md#validation--2026-10-14).
