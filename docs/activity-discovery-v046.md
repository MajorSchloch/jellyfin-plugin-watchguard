# WatchGuard v0.4.6 — bounded activity discovery

Candidate for Jellyfin Server/Web 12.2 and .NET 10, based on published v0.4.5. No publication or production deployment. Watchlist/preferences schemas, configuration keys, plugin GUID, standalone loading and deletion policies remain unchanged.

## Diagnosis before changes

The production warning cannot identify its exact cause: v0.4.5 combines source truncation, the candidate cap, oversized series and verification-work exhaustion into one flag/message. No production access was performed. The supplied 292-episode detail example proves that one targeted request can succeed, not that the global overview has sufficient remaining budget.

The old overview queried up to 101 resume rows and 101 played episodes per user, plus configured-limit+1 completed movies. It resolved episode ancestry and caller visibility repeatedly before deduplicating. Its first 100 distinct titles consumed the candidate allowance even when verification found no relevant activity. Candidates were ordered by active sessions, then each user's resume/played rows, completed movies and legacy combined-endpoint memberships. One user's candidates could fill the allowance before another user's active interest.

Verification performs a visible episode query and two native playback batches per title/user. A 292-episode series costs roughly 293 work units **per visible user**; several such titles share the 20,000-unit overview allowance. The targeted detail/protection request starts with its own allowance and one known series. A series query returning 1,001 rows previously threw an exception that stopped the entire overview, starving later movies. A deterministic 1,501-episode/140-movie fixture reproduced zero returned titles.

The current Web page already fetches explicit memberships separately and renders them first. Its automatic request passes `automaticOnly:true`, does not read the watchlist store and does not verify explicit-only entries. The older combined `InterestOverview` endpoint still supports membership-inclusive behavior; it is not the Web's activity source.

## Native source findings

The pinned 12.2 source documented in [architecture.md](architecture.md) was inspected locally:

