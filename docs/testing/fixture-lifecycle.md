# Disposable fixture lifecycle

The harnesses own UUID-named containers, temporary configuration/media roots and loopback ephemeral ports. They do not accept production configuration or media mounts. Official Jellyfin, LinuxServer and Caddy images retain their existing immutable digest pins.

`fixture_inventory.py` centralizes the media-indexing precondition. Both libraries are configured without triggering independent refreshes, then one native RefreshLibrary task is requested. Polling is read-only, with a monotonic deadline and capped per-request timeouts. Movie, series, season and episode counts, required paths/names and season/episode parent relationships must match exactly. Queries include the intended authenticated user ID. Scan task state is recorded independently. A successful task alone does not establish readiness.

Evidence includes elapsed time, counts, missing paths and parent mismatches in `inventory.json`. Only disposable generated media names/paths belong in this file. Transport failures may be polled again; schema/assertion failures are not converted into readiness retries. The helper never retries configuration mutations, approvals or DELETE requests.

Shared code covers indexing, readiness, phase journals, browser identity and sanitized failure evidence. The two scenario harnesses remain separate because enforcement and catalog/migration have different state transitions; they use the same runner locally and in CI. `installation-and-regressions` is a coarse phase, supplemented by browser assertions and catalog-operation timings, not a claim of per-scenario timing precision. Qualification results are recorded separately in `repeatability-results.md`.

CI pins Ubuntu 24.04, Node 24.22.0, Python 3.12.0, .NET SDK from global.json and Playwright 1.56.1 from package-lock. Local qualification must use the same language/tool versions; macOS Docker Desktop remains a distinct host environment from hosted Linux.

Startup/restart probes require the native `/health` body to be `Healthy`, not merely HTTP 200 (ASP.NET health responses may return 200 for Degraded), plus authenticated API readiness. The pinned main pipeline maps `/health`; the setup server exposes a separate StartupCheck. This strengthens readiness; it is not asserted to explain the earlier catalog timeout without further evidence.

Build jobs have a 20-minute bound and integration jobs 45 minutes, versus the former implicit six-hour Actions limit. Historical complete verification jobs took approximately 12–14 minutes. These outer watchdogs bound hangs; they do not relax benchmark assertions or readiness deadlines. Job summaries highlight the first failed phase and retained browser assertion, plus browser readiness timings. Cleanup completion never overwrites an earlier phase failure.

## Lifecycle and bounds

| Phase | Contract / bound |
|---|---|
| Workspace | UUID-owned temporary configuration/media, no production mounts |
| Container startup/restart | Pinned image, native Healthy plus required API readiness; 90-second readiness deadline |
| Initial setup/authentication | Native setup and login, HTTP calls bounded to 15 seconds |
| Background tasks | Disable automatic plugin update triggers before explicit catalog tests |
| Media generation | Generated disposable files using the pinned image tools; Docker command watchdog 180 seconds |
| Libraries/indexing | Configure both libraries before one scan; exact per-type/path/parent/user inventory, typically 120-second deadline; benchmark profiles retain their own existing bounds |
| Installation/runtime | Explicit catalog/migration assertions, restart health and actual plugin/script state; no ambiguous install retry |
| Browser scenarios | Authenticated identity and route contracts; existing assertion bounds, 600-second process watchdog |
| Failure evidence | First failed phase, native inventory/tasks, bounded container logs/state, sanitized browser trace/screenshot |
| Teardown | Owned container removal bounded to 60 seconds, even after failure; temporary workspace cleanup |

Media generation occurs after container bootstrap so it uses the pinned container's tools, and before library creation. The phase order deliberately differs from generating media with an unpinned host ffmpeg.

Run a profile with `python3 tests/run_suite.py <suite>` after installing the pinned tools and locked browser package. Migration/legacy accept `--injector-dll` for the pinned rollback-only dependency. The runner never retries a failed profile. CI creates independent ephemeral ports, networks, temporary paths and UUID artifact directories for parallel profiles.
