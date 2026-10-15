# WatchGuard v0.4.7 — multi-user verification

Release candidate for Jellyfin Server/Web 12.2 and .NET 10, based on published v0.4.6. No publication or deployment. The standalone loader, Web adapter, deletion dialog, protection controller routes, configuration keys, plugin GUID and schema-1 stores are unchanged.

## Production observations versus measurements

The supplied production observations were **not reproduced as benchmark measurements**:

| Scope | Candidates verified | User/title attempts | Episode rows | Playback calls | Service ms |
|---|---:|---:|---:|---:|---:|
| My list | 28 | 28 | 1,059 | 56 | 1,354.95 |
| All users | 100 | 704 | 19,294 | 1,406 | 21,591.25 |

The reported causes were `EpisodeMetadataIncomplete`, `RawEpisodeDiscoveryLimit`, `SeriesDiscoveryLimit` and `VerificationBudget`. `ResultLimitReached:false` distinguishes work-budget exhaustion from the 100-result allowance. A successful targeted series request has its own work allowance and does not establish global overview completeness. No production access was performed.

Before optimization, timing-only instrumentation was tested against the original algorithm. A disposable fixture with 100 series × 24 episodes, seven enabled users and six playback owners returned 100 titles with 16,800 episode rows and 1,400 playback calls. Median HTTP time was 8,719.54 ms. In its middle sample, episode queries consumed 7,357.45 ms, account/item visibility 1,462.36 ms, playback batches 134.73 ms, and classification 3.53 ms. These are **synthetic native Jellyfin measurements**, not estimates of production stage costs.

## Native API findings

Pinned Jellyfin source was inspected before changing the read path:

