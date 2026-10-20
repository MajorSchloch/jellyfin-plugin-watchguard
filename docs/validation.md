# Validation and release qualification

**Current published version:** [WatchGuard v0.6.0](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/releases/tag/v0.6.0) · Qualified Jellyfin Server/Web **12.2.0**, .NET 10.

**Release preparation (unpublished):** [v0.7.0 combined activity browser](release-v070.md), [qualification and native measurements](activity-browser-validation-v070.md). Public assets and catalog history are unchanged.

The historical v0.5.2 release qualification completed successfully on source commit `9a3aa7d046863687b671f316da0a138cb4f6be21`: [GitHub Actions #39219433132](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/39219433132). Its build, ten integration jobs and gated publish job all passed; the official native server-enforcement suite ran with `WATCHGUARD_PROXY_MATRIX=1`. The resulting release package is SHA-256 `62af61f98b9d914f7890967048986f8c4641b8f3417edc2f08756bd15df7b3ec`.

The release build passed 212 backend tests, 112 JavaScript tests, 14 Python infrastructure checks and 4 catalog tests, and reproduced the ZIP checksum in a second build. See [v0.5.2 validation](release-v052.md#validation). These are the historical v0.5.2 release’s results, not a claim that this documentation-only update reran the Docker matrix.

## Test boundaries

- **Backend and protocol:** per-account interest, native permission checks, one-use 60-second approval, token/session/target binding, fresh interest and parent-series evaluation, cancellation and replay/race behavior.
- **Native HTTP:** direct protected DELETE without approval is denied; the disposable movie/record remains. Approved deletion invokes exactly one native continuation and removes only the intended disposable media. Unsupported native routes and external file operations are outside protection.
- **Browser:** current Web adapter, cancellation with zero DELETE, authenticated approval, traditional/standalone migration, desktop/narrow layouts, Caddy HTTPS, native base paths and compatibility with archived client state.
- **Proxy and network security:** origin validation for direct HTTP(S), Caddy with/without `KnownProxies`, Nginx, Traefik and simulated tunnel forwarding. Separately, Jellyfin native `EnableRemoteAccess=false` behavior was checked using synthetic remote IP and disposable account before/after configuring trusted Caddy forwarding. Approval readiness is *not* a statement that native client-IP handling is healthy.
- **Packaging and recovery:** deterministic single-DLL + LICENSE ZIP, immutable catalog/checksum history, published-version upgrade/rollback fixtures, intact watchlist/preferences/configuration stores and rollback-compatible watchlist-date sidecar, and no Injector dependency in current installations.
- **Isolation:** CI creates short-lived local Jellyfin/Docker installations with generated accounts, configuration and media. It never uses the owner's production media or authentication tokens.

The dashboard's authenticated approval-readiness POST is **non-mutating** and only verifies the current request's authentication/origin boundary. It does not grant deletion consent, prove permission for a future target, establish successful JavaScript execution in every client or audit the underlying Jellyfin network policy. For server or UI upgrades beyond the qualified 12.2.0 baseline, repeat version-specific tests.

## Reproducing checks

Run ordinary tests with the pinned SDK and Node.js environment, following the [repository README](../README.md#development-and-verification). The manually dispatched [release workflow](../.github/workflows/release.yaml) defaults to `publish=false`. Enabling `proxy_matrix=true` adds the full reverse-proxy and native HTTPS security fixture; **never** publish without reviewing its completed results.

Historical phase and release-candidate reports are indexed in [docs/README.md](README.md) and intentionally preserved with their original results. Those snapshot statements do not override the latest validated release.
