# Stage A approval protocol

Isolated experimental implementation in `experiments/ServerApproval`; not a production v0.4.9 release. The published v0.4.8 plugin and prior veto-only PoC are unchanged. Read [threat model](server-approval-threat-model-v049.md) and [qualification results](server-approval-results-v049.md). No Stage B Web changes are included.

## Installation boundary

Build `dotnet build experiments/ServerApproval -c Release`. The disposable fixture installs only the resulting `WatchGuard.ServerApproval.dll` beside the checksum-verified published v0.4.8 DLL in one plugin load context. Enable only with `WATCHGUARD_DISPOSABLE_SERVER_APPROVAL=1` in the disposable server process. Do not install both experimental assemblies: registration refuses the veto-only environment flag. There is no new BasePlugin identity, GUID change, production setting, release dependency or public manifest change.

Exact native controller/action/version matching and descriptor verification follow the qualified PoC and its [pinned source evidence](deletion-architecture-v049.md). Descriptor verification failure also disables the protocol, not just its success diagnostic. Only `LibraryController.DeleteItem(Guid itemId)` and `DeleteItems(Guid[] ids)` receive the filter. The native authentication pipeline and inline native permission checks remain. On startup mismatch the approval endpoints report `ServerGuardUnsupported`; unmatched native actions are **not** claimed protected. Inactive/missing assembly restores native behavior. Restart is necessary to change MVC registrations.

Run:

```sh
dotnet test experiments/ServerApproval.Tests -c Release
python3 experiments/ServerApproval/docker-test.py
python3 experiments/ServerApproval/docker-test.py --base-path /jellyfin
```

The fixture has no option for a remote Jellyfin server or existing media/config paths. It generates media, creates temporary configuration, verifies the published v0.4.8 ZIP SHA-256, pins the native image, and cleans up. Evidence is under `experiments/ServerApproval/evidence`. Existing veto-only fixture commands still use their original assembly and remain separate.

## Authentication and transport

Self-service by the deleting administrator only. Each step requires a current enabled native account, a native user token in `Authorization: MediaBrowser ... Token="..."`, and native item visibility/deletion permission. Query-token fallback, cookie-only credentials and API keys are rejected. Ordinary users with native delete permission may delete clear items but cannot receive an override-capable challenge or approve protected deletion.

