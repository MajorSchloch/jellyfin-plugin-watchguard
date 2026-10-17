# Disposable fixture lifecycle

The harnesses own UUID-named containers, temporary configuration/media roots and loopback ephemeral ports. They do not accept production configuration or media mounts. Official Jellyfin, LinuxServer and Caddy images retain their existing immutable digest pins.

`fixture_inventory.py` centralizes the media-indexing precondition. Both libraries are configured without triggering independent refreshes, then one native RefreshLibrary task is requested. Polling is read-only, with a monotonic deadline and capped per-request timeouts. Movie, series, season and episode counts, required paths/names and season/episode parent relationships must match exactly. Queries include the intended authenticated user ID. Scan task state is recorded independently. A successful task alone does not establish readiness.

Evidence includes elapsed time, counts, missing paths and parent mismatches in `inventory.json`. Only disposable generated media names/paths belong in this file. Transport failures may be polled again; schema/assertion failures are not converted into readiness retries. The helper never retries configuration mutations, approvals or DELETE requests.

Current scope: shared indexing, phase journals and sanitized container failure evidence are implemented. Broader lifecycle consolidation and cleanup failure handling remain under qualification. Do not treat this document as evidence that all requested lifecycle work has passed.

CI pins Ubuntu 24.04, Node 24.22.0, Python 3.12.0, .NET SDK from global.json and Playwright 1.56.1 from package-lock. Local qualification must use the same language/tool versions; macOS Docker Desktop remains a distinct host environment from hosted Linux.

Startup/restart probes require the native `/health` body to be `Healthy`, not merely HTTP 200 (ASP.NET health responses may return 200 for Degraded), plus authenticated API readiness. The pinned main pipeline maps `/health`; the setup server exposes a separate StartupCheck. This strengthens readiness; it is not asserted to explain the earlier catalog timeout without further evidence.

Build jobs have a 20-minute bound and integration jobs 45 minutes, versus the former implicit six-hour Actions limit. Historical complete verification jobs took approximately 12–14 minutes. These outer watchdogs bound hangs; they do not relax benchmark assertions or readiness deadlines. Job summaries highlight the first failed phase and retained browser assertion, plus browser readiness timings. Cleanup completion never overwrites an earlier phase failure.
