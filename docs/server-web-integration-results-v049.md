# Stage B Web integration qualification

2026-10-16. **The isolated Web approval integration is feasible on the qualified Jellyfin 12.2 fixture.** It is ready for a separate production-readiness/security review, not release or deployment. No independent external security audit is claimed.

Read [implementation/installation/rollback](server-web-integration-v049.md), [Stage A threat model](server-approval-threat-model-v049.md) and [Stage A results](server-approval-results-v049.md). No production plugin source, loader, Web asset, configuration schema, workflow or manifest changed. No production ZIP was created.

## Evidence and test boundaries

Evidence lives under [`experiments/ServerApproval/evidence-stage-b`](../experiments/ServerApproval/evidence-stage-b). `direct/results.json` and `basepath/results.json` contain the full Stage A native run plus Stage B browser and lifecycle outcomes. Adjacent browser reports record request phases/status/timings and intended disposable item removal; guard logs contain aggregate outcomes only. Item IDs in browser reports identify generated test media, not production users/media; no challenges or credentials are retained.

Pinned official Jellyfin image and SHA-256-verified published v0.4.8 ZIP are unchanged from Stage A. Direct qualification also uses the same pinned Caddy image, exact trusted proxy address and HTTPS configuration. The browser accepts the disposable CA through its test context; the existing Python proxy checks separately validate the generated CA normally. No production Caddy configuration was accessed.

| Validation | Result |
| --- | --- |
| Approval state/security/attachment plus new Prepare/capability tests | 35 passed |
| Experimental Web unit tests plus unchanged Web/bootstrap suites | 82 passed (29 new, 53 existing) |
| Production backend/standalone tests | 105 passed |
| Catalog unit validation | 4 passed |
| Original veto-only unit suite | 8 passed |
| Native Stage A HTTP cases retained in each Stage B run | 72 passed direct; 72 passed base path |
| Main actual Web browser flow | 7 intended DELETEs in each mode; approved movie/episode/season/series, two queued single-item operations and one clear movie |
| Caddy browser approval | 1 intended DELETE, successful native removal |
| Disabled-guard fresh Web fallback | 1 intended DELETE in each mode, successful native removal |

The complete production release matrix (LinuxServer catalog upgrade, all legacy/discovery/verification benchmarks) was not rerun for this non-release companion. Existing suites and checksums were preserved. This evidence does not qualify arbitrary mobile/TV applications or every proxy topology.

## Observed behavior

- Native Jellyfin confirmation precedes the unchanged WatchGuard dialog. The added status line accurately distinguishes “Server approval required” from “Web-only warning.” Desktop and 390px mobile retain Cancel focus and the existing text-safe user/reason presentation.
- Cancel, Escape and explicit dialog close produce zero native DELETEs. The test checks both actual media paths and authenticated native library records after each veto. Mobile cancellation is also exercised.
- Explicit approval creates Prepare only after the button click, then Present/Approve and one request-local-header DELETE. Movie, series, season and episode paths remove the intended disposable item and native record. Child records removed by season deletion are also checked.
- Per-item queue testing calls the same native deleteItem operations used by multi-select; each gets a separate dialog/challenge and DELETE. It does not introduce a bulk request. The visual multi-select toolbar itself is unchanged and was not separately re-driven in this new browser fixture; native bulk enforcement remains covered by the retained Stage A tests.
- Browser route fault injection exercises 410 approval expiry and 503 capability unavailability. Both cause zero DELETE and preserve files/records. These are controlled browser transport faults, **not** claims of waiting for real expiry in the Web dialog. The retained Stage A native suite separately waits for the real 60-second expiry and verifies survival.
- Unit tests cover malformed capabilities/Prepare/Present/Approve, 401/403/409/410/429/503, changed reasons/scopes, expiry, account/token and navigation changes, concurrent duplicate calls, queue recovery, exact native receiver/arguments on the clear path and preservation of the original native rejection object. No automatic native retry occurs.
- Retained native tests cover real permission revocation, logout/disabled accounts, altered metadata/interest, API keys, replay, concurrent single/bulk redemption, native failure and restart invalidation. They also run the old v0.4.8 adapter first: its Cancel sends zero DELETE; its Delete Anyway sends one DELETE and receives the expected 409. Old clients never gain an insecure bypass.
- Caddy HTTPS same-origin approval passes only with native trusted-proxy forwarding. Strict Origin validation remains unchanged. gzip/zstd/identity HTML, HEAD/conditional/range semantics, private script no-store and authenticated WebSocket ping/pong remain passing with zero extra guard interest evaluations for unrelated traffic.
- Guard opt-out with the experimental Web asset still present reports Disabled and uses the existing fresh Protection warning on a newly loaded tab. An already-expecting tab cannot silently downgrade; that client invariant has unit coverage. Companion removal/restart restores v0.4.8 and invalidates approvals. Watchlists/preferences remain byte-identical.

## Screenshots

The direct evidence directory contains:

