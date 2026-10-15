# Disposable deletion-guard experiment

**Do not install in production.** This companion assembly is inactive without an explicit test environment opt-in and is excluded from WatchGuard release packaging.

- [Design, build, installation and removal](../../docs/server-guard-poc-v049.md)
- [Qualification results and limitations](../../docs/server-guard-poc-results-v049.md)
- `docker-test.py`: pinned, checksum-verified, generated-media fixture; direct or `/jellyfin` base path.
- `evidence/`: sanitized native guard logs and structured fixture results.

The guard has no override mechanism. It deliberately rejects a protected Web deletion even after Delete Anyway.
