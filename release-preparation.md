# WatchGuard v0.7.10 preparation

Unpublished. Published v0.7.9 remains the installation release. Public catalog and existing packages remain unchanged.

This candidate improves native navigation presentation and arrival. Publication copy lives in [docs/releases/v0.7.10.md](docs/releases/v0.7.10.md). Findings, before/after observations and qualification are recorded in [docs/navigation-v0710.md](docs/navigation-v0710.md).

Full [qualification](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/40769893542) passed on tested commit `2fffa6cca2440dfb0f6a32f7df00256359edc429` with `publish=false`, `proxy_matrix=true`: all 39 suites across Server/Web 12.2.0, 12.3.0 and 12.4.0. ZIP SHA-256: `fd4e0301c312406e4ada3301e64bcb504aa29fd16c80157beb735b5ddc2b0681`. Publication was skipped. Minimum ABI and dependencies remain 12.2. Browser evidence uses Chromium viewport/touch emulation, not physical-device testing.

The subsequent master release qualification failed in the native timestamp-ordering test. Its [test-only correction and evidence](docs/native-ordering-v0710.md) preserve the exact ZIP/DLL above. Follow-up run [40853608810](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/40853608810) passed all activity-native checks but **did not qualify**: the independent 12.3 published-v0.3.1 legacy browser scenario timed out (38/39 suites passed). No retries or assertion relaxations were added. This later failed run does not replace the historical qualification evidence above; release preparation remains blocked.

Do not merge, publish or deploy as part of preparation.
