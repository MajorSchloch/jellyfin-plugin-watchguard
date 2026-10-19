# WatchGuard v0.6.0 — Background activity indexing

**Unpublished release candidate.** This prepares the merged [PR #39](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/pull/39) for release. It does not publish assets, change the public catalog or deploy to production. The current published release remains [v0.5.2](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/releases/tag/v0.5.2).

Target: Jellyfin Server/Web **12.2.0**, .NET 10. Package version **0.6.0**; assembly/file versions **0.6.0.0**. Plugin GUID `a3c6bc84-783d-4ba8-a0db-89bfb83ab486` and target ABI `12.2.0.0` are unchanged. One plugin assembly, no Injector or additional runtime dependency.

## What changes

- **Background activity index:** ordinary Watchlists activity reads use rebuildable per-user/title results instead of repeating full playback classification on each page visit. Jellyfin remains authoritative; the index contains current derived status and native last-played dates, not an event history.
- **Incremental updates:** native playback/manual played-state events enqueue debounced work. Library/account changes invalidate affected results. The worker rejects calculations overtaken by newer changes. Currently Playing is derived from live native sessions rather than persisted as a durable fact.
- **Scheduled reconciliation:** a native Jellyfin scheduled task shares the serialized worker with startup and event-driven work. Resumable native discovery advances beyond the former first candidate batch, repairs missed events and revisits existing indexed titles.
- **Time filtering:** Last 7 / 30 / 90 days, default 30; Include older current interest defaults on. Valid native playback dates determine history range. Older Watching/Caught Up may remain through the current-interest option; unknown dates are not invented. Explicit watchlists remain independent. Saved owner/status/sort preferences and **3/3 +1** details are preserved; time controls are URL state, not new saved preference fields.
- **Progressive pages:** explicit memberships render first. Load more merges activity by title/user ID without replacing existing poster nodes. Local status filters and sorting do not restart discovery. Visible pages update periodically; Refresh prioritizes verification while preserving usable results on ordinary service failures.

## Reviewed fixes included

1. **No lost owners at a page boundary.** Continuation retains the first unfinished owner within a title and rechecks native visibility on every page. The three-series/seven-owner regression returns all 21 owner/title pairs; a title with 25 owners also progresses across multiple bounded pages.
2. **No mixed poll/pagination snapshots.** Polling and Load more share an in-flight slot. Explicit refresh invalidates older responses. Tests cover both operation orders and both response orders of overlapping refresh/pagination.
3. **Authorization denial clears protected views.** A 401/403 from initial load, refresh, polling or pagination clears memberships, activity, owner directory and continuation, invalidates competing responses and stops polling. Ordinary transport/service failures retain usable results.
4. **No unchanged idle checkpoints.** Persisted-state revisions track rows, discovery cursors and queued keys. Verified work is saved promptly; cursor/queue-only progress flushes within thirty seconds of the previous checkpoint and at pass completion. Failed writes remain dirty, and events arriving during disk I/O are not acknowledged as saved accidentally.

## Initial population, freshness and coverage

Expect an initially incomplete activity view after installation or a rebuild. Explicit memberships remain available while background work advances. Startup waits ten seconds, then processes small slices with a two-second cooperative delay. Persisted rows are revalidated after restart before disclosure. Initial population can take minutes or longer depending on library size and native lookup cost; it does not happen in the page request.

Freshness and completeness are different. A recent verification timestamp does not prove that all users, titles or the selected history window have been checked. Discovery offsets can move under concurrent native writes, so even a finished pass is not an exhaustive library audit. Pending verification, metadata gaps, native failures and safety limits remain visible. Unknown or unverified activity is never proof that nobody is interested.

Both requester and activity owner must still have native access. Episode-set and policy checks protect cached counts/extras after permission changes; a visible series alone does not authorize its episode details. Cross-user activity stays administrator-only.

## Operating limits

- One serialized worker; one 50-row discovery page and up to eight user/title verifications per slice. Native playback batching, alternate-version handling and the existing classification semantics remain intact.
- Up to 50 enabled users, 1,000 episode rows per user/series and the existing 20,000-unit verification bound. Oversized/incomplete series are reported, not classified as fully verified.
- Queue: 2,048 keys with two-second change debounce. Store: 10,000 rows / 32 MiB, reserving one MiB for checkpoint metadata. Saturation is reported; current-interest rows are not silently evicted to fit recent history.
- Reconciliation defaults to six hours. The native task supports progress, cancellation and manual execution; its foreground run is bounded to fifteen minutes, with remaining work resumed by the hosted coordinator. Native synchronous queries observe cancellation between calls.
- Native discovery bounds each source/account pass to 1,000,000 rows. Dates are reevaluated at server-local day changes; history-window expiry is applied at read time.
- Read pages visit at most 25 titles with a separate 20,000-row native episode-visibility budget. A title can span pages. Opaque continuations are caller/scope/range-bound, expire after two minutes, and are limited to eight per caller / 128 globally. They retain IDs/positions, not authorization decisions.
- Visible pages poll every thirty seconds and refresh at most four explicitly loaded pages per poll. Hidden pages pause; larger loaded views show an explicit Refresh instruction. Navigation/account changes invalidate late responses.

See [architecture, APIs and scheduling](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/blob/master/docs/activity-index.md) for the full contract.

## Storage, upgrade and rollback

Back up the actual WatchGuard plugin data and configuration paths before testing. LinuxServer.io commonly uses `/config/data/plugins/Jellyfin.Plugin.WatchGuard/` for data and `/config/data/plugins/configurations/Jellyfin.Plugin.WatchGuard.xml` for configuration.

`activity-index.json` is a separate derived schema-1 store. Existing `watchlists.json`, `watchlist-dates.json`, `preferences.json` and `preference-sorts.json` formats are unchanged. Atomic same-directory writes preserve the previous checkpoint on failure. Corrupt/unsupported bytes are quarantined; external replacement between checkpoints is preserved. Recovery files are bounded to five before further writes fail visibly and require administrator cleanup. Never erase unreadable personal stores to rebuild activity.

To rebuild, stop Jellyfin, preserve the derived index for diagnosis, remove only `activity-index.json`, then restart. Rebuild does not modify personal watchlists or native playback state. During normal catalog upgrades, retain one active WatchGuard version, restart Jellyfin and fully reload Web clients. The public catalog will not offer v0.6.0 until separate publication approval.

For rollback, use the checksum-verified **published v0.5.2** package and native plugin lifecycle, restart and reload Web clients. Retire the v0.6.0 assembly through Jellyfin rather than leaving duplicate discovery folders. v0.5.2 ignores the derived index and restores its on-demand activity overview; retain personal stores and XML configuration. A later re-upgrade revalidates derived rows before disclosure. Pending in-memory approvals do not survive restart. See [upgrade/rollback fundamentals](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/blob/master/docs/server-enforcement-upgrade-v049.md).

## Safety boundaries unchanged

Fresh per-title Protection and targeted SeriesActivity remain independent of the index. Deletion enforcement, administrator approval, self/other-user protection, Caught Up protection, native permissions, fail-closed handling, Cancel/Escape/close and exact native DELETE counts are unchanged. Index pages or caches never authorize deletion. Server enforcement remains opt-in. External filesystem changes and unsupported deletion routes are outside the qualified guard boundary.

## Qualification and artifact

**Concurrent approval response fix:** the release candidate now includes the [deterministic race resolution](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/blob/master/docs/approval-redemption-race-v060.md). Local checks pass; full qualification of this corrected runtime is pending. The following PR #40 commit/checksum/results are historical and do not qualify the corrected assembly.

Local qualification passed **250 backend, 132 JavaScript/bootstrap/approval/readiness, 15 Python and four catalog tests**. Two clean Release compilations produced identical single-DLL + LICENSE ZIPs: `Jellyfin.Plugin.WatchGuard-v0.6.0.zip`, SHA-256 `c967e12538558ad168be5242faf366f14484b074afdef10483483b3c2453a232`.

**Build and all eleven integration suites passed** in [39255014177](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/39255014177) on exact commit `b42e565da8d2cb8ed86841c378dd0e928b587bd9`, with `publish=false`, `proxy_matrix=true`; publication was skipped. The hosted ZIP is byte-for-byte identical to the local artifact above. [Structured qualification evidence](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/blob/master/docs/evidence/v060-qualification.json) records every job, checksum and rollback outcome. No qualification jobs were retried. The subsequent evidence commit changes documentation only. No publication is authorized by a successful validation run.

Passed suites: standalone/Caddy, migration, official-image base path, legacy/rollback, WebSocket, discovery, verification performance, activity index, official-image server enforcement, base-path server enforcement and LinuxServer.io server enforcement. The expanded proxy matrix exercised Nginx, Traefik and a tunnel-style frontend in addition to Caddy and direct HTTPS. Native catalog rollback to checksum-verified published v0.5.2 preserved saved stores and configuration bytes; saved-sort compatibility also passed against published v0.5.0/v0.4.10. The separate pre-existing master-run concern below remains for review.

Earlier qualification of PR #39's corrected runtime `50039a0793c7fa666d3c1e9cc6090ca392780db6` passed build and eleven integration suites in [39250890240](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/39250890240). That is historical evidence, not qualification of the new version.

The **v0.6.0 candidate's** [native measurements](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/blob/master/docs/evidence/activity-index/v060-summary.json) use seven accounts, 120 completed movies and one 300-episode series, comparing against checksum-verified published v0.5.2 on the same disposable native database:

| Scope | Published v0.5.2 request median (100 titles) | Indexed first-page median (25 titles) | Indexed complete fixture view (121 titles) |
| --- | ---: | ---: | ---: |
| Single user | 248.04 ms | 23.53 ms | 103.13 ms |
| All users | 1,318.41 ms | 51.32 ms | 212.86 ms |

Cold paced population took **282.37 s**; a manual unplayed update settled in **2.53 s**. Native task discovery, start and cancellation passed. First-page medians use three requests; full paging and cold/incremental times are individual measurements. These are movie-heavy fixture measurements with different response sizes, not production guarantees or full-library completeness claims. See [earlier measurements and limitations](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/blob/master/docs/activity-index-results.md).

### Concurrent approval concern — corrected candidate awaiting qualification

The preceding master run [39253745693](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/39253745693/job/118064182974), on `092bcb18cafb69b7051e01769febaa191241b2e5`, failed the concurrent bulk-approval test: the competing request returned `404 TargetUnavailable` rather than the asserted `409 ApprovalAlreadyUsed`. Server logs show one native continuation and the winning request removing both disposable targets before the competing request's final permission check. The test stopped before its final file/database assertions. This was not a demonstrated double deletion. PR #40 changed no security code or assertions; its passing corresponding suite did not resolve the race. The follow-up fix deterministically reproduces both single and bulk orderings and reports a consumed approval before a stale missing-target response, after revalidating identity. Fresh checks, atomic consumption and native file/database assertions remain intact. See the resolution above for current qualification status.

Published v0.5.2 comparison/rollback SHA-256 remains `62af61f98b9d914f7890967048986f8c4641b8f3417edc2f08756bd15df7b3ec`. Public release assets, tags and `manifest.json` history are unchanged.
