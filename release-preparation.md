# WatchGuard v0.7.10 preparation

Unpublished. Published v0.7.9 remains the installation release. Public catalog and existing packages remain unchanged.

This candidate improves native navigation presentation and arrival. Publication copy lives in [docs/releases/v0.7.10.md](docs/releases/v0.7.10.md). Findings, before/after observations and qualification are recorded in [docs/navigation-v0710.md](docs/navigation-v0710.md).

Full [qualification](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/40769893542) passed on tested commit `2fffa6cca2440dfb0f6a32f7df00256359edc429` with `publish=false`, `proxy_matrix=true`: all 39 suites across Server/Web 12.2.0, 12.3.0 and 12.4.0. ZIP SHA-256: `fd4e0301c312406e4ada3301e64bcb504aa29fd16c80157beb735b5ddc2b0681`. Publication was skipped. Minimum ABI and dependencies remain 12.2. Browser evidence uses Chromium viewport/touch emulation, not physical-device testing.

Subsequent master qualification exposed a timestamp comparison error in the native test, followed by an intermittent published-v0.3.1 dialog-dismissal/navigation race. Their [test-only corrections and retained failure evidence](docs/native-ordering-v0710.md) preserve the exact ZIP/DLL above. Final [qualification 40968308368](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/40968308368) passed on exact tested commit `720e62b228883910caba098a2e86d4b8902449fd`, with `publish=false`, `proxy_matrix=true`: all 39 suites / 54 primary fixture commands across all three supported versions. No retries or assertion relaxations were added. Publication was skipped; v0.7.10 remains unpublished. Historical qualification and failed-run evidence remain available.

Do not merge, publish or deploy as part of preparation.
