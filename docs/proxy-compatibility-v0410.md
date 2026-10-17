# v0.4.10 proxy compatibility

This is an isolated candidate, not a published release. See the [security policy](deployment-agnostic-security-v0410.md) before interpreting compatibility results.

| Deployment | Policy / qualification |
|---|---|
| Direct HTTP | Exact Origin authority/scheme; missing Fetch Metadata supported with explicit native token. Native disposable enforcement tested. |
| Direct HTTPS | Jellyfin's own TLS listener and trusted disposable certificate tested; no Fetch Metadata required for exact Origin. |
| Caddy, KnownProxies empty | Real Chromium dashboard readiness and protected approval/delete tested across public HTTPS to native HTTP. Public Host/port preserved; browser same-origin metadata required. |
| Caddy, native KnownProxies | Original strict forwarded-scheme fixture retained; native approval/delete, gzip/zstd and WebSocket checks retained. |
| Nginx | Actual digest-pinned Nginx behind test-CA HTTPS terminator, preserving `$http_host`; native protocol and veto/mutation invariants tested without KnownProxies. |
| Traefik | Actual digest-pinned Traefik file-provider service with `passHostHeader: true`, behind test-CA HTTPS terminator; same protocol checks. No Docker socket mounted. |
| Tunnel-style intermediary | Actual Nginx second hop preserves Host while adding misleading X-Forwarded-Host/Proto. With no KnownProxies, those values do not affect WatchGuard. This models forwarding semantics, not Cloudflare's external service. |
| Base path | Existing official `/jellyfin` suite retained. Origin has no path; existing native model binding and asset/approval paths remain unchanged. |
| Rewritten Host or stripped metadata | Scheme exception unavailable. Preserve public Host/browser headers, or configure Jellyfin native trusted forwarding for controlled proxy addresses. Diagnostic must not claim ready. |

There is no WatchGuard proxy IP setting. Host preservation is ordinary proxy routing, not a WatchGuard-specific identity secret. Do not manufacture `Sec-Fetch-Site: same-origin` in a proxy: preserve the browser's value and reject malicious/cross-origin values naturally. If intermediaries remove it, use native trusted forwarding instead. Do not trust arbitrary X-Forwarded-* or clear ASP.NET trust lists to accept every caller.

[Nginx proxy_set_header](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_set_header) documents Host forwarding; use `$http_host` when the external port matters. [Traefik services](https://doc.traefik.io/traefik/reference/routing-configuration/http/load-balancing/service/) expose passHostHeader. [Cloudflare configuration](https://developers.cloudflare.com/tunnel/configuration/) supports httpHostHeader overrides; an override to an internal host may prevent automatic compatibility. A real Cloudflare account/tunnel was not used and is not certified by this fixture.

## Reproduction

Use the pinned tools described in `testing/fixture-lifecycle.md`, then build the candidate with `python3 scripts/build-release.py` and run `python3 tests/server-enforcement.py --proxy-matrix`. The optional matrix adds real Nginx/Traefik/tunnel-style/native-TLS checks to the normal official enforcement fixture. It only accepts generated temporary media and loopback services. Regular enforcement profiles always test Caddy with and without native KnownProxies. The full release workflow's `proxy_matrix=true`, `publish=false` inputs run this additional qualification in the official enforcement job; unrelated jobs do not need all proxy services.

Images are digest-pinned in `tests/proxy_compatibility.py` and `tests/standalone-caddy.py`. All fixture network addresses are discovered dynamically; only the separate native trusted-Caddy case records its own ephemeral address in its disposable Jellyfin configuration.

## Upgrade / rollback

Default enforcement remains OFF. Existing enabled installations retain the setting and current data formats. Restart after installation and reload Web clients. Use the native settings page's approval POST readiness check before relying on browser approvals; no media creation/deletion is needed. Readiness does not grant permission or approve a target.

Rollback to the checksum-verified published v0.4.9 package preserves memberships/preferences/XML. Restart destroys pending in-memory approvals. v0.4.9 again requires native trusted scheme forwarding behind HTTPS-to-HTTP proxies; do not remove an existing valid KnownProxies configuration as part of this upgrade. The public manifest and published ZIPs remain unchanged.
