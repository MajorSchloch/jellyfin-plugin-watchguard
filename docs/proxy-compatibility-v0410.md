# v0.4.10 proxy compatibility

**Published v0.4.10 compatibility:** see the [security policy](deployment-agnostic-security-v0410.md) before interpreting these results. This is not a certification of Jellyfin's native client-IP or remote-access configuration. [Final qualification](validation.md) included the optional proxy matrix.

**Two independent requirements:** WatchGuard can authenticate an approval through some HTTPS reverse proxies even with Jellyfin `KnownProxies` unset. That is **only approval-protocol compatibility**, not proof that Jellyfin recognizes the actual client IP. Jellyfin's [reverse-proxy documentation](https://jellyfin.org/docs/general/post-install/networking/reverse-proxy/) requires trusted proxies to be configured so its own local/remote access restrictions, IP filtering and related network policy use validated forwarded client addresses. **For an internet-facing Jellyfin reverse proxy, configure Jellyfin's native Known Proxies even if WatchGuard reports approval readiness.** Direct Jellyfin connections need no proxy entry. WatchGuard does not add its own proxy IP configuration.

| Deployment | Policy / qualification |
|---|---|
| Direct HTTP | Exact Origin authority/scheme; missing Fetch Metadata supported with explicit native token. Native disposable enforcement tested. |
| Direct HTTPS | Jellyfin's own TLS listener and trusted disposable certificate tested; no Fetch Metadata required for exact Origin. |
| Caddy, KnownProxies empty | WatchGuard approval compatibility passed, but native Jellyfin client-IP forwarding is **not trusted**. Do **not** interpret successful approval as native remote-access policy verification. |
| Caddy, native KnownProxies | Original strict forwarded-scheme fixture retained; native approval/delete, gzip/zstd and WebSocket checks retained. |
| Nginx | Approval/veto compatibility passed without KnownProxies when the public Host is preserved; configure Jellyfin's native proxy trust independently for correct client-IP classification. |
| Traefik | Approval/veto compatibility passed using `passHostHeader: true`; native Jellyfin proxy trust remains separately required. No Docker socket mounted. |
| Tunnel-style intermediary | Actual Nginx second hop preserves Host while adding misleading X-Forwarded-Host/Proto. WatchGuard ignores raw forwarded headers; native Jellyfin client-IP forwarding still requires its own trust configuration. This does not certify Cloudflare. |
| Base path | Existing official `/jellyfin` suite retained. Origin has no path; existing native model binding and asset/approval paths remain unchanged. |
| Rewritten Host or stripped metadata | Scheme exception unavailable. Preserve public Host/browser headers, or configure Jellyfin native trusted forwarding for controlled proxy addresses. Diagnostic must not claim ready. |

WatchGuard's non-mutating POST Readiness verifies the current browser's approval authentication/origin only. `HttpsProxySameOrigin` specifically means the constrained HTTPS-frontend/HTTP-backend exception was used; it **does not** mean Jellyfin trusts any proxy. The settings page presents native client-IP and remote-access handling as **not verified**, even when approval is ready.

The optional `--proxy-matrix` fixture additionally exercises **Jellyfin-native** remote-access policy with a disposable local-only account and a synthetic RFC 5737 remote client IP. It verifies visibility and token authorization before native KnownProxies is configured, after trusting only the disposable Caddy IP, and after untrusted direct spoofed forwarding headers. This detects the real policy distinction without using WatchGuard approval to infer network trust. The new checks must pass hosted qualification before the follow-up is release-ready.

There is no WatchGuard proxy IP setting. Host preservation is ordinary proxy routing, not a WatchGuard-specific identity secret. Do not manufacture `Sec-Fetch-Site: same-origin` in a proxy: preserve the browser's value and reject malicious/cross-origin values naturally. If intermediaries remove it, use native trusted forwarding instead. Do not trust arbitrary X-Forwarded-* or clear ASP.NET trust lists to accept every caller.

[Nginx proxy_set_header](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_set_header) documents Host forwarding; use `$http_host` when the external port matters. [Traefik services](https://doc.traefik.io/traefik/reference/routing-configuration/http/load-balancing/service/) expose passHostHeader. [Cloudflare configuration](https://developers.cloudflare.com/tunnel/configuration/) supports httpHostHeader overrides; an override to an internal host may prevent automatic compatibility. A real Cloudflare account/tunnel was not used and is not certified by this fixture.

## Reproduction

Use the pinned tools described in `testing/fixture-lifecycle.md`, then build the candidate with `python3 scripts/build-release.py` and run `python3 tests/server-enforcement.py --proxy-matrix`. The optional matrix adds real Nginx/Traefik/tunnel-style/native-TLS checks to the normal official enforcement fixture. It only accepts generated temporary media and loopback services. Regular enforcement profiles always test Caddy with and without native KnownProxies. The full release workflow's `proxy_matrix=true`, `publish=false` inputs run this additional qualification in the official enforcement job; unrelated jobs do not need all proxy services.

Images are digest-pinned in `tests/proxy_compatibility.py` and `tests/standalone-caddy.py`. All fixture network addresses are discovered dynamically; only the separate native trusted-Caddy case records its own ephemeral address in its disposable Jellyfin configuration.

## Upgrade / rollback

Default enforcement remains OFF. Existing enabled installations retain the setting and current data formats. Restart after installation and reload Web clients. Use the native settings page's approval POST readiness check before relying on browser approvals; no media creation/deletion is needed. Readiness does not grant permission or approve a target.

Rollback to the checksum-verified published v0.4.9 package preserves memberships/preferences/XML. Restart destroys pending in-memory approvals. v0.4.9 again requires native trusted scheme forwarding behind HTTPS-to-HTTP proxies; do not remove an existing valid KnownProxies configuration as part of this upgrade. The public manifest now lists v0.4.10. Existing published version entries and historical ZIPs remain immutable.