- [UserDataManager](https://github.com/jellyfin/jellyfin/blob/ca0f16eb7c195f720a1493ed469a27c4657db0c6/Emby.Server.Implementations/Library/UserDataManager.cs) batches user-data rows, resolves native keys and selects the most recently played alternate version. Resume batching includes local-version existence probes, linked-version enumeration and additional native user-data work. WatchGuard must preserve that selection instead of inventing a cheaper playback rule.
- [DtoOptions](https://github.com/jellyfin/jellyfin/blob/ca0f16eb7c195f720a1493ed469a27c4657db0c6/MediaBrowser.Controller/Dto/DtoOptions.cs) defaults to all fields, images and user data.
- [Query navigation hydration](https://github.com/jellyfin/jellyfin/blob/ca0f16eb7c195f720a1493ed469a27c4657db0c6/Jellyfin.Server.Implementations/Item/BaseItemRepository.QueryBuilding.cs) joins those collections. Episode queries retain linked children for alternate versions independently of image/settings fields.
- [LibraryManager](https://github.com/jellyfin/jellyfin/blob/ca0f16eb7c195f720a1493ed469a27c4657db0c6/Emby.Server.Implementations/Library/LibraryManager.cs) and `InternalItemsQuery(user)` apply native user visibility/restrictions. Account policy equivalence was not proven, so episode collections are **not shared across users**.

## Implementation and unchanged work bounds

`OverviewVerificationReads` replaces the movie-only reader. It exists only for one ActivityOverview candidate window and is never registered as a singleton or used by protection.

1. Discovery order, user interleaving, source limits and candidate deduplication remain unchanged.
2. A window contains no more than the remaining result slots, at most 100 titles. Metadata preparation follows the original title/account order and simulates the existing remaining-work ledger. It stops at the same exhausted pair; classification still charges the original ledger. No discount is applied for batching.
3. Native user-scoped episode queries retain the 1,001-row probe. Read-only hydration keeps provider IDs, stored episode fields and native linked versions, but omits images, settings and hydrated playback rows belonging to every account. These objects are never saved or used to modify metadata.
4. Account lookup and item visibility are retained only in this window. Account data is separated by Jellyfin user GUID. A new window/request resolves accounts again. Playback, metadata and visibility are never shared between accounts or requests. Like other request snapshots, policy changes during an in-flight request take effect on the next request; authentication/authorization at the controller is unchanged.
5. Eligible episode/movie IDs are deduplicated per account and sent through native `GetUserDataBatch` and `GetResumeUserDataBatch`, each with at most **1,000 primary items**. Native linked-version expansion remains internal to Jellyfin; a strict bound on its internal SQL rows cannot be imposed by this API. No direct SQL or custom version resolver is introduced.
6. Classification receives only the current title's records. This is necessary to preserve latest dates, resume positions, effective completion and episode counts. Missing playback rows fail the request; they never become an unplayed/empty success.
7. Oversized series keep only an oversized marker after the probe, not their episode arrays. They are skipped with the existing warning. At most the unchanged 20,000 work allowance plus the one bounded failing/probe collection can be retained. Playback dictionaries contain only successfully admitted rows. Cancellation is checked during preparation and between native batch calls; synchronous native SQL cannot be interrupted through these APIs.

The 50-user, 100-result, 1,000-episode-per-user/series, 20,000-work-unit and discovery limits are unchanged. A 1,501-episode series is still omitted from the overview. Empty series require no playback batch. A 1,000-episode title still requires its own full-sized batch per account; batching cannot reduce that below the native work required.

Scheduling was reviewed but not reordered: candidates and account/title pairs are already deduplicated, and v0.4.6 interleaves discovery across accounts. Reordering verification by estimated series size could starve older/long titles or change which users/titles survive a budget boundary. Native played counts alone cannot safely skip an account: resume/version selection, future/missing rows and exact progress/date semantics still need verification. The implementation therefore preserves the original ordering and budget outcome. It eliminates duplicate account/visibility reads within the window, not required episode visibility queries.

There is no speculative cross-user episode cache and no new pagination. One native episode query per visible user/title remains necessary here. The performance gain comes from narrower hydration, fewer playback calls and fewer account reads, not reduced coverage or changed accounting. Consequently this release does **not** promise to eliminate the production `VerificationBudget` warning. Every skipped/partially evaluated candidate retains the existing coverage cause; no partial title is presented as complete.

## Diagnostics

Existing response fields and coverage contracts remain. `Diagnostics` adds:

| Field | Meaning |
|---|---|
| `DiscoveryDurationMs` | Service start through candidate discovery/preparation of the candidate list. |
| `EpisodeQueryDurationMs`, `EpisodeQueryCount` | Native user-scoped episode query calls, including their hydration and probes. |
| `VisibilityDurationMs` | Account lookup and native item visibility/prepared-visibility access during verification. |
| `PlaybackBatchDurationMs`, `PlaybackBatchCount` | Public playback batch calls; count agrees with `NativePlaybackBatches`. |
| `UserDataBatchDurationMs`, `ResumeBatchDurationMs` | Separate native calls in the prepared ActivityOverview path. |
| `ClassificationDurationMs` | Effective playback states, dates, counts, reason construction and active-session matching. |
| `TotalVerificationDurationMs` | Whole preparation/batching/classification interval. |
| `PlaybackCacheHits`, `PlaybackCacheMisses` | Per-title projections and per-account native batch fills, respectively; these are not item hit ratios. |
| `PreparedVisibilityHits`, `PreparedVisibilityMisses` | Prepared visibility reads and native visible-title lookups. |
| `AccountCacheHits`, `AccountCacheMisses` | Request-window account snapshot reuse and native account resolutions. |

These stages are not a partition to sum: verification includes its child timers; playback includes its two native call timers; classification includes session alternate lookups; visibility includes native permission work. Episode-query time includes native SQL and hydration. Resume time includes internal version probes, enumeration and nested user-data calls. SQL counts, native cache hit ratios and alternate-resolution-only time are **not separately observable** through these services. `QueryDurationMs` excludes MVC response serialization/network; the existing opt-in serialization/write timing remains separate. Older non-activity interest endpoints retain their original path, so prepared-cache/sub-call counters can be zero there.

Only aggregate numbers and existing fixed cause codes are exposed/logged by these diagnostics. No names, IDs, titles, playback records or credentials are added to routine logging. Cross-user endpoints remain administrator-only; own/specific-user scopes retain current authorization. Diagnostics never authorize deletion.

## Benchmarks

### Deterministic interfaces

Identical test sources were run against the checksum-verified published v0.4.6 DLL and the candidate. The fixture has 110 series × 24 episodes, one/seven users and mixed completion/resume semantics. Native calls are mocked; **these are not SQL latency measurements**.

| Users | Returned before → after | Episode rows | Playback calls | Native queries | Allocated bytes before → after |
|---|---|---:|---|---:|---|
| 1 | 100 → 100 | 2,400 | 200 → 6 | 104 | 1,740,608 → 2,489,304 |
| 7 | 100 → 100 | 16,800 | 1,400 → 42 | 728 | 10,947,440 → 16,132,064 |

The model allocates more memory (roughly 47% in the seven-user run), because multiple titles' records are retained until classification. Bounds remain explicit. Wall times are included in raw data but are not used to claim native speedups. [Before](performance-data/verification-model-v047-before.json), [after](performance-data/verification-model-v047-after.json). The existing 300/1,000/1,501-episode model was also run against both assemblies: [before](performance-data/discovery-model-v047-before.json), [after](performance-data/discovery-model-v047-after.json).

### Native profiling and release comparison

Timing-only baseline: [raw profile](performance-data/verification-instrumented-v046.json). Hydration-only experiment: [raw profile](performance-data/verification-hydration-v047.json). The latter retained all counts/calls and reduced median all-user time from 8,719.54 to 4,691.16 ms (single-user 1,548.31 to 747.35 ms). These separate disposable runs informed the implementation; the final published-DLL comparison uses the same database for both versions.

The isolated uniform seven-user fixture uses the exact published v0.4.6 DLL and candidate on the **same database**, with a warm-up and three measured requests per scope. Every returned item, user, reason, count and native date matched across versions and repeated requests.

| Scope | Median HTTP ms before → after | Playback calls before → after | Episode rows | Returned |
|---|---|---|---:|---:|
| One account, 100 series | 1,963.52 → 845.24 | 200 → 6 | 2,400 | 100 → 100 |
| Seven accounts, 100 series | 12,920.36 → 4,859.82 | 1,400 → 42 | 16,800 | 100 → 100 |
| Movies-only account, large-library fixture | 475.35 → 128.94 | 2 → 2 | 0 | 100 → 100 |
| Mixed users, 300/1,000/1,501-episode fixture | 2,887.53 → 904.38 | 40 → 30 | 7,501 | 100 → 100 |

The final mixed-state fixture sets Continuing/Ended metadata, unfinished playback, a missing air date, native merged alternate versions, and tag-restricted visibility for one account. Both versions' entire `Items` responses matched in every measured request. Coverage causes also remained `EpisodeMetadataIncomplete` and `RawEpisodeDiscoveryLimit`.

| Mixed-state scope | Median HTTP ms before → after | Playback calls before → after | Episode rows | Returned |
|---|---|---|---:|---:|
| One account | 1,515.72 → 831.90 | 200 → 6 | 2,399 | 100 → 100 |
| All users, including restricted account | 11,103.39 → 5,029.86 | 1,360 → 40 | 16,314 | 100 → 100 |

[Mixed-state raw measurements](performance-data/verification-native-v047-mixed.json). The restricted account removes 20 user/title episode queries in both versions; this is existing native visibility, not an optimization that excludes users.

The uniform comparison reduces playback calls by 97% and median latency by approximately 62%, with identical episode queries, rows and title coverage. The candidate's seven-user samples were variable; the five-second target is a median observation, not a latency guarantee. Large-library runs include 140 completed movies and 200 untouched movies; their oldest oversized series remains omitted. Their measurements were collected while other regression fixtures were active, so use them as supporting evidence rather than an isolated latency claim. [Uniform raw measurements](performance-data/verification-native-v047-uniform.json), [large-library raw measurements](performance-data/verification-native-v047-large.json).

A concurrent uniform run exceeded the unchanged fixture 15-second HTTP timeout. It was discarded and rerun in isolation; no timeout or equality assertion was weakened. Native process allocation and individual SQL durations were not measured. HTTP timing includes serialization/transport; service timing excludes them. The narrower episode queries remain the dominant measured cost, and cross-user metadata reuse was deliberately not introduced.

Production's 21.6-second request is not a benchmark assertion. No five-second production guarantee is made, and work-budget exhaustion can remain for the same row workload.

## Reproduction and validation

With the pinned SDK, Docker and existing browser prerequisites:

```sh
WATCHGUARD_VERIFICATION_MODEL_OUTPUT=/tmp/verification-model-v047.json dotnet test Jellyfin.Plugin.WatchGuard.slnx -c Release
python3 tests/verification-model.py
python3 scripts/build-release.py
python3 tests/docker-smoke.py --profile verification
WATCHGUARD_DISCOVERY_BASELINE=0.4.6 python3 tests/docker-smoke.py --profile discovery
python3 tests/docker-smoke.py --profile discovery
```

The model runner restores the exact pinned test package versions in a temporary project and references the verified published DLL; it does not rebuild a supposed baseline from current source.

The published ZIPs must be present under `artifacts`; each runner verifies the fixed published digest before loading a DLL. The release workflow downloads them. Native comparisons stop only their disposable container when swapping assemblies and restore the candidate in `finally`. No production configuration or media is mounted.

All seven release-validation jobs passed locally. [Final validation summary](performance-data/release-v047.json). Local backend validation passed 102 tests; JavaScript/bootstrap passed 53 tests; catalog unit validation passed four tests. Four complete browser runs (LinuxServer/Caddy, migration, official base-path and legacy) each observed 13 native DELETEs and zero ordering violations, with assertions for zero DELETE on cancellation and exactly one on approval. The Caddy protocol test passed authenticated WebSocket upgrade/ping-pong, compression, conditional/range/HEAD handling and no-store behavior. Catalog upgrade/rollback exercised published v0.4.0 through v0.4.6 and returned to v0.4.7 with byte-preserved stores/configuration. A forced rebuild produced identical ZIP bytes. The retained v0.4.5 discovery regression also passed with its original zero-result baseline assertion; fixture seeding now orders series numerically so the oversized title is deterministically newest. Earlier name-order seeding could legitimately return two smaller titles before hitting the old early-stop bug. No assertion was relaxed. [Raw discovery regression](performance-data/discovery-native-v047-v045-regression.json).

The parallel workflow retains Caddy/catalog, migration, base-path, legacy, WebSocket and discovery jobs and adds `verification`, including the same-database large-library comparison. A dedicated model comparison asserts identical rows/results and at least a 90% playback-call reduction for the many-short-series workload. No wall-clock assertion is imposed on shared CI machines.

## Deletion isolation and upgrade

`InterestService.Get` and `GetSeriesActivity` retain their authoritative behavior. Only ActivityOverview installs prepared reads; direct/targeted checks continue their fresh native sequence, full hydration, session inspection, authorization and failure handling. Watchlisted, InProgress, CurrentlyPlaying and configurable CaughtUp reasons, parent-series resolution, self/other warnings and native DELETE counts are unchanged. No overview cache reaches the deletion adapter. Native clients/direct API/filesystem deletion remain outside Web warnings.

Normal catalog upgrade after separately approved publication: back up plugin XML plus `watchlists.json` and `preferences.json`, update WatchGuard, restart Jellyfin and fully reload clients. No schema or settings migration, dependency, environment variable or Web-file edit is required. Roll back with the verified published v0.4.6 ZIP, one active assembly, retained XML/JSON and a server/client restart. See [deployment.md](deployment.md).

Published v0.4.3–v0.4.6 ZIPs were downloaded and verified against GitHub asset SHA-256 digests:

| Version | SHA-256 |
|---|---|
| 0.4.3 | `fc8bcb6e312f37fe73749ee0450a57f5dfda8fc4470549c633c1e3920271be47` |
| 0.4.4 | `516f29160d4e6efb7296867d7a00848124306af804586dedceea9e6828d2e679` |
| 0.4.5 | `ebe3827470e439bd0a15f7fb65edfa330c6ecf2d1f8ec4112402680f109f709f` |
| 0.4.6 | `e083f873d76a2cd62005e1093f30ecfde3201409fa9caa45948433372bba87e1` |

The public manifest/history and published assets are unchanged. The candidate uses version 0.4.7.0, GUID `a3c6bc84-783d-4ba8-a0db-89bfb83ab486` and ABI 12.2.0.0. Packaging remains deterministic, DLL plus LICENSE only, with catalog MD5 and an additional SHA-256 sidecar. Release workflow publication remains separately gated.

Candidate ZIP SHA-256: `8046bbd611ba3e17bf003160e32d8bffdf07a22038f06863bd8414e78c08b6e0`. Catalog MD5: `5c0ed51730eeaff62f7d87da453ad671`. These identify the validated unpublished candidate, not a new published asset.
