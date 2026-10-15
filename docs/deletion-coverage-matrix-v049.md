# v0.4.9 deletion coverage and validation matrix

Companion to [the exact source trace](deletion-architecture-v049.md) and [options/recommendation](server-side-protection-options-v049.md). Research only; no server guard was installed. “Potential filter” below means an unimplemented, version-qualified ASP.NET action filter on the two native LibraryController deletion actions, not a universal library hook.

## Coverage by operation

| Operation | Current v0.4.8 WatchGuard | Potential filter | Boundary |
| --- | --- | --- | --- |
| Supported Web movie/series detail Delete | Fresh check and confirmation through wrapped instance | Could block native item action | Native confirmation stays first; permissions still apply |
| Supported Web season/episode Delete | Fresh parent-series protection, actual target displayed | Could apply same resolution before native item action | Missing/invalid parent must fail closed |
| Supported Web poster/context Delete | Same wrapped method | Could block native item action | Only installed, compatible adapter instance is covered |
| Web multi-select | Separate serialized checks/dialogs for individual calls | Could guard each single action | Neither is an atomic multi-item transaction |
| Direct `DELETE /Items/{id}` | Not intercepted by Web adapter | Could stop action before mutation | Authentication, visibility, permission and privacy preflight required |
| Direct `DELETE /Items?ids=...` | Not intercepted by Web adapter | Needs separate bulk-action attachment/preflight | Existing native bulk can partially delete before an error |
| Mobile/TV client using either item API | No general guarantee | Same HTTP guard regardless of client | Stock clients have no proven WatchGuard challenge/override UI |
| Mobile app embedding supported Web | Only if the same loader/instance executes; not independently qualified | Same endpoint coverage | Do not infer mobile/TV compatibility from desktop tests |
| API-based external tool using item APIs | No | Same route coverage, API-key policy unresolved | Must fail protected requests rather than silently override |
| Folder/collection/playlist item deletion | Current adapter conservatively blocks unsupported target types | Not safe to pass as zero interest | Recursive/container semantics require separate scope analysis |
| `DELETE /LiveTv/Recordings/{id}` | No demonstrated coverage | Not covered by the proposed two-action scope | Separate native policy and channel/internal deletion semantics |
| Remove library or configured library path | No | No | Changes library configuration/indexing; not equivalent to deleting external source files |
| Internal scan cleanup or retention tasks | No | No | Calls services/filesystem without these HTTP actions |
| Other plugins calling ILibraryManager | No | No | No cancellable native deletion event |
| Files removed manually, by shell, SMB/NFS or storage tools | No | No | Outside Jellyfin request pipeline |
| Sonarr/Radarr deleting or replacing files directly | No | No | Filesystem action outside Jellyfin; if a tool instead calls a guarded item API, only that request could be covered |
| Tdarr replacing/transcoding files directly | No | No | Rewrites/renames may not involve a Jellyfin DELETE at all |
| Plugin disabled/uninstalled, server restarted without it | No active WatchGuard enforcement | No | Native Jellyfin permissions still apply; old browser tabs must be reloaded |

No inference about all versions of mobile/TV clients or third-party tools is made. Server coverage is defined by the operation they actually send. Their own UI implementations were not tested in this investigation. Filesystem access controls, backups and external-tool retention configuration are separate controls, not WatchGuard features.

## Current audit results (2026-10-15)

The unchanged repository implementation was tested with:

- Backend Release tests: **105 passed, 0 failed**.
- JavaScript/bootstrap tests: **53 passed, 0 failed**.
- `python3 tests/docker-smoke.py --linuxserver --caddy`: **exit 0** using disposable fixture media. Native movie/series detail, context menu, episode/season protection, self-interest, bulk, Escape, approval and permission scenarios passed. Browser report records **13 native DELETEs, zero ordering violations** across the fixture's successful operations. These are total fixture counts, not 13 deletions for one approval.
- The same Docker run passed anonymous/authenticated standalone loading, reload/stale-tab checks, CSP blocking, settings/preferences, HTTPS identity/gzip/zstd, HEAD/conditional/range handling, persistent authenticated WebSocket ping/pong and uninstall. Uninstall retained JSON data and left native Web files unchanged.

