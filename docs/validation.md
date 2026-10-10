# Validation scope

The active deployment-test release is **WatchGuard v0.1.0 for Jellyfin 12.2 / .NET 10**, with the approved Phase 4 behavior.

See [deployment.md](deployment.md#automated-results) for the final release build, packaging and automated test results, and [hardening.md](hardening.md) for the supported Web paths and limitations. The [deletion PoC](deletion-poc.md) records historical Phase 1 evidence; it is not a description of the current feature set.

All live validation uses an isolated official Docker container, temporary accounts/configuration and generated disposable media. Backend and JavaScript unit tests use local fixtures. Nothing is deployed to production or published by the build/test scripts.
