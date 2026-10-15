# WatchGuard v0.4.8 — episode query performance

Release candidate for Jellyfin Server/Web 12.2 and .NET 10, based on published v0.4.7. This document separates production observations, deterministic interface models and disposable native measurements. No production configuration or media is used.

## Diagnosis and native API evidence

The supplied production observation is 10,363.55 ms total, 8,823.49 ms episode-query time, 696 episode queries, 19,290 logical episode rows and 48 playback batches. These numbers are not synthetic benchmark results. The reported 20,000-unit verification-budget exhaustion is independent of database latency.

Before changing production code, an unchanged v0.4.7 fixture with 100 series × 24 episodes, seven accounts, alternate versions, missing dates and blocked tags was measured twice on one disposable database. Median single-user HTTP time was 639.75/640.96 ms; all-user time was 3,390.53/3,386.70 ms. The first all-user run spent a median 2,628.22 ms in 680 episode queries, processed 16,314 logical rows and issued 40 playback calls. Both runs returned exactly the same per-item/per-user results. This confirms hydration dominates this fixture; it does not reproduce the production library.

Pinned Jellyfin commit: `ca0f16eb7c195f720a1493ed469a27c4657db0c6`.

- [LibraryManager](https://github.com/jellyfin/jellyfin/blob/ca0f16eb7c195f720a1493ed469a27c4657db0c6/Emby.Server.Implementations/Library/LibraryManager.cs): `GetItemList` and `GetItemIds` call `AddUserToQuery`. The recursive-parent rewrite applies only to `ParentId`; WatchGuard uses `AncestorIds`. Neither path invents permission equivalence between accounts.
- [Native query projections](https://github.com/jellyfin/jellyfin/blob/ca0f16eb7c195f720a1493ed469a27c4657db0c6/Jellyfin.Server.Implementations/Item/BaseItemRepository.Querying.cs): both APIs prepare, translate, group and page the query. `GetItemIdsList` projects IDs instead of materializing episode entities. Its placeholder exclusion cannot remove an Episode. It retains the same primary/alternate grouping and bounded probe.
- [Query filtering and navigation hydration](https://github.com/jellyfin/jellyfin/blob/ca0f16eb7c195f720a1493ed469a27c4657db0c6/Jellyfin.Server.Implementations/Item/BaseItemRepository.QueryBuilding.cs): native filtering handles inherited allowed/blocked tags, parental rating/subrating, blocked unrated items, top-parent restrictions and alternate ownership. Full episode materialization includes provider IDs and linked children; ID projection avoids materializing those collections. There is no custom equivalent-permissions fingerprint.
- [InternalItemsQuery](https://github.com/jellyfin/jellyfin/blob/ca0f16eb7c195f720a1493ed469a27c4657db0c6/MediaBrowser.Controller/Entities/InternalItemsQuery.cs) carries the native user's restrictions. Ancestor queries do not automatically add user-view top parents, so the existing preceding native title visibility check remains essential.
- [BaseItem visibility](https://github.com/jellyfin/jellyfin/blob/ca0f16eb7c195f720a1493ed469a27c4657db0c6/MediaBrowser.Controller/Entities/BaseItem.cs): standalone visibility checks the item, ancestors and collection-folder access, including enabled/blocked folders. Checking an episode with `GetItemById` instead of the existing native query would introduce a different permission path and many per-item calls; it was rejected.
- [UserDataManager](https://github.com/jellyfin/jellyfin/blob/ca0f16eb7c195f720a1493ed469a27c4657db0c6/Emby.Server.Implementations/Library/UserDataManager.cs): read batches isolate records/cache keys by account; resume selection retains native linked/local alternate handling. These read methods do not attach the requesting user's playback state to the shared episode objects. Metadata queries explicitly disable hydrated UserData. WatchGuard neither mutates nor saves these objects.

Stable stored episode metadata—identity, ancestry, provider keys, air dates, virtual/missing indicators and linked-version metadata—is independent of the requesting account. **Membership in the visible episode set is not.** Every account therefore still receives a fresh native scoped query; administrators, identical library settings and equal query results never authorize skipping another account's query.

## Implementation

Only ActivityOverview's `OverviewVerificationReads` changes its episode read strategy:

1. Check native series visibility for the current account as before.
2. For the first visible account, perform the existing bounded full episode query with reduced hydration.
3. Retain metadata by episode ID while preparing this series. For subsequent accounts, execute the exact same user-scoped native query through `GetItemIds`.
4. Reuse objects only for IDs returned for that account. Empty sets remain empty. An oversized ID probe retains only the existing oversized marker and does not hydrate/play back its episodes.
5. If the account sees an ID absent from the metadata snapshot, perform the original native full query for that account. Require its IDs to match the ID probe; a changed/inconsistent result fails rather than silently losing activity. This fallback is included in query counters.
6. Batch playback exactly as v0.4.7, in separate per-account dictionaries, and classify using only that user's authorized title rows.

Single-account requests keep the original full-query path. No unscoped episode query, account-policy reimplementation, direct SQL, filesystem traversal or cross-request cache is introduced. This reduces **hydration**, not the number of native authorization queries. Different/nonoverlapping scopes may require extra fallback queries; measured trade-offs must not be hidden as a lower logical query count.

The metadata dictionary is discarded after preparing each title. Prepared collections reference the same immutable metadata where authorized; account-specific collections and playback dictionaries remain separate. The whole candidate window expires after the request/window. At most the original 20,000-unit admission allowance plus one bounded failing/probe collection is prepared. Disjoint scopes cannot build an unbounded metadata union. A later request re-reads policies and metadata. Like the previous implementation, an in-flight request is a snapshot, not a database transaction; concurrent library/policy changes are reflected on subsequent requests, and detected inconsistencies fail.

All 50-user, 100-result, 1,000-row/user/series, 20,000-work-unit and discovery limits are unchanged. Logical episode work is charged per account even when objects are reused. Therefore this optimization does not promise to remove `VerificationBudget`, infer Caught Up from incomplete dates, or make a bounded overview exhaustive.

## Diagnostics and API compatibility

Existing routes, response fields and coverage causes remain unchanged. Additive aggregate fields under ActivityOverview `Diagnostics`:

| Field | Meaning |
| --- | --- |
| `EpisodeQueryCount` | All native verification episode calls, including ID projections and full-query fallbacks. |
| `EpisodeQueryDurationMs` | Combined ID/full query and metadata projection time; includes native filtering, SQL and hydration. |
| `EpisodeIdQueryCount` | User-scoped ID projections. |
| `EpisodeHydrationQueryCount` | Full native episode materializations. |
| `EpisodeHydratedRows` | Rows returned by full queries, including oversized probes/fallbacks. |
| `EpisodeMetadataReusedRows` | Authorized rows served from this title's metadata snapshot. |
| `EpisodeRowsProcessed` | Original logical per-user rows/probes; budget accounting is unchanged. |

`EpisodeQueryCount = EpisodeIdQueryCount + EpisodeHydrationQueryCount` on this prepared overview path. A fallback can hydrate rows already counted by the ID query; physical hydration and logical work are intentionally separate. Existing playback counters remain unchanged. Timers overlap with total verification/request time and cannot be summed as independent stages. Internal SQL statements, EF allocations and native cache hits are not observable separately through these interfaces. No private IDs, names, titles, history or credentials are added to routine diagnostics.

## Validation status

### Native same-database comparisons

Both assemblies run against the same native database, with a warm-up and three measured requests per scope. The baseline is extracted from the checksum-verified **published** v0.4.7 ZIP, not rebuilt from source. Comparisons assert identical complete `Items` responses (IDs, users, reasons, episode counts and native dates) and identical structured coverage. No assertion is reduced to title counts.

| Fixture / scope | Median HTTP ms, v0.4.7 → v0.4.8 | Episode-query ms | Native episode calls | Full hydration calls | Logical episode rows | Playback calls |
| --- | --- | --- | --- | --- | ---: | ---: |
| Mixed metadata, one user | 648.69 → 627.37 | 437.77 → 449.41 | 100 → 100 | 100 → 100 | 2,399 | 6 |
| Mixed metadata, seven users | 3,484.95 → 2,917.51 | 2,685.65 → 2,223.25 | 680 → 680 | 680 → 100 | 16,314 | 40 |
| Restricted policies, one user | 694.58 → 661.83 | 470.01 → 455.81 | 100 → 100 | 100 → 100 | 2,399 | 6 |
| Restricted policies, seven users | 3,235.24 → 2,950.87 | 2,485.99 → 2,225.05 | 530 → 539 | 530 → 109 | 12,697 | 32 |
| Large series / movies, eight accounts | 1,353.51 → 1,258.46 | 407.85 → 204.66 | 17 → 17 | 17 → 3 | 11,401 | 48 |
| Same large library, movies-only account | 118.21 → 108.86 | 0 → 0 | 0 → 0 | 0 → 0 | 0 | 2 |

Each row returns/verifies 100 titles in both versions. v0.4.7 has no hydration-specific field; every episode query in that version hydrates rows, so its hydration count is the existing episode query count. The seven-user mixed fixture hydrates 2,399 rather than 16,314 rows. The policy fixture hydrates 2,606 rather than 12,697 rows, with nine additional fallback calls explicitly counted. Its reduction in logical rows relative to the mixed fixture is caused by permissions, not optimization; only equivalent fixtures are compared.

Both versions report `EpisodeMetadataIncomplete` and `RawEpisodeDiscoveryLimit` in these fixtures. The policy fixture includes native blocked/allowed tags, episode-level blocked tags, a native TV-PG parental threshold against TV-MA episodes, enabled/blocked library folders, a future episode, merged versions, Continuing/Ended states and explicit membership. Assertions require restricted episode counts and absence of the blocked-folder account's activity. Independent native APIs seed all state; no direct database writes are used.

The improvement is approximately 16%/9% for these all-user workloads, not the desired halving of production latency. Native filtering/grouping still runs per user/title and dominates much of the remaining query time. Eliminating those queries by guessing equivalent permissions would be unsafe. No under-five-second production claim is made. The one-user path has no substantive optimization; its small timing differences are measurement variability. HTTP durations include serialization/transport; service fields exclude them.

Raw data: [unchanged pre-profile](performance-data/verification-native-v048-prechange.json), [mixed metadata comparison](performance-data/verification-native-v048.json), [policy comparison](performance-data/verification-native-v048-policies.json). These runs were isolated from the other regression containers. They are synthetic native workloads, not production-scale guarantees.

The [large-library comparison](performance-data/discovery-native-v048-v047.json) has series of 300, 1,000 and 1,501 episodes, six series-playback users, one movies-only user and the administrator, 140 completed movies and 200 untouched movies. All repeated responses and coverage match. The oversized series remains omitted, with `EpisodeLimit`; `CompletedMovieDiscoveryLimit`, `RawEpisodeDiscoveryLimit` and `ResultLimit` also remain. Truncation frequency is 100% before/after, intentionally unchanged. Hydrated rows fall from 11,401 to 2,301, including the 1,001-row oversized probe. Episode time halves but total time improves only about 7%, as discovery now dominates. The unchanged movies-only path shows normal timing variability. No timed benchmark runs alongside the browser matrix.

### Deterministic interfaces and memory

Identical interface-model sources run against both DLLs, including 110 × 24-episode series, one/seven users, and 300/1,000/1,501-episode libraries with 140 completed movies and 10,000 untouched movies. Entire item responses and coverage match; episode work and playback batch counts remain equal. Unit coverage also exercises exhaustion of the unchanged 20,000-unit budget, exact dates/resume/version semantics, changed visibility, incomplete/future/virtual/missing episode metadata, account isolation, native failures, cancellation, oversized ID probes and request-local lifetime.

| Users / 110-series model | Allocated bytes before → after | Full hydration calls before → after | Playback calls |
| --- | --- | --- | ---: |
| 1 | 2,492,656 → 2,760,936 | 100 → 100 | 6 |
| 7 | 16,149,272 → 17,187,160 | 700 → 100 | 42 |

The model preallocates native episode objects; it therefore measures the added dictionaries/ID projections but **cannot measure avoided EF hydration allocations or native SQL speed**. Managed allocations rise about 11%/6% in this model, with the original work bounds unchanged. Native process allocations were not measured. This trade-off is accepted for the measured reduction in native materialization; it is not presented as a measured native memory saving. Raw model measurements include elapsed time only for reproducibility, not latency claims. Stored result hashes identify the exact synthetic result/coverage equality checked by the runner.

[Verification before](performance-data/verification-model-v048-before.json), [after](performance-data/verification-model-v048-after.json); [large-series model before](performance-data/discovery-model-v048-before.json), [after](performance-data/discovery-model-v048-after.json).

The native fixtures include real future episodes and missing air dates. Virtual/missing rows are covered through deterministic native-interface tests; the native fixture does not manufacture provider-supplied missing rows through direct SQL or external metadata. This remains a limitation of the native benchmark matrix.

### Reproduction and release validation

```sh
python3 scripts/build-release.py
WATCHGUARD_VERIFICATION_MODEL_OUTPUT=/tmp/verification-model-v048.json \
WATCHGUARD_BENCHMARK_OUTPUT=/tmp/discovery-model-v048.json \
dotnet test Jellyfin.Plugin.WatchGuard.slnx -c Release
python3 tests/verification-model.py
python3 tests/docker-smoke.py --profile verification
WATCHGUARD_VERIFICATION_POLICIES=1 \
WATCHGUARD_VERIFICATION_OUTPUT=artifacts/verification-native-v048-policies.json \
python3 tests/docker-smoke.py --profile verification
WATCHGUARD_DISCOVERY_BASELINE=0.4.7 python3 tests/docker-smoke.py --profile discovery
```

Native runners require the published ZIP under `artifacts` and refuse an incorrect digest. They stop/swap/restart only disposable containers and restore the candidate in `finally`. The release workflow retains all seven jobs and adds policy-case verification to the existing verification job. Publication remains separately gated and disabled by default.

All seven release-validation jobs passed **locally**: standalone+Caddy/catalog, migration, official-image base-path, legacy, WebSocket, discovery and verification. Backend tests: **105 passed**; JavaScript/bootstrap: **53 passed**; catalog unit tests: **4 passed**. Both exact published-DLL interface comparisons passed. This is local evidence for the workflow's jobs, not a claim that a GitHub-hosted workflow was dispatched.

Four complete browser runs each observed 13 native DELETEs and zero ordering violations, retaining zero DELETE on cancellation/Escape and exactly one on explicit approval. Movie/series/season/episode, self/other/CaughtUp protection, malformed/failed lookups, bulk ordering, privacy, preferences, stale accounts/tabs, navigation and existing UI assertions passed. Caddy passed trusted test HTTPS, gzip/zstd, conditional/range/HEAD behavior, no-store authentication and native WebSocket 101/ping-pong. Installation/restart/uninstall retained Web file integrity and persisted stores. Catalog round-trip used immutable v0.4.0–v0.4.7 packages and returned to v0.4.8 with byte-preserved XML/JSON and one active assembly; legacy migration/rollback also passed. The retained v0.4.5 discovery regression passed without weakening its original expectations.

[Final validation summary](performance-data/release-v048.json), [retained discovery regression](performance-data/discovery-native-v048-v045-regression.json). The v0.4.7 comparison timings were collected before the parallel browser matrix. The old v0.4.5 discovery run is regression evidence, not used to claim v0.4.8 performance gains.

A forced rebuild produced identical ZIP bytes. The 269,381-byte archive contains only the plugin DLL and LICENSE. SHA-256: `06f33f62d06d864b63c879213ec1b3536d81c8ebb0ab7ac186b6820580aa24d5`; Jellyfin catalog MD5: `c09115ba15d1ec4f6e2b46566e040257`. These identify the prepared candidate, not a published asset.

## Safety, upgrade and rollback

`InterestService`, Protection, targeted SeriesActivity, Web deletion adapter/dialog, standalone loader, authorization, schemas and configuration are unchanged. No metadata snapshot or overview result reaches a deletion decision. Fresh protection keeps Watchlisted/InProgress/CurrentlyPlaying/configurable CaughtUp rules and fail-closed behavior. Native clients/direct API/filesystem deletion remain outside Web warnings.

After separately approved publication, normal catalog upgrade requires a server restart and fully reloaded clients. Back up plugin XML, `watchlists.json` and `preferences.json` first. No schema/settings migration, new dependency or Web-file edit is required. Rollback uses one active v0.4.7 assembly with the same XML/JSON and a server/client restart. The actual published v0.4.7 ZIP was downloaded and matched GitHub's asset digest: `8046bbd611ba3e17bf003160e32d8bffdf07a22038f06863bd8414e78c08b6e0`. Do not replace it with a locally rebuilt baseline.

Public manifest history and published release assets are not modified. The release candidate retains GUID `a3c6bc84-783d-4ba8-a0db-89bfb83ab486`, ABI `12.2.0.0`, and schema-1 JSON files; version is `0.4.8.0`.
