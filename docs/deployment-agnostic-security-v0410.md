# v0.4.10 request-security design

**Release status:** [v0.4.10 was published on 2026-10-18](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/releases/tag/v0.4.10) after [final full qualification](validation.md). This document originated as a pre-release security review against v0.4.9; its threat model, mechanism and residual risks remain relevant. Approval state, native permissions, replay/expiry, target and inventory binding, and fresh protection evaluation were unchanged in this release.

## Why KnownProxies was required

At pinned Jellyfin server `ca0f16eb7c195f720a1493ed469a27c4657db0c6`, `Jellyfin.Server/Extensions/ApiServiceCollectionExtensions.cs:ConfigureForwardHeaders` configures `ForwardedHeaders.None` when KnownProxies is empty. With configured proxies it enables native forwarded host/proto/for processing. `Startup.cs` runs `UseForwardedHeaders` before CORS/authentication. The old WatchGuard Identity compares Origin to Request.Scheme + Host, so a public HTTPS Origin fails against the backend HTTP scheme even when Host is preserved. This is not a failure of native authentication.

Native `AuthorizationContext.GetAuthorizationInfo(HttpRequest)` re-resolves the token. WatchGuard still requires exactly one explicit MediaBrowser Authorization header matching that native token; URL tokens, ambient cookies and API keys cannot approve. A caller-supplied DeviceId is not a session boundary. Existing per-process token HMAC and account binding remain unchanged.

## Chosen policy

1. Authenticate the native enabled account and exact explicit session header first. Require administrator authority where the existing protocol requires it.
2. Reject duplicate, malformed or opaque Origin; require HTTP/HTTPS, no credentials/path/query/fragment. Compare canonical host and port with framework Request.Host. Base paths are not part of an origin.
3. Reject Fetch-Site other than absent, same-origin or none, including same-site and cross-site.
4. Exact scheme/authority is accepted as before, including browsers lacking Fetch Metadata.
5. The sole scheme exception is **HTTPS Origin, HTTP backend, matching authority, exactly `Sec-Fetch-Site: same-origin`**. No fallback for missing/none Fetch Metadata, reverse downgrade, host rewrite or different port.
6. Missing Origin retains the existing explicit-token native-client contract. It is not reported as browser readiness. A cross-site Fetch-Site is rejected even without Origin.
7. Never read raw Forwarded/X-Forwarded-* headers. Native middleware may set Scheme/Host only through its administrator-configured trust policy.

The exception is not a declaration that HTTP and HTTPS are the same origin. The browser attests that its actual destination is same-origin; only the backend transport differs. Browser JavaScript cannot set Host, Origin or Sec-Fetch-* arbitrarily. An HTTP attacker page calling the HTTPS endpoint is same-site or cross-site, not same-origin. A malicious native client can forge all these headers, but must already possess the enabled administrator's bound native session token and pass every operation check. This is also true of the prior strict Origin check. A stolen admin token or XSS on the trusted frontend remains a residual risk.

Host is a destination comparison, **not an authenticated server identity or arbitrary hostname allowlist**. A browser cannot spoof it independently of the destination. A native caller supplying matching forged Host/Origin and a stolen token cannot be distinguished by Origin validation. Deployments must control DNS/TLS and proxy host routing; this plugin does not authenticate the proxy or defend a hostile proxy that rewrites security headers. Never expose a backend to an untrusted intermediary that can inject arbitrary browser evidence.

## Separate native Jellyfin networking security boundary

