# Isolated Stage A approval guard

Research only. Never place this assembly in production or a catalog ZIP.

Read the [threat model](../../docs/server-approval-threat-model-v049.md),
[protocol and disposable installation instructions](../../docs/server-approval-protocol-v049.md),
and [results](../../docs/server-approval-results-v049.md).

The companion is inactive without `WATCHGUARD_DISPOSABLE_SERVER_APPROVAL=1`.
The fixture builds on the **published, SHA-256-verified v0.4.8** plugin in a
single disposable load context. It never accepts a remote server or existing
configuration/media directory. Do not simultaneously load ServerGuardPoC.

```sh
dotnet test experiments/ServerApproval.Tests -c Release
python3 experiments/ServerApproval/docker-test.py
python3 experiments/ServerApproval/docker-test.py --base-path /jellyfin
```

Run from the repository root; Docker, curl, Python 3, .NET 10 and the existing
browser-test dependencies are required. The direct fixture additionally runs
the existing pinned Caddy fixture (including zstd and WebSocket checks).

No production project, loader, Web adapter, version, workflow or manifest is
changed. Removal of the companion and a server restart invalidates approvals
and restores v0.4.8 Web-only behavior. The test harness does this explicitly.

`evidence/` contains aggregate results without access tokens, challenges or
private viewing details. The store memory sample is a managed-heap test, not
native server RSS. Stage B requires separate review and authorization.
