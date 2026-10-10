# Jellyfin WatchGuard

Personal movie/series watchlists, separate from Favorites and Seerr, with **web-only deletion warnings**. Built against Jellyfin **12.0.0**, .NET 10. No database, frontend framework, media writes, metadata tags, or automatic deletion.

On supported Jellyfin Web detail pages, users can add/remove a title and open **My Watchlist**. Administrators see other interested users and their reasons. Interest includes explicit watchlist entries, incomplete playback, and current playback sessions. Manual entries survive playback completion.

## Deletion behavior

Jellyfin's original confirmation appears first. WatchGuard then checks current interest before the native deletion request. Administrators get **Cancel / Delete Anyway**, with usernames and reasons. Cancellation, missing items, or failed checks stop that request. Non-admins with native delete permission receive a generic confirmation because cross-user status is private; their deletion permissions remain Jellyfin's responsibility.

This is an advisory web integration, **not server-side deletion enforcement**. Native clients, direct API calls, cleanup plugins, filesystem tools, and unwrapped SDK requests bypass it. Bulk deletion checks each item separately; cancelling one cannot restore earlier approved items. See [architecture and client limits](docs/architecture.md).

## Build and test

Requirements: .NET SDK 10.0.302 (or later patch in its feature band), Node.js 24+ for JavaScript tests. NuGet dependencies are locked. Node tests use only the built-in test runner.

```sh
dotnet restore Jellyfin.Plugin.WatchGuard.slnx --locked-mode
dotnet test Jellyfin.Plugin.WatchGuard.slnx -c Release --no-restore
node --test tests/web.test.cjs
dotnet publish Jellyfin.Plugin.WatchGuard/Jellyfin.Plugin.WatchGuard.csproj \
  -c Release --no-restore -o artifacts/WatchGuard
```

Install only `artifacts/WatchGuard/Jellyfin.Plugin.WatchGuard.dll`. Do not copy Jellyfin or framework dependency DLLs into the plugin directory. The JavaScript is embedded.

## Docker installation

Use Jellyfin server **12.0** with its matching bundled web client. For an existing official Docker deployment whose `/config` is a host directory:

```sh
# Replace ./jellyfin-config with the host directory mounted at /config.
docker compose stop jellyfin
mkdir -p ./jellyfin-config/plugins/WatchGuard
cp artifacts/WatchGuard/Jellyfin.Plugin.WatchGuard.dll \
  ./jellyfin-config/plugins/WatchGuard/
docker compose up -d jellyfin
```

For a new deployment, this minimal Compose file uses the same directory:

```yaml
services:
  jellyfin:
    image: jellyfin/jellyfin:12.0
    ports:
      - "8096:8096"
    volumes:
      - ./jellyfin-config:/config
      - ./jellyfin-cache:/cache
      - ./media:/media
    restart: unless-stopped
```

Set directory ownership to the UID/GID running Jellyfin. Configure libraries normally; native deletion still requires Jellyfin permissions and writable media mounts. Use disposable media to test deletion.

Install the **Jellyfin 12 build** of [JavaScript Injector](https://github.com/n00bcodr/Jellyfin-JavaScript-Injector), enable it, and restart Jellyfin. WatchGuard registers `watchguard-v1` through Injector's public `PluginInterface.RegisterScript` API. Check logs for `WatchGuard web script registered with JavaScript Injector`, then reload the web client. The inspected Injector revision is in the architecture document; do not install its Jellyfin 10 artifact on Jellyfin 12.

If registration fails, the backend still works but there is **no web warning**. As a manual fallback, paste `Jellyfin.Plugin.WatchGuard/Web/watchguard.js` into one enabled, authentication-required Injector script. Use either registration or the manual fallback; remove manual copies before upgrades. To uninstall, disable/remove the Injector script too (registered scripts can persist in Injector configuration).

The store is `watchlists.json` under Jellyfin's assigned plugin `DataFolderPath` (`/config/plugins/Jellyfin.Plugin.WatchGuard` in the tested official image; check your host's plugin-path settings). Back up this directory with `/config`. Writes use a lock, a flushed temporary file, and atomic replacement. Unknown versions or corrupt stores cause errors instead of silent data loss. One Jellyfin process must own the file. Stale entries are hidden, not automatically destroyed; users can remove their own stale IDs via the API.

## API

All endpoints require a real authenticated Jellyfin user session. User identity comes from Jellyfin's claim, never a supplied user ID. API keys without a user are rejected. Item reads obey native library visibility.

| Method | Path | Access / result |
| --- | --- | --- |
| GET | `/WatchGuard/Watchlist` | Own accessible movie/series entries |
| GET | `/WatchGuard/Watchlist/{itemId}` | Own `Watchlisted` state |
| PUT | `/WatchGuard/Watchlist/{itemId}` | Add own entry, idempotent |
| DELETE | `/WatchGuard/Watchlist/{itemId}` | Remove own entry, including stale IDs |
| GET | `/WatchGuard/Protection/{itemId}` | Admin only: title, deduplicated users and reasons |

Prefix URLs with your Jellyfin base path if configured. Protection responses include the requesting administrator when interested; the UI excludes them from warnings about **other** users. Non-admins get HTTP 403, with no cross-user names, counts, or playback details. Unsupported/inaccessible/missing titles return 404. Responses are not cached.

## Validation

Automated backend tests cover shared interest, movie/series progress, completion, durable manual entries, active sessions, authorization boundaries, missing items/users, concurrent writes, and unsupported store versions. JavaScript tests cover pre-request cancellation, explicit override, fresh checks, errors, non-admin privacy, idempotent installation, and per-item bulk behavior. An optional real-server test runs with `python3 tests/docker-smoke.py` after publishing. See [runtime test notes](docs/validation.md) for the exercised environment and remaining manual checks.