- [InternalItemsQuery](https://github.com/jellyfin/jellyfin/blob/ca0f16eb7c195f720a1493ed469a27c4657db0c6/MediaBrowser.Controller/Entities/InternalItemsQuery.cs): user-scoped played/resume filtering, bounded result counts, offset paging and series-presentation-key grouping.
- [Native grouping](https://github.com/jellyfin/jellyfin/blob/ca0f16eb7c195f720a1493ed469a27c4657db0c6/Jellyfin.Server.Implementations/Item/BaseItemRepository.QueryBuilding.cs): groups filtered episode rows by series key in SQL, selecting a representative ID, then applies ordering/limits. This is **not** a maximum-last-played-date aggregate. Missing/shared keys can collapse unrelated groups.
- [UserDataManager](https://github.com/jellyfin/jellyfin/blob/ca0f16eb7c195f720a1493ed469a27c4657db0c6/Emby.Server.Implementations/Library/UserDataManager.cs): `GetUserDataBatch` resolves each user's native keys; `GetResumeUserDataBatch` performs batched alternate-version probes and native most-recent version selection. It already avoids a per-episode resume lookup.

Raw native played counts alone cannot replace these reads: they do not establish the effective alternate-version state, latest native date, aired/missing coverage and visible episode set together. Sharing episode arrays across users would bypass per-user episode visibility unless equivalent access were proven. No permission-fingerprint cache or direct database access was introduced. Episode queries and native version selection retain their existing semantics.

## Implementation

1. Active sessions remain first. Resume and played sources interleave rows across enabled accounts. Completed movies also interleave across accounts, after series/unfinished interest.
2. Add one bounded, native grouped played-episode query per account. It can find series beyond a long show's first 100 played episodes. Keep the original raw query as a fallback for missing/shared presentation keys; grouped discovery alone would regress those libraries.
3. Deduplicate `(user ID, source item ID)` before repeated resolution, cache ancestry only within that user's request, and skip repeat caller lookups once a verified visible candidate is present.
4. Treat `ActivityLimit` as the returned-title allowance (still 1–100), retaining its existing completed-movie discovery limit. Candidates with no relevant activity no longer consume returned slots. Candidate admission is bounded by `20,000 / enabled-account-count`; source queries and a 20,000-resolution guard also bound memory/work. This reuses the existing work allowance, rather than lifting episode, account or result caps. The settings description is updated; stored values/keys/defaults do not migrate.
5. Verify in chunks of at most 100 candidates. Movies batch native states/resume selection per account/chunk, with native visibility checked before reads. The cache holds only that chunk, separates accounts by GUID, returns only the current movie's rows/dates and is destroyed within the request. No cross-request cache exists.
6. A per-series episode-cap failure omits that series with an explicit warning and continues to later titles. Exhaustion of the shared verification budget still ends the request. Partial per-title verification never becomes a successful title result.
7. Request-abort cancellation is checked between discovery calls, candidate resolution, title/user verification and native batches via the shared work checks. Synchronous native calls cannot be interrupted mid-query through these APIs. No pagination/background fetch loop is added; existing Web generations discard stale owner/account responses.

### Bounds and remaining omissions

- 50 enabled accounts; exceeding this still fails with HTTP 503.
- 100 resume rows, 100 raw played episodes, 100 grouped series representatives per account, each plus one probe. Completed movies use configured `ActivityLimit` plus one probe.
- At most 100 active sessions prioritized in discovery, plus one probe retained in the bounded verification snapshot, with a distinct warning if truncated. **Protection still inspects the original fresh native sessions.**
- At most 20,000 distinct account/item resolutions; candidate admission also reserves the minimum account-verification work described above.
- 1,000 episode rows per series/user plus one probe; 20,000 verification work units. These caps are unchanged. A 1,501-episode series is **still omitted**, but no longer prevents unrelated titles appearing.
- Only one movie chunk is retained for playback reuse: at most 100 primary movies per account. Native linked-version enumeration remains owned by Jellyfin and can cost more than the primary-row counters indicate.

Old/unusual activity displaced beyond source limits can still be missing. Incomplete presentation keys, bounded completed-history discovery, missing episode dates and changes during a request prevent exhaustive claims. The raw fallback means a long series can still cause a **discovery** warning even when grouped discovery finds its peers; it does not prove every other series key is trustworthy. No title's absence is evidence of safe deletion. Large native SQL workloads can remain expensive despite bounded returned rows; no production-scale latency guarantee is made.

## Why no continuation token

`StartIndex` plus mutable `DatePlayed` ordering is not a stable cursor. Playback, library changes and native grouped representative selection can reorder results across requests; the API supplies neither a snapshot token nor a keyset boundary covering these semantics. A token over the old truncated candidate set would only disguise omissions. A durable snapshot/history store or broad library materialization would conflict with this release's scope and resource goals. Therefore there are no continuation tokens, no Load More control and no claim that a bounded response is a complete scan. `AdditionalPagesAvailable:false` means this API offers no continuation, **not** that all activity was found.

## Additive API and diagnostics

All ActivityOverview routes, permissions and existing `Items`, `IsComplete`, `LimitReached`, `Notice` fields remain. `IsComplete` remains false. Added fields:

```json
{
  "Coverage": {
    "Version": 1,
    "ActivityWindowDays": 30,
    "DiscoveryLimited": true,
    "EpisodeMetadataIncomplete": true,
    "VerificationLimited": false,
    "ResultLimitReached": false,
    "AdditionalPagesAvailable": false,
    "Causes": ["EpisodeMetadataIncomplete", "RawEpisodeDiscoveryLimit"],
    "Warnings": [
      "Some continuing series lack episode or air-date coverage; Caught Up is not inferred for them.",
      "Candidate discovery was bounded; older titles or titles with incomplete series keys may be omitted."
    ]
  },
  "Diagnostics": {
    "CandidatesDiscovered": 612,
    "UniqueCandidates": 103,
    "CandidatesVerified": 100,
    "UsersEvaluated": 401,
    "EpisodeRowsProcessed": 6201,
    "NativePlaybackBatches": 32,
    "NativeDiscoveryQueries": 16,
    "QueryDurationMs": 1900
  }
}
```

The numeric example is illustrative. `CandidatesDiscovered` counts source submissions including duplicates, saturating at 20,000; `UniqueCandidates` counts admitted visible titles. `CandidatesVerified` counts fully verified titles including zero-interest titles. `UsersEvaluated` counts title/account attempts, not distinct accounts. Episode rows include probe rows and coverage metadata; playback batches count the two public native batch APIs, not their internal SQL/alternate-version work. Duration covers service execution, not serialization/network/browser rendering (the existing MVC timing remains separate).

Fixed cause codes: `ResumeDiscoveryLimit`, `RawEpisodeDiscoveryLimit`, `SeriesDiscoveryLimit`, `CompletedMovieDiscoveryLimit`, `SessionDiscoveryLimit`, `ResolutionWorkLimit`, `CandidateWorkLimit`, `EpisodeLimit`, `VerificationBudget`, `ResultLimit`, `EpisodeMetadataIncomplete`. Native lookup/playback failures remain **503**, not an empty/partial success or a coverage warning. Invalid/missing playback rows fail the request. The configured activity window remains separately described and applies to completed history, not all ongoing viewing interest.

With DiagnosticMode enabled, successful overview requests log only bounded aggregate counters, milliseconds and fixed cause codes. No tokens, account IDs, names, title IDs or playback records are logged. Failed lookups retain the existing generic error-type diagnostic and 503 response. Own endpoints expose counters only for their authenticated scope; cross-user endpoints remain administrator-only.

The existing UI prefers version-1 structured coverage while retaining the exact full `Notice` in its disclosure. Older/unrecognized responses use the v0.4.5 text fallback. Material warnings remain outside the disclosure. Layout, styles, local filtering/sorting, membership-first rendering and card identity are unchanged.

## Deletion isolation

`InterestService.Get` and `GetSeriesActivity` remain source-identical. Their budget never receives the overview movie reader or session snapshot; native reads and sessions remain fresh. Shared code adds only optional overview reading and counters/default-no-op cancellation. Failed/incomplete targeted checks still reject deletion; all Watchlisted/InProgress/CurrentlyPlaying/configurable Caught Up, self/other, parent-series, permission and visibility rules remain. The JavaScript deletion adapter, dialog, protection validator and resolver are unchanged. No overview or diagnostic field approves deletion.

## Benchmarks and validation

`DiscoveryBenchmarks.cs` is a deterministic native-interface workload model, not a database benchmark; `tests/discovery-native.py` swaps the verified published v0.4.5 DLL and candidate on the same disposable native Jellyfin database. Native fixture timings include serialization/HTTP and use a warm-up plus three measured requests. No production server was accessed.

### Deterministic workload model

Four users, overlapping explicit memberships, 140 completed movies, 10,000 untouched movies, and one continuing series with incomplete air-date metadata. Automatic discovery deliberately does not read the explicit store. One warm-up precedes measurement. These are native-interface mocks, **not SQL or production latency measurements**.

| Episodes | Returned before → after | Playback batches | Episode rows | Native lookup calls | Allocated bytes | Model ms |
|---|---|---|---|---|---|---|
| 300 | 100 → 100 | 800 → 16 | 1,200 → 1,200 | 2,400 → 1,701 | 3,715,736 → 2,934,504 | 10.90 → 12.49 |
| 1,000 | 100 → 100 | 800 → 16 | 4,000 → 4,000 | 2,400 → 1,701 | 4,456,280 → 3,707,016 | 14.76 → 15.21 |
| 1,501 | 0 → 100 | 0 → 16 | 1,001 → 1,001 | 2,001 → 1,706 | 1,668,528 → 2,769,816 | 12.12 → 4.34 |

Native discovery/episode query counts increase from 16 to 20 (13 to 17 in the oversized case), because the grouped discovery query is additional. Truncation remains 100% in these intentionally over-limit workloads. The measurable improvement is fewer playback batches and lookups at equivalent output, plus useful results after an oversized series. Mock wall time is noisy and is not evidence of faster native SQL. Episode work has **not** been reduced by sharing playback or visibility across accounts.

Raw measurements: [before](performance-data/discovery-model-v046-before.json), [after](performance-data/discovery-model-v046-after.json). Regression tests additionally exercise more than 100 irrelevant candidates before a relevant result, grouped discovery beyond a long series' first 100 episodes, account interleaving, failures, cancellation, alternate versions and date isolation.

### Native Jellyfin comparison

Same disposable official Jellyfin 12.2 database, pinned image, published v0.4.5 versus the exact candidate DLL; one warm-up and three measured HTTP requests per scope. Three series contain 300, 1,000 and 1,501 episodes, three users have different series playback, one additional user has movie-only activity, and 140 completed/200 untouched movies are present. These generated fixtures do not represent production metadata/provider costs.

| Scope | Returned before → after | Median HTTP ms before → after | Candidate episode rows | Candidate playback batches |
|---|---|---|---|---|
| Movies-only account | 100 → 100 | 286.22 → 317.08 | 0 | 2 |
| Mixed all users | 0 → 100 | 557.65 → 2,133.23 | 7,501 | 40 |

All three samples per scope returned those counts; all remained truthfully truncated. Mixed results include the two eligible series and movies; the 1,501-episode series remains omitted. The baseline stops on that series, so its shorter duration is not equivalent completed work. The movie-only comparison shows **no latency improvement** (about 11% slower in this run) despite batching. The additional grouped discovery query and native visibility/query costs remain. Therefore this release demonstrates coverage improvement and fewer native API batch invocations, not an end-to-end speedup. It should receive deployment latency monitoring before broader use.

The published baseline lacks the new counters; its native row/batch counts are not fabricated. Candidate service times are in the [raw native results](performance-data/discovery-native-v046.json); HTTP minus service time includes serialization, transport and fixture overhead, not isolated serialization. Existing browser regressions confirm progressive rendering and node identity, but no new isolated browser-render timing claim is made. Native process allocation was not measured; allocation results above are limited to the model.

### Validation

95 backend tests, 53 JavaScript/bootstrap tests and four catalog tests passed. The existing five integration jobs passed locally: LinuxServer/Caddy catalog, migration, official base-path, legacy catalog/browser, and Caddy WebSocket. Four complete browser runs each observed 13 native DELETEs with zero ordering violations, alongside assertions for zero DELETE on cancellation and exactly one on approval. The authenticated Caddy WebSocket check passed 101 upgrade and three ping/pong exchanges; the pre-existing browser helper's frame observations are not substituted for this protocol check.

A forced second release build produced the identical SHA-256. Public catalog entries, loader, stores, configuration schema, deletion adapter and confirmation dialog remain unchanged. CI adds a separate discovery benchmark job; publishing still requires the existing explicit release workflow action.

Reproduce with the pinned SDK and existing fixture prerequisites:

```sh
WATCHGUARD_BENCHMARK_OUTPUT=/tmp/discovery-model-v046.json dotnet test Jellyfin.Plugin.WatchGuard.slnx -c Release
node --test tests/web.test.cjs tests/standalone-bootstrap.test.cjs
python3 scripts/build-release.py
python3 tests/catalog_test.py
python3 tests/docker-smoke.py --profile discovery
```

The native benchmark requires the verified published v0.4.5 ZIP in `artifacts`; the workflow downloads it and validates its SHA-256 before running. It swaps assemblies only inside its disposable fixture, restores the candidate in `finally`, and never touches production.

## Release and rollback

Version 0.4.6.0, existing GUID `a3c6bc84-783d-4ba8-a0db-89bfb83ab486`, ABI 12.2.0.0. No new dependency or schema/configuration migration. Catalog update, restart and full Web reload remain sufficient after separate publication approval. Roll back to the verified published v0.4.5 ZIP with one active assembly; preserve plugin XML and both JSON files. Rollback restores the previous bounded discovery behavior. Fresh deletion policies are unchanged.

Published ZIPs v0.4.0–v0.4.5 were downloaded through GitHub's release API and checked against asset digests. In particular, published v0.4.3 SHA-256 is `fc8bcb6e312f37fe73749ee0450a57f5dfda8fc4470549c633c1e3920271be47`; its older prerelease digest must not be substituted. Published v0.4.5 is `ebe3827470e439bd0a15f7fb65edfa330c6ecf2d1f8ec4112402680f109f709f`. Existing public assets and manifest history are unchanged.
