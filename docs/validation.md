# Validation and release qualification

**Current published version:** [WatchGuard v0.5.1](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/releases/tag/v0.5.1) · Qualified Jellyfin Server/Web **12.2.0**, .NET 10.

The release qualification completed successfully on source commit `925a4fba061c8ecc79f01fa4626fd7aa4e5e3989`: [GitHub Actions #39173529151](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/39173529151). Its build, ten integration jobs and gated publish job all passed; the official native server-enforcement suite ran with `WATCHGUARD_PROXY_MATRIX=1`. The resulting release package is SHA-256 `61148bd7db0ac4d3f309b2a3e05d633aed893800b4092fa78c1d400f15b8d2bc`.

The release build passed 207 backend tests, 109 JavaScript tests, 14 Python infrastructure checks and 4 catalog tests, and reproduced the ZIP checksum in a second build. See [v0.5.1 results and resolved fixture failure](release-v051.md#verified-qualification). These are the published release’s results, not a claim that this documentation-only update reran the Docker matrix.

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