The approval policy is deployment-portable, but **the hosting server's trusted-proxy configuration remains the administrator's responsibility**. Jellyfin's pinned [native forwarding configuration](https://github.com/jellyfin/jellyfin/blob/ca0f16eb7c195f720a1493ed469a27c4657db0c6/Jellyfin.Server/Extensions/ApiServiceCollectionExtensions.cs) sets `ForwardedHeaders.None` when `KnownProxies` is empty. Consequently, Jellyfin can classify the proxy's private-network IP as the caller instead of the real remote client. The pinned [DefaultAuthorizationHandler](https://github.com/jellyfin/jellyfin/blob/ca0f16eb7c195f720a1493ed469a27c4657db0c6/Jellyfin.Api/Auth/DefaultAuthorizationPolicy/DefaultAuthorizationHandler.cs) consults `GetNormalizedRemoteIP()` for each user's `EnableRemoteAccess` permission; [UserController](https://github.com/jellyfin/jellyfin/blob/ca0f16eb7c195f720a1493ed469a27c4657db0c6/Jellyfin.Api/Controllers/UserController.cs) also filters publicly visible users according to that native local/remote classification. This is a genuine server-policy boundary, **not** a WatchGuard CSRF/approval check.

Jellyfin's official [reverse-proxy instructions](https://jellyfin.org/docs/general/post-install/networking/reverse-proxy/) require properly configured native Known Proxies and forwarded client-IP headers for correct remote-access restrictions. The narrowed `HttpsProxySameOrigin` exception can work without this configuration, but must **never** be described as proof that Jellyfin's client-IP forwarding, remote-access restrictions or network filtering are healthy. Direct Jellyfin connections have no proxy to trust. Neither WatchGuard nor its Readiness endpoint should automatically accept forwarded headers, rewrite Jellyfin's network policy or assign trust based only on the browser's claimed Origin.

The native-policy regression fixture creates a disposable non-admin account with `EnableRemoteAccess=false`, uses a reserved RFC 5737 address as the synthetic external client via the owned Caddy container, checks native `/Users/Public` filtering and `/Users/Me` authorization before and after the correct KnownProxies configuration, and verifies untrusted direct X-Forwarded headers remain ignored. These checks are independent of WatchGuard approvals and deliberately demonstrate that approval-ready and native-network-ready are different claims. This addition requires new hosted qualification.

## Mechanisms that are not substitutes

- Authentication proves token possession; it does not prove request origin or human consent.
- CORS governs browser response access/preflight, not native clients. Do not rely on Jellyfin CORS as authorization or CSRF protection.
- Fetch Metadata provides browser context, not a native-client identity. HTTPS is required for reliable metadata outside trustworthy local addresses.
- Referer can be suppressed, carries paths and is unnecessary when Origin/Fetch Metadata are available; it is not used as an authority fallback.
- Public server URL settings can be deployment-dependent and client-facing. They are not a trusted dynamic origin allowlist.
- Request.Scheme/Host reflect backend transport unless native trusted forwarding is configured. Raw forwarded values have no independent authority.
- Session/device names do not replace the existing native token/account binding.

## Readiness

Authenticated administrator `POST /WatchGuard/ServerApproval/Readiness` exercises the same Identity boundary without media lookup, challenge allocation or state transition. Responses are no-store. A successful GET Capabilities is not proof of POST readiness. Even successful Readiness proves only current request authentication/origin and guard attachment; native target permissions, fresh interest and approval consent remain operation-specific. Missing Origin cannot yield BrowserRequestVerified or ApprovalRequestsReady.

## Residual compatibility and rollback

Host-rewriting or Fetch-Metadata-stripping proxies require normal native trusted-proxy configuration, or preserving the original public Host and browser metadata. No hardcoded WatchGuard IP or proxy-specific exception is introduced. Unsupported browsers can use strict native scheme forwarding. Direct HTTP retains its existing transport confidentiality risk; HTTPS is preferred. Multi-instance approval storage and TOCTOU limitations remain unchanged.

Rollback to published v0.4.9 restores strict scheme matching and its native trusted-proxy requirement. JSON/XML schemas and GUID remain unchanged; restart invalidates pending approvals and clients must reload. The publication gate was satisfied by the reviewed browser and native regression matrix recorded in [validation](validation.md).

## Primary references

- [Pinned Jellyfin forwarding configuration](https://github.com/jellyfin/jellyfin/blob/ca0f16eb7c195f720a1493ed469a27c4657db0c6/Jellyfin.Server/Extensions/ApiServiceCollectionExtensions.cs)
- [Pinned native authentication](https://github.com/jellyfin/jellyfin/blob/ca0f16eb7c195f720a1493ed469a27c4657db0c6/Jellyfin.Server.Implementations/Security/AuthorizationContext.cs)
- [ASP.NET Core proxy trust and Host risks](https://learn.microsoft.com/en-us/aspnet/core/host-and-deploy/proxy-load-balancer?view=aspnetcore-10.0)
- [W3C Fetch Metadata browser-generated site classification](https://www.w3.org/TR/fetch-metadata/)
