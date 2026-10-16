# Stage A server approval threat model

Design recorded before implementation, 2026-10-16. Stage A is an isolated, opt-in companion assembly, not a release or an independent security audit. The qualified veto-only PoC and production WatchGuard remain unchanged. This document describes intended controls; qualification results distinguish tested evidence from residual risk.

## Assets, identities and trust boundaries

Assets: source media and native library records, native deletion/visibility permissions, private cross-user interest, watchlists/preferences, and the integrity of a single native controller invocation. Trust the pinned Jellyfin authentication and library services, WatchGuard InterestService, server process/administrators and TLS termination. Do not trust request IDs, headers, body, client-reported state, overview data, browser tabs or network retries.

Identities: authenticated enabled human administrators, ordinary users with/without native deletion permission, API keys, revoked tokens, disabled/deleted accounts and anonymous clients. Approval is **self-service only**: no administrator-on-behalf-of-user delegation. API keys cannot create/approve/redeem and retain the PoC's restrictive deletion policy. Ordinary users can delete clear targets under native permission, but receive only generic protection-required errors for protected targets.

Native identity evidence: pinned `Jellyfin.Server.Implementations/Security/AuthorizationContext.cs` resolves the access token through the native device manager and user manager (or marks an API key separately). Its HttpContext overload caches within one request; its HttpRequest overload resolves again. Stage A uses the latter for identity rechecks. `CustomAuthenticationHandler` gives API-key callers an administrator role, so role claims alone are insufficient. Native User.HasPermission and IsApiKey checks are required. Source pin: `ca0f16eb7c195f720a1493ed469a27c4657db0c6`.

Binding uses user ID plus a per-process keyed digest of the native access token, not a caller's DeviceId. Tabs sharing the same token are the same principal/session for this protocol. A different device/token for the same user cannot redeem it. Raw access tokens are never stored in challenges or logs. Native token expiry/revocation remains authoritative; a fresh native lookup occurs on every protocol step and again immediately before continuation.

## Threats and controls

| Threat | Intended control | Residual boundary |
| --- | --- | --- |
| Stolen/guessed challenge ID | 256-bit random ID, same enabled admin + token binding, short TTL, server generation, one-use consume | An attacker with both the admin bearer token and challenge has that admin's authority; no defense against fully compromised clients/server |
| Ordinary user or API-key override | Native auth/visibility/CanDelete preflight; separate enabled-admin check; API-key rejection; no delegated approval | Generic protected status is available only after native permission; no names/history for ordinary users |
| Cross-user/device/account switching | Exact user/token digest match before returning state or details | Same-token tabs cannot be distinguished; first valid redemption wins |
| CSRF/cross-origin browser request | Explicit MediaBrowser Authorization header token only; reject URL credentials, cookie-only auth, cross-origin Origin and cross-site/same-site Fetch Metadata; JSON-only approval POST | No XSS defense; malicious clients can omit Origin but must possess the bearer token. Trusted reverse-proxy forwarded-host configuration is required |
| Replay/concurrent redemption/retry | Atomic terminal consumption before native delegate; no refund on failure; reject used IDs even if current interest becomes empty | At most one invocation, not exactly-once filesystem completion. Timeout must not trigger automatic retry |
| Two challenges / overlapping bulk operations | Bounded in-flight scope lease; consumption revokes other outstanding challenges sharing resolved native inventory | Conservative serialization may reject independent episodes of one series; must obtain new approval |
| Altered operation/IDs/order/parent/version | Bind native action identity and ordered duplicate-free target set; fresh native metadata/scope inventory fingerprint and current protection fingerprint | Changes unobserved by Jellyfin (same-path external replacement without metadata refresh), unindexed files and final check-to-delete races cannot be eliminated |
| Changed interest/configuration | Fresh InterestService at creation, presentation, approval and redemption; compare server fingerprints; revoke on mismatch | Progress/date movement retaining the same actionable reasons is not itself a new reason; no atomic playback/filesystem transaction |
| Changed permissions/disabled account/revoked token | Reauthenticate and repeat native permissions; observed failed own redemption revokes its challenge where identity is still verifiable | Framework rejection can happen before the filter; unseen disable/re-enable transitions are not an event history |
| Lookup errors/incomplete coverage | Fail closed; no overview authorization or cached decision | Work limits can deny legitimate deletion; no fallback bypass |
| Resource exhaustion | Bounded challenges/tombstones, short monotonic expiry, bounded cleanup scans, per-user request rate and global concurrent-work admission, bounded targets/inventory | Native auth and a single synchronous InterestService call still cost work; authenticated clients can cause bounded denial of service |
| Restart/uninstall/multiple instances | Memory-only store, random generation, no cross-instance acceptance; restart invalidates IDs | Removal disables experimental enforcement. Sticky routing is insufficient to make a distributed approval store; multi-instance deployment unsupported |
| Caddy/base-path | Action identity, not raw URL; tokens/approval headers forwarded without query encoding; same-origin browser checks | Misconfigured proxies/CORS/logging may expose headers. Do not log Authorization or approval headers; no production Caddy changes |

## Security invariants

- Native action invoked zero times on every WatchGuard veto; at most once per consumed approval.
- Native authentication/visibility/CanDelete are necessary, including for administrators; no privileged service deletion shortcut.
- All bulk targets preflight before any mutation. Native partial failure after continuation remains possible.
- A header value is not a force flag: it must identify a live approved record bound to this exact operation and principal, and pass fresh checks.
- No approval persistence in existing JSON, no production loader/adapter changes, no cross-request protection cache.
- Guard scope is only the two qualified native HTTP item actions. Internal cleanup, filesystem changes, Sonarr/Radarr/Tdarr and other routes remain out of scope.
- Startup mismatch is conspicuous and approval endpoints report unsupported; an incompatible server is not claimed guarded.

## Review gates

Before concluding Stage A: test ownership, state transitions, expiry, quotas, cancellation, concurrent consumption, stale metadata/interest, native privilege revocation, direct/base-path media survival and exact delegate counts. Review negative paths independently of successful approvals. Retain logs with aggregate codes/timings only. Record untested risks rather than claiming production readiness. Stage B requires separate review of Web handling, confirmation content, header transport, installation/migration and rollback.