[`IAuthorizationContext.GetAuthorizationInfo(HttpRequest)`](https://github.com/jellyfin/jellyfin/blob/ca0f16eb7c195f720a1493ed469a27c4657db0c6/Jellyfin.Server.Implementations/Security/AuthorizationContext.cs) re-resolves the native token rather than reusing the HttpContext-local cached authorization result. Native user permission is re-read. Binding is user ID plus a per-process HMAC of the native access token. Caller-provided DeviceId is not trusted as a session boundary. Same-token browser tabs are the same identity; different tokens for the same account are different identities. Never persist the token or challenge in browser localStorage.

For browser requests, Origin must match the request scheme/host and Fetch Metadata must be absent, `same-origin` or `none`. Approval POST requires JSON and has a 1 KiB body limit. Explicit bearer authentication is not an ambient browser credential; cross-origin sites without the token cannot authenticate. Origin rejection adds defense even if Jellyfin's CORS policy permits a preflight. Non-browser clients without Origin still need the token. The disposable Caddy fixture configures Jellyfin KnownProxies with only the exact proxy container address and restarts the server. With no trusted proxy, native Jellyfin ignores forwarded HTTPS and this protocol rejects the origin mismatch. Correct trusted proxy forwarding is required; never weaken the origin check to accommodate a production proxy without qualification.

### Transport comparison

| Transport | Decision |
| --- | --- |
| Scoped one-use header on original native DELETE | Chosen: same controller/model binding/authorization, no nested native invocation, no URL secret. Requires explicit client support. Header is only an identifier into the bound server state, not a force flag. |
| Operation ID in protected endpoint body | Used for Present/Approve/Revoke only. Avoids IDs in URL and supports JSON-only requests. It does not execute deletion. |
| Plugin endpoint performing deletion itself | Rejected for Stage A: duplicates native controller behavior, risks elevation/double deletion and changes native errors/bulk semantics. |
| Query `force`, reusable header secret, URL token | Rejected: unscoped/replayable bypass or URL/log exposure. |

Caddy/access logging must not record Authorization, `X-WatchGuard-Approval` or approval bodies. The implementation logs only aggregate outcomes/counts/timing. Arbitrary native clients will not understand the challenge; they remain blocked on protected media.

## State machine

| From | Operation | To | Conditions |
| --- | --- | --- | --- |
| none | Protected native DELETE without approval | Created | Fresh native permissions/interest, verified admin identity, quota available |
| Created / Presented | POST Present | Presented | Same identity, fresh target/scope/state fingerprint matches |
| Presented | POST Approve | Approved | `Decision: "Approve"`, same enabled administrator and fresh permissions/state |
| Approved | Original DELETE with header | Consumed | Same action/ordered target set/session, fresh permissions/interest/inventory; atomic consume and resource reservation |
| Created / Presented / Approved | Explicit Revoke, observed owned failure, changed state, overlapping successful reservation | Revoked | No native continuation |
| Created / Presented / Approved | Monotonic age reaches 60 seconds | Expired | Lazy check, no lifetime extension |
| Consumed / Revoked / Expired | Any redemption | unchanged | Rejected; no refund or reuse |

Calling Approve before Present is invalid. Presentation is an explicit protocol step, not evidence that a human actually read a screen. Approve is explicit API intent, not a cryptographic proof of user interaction. A malicious authenticated administrator can use the API directly, subject to all native permissions and fresh state checks.

Consumed/revoked tombstones remain bounded and are removed after original lifetime plus 60 seconds; then replay reports Invalid rather than Used/Expired. Both reject. Terminal state lookup is exposed only to the bound identity. No persistence, distributed store or acceptance across process restart.

## Routes and response contracts

1. Native `DELETE /Items/{id}` or `DELETE /Items?ids=...` performs full preflight. Protected administrator requests receive 409:

```json
{"Code":"ProtectionRequired","ChallengeId":"<64 hex characters>","ExpiresAt":"<UTC timestamp>"}
```

Ordinary-user protection errors have null challenge/expiry and no names, reasons or playback details. API keys are rejected even for clear media in this initial experimental policy.

2. `POST /WatchGuard/ExperimentalApproval/Present`, JSON `{"ChallengeId":"..."}`. Only the bound administrator can retrieve current target IDs and fresh Protection responses, including administrator-authorized names/reasons. No playback detail is stored in the challenge.
3. `POST /WatchGuard/ExperimentalApproval/Approve`, JSON `{"ChallengeId":"...","Decision":"Approve"}`. Rechecks and transitions to Approved; does not delete anything or extend expiry.
4. Repeat the **same native DELETE operation**, sending `X-WatchGuard-Approval: <ChallengeId>`. No approval ID in URL or body of the native DELETE. Supplied headers are always validated, even if the title is now unprotected.
5. `POST /WatchGuard/ExperimentalApproval/Revoke`, JSON `{"ChallengeId":"..."}`. Cancels an outstanding own challenge. Client navigation/cancellation must never send a redeeming DELETE.

Guard/protocol errors and protocol responses are `Cache-Control: no-store`. Native framework auth/model-validation errors retain native contracts. Unprotected native success and native action exceptions are preserved.

| Code | Status | Meaning |
| --- | --- | --- |
| ProtectionRequired | 409 | Fresh interest prevents continuation; only eligible admin gets a challenge |
| ApprovalExpired | 410 | Live record exceeded its monotonic TTL |
| ApprovalAlreadyUsed | 409 | Bound record was consumed; never retry it |
| ApprovalRevoked | 409 | Cancelled/invalidated record or conflicting in-flight operation |
| ApprovalStateChanged | 409 | Fresh fingerprint differs; record is revoked |
| ApprovalInvalid | 400/403/409 | Malformed operation, credential/origin boundary, unknown/wrong-owner ID, wrong step/action/order/target set |
| NativePermissionDenied | 401/403 | Missing/disabled human identity, API key, lost administrator/native deletion permission |
| TargetUnavailable | 404/409 | Missing/invisible/unsupported target or invalid parent scope |
| ProtectionUnavailable | 503 | Lookup failure or insufficient/bounded mutation inventory; never zero interest |
| ServerGuardUnsupported | 503 | Experimental registration/version not qualified/active |
| GuardBusy / ApprovalCapacityExceeded | 429 | Bounded concurrency/rate/storage admission rejected work |

## Binding and fresh checks

The server fingerprint contains generation, exact action, canonical GUIDs **in original bound order**, target/scope metadata, native ancestry, paths, dates, virtual/premiere/status data, known descendant inventory and linked/local version relationships, configured CaughtUp protection, and sorted user-ID/reason sets from fresh InterestService. User display names and changing playback positions/dates that retain the same actionable reason are not material authorization changes. No client-supplied state is trusted.

Bulk order matters because native partial-failure behavior is order-sensitive. One-item bulk is different from the single-item action. Duplicates, empty IDs/sets, more than 100 targets and parent/child overlap are rejected. Every target's visibility and CanDelete is checked before interest disclosure; all scopes are checked before continuation. Parent-series inheritance is unchanged.

To bind deletion inventory safely, Stage A compares bounded native global and user-visible descendant ID sets and fails closed if they differ. It does not expose inaccessible IDs or substitute custom access policy. Inventory includes seasons, not only episodes. Bounds are 1,000 descendants per scope, 4,000 unique metadata records and version links per request, 1,000 links per video, and eight version-expansion rounds. Alternate-version candidate IDs use native batch discovery. This is more conservative than the production per-title API; hitting a bound denies this experimental operation rather than truncating approval scope.

Before native continuation: re-resolve identity, repeat native target permissions, atomically consume the matching approval, reserve overlapping native inventory, check request cancellation and call `next()` exactly once. The native controller rechecks its own permissions. No direct LibraryManager deletion occurs in the plugin. A native failure/timeout does not restore approval. Resource reservations are released in `finally`; other outstanding approvals sharing inventory are revoked when a reservation succeeds. This applies to clear operations too, preventing pending challenges from surviving an overlapping mutation.

## Bounds and residual races

Default store: 256 total records including terminal tombstones, 32 per user, 60-second monotonic TTL, lazy scans bounded by 256. IDs use 32 cryptographically random bytes. Metadata/reasons are not stored; only operation IDs, resource IDs, keyed session digest, fingerprint and state. Memory depends on bounded inventory, measured separately. Admission permits four concurrent operations and 120 protocol/guard operations per user per minute, with at most 256 active rate buckets. Excess work returns 429, never queues without bound. Native synchronous calls may finish after cancellation; checks between calls and before native continuation prevent approval on observed cancellation, but cannot preempt native database work internally.

No exactly-once filesystem guarantee across crashes. No transaction covers interest, library metadata and filesystem mutation. In-place external replacement not yet reflected by Jellyfin, unindexed files and changes in the final recheck-to-delete interval remain residual risks. Approval fingerprints represent native-known state, not filesystem content hashes. A timeout after consumption is ambiguous; clients must query current state rather than automatically retrying deletion. Internal deletion services and external tools are outside these two HTTP actions.

## Stage B proposal and rollback

After separate review: integrate a challenge/presentation/approval/redemption flow into the existing narrow Web adapter, keep Cancel initially focused, display fresh target-specific server details, and retain the native confirmation. Do not approve automatically merely because a 409 was returned. Keep identifiers in closure-local memory only, bind them to captured account/client/target, discard on identity/navigation changes and revoke best-effort. Never retry a consumed or ambiguous request. Decide how native bulk selection maps to per-item versus native bulk challenges before shipping.

Stage B must also qualify production opt-in/migration, co-location removal, server version failure behavior, privacy, Caddy origin forwarding and old tabs. Existing v0.4.8 clients deliberately fail protected Delete Anyway in Stage A; no insecure compatibility bypass is included. Removing the companion DLL and restarting returns to unchanged v0.4.8 Web-only protection, preserves JSON/XML and invalidates all approvals. Disabling the entire plugin folder disables both components after restart; neither filter is dynamically detached from an already-running MVC pipeline. No public catalog or production deployment changes are needed for this research.
