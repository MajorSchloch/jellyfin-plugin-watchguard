# Background activity index — implementation design

Status: implementation on a review branch after published v0.5.2; not published or deployed. Qualification results are recorded separately in [activity-index-results.md](activity-index-results.md). The supplied 7,772.52 ms / 680 episode queries / seven-account observation is production evidence supplied by the user, not our benchmark.

## Boundaries and authority

The index is a rebuildable projection of current native playback state, not an event log. It never authorizes deletion. `Protection`, targeted `SeriesActivity`, server enforcement, approvals, and their native reads remain unchanged. The original `ActivityOverview` remains available as a fresh comparison/oracle and for older clients. New Web clients use a separate `ActivityIndex` API. Explicit watchlists are read separately and never depend on population finishing.

Reuse `InterestService.GetForOverview` and `OverviewVerificationReads`, including native alternate-version resume selection, dates, the 1,000-row series limit, incomplete metadata semantics and v0.5.2 `EpisodeProgress`. Do not replace native authorization with equivalent-looking account policies.

## Native contracts reviewed

Pinned Jellyfin source: [`ca0f16eb7c195f720a1493ed469a27c4657db0c6`](https://github.com/jellyfin/jellyfin/tree/ca0f16eb7c195f720a1493ed469a27c4657db0c6).

- `MediaBrowser.Controller/Library/IUserDataManager.cs`, `UserDataSaved`; `Emby.Server.Implementations/Library/UserDataManager.cs`, `SaveUserData`: event follows native transaction commit and contains user and item. Manual played/unplayed saves use this path too; do not filter by playback-stop reason.
- `ILibraryManager.ItemAdded/ItemUpdated/ItemRemoved`, `ItemChangeEventArgs`: metadata/ancestry/version changes invalidate snapshots. Conservative global library invalidation covers old ancestors on episode moves, including cases where the event only supplies the new parent.
- `IUserManager.OnUserUpdated`: invalidate user results; reads also resolve current accounts and native visibility. Removed/disabled accounts are excluded on every read.
- `IPluginServiceRegistrator` registers the coordinated hosted worker. `MediaBrowser.Model.Tasks.IScheduledTask` supplies native manual execution, progress, cancellation and interval triggers; `ApplicationHost` discovers task exports.
- `InternalItemsQuery(user)` and `LibraryManager.GetItemList/GetItemIds` retain native tag, parental-rating, folder and version grouping rules. IDs are not permission-equivalence tokens. Page reads re-run the native episode-ID query for owners and requester; mismatch suppresses the row and queues revalidation. This incurs bounded authorization work, but no per-episode playback reads/classification on page loads.
- `BaseItem.IsUnaired`: `PremiereDate.Value.ToLocalTime().Date >= DateTime.Now.Date`. The entire server-local release day remains unaired. Midnight invalidates date-sensitive classifications without a playback event.

## Store and coordinated work

Separate `activity-index.json`, schema 1. Never alter `watchlists.json`, timestamp sidecars or preferences. Persist only derived user/title status, native dates/progress, coverage, authorized episode-ID set and resumable discovery positions. No tokens, durable CurrentlyPlaying, or playback-event history. Re-resolve names and native account/item visibility when serving results.

Single writer/worker, bounded queue, deduplicated owner/item events and generation fencing. Changes arriving during a native calculation prevent its publication. Native synchronous queries cannot be interrupted internally: check cancellation between calls. Work in small title batches with a cooperative pause. Startup resumes discovery positions but revalidates stored rows before disclosure; no trust in events missed during downtime. Scheduled reconciliation advances the same coordinator rather than starting a competing scan.

Native resume and played item discovery uses bounded offset pages, advances beyond the first 100 candidates, resolves episodes to series, and deduplicates titles per pass. Recent rows are visited first. Native pagination is not a transactional cursor: library changes restart discovery and playback changes may reorder rows; follow-up passes repair missed rows. Never call this a completely checked library or range. Retain older current-interest records independently of the 90-day history selection. Scheduled passes also revisit previously indexed titles that no longer occur in played/resume queries.

Conservative initial limits: 50 enabled accounts, 1,000 episode probe rows per account/series, at most 20,000 verification units in one work slice; bounded discovery pages and queue; bounded persisted records and file size. Safety-limit and lookup failures are explicit per-title outcomes, not empty verified activity. Exact worker limits and measured behavior are recorded below and in the qualification report.

Atomic same-directory temp-file replacement; validate version, structure, counts and size before adoption. Preserve corrupt bytes under a unique quarantine name and rebuild, reporting that recovery occurred. Failed writes do not publish a successful checkpoint. Crash before replacement leaves the previous checkpoint; interrupted temporary files are not adopted. No approval or authorization state is persisted.

## Reads, time selection and pagination

`ActivityIndex` reads current identity, restricts ordinary users to self, and validates every returned owner and item. Native episode-set checks protect counts/extras after policy changes even if an event was missed. Library generation changes or server-local date rollover suppress stale snapshots. Live native sessions add CurrentlyPlaying only after current owner/requester visibility checks.

Last 7/30/90 days (default 30) filters valid native LastPlayedDate values, excluding unknown/future values. Include older current interest defaults on and retains InProgress/CaughtUp independently of history. Live CurrentlyPlaying and explicit memberships remain independent. Time controls do not rewrite saved owner/status/sort defaults or trigger discovery.

Stable pages prioritize live sessions, then eligible Watching/Caught Up, then completed history, with an ID tie-breaker frozen for that view. They use short-lived opaque server-held snapshot identifiers bound to caller, scope and query; every page reauthorizes results. Bound snapshots and expiry, reject invalid/expired continuation. Report separate freshness, population progress, metadata gaps, safety limits, lookup failures and more-pages state. A fresh subset is never described as exhaustive.

Refresh queues prioritized work while keeping usable rows visible. A visible open page polls bounded index state, stops on navigation/account changes, and discards late responses. No unbounded automatic pagination. Preserve poster identity, local owner/status/sort behavior and accessible +N details.

## Recovery and rollout

Older versions ignore the derived file; downgrade restores the fresh v0.5.2 overview. Re-upgrade must revalidate, never assume the old process received events. Delete only the derived index with Jellyfin stopped to request a rebuild; preserve all personal stores. No production migration or public artifact changes in this branch.

Validation must separately measure cold population, warm authorized pages, event latency and reconciliation. Compare exact published v0.5.2 (`62af61f98b9d914f7890967048986f8c4641b8f3417edc2f08756bd15df7b3ec`) on identical disposable data; report native authorization query cost as well as avoided hydration/playback work. Unit models do not establish native SQL performance. Required tests include later discovery pages, cancellation/restart, failed writes/corruption, event races, visibility/policy changes, date boundaries, live sessions, browser lifecycle and existing deletion regressions. Unmeasured claims remain unqualified.

## Implemented limits and lifecycle

- One native discovery page of 50 rows and up to eight user/title verifications per slice; two-second cooperative delay, ten-second initial startup delay. Eight maximum-size verifications remain below the existing 20,000-unit allowance. Native playback chunks and the 1,000-episode limit are unchanged. Each slice groups its exact pending pairs by account and reuses v0.4.7 prepared playback batches across that account’s titles; it does not expand work into a user/title cross product. The worker does not parallelize native reads.
- Resume/played sources advance independently per enabled account, round-robin, with DatePlayed/SortName ordering. Maximum 1,000,000 raw rows per source per pass is explicit `DiscoveryWorkLimit`; native writes can reorder offsets. This is resumable discovery, not a transactional full-library snapshot. Deduplication is bounded to 10,000 user/title pairs per pass.
- 2,048 queued keys; changed playback keys have priority after two-second debounce. Library events invalidate all rows to cover unknown old ancestors; this is conservative and may temporarily suppress many results during metadata refresh. An active library scan can delay convergence.
- At most 10,000 stored rows and 32 MiB serialized data, with one MiB reserved for checkpoint metadata. Rows retain only eligible recent completed history (90 days) or older current interest; metadata gaps and lookup failures remain explicit. Size saturation refuses new rows, reports `StorageLimit`, and never evicts another user's current interest silently.
- Native scheduled reconciliation defaults to six hours. Manual/scheduled execution uses the same semaphore and stops its foreground loop after fifteen minutes; the background worker retains remaining work. Cancellation stops that task's work, while the ordinary hosted coordinator remains available. Native synchronous calls can only observe cancellation between calls.
- Startup revalidates all persisted rows before returning them. It resumes stored discovery offsets and queued keys; no persisted `Validated` flag can make stale episode counts visible. Previously indexed titles are also revisited during reconciliation, including unplayed titles no longer in discovery sources.
- Local midnight invalidates classifications, retaining native full release-day semantics. History-range filtering happens at read time, so expiration does not wait for reconciliation.
- Read pages contain at most 25 title IDs; current native episode authorization uses a separate 20,000-row ceiling and suppresses rows that cannot be checked. `VisibilityBudget` remains a material warning. Authorization cost is included in warm-page timing.
- Pagination snapshots retain only title IDs, not playback responses: at most 128 globally / eight per requester, two-minute expiry, cryptographically random opaque tokens bound to current account, owner, range and older-interest selection. Every page reauthorizes rows. Changed membership in a snapshot is not a new discovery audit; start a fresh view to incorporate newly indexed IDs.
- Visible Web pages update every thirty seconds; hidden pages skip polling. At most four explicitly loaded pages are refreshed automatically per poll. Beyond that, automatic updates pause with a visible Refresh instruction rather than issuing unbounded work. Explicit refresh starts a new first page while retaining old cards until the response arrives. No automatic Load more. Account/navigation changes reject late responses and stop the timer.
- Last 7/30/90 and older-interest controls are URL state only. Existing saved owner/status/sort defaults remain byte/schema compatible. Saving defaults continues to save those existing fields; the new time controls are not silently written to another preference representation.

## API

`GET /WatchGuard/ActivityIndex?owner=mine|all|USER_ID&days=7|30|90&older=true|false[&continuation=OPAQUE][&refresh=true]`

Requires native user authentication; API keys are rejected. `all` and other owners require an enabled administrator. `refresh=true` only requests background work and never grants deletion permission. Invalid range/continuation returns 400; unavailable native state returns 503. All responses are no-store. Existing `/ActivityOverview` APIs remain unchanged for older clients and the benchmark oracle.

Response adds `Freshness` and `Continuation` alongside the existing `Items`, `IsComplete:false`, `LimitReached`, `Notice`, and structured `Coverage` vocabulary. Freshness includes last successful verification, stored/validated/pending counts and native pass state. Administrator diagnostics contain cumulative native episode queries/rows, playback batches, completed verifications, discarded stale results, verification milliseconds and retained serialized size. Ordinary users do not receive cross-account work counters. A finished discovery pass is separate from per-title metadata/verification completeness, and is never an exhaustive-library assertion.

## Store recovery and rollback details

The coordinator owns `activity-index.json` schema 1 and its temporary checkpoints. It stores no durable sessions, explicit memberships, preferences, approval identifiers or credentials. Corrupt/unsupported documents move to `activity-index.json.corrupt-<random>` before rebuilding; an external change between checkpoints is preserved as `.replaced-<random>`. At five recovery files further writes fail with a visible checkpoint error until the administrator archives/removes those files; inability to preserve the original fails the worker rather than overwriting it. A single `.tmp` file bounds interrupted-write remnants and is overwritten on the next checkpoint, never adopted. Legacy `.tmp-*` files are ignored. A checkpoint failure is visible separately from successfully calculated in-memory rows; restart uses only the last successfully replaced checkpoint and revalidates it.

Back up personal data as before. Backing up the derived index is optional; it can always be rebuilt. Quarantines may contain derived playback information and should have the same filesystem protections as Jellyfin configuration. They are preserved for diagnosis and can be removed explicitly with the server stopped. Downgrade to published v0.5.2 ignores the index, restores its on-demand activity path, and retains both personal stores unchanged. Re-upgrade revalidates after downtime. The published catalog and existing release assets are unchanged.

`GET /WatchGuard/ActivityIndex/Status?owner=mine|all|USER_ID` returns scoped `Freshness` only, under the same authentication/administrator checks. It neither allocates paging snapshots nor queries episodes and is suitable for bounded population-readiness polling.


Warm read responses include `ReadDiagnostics.DurationMs`, `EpisodeVisibilityQueries` and `EpisodeRows`. These exclude response serialization/network time; fixture wall-clock latency includes them. Worker diagnostics are cumulative background work, not work caused by a warm read. The benchmark reports first-page latency and full manually paginated view latency separately because they return different quantities than the old capped overview.

Owner snapshots also carry a SHA-256 fingerprint of the complete native policy/configuration DTO and parental-rating fields. Any change suppresses the cached row and queues verification, even if the primary episode-ID set is identical (for example, access to a linked media version changed). This is a conservative invalidation check, never permission equivalence or a replacement for native visibility checks. Routine logs never contain the policy or fingerprint.

## UI and reconciliation limits to review

Status filtering and title/date sorting remain local to the loaded cards, including explicit memberships. They are not a global sort of unloaded pages. The page distinguishes no matches on loaded pages from a finished view and offers explicit Load more; active interest has snapshot priority so default active-status filters do not start behind arbitrary completed-history IDs. A newly playing title enters the next fresh view rather than changing an existing continuation's ordering.

The new range controls default to 30 days and use the fixed 7/30/90 choices. Existing `ActivityWindowDays` and `ActivityLimit` still govern the unchanged legacy overview API; they do not change the index's 90-day retained completed-history bound or 25-title page size. No configuration values are rewritten.

Missed events and reordering can leave newly discovered titles waiting for the next reconciliation pass. Startup resumes unfinished offsets and revalidates known rows; if a persisted discovery pass was already finished, undiscovered changes made while WatchGuard was absent may wait until the next six-hour pass or manual task execution. Freshness/coverage must not be interpreted as proof that no other title has interest. Refresh prioritizes known rows; the native scheduled task requests a new discovery pass. Other clients' manual watchlist edits are fetched on explicit Refresh/navigation; the thirty-second poll refreshes automatic activity and live sessions.
