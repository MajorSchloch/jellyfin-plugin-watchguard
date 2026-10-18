# WatchGuard v0.4.10 — published release overview

**Published:** 2026-10-18 · [GitHub release](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/releases/tag/v0.4.10) · [Catalog manifest](../manifest.json).

Target: Jellyfin Server/Web 12.2.0, .NET 10. The plugin GUID, watchlist/preferences schemas, optional server-enforcement setting and the two native HTTP deletion action hooks are unchanged from v0.4.9.

## Changes from v0.4.9

- **More portable browser approval security.** For a verified admin session and matching public Host/port, WatchGuard can accept a browser's HTTPS same-origin approval request when the backend connection is HTTP and the browser explicitly sends `Sec-Fetch-Site: same-origin`. No wildcard Origin trust, arbitrary forwarded-header trust or WatchGuard-specific proxy IP allowlist was added.
- **Non-mutating approval-readiness check.** The plugin dashboard now verifies the active browser's authenticated POST origin boundary without issuing or approving any media mutation.
- **Separate Jellyfin network-security disclosure.** Approval readiness does *not* prove that Jellyfin correctly handles forwarded client IPs or enforces native remote-access policy. Reverse-proxy administrators must configure Jellyfin's native **Known Proxies**; direct connections require no proxy entry.
- **Regression coverage.** Disposable Caddy, Nginx, Traefik, simulated tunnel, direct TLS, base-path, catalog, migration and LinuxServer fixtures verify authenticated approval, media preservation after veto, one-use DELETE continuation, spoofed request rejection, and Jellyfin's separate local/remote policy behavior.

This release does **not** add support for TV/mobile clients' approval UI, arbitrary Jellyfin versions, direct filesystem removal, Sonarr/Radarr/Tdarr cleanup or Cloudflare Tunnel certification.

## Installation and upgrade

Install or upgrade through Jellyfin's WatchGuard plugin catalog, restart Jellyfin, and fully reload all browser tabs. Existing watchlists and preferences are preserved. Keep Jellyfin's existing trusted-proxy settings; do not remove them merely because approval readiness reports success.

With server enforcement enabled, the plugin dashboard should report `Runtime: Enabled`, `AttachedActions: 2/2`, `Restart required: false`, `Approval POST readiness: ready`, and `This browser: adapter installed`. The native-networking notice remains informational. Verify watchlists and **Cancel** on disposable/protected media before relying on the upgrade.

See [current installation and safety guidance](../README.md), [proxy compatibility](proxy-compatibility-v0410.md), [security design](deployment-agnostic-security-v0410.md) and [verification](validation.md).

## Final qualification and provenance

- Source merge of the reviewed browser-fixture follow-up: `540b467a40ceba642e8f9a14ee029516880a7410`.
- Successful final publishing workflow: [GitHub Actions #39111459009](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/39111459009) on that source commit; build, all ten integration suites and publish completed successfully with the optional proxy matrix enabled.
- Published v0.4.10 package SHA-256: `471d99364db520a0990e4a624d73e26ae4c9f1c50404c2902c9691516667bf3e`.
- Catalog version: `0.4.10.0`; published package includes the DLL and LICENSE. The public catalog preserves earlier immutable release entries.

Published release asset and manifest are the authority for downloads; this Markdown is a descriptive summary, not another publication mechanism.
