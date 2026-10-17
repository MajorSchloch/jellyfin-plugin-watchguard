# Release qualification reliability investigation

Status: in progress; v0.4.9 publication remains frozen. Production code is unchanged.
Evidence: full job logs and failure artifacts downloaded from the four runs below, retained locally under `artifacts/reliability/historical`. These are observations from different commits, not repeatability runs of one candidate.

| Run | Confirmed observation | Cause established / uncertainty | Infrastructure response |
|---|---|---|---|
| [55](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/38939120712) | LinuxServer fixture raises `KeyError: WebProtected`; old-tab tests time out on hidden More | Episode-only readiness did not establish movie inventory. Hidden More does not prove lack of native delete support. | Exact inventory validation; separate adapter contracts from native menu coverage. |
| [56](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/38951074621) | Old-tab More remains hidden despite retry | Reload retry did not fix the invalid adapter-test dependency. Actual reason the toolbar had not initialized remains unproven. | Retain direct adapter coverage introduced by subsequent baseline fixes; strengthen initialization. |
| [57](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/38954944299) | Current adapter suite fails on More; base-path whole-suite retry masks a first failure | Same native-control dependency moved to current script. A successful rerun is not an explanation. | Retain dedicated native-menu suite; remove whole-suite retry. |
| [58](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/38971930423) | Migration says `Synthetic media was not scanned`; official Caddy browser ends on Home with CaddyWeb still present | Scan diagnostic was insufficient to identify missing items. Login-to-Home race is a hypothesis supported by missing route/identity preconditions, not yet a confirmed server defect. | Exact inventory evidence and authenticated route contracts; qualify locally and hosted before concluding. |

Pinned Web source: `61b1f890365ad15138e943e694af723c1d47df2a`, `src/apps/legacy/controllers/itemDetails/index.html` initializes More hidden; `index.js` renders details and asynchronously calls `itemContextMenu.getCommands` before changing visibility. It is incorrect to infer that a hidden initial button is intentionally unsupported by the modern shell.

Pinned server source: `ca0f16eb7c195f720a1493ed469a27c4657db0c6`. `ScheduledTasksController.StartTask` (`POST /ScheduledTasks/Running/{taskId}`) starts the native task; `RefreshMediaLibraryTask.Key` is `RefreshLibrary`. Task Idle is necessary here but insufficient: exact inventory must also match.

No production security defect has been established by these failures. No security invariant is waived. Remaining investigation includes first-failure trace capture, teardown evidence, test contamination, version parity and full hosted repeatability.

During local refactoring qualification, migration exposed an order-dependent `items[0]` assumption: expanding inventory to include seasons caused a season to be sent to a movie watchlist setup operation. Fixed by selecting `PoC Movie Detail` explicitly in migration and legacy catalog setup. This was introduced/exposed by the refactor, not asserted as the cause of historical run #58. The failed run is retained and does not count as qualification.

The first base-path failure in #57 was `page.goto: net::ERR_ABORTED at about:blank` during Watchlist UI, not a deletion assertion. The redundant intermediate blank-document navigations were removed; setup now navigates directly to the intended native route. There is no automatic navigation/deletion retry. Qualification must demonstrate this remains valid for all native UI cases.

A local standalone/catalog run also timed out on the native package installation POST after repeated version round-trips. The failed operation was not retried. Its sanitized container evidence is retained; the reason for the package timeout is not yet established. This is a release blocker until diagnosed.
