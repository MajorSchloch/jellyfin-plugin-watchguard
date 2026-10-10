# Jellyfin WatchGuard — Phase 3

Personal watchlists and native interest detection for **Jellyfin 12.2 / .NET 10**, integrated into Jellyfin Web through JavaScript Injector.

Movie and series detail pages have an independent Watchlist toggle. Administrators see interested users and reasons. Before native Web deletion, WatchGuard checks fresh status: other users' interest requires **Cancel / Delete Anyway**; confirmed zero or self-only interest needs no extra warning. Failed checks and unsupported item types block the wrapped deletion. Native permissions remain authoritative.

See [Web integration and observed limitations](docs/web-ui.md), [backend API and storage](docs/backend.md), and the historical [deletion proof of concept](docs/deletion-poc.md). The architectural reference is [architecture.md](docs/architecture.md).

## Build and tests

Requires .NET SDK 10.0.302 or a later patch in that feature band; Node 24+ for tests.

```sh
dotnet restore Jellyfin.Plugin.WatchGuard.slnx --locked-mode
dotnet build Jellyfin.Plugin.WatchGuard.slnx -c Release --no-restore
dotnet test Jellyfin.Plugin.WatchGuard.slnx -c Release --no-build --no-restore
node --test tests/web.test.cjs
dotnet publish Jellyfin.Plugin.WatchGuard/Jellyfin.Plugin.WatchGuard.csproj \
  -c Release --no-restore -o artifacts/WatchGuard
```

Open `Jellyfin.Plugin.WatchGuard.slnx` in Rider. `Jellyfin.Plugin.Template.slnx` remains as an equivalent compatibility entry point for existing Rider workspaces.

For real Web path testing, use the disposable Docker/browser harness described in [deletion-poc.md](docs/deletion-poc.md#reproduce). It creates its own test accounts and synthetic media, tests native menus, and removes its container. It never mounts a real library.

## Install into a test Jellyfin container

Use Jellyfin 12.2 and its matching bundled Web client. Install a Jellyfin-12-compatible [JavaScript Injector](https://github.com/n00bcodr/Jellyfin-JavaScript-Injector). Copy only `artifacts/WatchGuard/Jellyfin.Plugin.WatchGuard.dll` into `/config/plugins/WatchGuard/` while Jellyfin is stopped, then restart. Do not copy Jellyfin dependency DLLs.

WatchGuard registers the embedded script programmatically; there is no manual script installation step. Verify the registration log and reload the Web client. A missing/failed Injector means there is **no active confirmation**. When upgrading from the earlier prototype, the same `watchguard-v1` registration ID replaces that script; remove any manually pasted duplicate and reload all test tabs. The backend uses a versioned JSON store in the plugin data directory. Incompatible or corrupt existing files cause an explicit error; see the recovery instructions in [backend.md](docs/backend.md#persistence-and-recovery).

Diagnostics are opt-in; instructions are in [deletion-poc.md](docs/deletion-poc.md#diagnostics). Only fixed event names and operation counters are logged.

**Limits:** this does not protect native clients, direct API requests, filesystem deletion, or cleanup plugins. Cancelling can trigger Jellyfin's generic deletion-error alert. Bulk prompts operate per item, not as an atomic transaction. Use disposable media for validation. No production deployment is included.
