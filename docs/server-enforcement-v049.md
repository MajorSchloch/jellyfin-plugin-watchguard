# v0.4.9 server enforcement candidate

Stage C integrates the qualified Stage A/B protocol into the normal WatchGuard assembly, targeting the [pinned Jellyfin 12.2.0 controller source](https://github.com/jellyfin/jellyfin/blob/ca0f16eb7c195f720a1493ed469a27c4657db0c6/Jellyfin.Api/Controllers/LibraryController.cs#L362) and [qualified Web source](https://github.com/jellyfin/jellyfin-web/tree/61b1f890365ad15138e943e694af723c1d47df2a). This is an unpublished candidate; production readiness depends on the complete release matrix. Published catalog history is unchanged.

## Activation and lifecycle

`EnableServerEnforcement` defaults to **false**, including XML without this field. The normal plugin service registrator always adds the narrow MVC convention on supported hosts. Only the exact Jellyfin.Api `LibraryController.DeleteItem(Guid itemId)` and `DeleteItems(Guid[] ids)` actions qualify, with their exact ActionResult return types and HttpDelete route attributes, on server 12.2.0. Action descriptors are independently counted before successful attachment is reported.

Jellyfin registers services before constructing plugins. The plugin constructor captures its loaded configuration exactly once into the shared attachment state, before host startup. The convention can be constructed independently of configuration. Unknown configuration never becomes an inactive bypass. The filter checks the immutable startup value; changing the saved preference requires a server restart in either direction. Saving off does not deactivate an already running guard. Saving on does not activate a startup-disabled guard. Capabilities report preference, runtime attachment and restart requirement separately.

An incompatible host is **not protected by this filter**. No broad interception fallback is installed. An expecting Web client fails closed, and diagnostics report incompatibility rather than successful enforcement. Do not enable this feature on another server version merely because the plugin loads.

## Normal package and Web flow

One BasePlugin GUID, one DLL, existing embedded script and standalone loader. No companion DLL, experimental environment variable, asset response substitution or Injector dependency is used. The archived experiments remain separate test/research code.

The default-disabled filter continues the native action without identity or interest work. The Web adapter obtains fresh capabilities and its normal fresh Protection response. Inactive mode uses the original deleteItem receiver, arguments and result; no challenge or server veto is added.

Active mode preserves native confirmation, then one existing WatchGuard dialog. Cancel/Escape/close send no DELETE. Only explicit Delete Anyway starts Prepare → Present → Approve. The browser validates identity/token/location, target, parent scope and reasons at asynchronous boundaries. One native API-client Ajax DELETE carries a request-local approval header. No global transport interception and no automatic DELETE retry occurs. Clear operations use the original deleteItem; the filter independently checks them.

A tab that observed or was delivered an active-enforcement expectation cannot fall back to Web-only mode. Reload after intentional restart/disable/rollback. A capability response is not a lease against an administrator subsequently uninstalling the plugin: drain operations and reload clients at lifecycle boundaries.

## Endpoints and diagnostics

All routes below use `/WatchGuard/ServerApproval/`, native authentication and no-store responses:

- `GET Capabilities`: protocol, configured preference, runtime state, compatibility, attached-action count, restart requirement, generation when active, request-origin observations and native-session authentication health. An absent Origin on a GET does not verify proxy health.
- `POST Prepare`: exact action and ordered targets; fresh native permission and interest checks; non-mutating Created challenge only.
- `POST Present`, `Approve`, `Revoke`: the Stage A state machine. Approval requires an enabled administrator using the same native session identity.

Dashboard → Plugins → WatchGuard displays the setting and actual runtime state. Successful server attachment does not establish browser execution or reverse-proxy compatibility. Validate the current browser and disposable cancellation/approval before relying on the integration.

## Coverage

Only the two qualified native HTTP item-deletion actions. Movies, series, seasons and episodes use fresh authoritative interest with verified parent-series inheritance. Unknown targets/inventories fail closed. Other HTTP actions, internal cleanup, library removal, filesystem operations and Sonarr/Radarr/Tdarr direct file changes remain outside this boundary.

Clients without the approval protocol cannot delete protected items. The qualified credential transport is an explicit `Authorization: MediaBrowser ... Token="..."` header; clients using URL tokens, cookies or other credential transports may be rejected even for clear operations. Do not convert API keys into user identities. Enabled ordinary users with native deletion permission can delete verified unprotected media; they cannot override protection or retrieve other users' playback details. API keys cannot delete through the enabled guard. No override grants native permissions.

See [security](server-enforcement-security-v049.md), [upgrade/rollback](server-enforcement-upgrade-v049.md) and the historical [Stage B transport evidence](server-web-integration-v049.md).

## Differences found during production qualification

Service registration precedes plugin construction in the pinned native host; activation is therefore captured by the plugin constructor rather than read during service registration. Production cancellation retains the existing AbortError and token-free diagnostic event contracts. Enforcement expectation is sticky for the adapter lifetime, including replacement ApiClient instances. A foreign receiver is rejected before any native request, and feedback failure cannot replace a native DELETE rejection. These changes have dedicated regressions; no bypass, retry or extra approval path was introduced.

The archived approval store, identity validator and evaluator retain their qualified Stage A/B logic. The production middleware and bootstrap are unchanged. Authenticated script delivery substitutes only the startup expectation marker in the normal embedded script, alongside the existing diagnostic marker; it does not rewrite native Web files or substitute experimental response assets.

The no-store MVC filter runs before automatic model validation, so malformed authenticated protocol bodies also receive `Cache-Control: no-store`. Native authentication rejection can occur before controller filters and carries no protocol/private response. This ordering is covered by unit and real HTTP tests.

## Reproducing qualification

Build with the pinned SDK using `python3 scripts/build-release.py`, then run `dotnet test Jellyfin.Plugin.WatchGuard.slnx -c Release --no-restore`, `node --test tests/web.test.cjs tests/standalone-bootstrap.test.cjs tests/server-enforcement.test.cjs`, and `python3 tests/catalog_test.py`. A second forced release build must produce the same SHA-256.

The dedicated disposable fixture is `python3 tests/server-enforcement.py`; repeat with `--base-path /jellyfin` and `--linuxserver`. It downloads and verifies published v0.4.8, installs the candidate through a temporary native catalog, uses generated media only, and removes its containers/configuration afterward. It accepts no production URL or media directory. Official/direct and LinuxServer runs include Caddy HTTPS; base-path tests use the actual native base path. The full existing matrix remains in `.github/workflows/release.yaml`, parallel across independent CI jobs.

The discovery fixture now sets distinct native playback timestamps and asserts resume ordering before benchmarking. Its earlier implicit timing could place a smaller series first and invalidate the historical v0.4.5 starvation scenario. Expected result counts, safety budgets, checksums and benchmark timeouts were not relaxed. Fixture measurements are not production performance claims.

## Browser evidence

- [Desktop confirmation](screenshots/v0.4.9/desktop-dialog.png) and [390px confirmation](screenshots/v0.4.9/mobile-dialog.png).
- [Native settings](screenshots/v0.4.9/settings-desktop.png) and [mobile settings](screenshots/v0.4.9/settings-mobile.png), separating configuration, attachment, restart and browser status.
- [Post-approval navigation](screenshots/v0.4.9/approved.png) and [mobile](screenshots/v0.4.9/mobile-approved.png). File/record assertions establish deletion; screenshots alone do not.
- [Expired approval feedback](screenshots/v0.4.9/ApprovalExpired.png), [mobile](screenshots/v0.4.9/ApprovalExpired-mobile.png), [unavailable guard](screenshots/v0.4.9/ServerGuardUnsupported.png) and [mobile](screenshots/v0.4.9/ServerGuardUnsupported-mobile.png).

The error screenshots use controlled browser 410/503 response faults; the native suite separately waits for the actual 60-second expiry. Per-item queue tests exercise the same ApiClient calls used by multi-select, while the existing full browser suite retains visual multi-select coverage. No claim is made that arbitrary mobile/TV clients understand approvals.

Qualification also verifies that a request carrying a hostile Origin plus spoofed X-Forwarded-Host/Proto remains rejected when the caller is not a configured trusted proxy. The Caddy teardown fixture restarts its disposable Jellyfin container after detaching the temporary network: Docker Desktop was observed to leave the host-port route unresponsive while the internal native public endpoint remained healthy. This is fixture lifecycle handling, not a production proxy workaround; no DELETE is retried.

## Native approval measurements

These are local disposable-fixture observations on the final candidate, not production latency promises or a controlled load benchmark. Browser elapsed time starts at explicit Delete Anyway and ends after native navigation; it excludes human decision time and the preceding Protection lookup. The Web-only comparison uses the same candidate after restart with enforcement disabled.

| Image/path | Protected movie approval | Web-only movie | Native 300-episode challenge | Native approved bulk |
| --- | ---: | ---: | ---: | ---: |
| Official, direct | 283 ms | 126 ms | 163.17 ms | 45.28 ms |
| Official, base path | 261 ms | 131 ms | 155.93 ms | 41.43 ms |
| LinuxServer.io, direct | 280 ms | 136 ms | 160.18 ms | 46.53 ms |

Across successful browser requests in the official/direct fixture, median Protection / Prepare / Present / Approve / native DELETE durations were 28.5 / 36 / 29 / 28 / 37 ms. These span different generated targets and are not additive components of a single operation. Native guard log timings exclude downstream controller execution; HTTP timings include it. The fresh recheck remains required at each protocol boundary. All fixture variants report zero additional InterestService evaluations for unrelated HTTP traffic. Raw aggregate timings and exact continuation counts are retained in [native evidence](evidence/v0.4.9/official/direct/results.json).

## Qualification scope and release gate

Backend tests: **147 passed**. Web/bootstrap/server-adapter tests: **86 passed**. Catalog tests: **4 passed**. Archived Stage A/B and veto-PoC unit suites: **35 + 8 passed**. The published-baseline deterministic model comparison passes both retained tests. Two forced Release builds produce identical bytes; package allowlisting and both catalog MD5 / downloadable SHA-256 checks pass.

The enforced native fixtures record **74 official/direct**, **73 official/base-path**, and **74 LinuxServer/direct+Caddy** case results. Each actual veto checks native library records and disposable files. Approved single/bulk and concurrent redemption cases assert one native controller continuation and intended removal. Browser Cancel/Escape/close and fault-injected failures assert zero DELETEs. Main browser approval flows send exactly seven intended DELETEs; Caddy and freshly disabled-mode flows each send one. Exact version/signature mismatch and missing registration are unit-tested; unsupported future/custom server builds are not Docker-qualified.

All snapshots, credentials and media used for testing are disposable. See [evidence provenance and failed-attempt notes](evidence/v0.4.9/run-notes.md). Normal catalog upgrade retains the superseded v0.4.8 directory and verifies one active candidate without manual DLL operations; [catalog evidence](evidence/v0.4.9/catalog-upgrade-v049.json) and [legacy migration evidence](evidence/v0.4.9/migration-v049.json) preserve both stores and configuration values.

The final local matrix passed all 11 candidate jobs: enforced official/direct, official/base-path and LinuxServer/Caddy; default base-path, migration, catalog/Caddy and WebSocket; discovery, verification, restricted episode-policy verification and the v0.4.7 large-series comparison. Legacy published-v0.3.1 catalog and browser fixtures also passed separately. See [matrix](evidence/v0.4.9/release-matrix.json) and [validation summary](evidence/v0.4.9/validation-summary.json). The GitHub Actions workflow is prepared with parallel integration jobs and explicit publication/environment approval; no hosted workflow, release publication, catalog update or production deployment is claimed here.

The retained 100-series/7-user native verification fixture returned 100 titles on all three measured runs in each scope. Candidate medians were 678.3 ms (one user) and 3159.0 ms (all users), with exactly 2,399 / 16,314 episode work rows respectively, matching the published-baseline counts. The expanded restriction-policy fixture also returned 100 on every run, with candidate medians 858.7 / 3746.2 ms. These preserve existing regression behavior; comparisons against the historical v0.4.7 baseline measure previously implemented episode-query optimizations, not a new Stage C speedup. Exact result/visibility/playback/coverage equality assertions remain in the original native tests. Raw reports retain historical v048 filenames/labels, with final-candidate provenance recorded in the evidence notes.

## Prepared artifact and decision

**The candidate passes the local release qualification gates and is ready for separate release approval on the pinned Jellyfin 12.2.0 images.** No publication or production rollout has occurred. Default upgrades remain Web-only. Opt-in enforcement is limited to the two qualified native item-deletion actions; unsupported hosts, client credential transports, external file operations and TOCTOU/crash boundaries remain as documented.

Artifact: `artifacts/Jellyfin.Plugin.WatchGuard-v0.4.9.zip` (one DLL + LICENSE), with adjacent `.zip.sha256`.

SHA-256: `5cc5cd51e1a9f666a4abdbda07b1ad08b8d8ab9480edbad0dbd23fc53440be6d`.

Catalog MD5: `a83bfce2e35037cf19262fb8fe6f3f1b`. Version `0.4.9.0`, target ABI `12.2.0.0`, existing GUID unchanged. The public manifest and published assets remain unchanged. Production URL/browser/proxy verification is a post-deployment task requiring separate authorization; no production-specific compatibility claim is inferred from disposable results.