The browser report is generated at `artifacts/v048/linuxserver/caddy/standalone/report.json` by the existing suite. Local command logs for this audit were `/tmp/wg049-backend-tests.log`, `/tmp/wg049-web-tests.log` and `/tmp/wg049-browser.log`; these temporary paths are not release artifacts. The source pin and commands make the audit reproducible.

[Existing v0.4.8 full release-validation evidence](performance-data/release-v048.json) records the earlier complete matrix, including migration, base-path, legacy, discovery and verification. That historical file labels its run as a release-candidate validation; it is not fresh evidence for a v0.4.9 server guard. Those suites and their safety assertions are preserved unchanged. This documentation-only investigation reran the tests above, not the entire seven-job release matrix, and does not claim new catalog/rollback validation.

## Existing adapter assertions reviewed

`tests/web.test.cjs` covers original receiver/arguments/result, one native call on approval, zero on rejection, native permission errors, queue recovery/serialization, identity changes, duplicate installation, method replacement, redacted diagnostics, focus/Cancel/Escape/close, double activation, confirmed empty interest, self/other/multiple reasons, malformed/failed responses and parent-series resolution. Browser tests exercise real Web dialogs and request ordering; neither proves interception of a different native client or arbitrary future Web code.

Completed history alone remains non-protecting. Verified CaughtUp protection remains configuration-dependent. Watching, watchlist and currently playing protection remain independent of overview completeness. No ActivityOverview result authorizes deletion.

## Required qualification scenarios for a future HTTP guard

These are **planned tests, not passing results**. No server interceptor or override protocol exists in this change.

| Scenario | Required assertion before adoption |
| --- | --- |
| Single and bulk native item routes; base-path aliases | Exact action coverage, zero filesystem/database mutation on veto; unrelated routes unaffected |
| Unauthenticated, expired token, disabled user | Native rejection; no playback/name disclosure, no approval created |
| Visible/invisible item, delete permission enabled/disabled, restricted folders | Preserve native lookup/permission behavior; no guard-created elevation |
| API key versus user token | Explicit documented policy; key is not silently converted into a human admin |
| Self/other/multiple users, movies/series/seasons/episodes | Same authoritative reasons as Protection, parent target binding correct |
| Continuing/ended/unknown, missing metadata, incomplete lookup | CaughtUp option respected; unreliable protection fails closed; history alone does not protect |
| Cancel, Escape, disconnect before approval | No mutation and no usable approval; disconnect after native execution begins is not rollback |
| Explicit approval and duplicate request | Exact target/method/identity binding; approval consumed atomically; at most one invocation |
| Two approvals/tabs, simultaneous requests, expired/replayed approval | No reusable bypass, deterministic conflict response and recheck |
| Interest/permissions/library identity change during confirmation | Recheck current state; changed challenge requires new approval; no stale authorization |
| Bulk with protected later target, duplicate/overlapping series and episode targets | Preflight before any mutation; explicit partial-execution policy; no false atomicity promise |
| Lookup failure, malformed scope, unsupported item type | Fail closed, never interpret error as zero interest |
| Restart, disable, uninstall and rollback | Outstanding approvals invalidated; documented native-only behavior; watchlists/preferences preserved |
| Native Web, representative mobile/TV, external API tool | Meaningful failure without automatic retry/bypass; opt-in clients can explicitly approve |
| Streaming, metadata, WebSocket, library scans | No interest queries for unrelated requests, no changed native pipeline behavior |
| Catalog install/upgrade/rollback, Caddy, base path, legacy | Existing full matrix still passes; native Web files and loader unchanged |

Filesystem mutation assertions must inspect disposable files and library state, not merely count HTTP responses. Exactly-once invocation is testable inside a request; exactly-once distributed completion across process failure requires a stronger protocol than a transient nonce. Do not advertise that guarantee without implementing and testing it.