- `desktop-dialog.png`, `mobile-dialog.png`: unchanged protection UI plus precise enforcement label.
- `approved.png`, `mobile-approved.png`: native post-approval navigation after the single DELETE; actual removal is established by separate assertions, not the image alone.
- `ApprovalExpired.png`, `ApprovalExpired-mobile.png`: clear pre-delete failure feedback, with no approval button.
- `ServerGuardUnsupported.png`, `ServerGuardUnsupported-mobile.png`: unavailable-guard feedback.
- `proxy-approved.png`: native navigation after the Caddy-approved operation.

The desktop/mobile dialog captures were visually inspected for button placement, text wrapping and overlap. Error feedback deliberately preserves Jellyfin's generic error afterward rather than suppressing it or returning fake deletion success.

## Performance interpretation

Per-request timings and click-to-response/navigation samples are recorded in the browser JSON. Prepare/Present/Approve each perform fresh authoritative work; there is no protection cache. The total click-to-native-navigation sample includes browser scheduling, the protocol, target revalidation, native deletion and UI navigation, but excludes human reading time. Protection timings are recorded separately and include detail-page indicator reads as well as the deletion check; they must not be summed as one request timeline. Native controller-only duration is not isolated from network/guard overhead in this browser measurement; Stage A aggregate evaluation logs provide the narrower server-side evidence.

The disabled-guard fresh-tab sample is the current v0.4.8 Web-only decision path (plus capability discovery). Compare it to Stage B as a small disposable-fixture observation, not a statistically controlled production benchmark. Different titles, cold/warm effects and concurrent fixture execution affect latency. The separate phase data makes the extra security round trips explicit; no five-second production claim is inferred.

Final local observations ([structured summary](../experiments/ServerApproval/evidence-stage-b/performance.json)):

| Measurement | Direct | Base path |
| --- | ---: | ---: |
| Fresh Protection requests, median | 31.0 ms | 24.5 ms |
| Prepare, median | 44 ms | 30 ms |
| Present, median | 34 ms | 29 ms |
| Approve, median | 33.5 ms | 30 ms |
| Native DELETE response, median across clear/protected operations | 45 ms | 38 ms |
| Protected movie click through native navigation, one sample | 333 ms | 302 ms |
| Web-only movie click through native navigation, one sample | 138 ms | 151 ms |

Caddy protected movie click-to-navigation was 226 ms, with 46/31/31 ms Prepare/Present/Approve samples and 45 ms for the native DELETE response. These samples demonstrate the expected extra round trips, not a controlled speed comparison. The server's native continuation duration is included rather than independently instrumented; no invasive native-controller profiling was added.

## Review findings, changes from Stage A and remaining work

Stage B adds authenticated Capabilities and non-mutating Prepare, extends Present/Approve responses with action/scope/generation binding, and substitutes an explicitly opted-in Web adapter only in the disposable authenticated asset response. The existing Stage A state machine, TTL, atomic consumption, inventory conflict handling, API-key policy and fresh guard remain authoritative. Successful consumption requires no extra Revoke; abandoned/failed challenges use best-effort revocation under the captured identity.

The native API-client package was verified against the pinned Web lockfile. Its non-GET native transport does not reconnect/retry. Approved operations use that narrow transport because deleteItem has no request-local header argument. Clear/fallback operations preserve the original method and arguments. No generic fetch/XHR/Ajax patch, private Web module replacement or native source-file change was introduced.

During qualification the fixture was corrected to choose Jellyfin's visible responsive More button and await native post-delete navigation before opening the next detail page. A later screenshot rerun hit a host-port read reset after disposable Docker proxy-network detachment. A read-only readiness check was added after that teardown; DELETE is never retried. No deletion safety assertion or timeout was weakened. Native action completion and subsequent router navigation are distinct browser events.

Residual Stage A risks remain: no filesystem transaction, final-check TOCTOU window, no cross-instance approvals and no defense against a fully compromised administrator bearer identity. The dialog binds the displayed item and parent scope, while native inventory/version fingerprinting begins at Prepare and is rechecked server-side through redemption. Browser-visible metadata is not a filesystem hash. Native errors after a sent DELETE are treated as potentially ambiguous; the UI never promises files survived that case.

Capability discovery is not an atomic enforcement lease. If an administrator removes/disables the guard after the last check but before the native request arrives, native Jellyfin ignores the now-unknown approval header and its normal permissions apply. A retained guard rejects restart-invalidated approvals; a removed guard cannot enforce them. Production migration must drain pending operations and require client reloads, rather than promising protection across intentional guard removal.

Before production: independently review protocol/transport and activation policy, replace experimental response substitution with normal single-assembly embedded assets, decide stable capability/version negotiation, qualify production image/catalog migration and every supported Web shell, and run the full release matrix. Longer real-user dialogs, expired consent UX and quota exhaustion deserve usability testing. Native bulk Web approval is intentionally not added. Stage B does not authorize publishing or deployment.
