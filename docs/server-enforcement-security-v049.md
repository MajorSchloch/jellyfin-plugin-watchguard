# v0.4.9 production-integration security review

The [Stage A threat model](server-approval-threat-model-v049.md) and [protocol](server-approval-protocol-v049.md) remain applicable. Stage C changes packaging, activation, route prefix and diagnostics; it does not simplify approval into a bypass flag.

## Preserved boundaries

Native authentication, fresh enabled-account/session binding, native visible-item resolution and CanDelete preflight precede disclosure. Only the same authenticated administrator can present, approve and redeem. API keys and query-string credentials cannot override. Explicit token headers, strict Origin and Fetch-Site validation remain. The native action retains its own checks and original result/exception.

Approval IDs contain 32 cryptographically random bytes. The store binds user, token HMAC, process generation, exact action and ordered target set, parent scopes and authoritative interest/inventory fingerprint. Created is not consent. Presented precedes Approved; atomic Consumed permits at most one native continuation. No refund follows a native exception or disconnected client. Overlapping inventory reservations revoke competing pending approvals. Bulk preflight rejects duplicate, overlapping, missing, unauthorized or unsupported targets before any native mutation.

Fresh permission, metadata and interest rechecks occur at preparation, presentation, approval and redemption. No overview or cross-request protection cache participates. Completed ended-series history remains unprotected; existing configured CaughtUp semantics are unchanged.

## Work and memory bounds

The existing limits remain: 256 retained challenges globally, 32 per account, 60-second monotonic validity; tombstones expire after another 60 seconds. Cleanup scans at most the bounded store. Four concurrent evaluations and 120 admissions/account/minute; at most 256 rate buckets. Operations contain at most 100 targets, at most 1,000 descendants per scope, 4,000 inventory entries and eight linked-version levels. Synchronous native calls cannot be forcibly preempted; admission bounds concurrency rather than imposing a database deadline.

A serial isolated managed-heap sample of 256 records, each with 100 targets and 4,000 resource IDs, measured **35,806,416 bytes** (about 34.1 MiB). This is a GC heap delta, not process RSS or a production load benchmark. The sample must not run concurrently with allocation-heavy benchmarks. The 40 MiB test ceiling was retained. Each evaluation invokes the existing fresh InterestService once per distinct protection scope (at most 100); its cost still scales with enabled native accounts and visible episodes. Inventory bounds do not turn this into the bounded activity overview, and no overview result authorizes deletion. Exact inventories are retained for overlap/replay correctness; replacing them with only a digest would lose resource conflict detection. Tickets copy bounded arrays; transient evaluation and serialization allocations are additional. Capacity exhaustion rejects with 429; no empty-result or unrestricted fallback is introduced.

## Reverse proxy

Use Jellyfin's native trusted-proxy configuration with the actual Caddy address/subnet under administrator control. A Docker service name is not evidence of a trusted proxy IP. Forwarded host/scheme values from untrusted callers are not accepted by WatchGuard. The disposable Caddy fixture records its exact IP in KnownProxies and restarts Jellyfin before HTTPS approvals. Keep Authorization and X-WatchGuard-Approval out of access logs. Do not weaken Origin checks to fix a proxy mismatch.

## Residual risks

This is qualified use of ASP.NET Core MVC extension infrastructure, not an upstream Jellyfin cancellable deletion contract. Exact version/action checks intentionally limit compatibility; they do not prove a custom server binary bearing the same version is identical to the pinned images. Such builds require requalification. Unsupported attachment cannot enforce direct API requests; never advertise protection in that state.

Native state and filesystem mutation are not one transaction. Rechecks narrow but cannot eliminate TOCTOU, same-path external replacement invisible to native metadata, or crashes during filesystem deletion. One continuation is not exactly-once filesystem completion. A stolen administrator session has administrator authority; authenticated Approve represents consent but does not cryptographically prove a human click. Same-token tabs share an identity. No distributed/multi-instance approval coordination exists.

Intentional guard removal/restart is an operational boundary, not a capability lease. Drain pending actions, restart and reload clients. Browser timeout after DELETE is ambiguous: inspect the library; never automatically retry. No private histories, tokens, target names or approval identifiers belong in routine diagnostics.

## Release gate

The complete local default/enforced, catalog, migration, rollback, Caddy, base-path and performance matrix passed for the final candidate. See [qualification and evidence](server-enforcement-v049.md). This qualifies the pinned images for separate release approval; it does not establish compatibility with production-specific proxy policies or custom server builds. Evidence is separate from historical Stage A/B results; passing attachment alone is insufficient.

This is an implementation review and automated qualification, not an independent external security audit. Native authentication middleware may reject a request before the protocol controller runs; those responses contain no approval or viewing data. Authenticated malformed model responses are explicitly tested for no-store headers.
