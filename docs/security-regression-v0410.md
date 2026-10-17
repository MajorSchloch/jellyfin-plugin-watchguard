# v0.4.10 security regression evidence

Status: local focused qualification passed; final full release matrix pending. No publication or production deployment authorized by these results.

## Automated coverage

- 175 backend tests: existing state-machine, atomic replay/concurrency, session/account binding, permissions, changed interest/inventory, default settings and memory bounds retained. New origin policy tests cover direct schemes, HTTPS frontend/HTTP backend, exact host/port, spoofed Origin/Host/forwarded headers, missing metadata, cross-site/same-site, null/malformed/duplicate origins, credentials/path/query/fragment and base path independence.
- Non-mutating Readiness tests verify administrator identity and no library/playback calls, no readiness from missing Origin or inactive enforcement, cookie/query credential rejection, no-store responses.
- 86 existing JavaScript/bootstrap/approval tests, six infrastructure tests and four catalog tests retained.
- Native official enforcement `--proxy-matrix`: 77 existing/extended main cases plus proxy-specific transition/veto assertions. Real expiry, API keys, native permissions, revoked sessions, replay/concurrency, exact target/bulk binding, changed metadata/interest and native file/database survival remain asserted.
- Caddy without KnownProxies: actual Chromium warning/explicit approval flow, and desktop/mobile POST-readiness screenshots. Trusted-Caddy original HTTP/security checks remain.
- Nginx, Traefik and tunnel-style: protected no-approval requests vetoed; malicious/missing origin metadata rejected; Created/Presented/Approved preserve file and record; approved DELETE produces one native continuation and removes intended file/record; replay produces no extra continuation.
- Native Jellyfin HTTPS: trusted test certificate, strict same-origin without Fetch Metadata, protected veto preserves file/record, explicit approval removes target exactly once.

The retained local runs preceded final documentation/test-only edits; final unchanged-source qualification is recorded below after completion. Tests use disposable generated media, never production. Invalid or ambiguous native mutations are not retried. HTTP success alone is not counted as protection evidence.

## Review boundaries

This is implementation self-review and automated evidence, not an independent external security audit. ApprovalStore, Guard, Evaluator, InterestService, native permission paths and the Web approval adapter are unchanged. The behavioral change is the constrained request-origin policy; it requires security review before publication. Host validation does not identify arbitrary native clients with stolen administrator tokens. The tunnel-style result does not certify Cloudflare's actual edge service. Browser POST readiness cannot prove future target permissions, human consent or filesystem atomicity.
