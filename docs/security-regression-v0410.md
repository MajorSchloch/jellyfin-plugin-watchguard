# v0.4.10 security regression evidence

Status: **full hosted release qualification PASS** on commit `6582dd7933200eb3233ae63531f52589feb6ef96`. [Run 39035305677](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/39035305677) used `publish=false`, `proxy_matrix=true`; all eleven required jobs passed and publication was skipped. No publication or production deployment is authorized by these results.

## Follow-up: native Jellyfin network-policy qualification (pending)

The previous hosted qualification below establishes **WatchGuard approval compatibility and deletion-security behavior**, not the correctness of Jellyfin's own client-IP forwarding and remote-access restrictions. The follow-up branch `docs/v0410-native-proxy-boundary` adds a separate native-policy regression and dashboard disclosure. **Those new assertions are not covered by the historical run listed below.** They require a fresh hosted `publish=false`, `proxy_matrix=true` run on the final branch/merged source before release approval.

The disposable native-policy check creates an ordinary local-only account with `EnableRemoteAccess=false` and injects a synthetic RFC 5737 remote client address from the owned Caddy proxy. With KnownProxies empty, Jellyfin sees the proxy as a local caller; after trusting exactly Caddy's container IP, Jellyfin must hide the local-only account in `GET /Users/Public` and deny `GET /Users/Me` for that account. A direct request with forged forwarding headers must remain untrusted. These tests use Jellyfin's own endpoints, independent of WatchGuard challenge/approval evaluation, and do not read or change production settings.

## Automated coverage

- 175 backend tests: existing state-machine, atomic replay/concurrency, session/account binding, permissions, changed interest/inventory, default settings and memory bounds retained. New origin policy tests cover direct schemes, HTTPS frontend/HTTP backend, exact host/port, spoofed Origin/Host/forwarded headers, missing metadata, cross-site/same-site, null/malformed/duplicate origins, credentials/path/query/fragment and base path independence.
- Non-mutating Readiness tests verify administrator identity and no library/playback calls, no readiness from missing Origin or inactive enforcement, cookie/query credential rejection, no-store responses.
- 86 existing JavaScript/bootstrap/approval tests, six infrastructure tests and four catalog tests retained.
- Native official enforcement `--proxy-matrix`: 77 existing/extended main cases plus proxy-specific transition/veto assertions. Real expiry, API keys, native permissions, revoked sessions, replay/concurrency, exact target/bulk binding, changed metadata/interest and native file/database survival remain asserted.
- Caddy without KnownProxies: actual Chromium warning/explicit approval flow, and desktop/mobile POST-readiness screenshots. Trusted-Caddy original HTTP/security checks remain.
- Nginx, Traefik and tunnel-style: protected no-approval requests vetoed; malicious/missing origin metadata rejected; Created/Presented/Approved preserve file and record; approved DELETE produces one native continuation and removes intended file/record; replay produces no extra continuation.
- Native Jellyfin HTTPS: trusted test certificate, strict same-origin without Fetch Metadata, protected veto preserves file/record, explicit approval removes target exactly once.

Local focused runs preceded the final source commit. The hosted qualification above tested the exact committed candidate; the evidence follow-up changes documentation/screenshots only. Tests use disposable generated media, never production. Invalid or ambiguous native mutations are not retried. HTTP success alone is not counted as protection evidence.

## Review boundaries

This is implementation self-review and automated evidence, not an independent external security audit. ApprovalStore, Guard, Evaluator, InterestService, native permission paths and the Web approval adapter are unchanged. The behavioral change is the constrained request-origin policy; it requires security review before publication. Host validation does not identify arbitrary native clients with stolen administrator tokens. The tunnel-style result does not certify Cloudflare's actual edge service. Browser POST readiness cannot prove future target permissions, human consent or filesystem atomicity.


## Hosted evidence

| Job | Result | Seconds |
|---|---|---:|
| build | success | 55 |
| Integration / verification | success | 818 |
| Integration / migration | success | 311 |
| Integration / legacy | success | 351 |
| Integration / basepath | success | 262 |
| Integration / server-enforcement-linuxserver | success | 304 |
| Integration / server-enforcement | success | 314 |
| Integration / discovery | success | 288 |
| Integration / standalone-caddy | success | 502 |
| Integration / websocket | success | 117 |
| Integration / server-enforcement-basepath | success | 259 |
| publish | skipped | 0 |

Structured results: [qualification](evidence/v0.4.10/qualification.json), [proxy transitions and preservation](evidence/v0.4.10/proxy-compatibility.json). The workflow artifacts retain full existing fixture and performance reports. Official direct, LinuxServer direct and official base-path enforcement each passed 77 main cases; the optional proxy/native-TLS assertions are additional, not counted as those 77.

Diagnostics screenshots: [desktop](screenshots/v0.4.10/proxy-readiness-desktop.png), [mobile](screenshots/v0.4.10/proxy-readiness-mobile.png). Both show actual browser POST readiness through Caddy with empty KnownProxies; server attachment and GET-only environment information are separate.

Catalog qualification includes published v0.4.9 (SHA-256 `5cc5cd51e1a9f666a4abdbda07b1ad08b8d8ab9480edbad0dbd23fc53440be6d`) in the preserved-store version round trip. The historical v0.4.8 and older fixtures remain checksum-verified. Public manifest entries were not altered.

Reproducible candidate ZIP SHA-256: `6690af55245a051947e074634235c4a593bc6d3561bfd13198785d9a10853eeb`. Hosted and local ZIP bytes match, and the hosted clean rebuild matched its first checksum. The ZIP is a review artifact, not a published release. Security-design review remains required before publication.
