# Background activity index — implementation design

Status: review branch after published v0.5.2; not published or deployed. The supplied 7,772.52 ms / 680 episode queries / seven-account observation is production evidence supplied by the user, not our benchmark.

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

Separate `activity-index.json`, schema 1. Never alter `watchlists.json`, timestamp sidecars or preferences. Persist only derived user/title status, native dates/progress, coverage, authorization episode-set digest and resumable discovery positions. No tokens, durable CurrentlyPlaying, or playback-event history. Re-resolve names and native account/item visibility when serving results.

Single writer/worker, bounded queue, deduplicated owner/item events and generation fencing. Changes arriving during a native calculation prevent its publication. Native synchronous queries cannot be interrupted internally: check cancellation between calls. Work in small title batches with a cooperative pause. Startup resumes discovery positions but revalidates stored rows before disclosure; no trust in events missed during downtime. Scheduled reconciliation advances the same coordinator rather than starting a competing scan.

Native resume and played item discovery uses bounded offset pages, advances beyond the first 100 candidates, resolves episodes to series, and deduplicates titles per pass. Recent rows are visited first. Native pagination is not a transactional cursor: library changes restart discovery and playback changes may reorder rows; follow-up passes repair missed rows. Never call this a completely checked library or range. Retain older current-interest records independently of the 90-day history selection. Scheduled passes also revisit previously indexed titles that no longer occur in played/resume queries.

Conservative initial limits: 50 enabled accounts, 1,000 episode probe rows per account/series, at most 20,000 verification units in one work slice; bounded discovery pages and queue; bounded persisted records and file size. Safety-limit and lookup failures are explicit per-title outcomes, not empty verified activity. Exact worker limits and measured behavior will be recorded with implementation tests.

Atomic same-directory temp-file replacement; validate version, structure, counts and size before adoption. Preserve corrupt bytes under a unique quarantine name and rebuild, reporting that recovery occurred. Failed writes do not publish a successful checkpoint. Crash before replacement leaves the previous checkpoint; interrupted temporary files are not adopted. No approval or authorization state is persisted.

## Reads, time selection and pagination

`ActivityIndex` reads current identity, restricts ordinary users to self, and validates every returned owner and item. Native episode-set checks protect counts/extras after policy changes even if an event was missed. Library generation changes or server-local date rollover suppress stale snapshots. Live native sessions add CurrentlyPlaying only after current owner/requester visibility checks.

Last 7/30/90 days (default 30) filters valid native LastPlayedDate values, excluding unknown/future values. Include older current interest defaults on and retains InProgress/CaughtUp independently of history. Live CurrentlyPlaying and explicit memberships remain independent. Time controls do not rewrite saved owner/status/sort defaults or trigger discovery.

Stable pages use short-lived opaque server-held snapshot identifiers bound to caller, scope and query; every page reauthorizes results. Bound snapshots and expiry, reject invalid/expired continuation. Report separate freshness, population progress, metadata gaps, safety limits, lookup failures and more-pages state. A fresh subset is never described as exhaustive.

Refresh queues prioritized work while keeping usable rows visible. A visible open page polls bounded index state, stops on navigation/account changes, and discards late responses. No unbounded automatic pagination. Preserve poster identity, local owner/status/sort behavior and accessible +N details.

## Recovery and rollout

Older versions ignore the derived file; downgrade restores the fresh v0.5.2 overview. Re-upgrade must revalidate, never assume the old process received events. Delete only the derived index with Jellyfin stopped to request a rebuild; preserve all personal stores. No production migration or public artifact changes in this branch.

Validation must separately measure cold population, warm authorized pages, event latency and reconciliation. Compare exact published v0.5.2 (`62af61f98b9d914f7890967048986f8c4641b8f3417edc2f08756bd15df7b3ec`) on identical disposable data; report native authorization query cost as well as avoided hydration/playback work. Unit models do not establish native SQL performance. Required tests include later discovery pages, cancellation/restart, failed writes/corruption, event races, visibility/policy changes, date boundaries, live sessions, browser lifecycle and existing deletion regressions. Unmeasured claims remain unqualified.
