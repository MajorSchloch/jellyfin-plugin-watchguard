# Validation

Verified on 2026-10-10 with .NET SDK 10.0.302 and Node 25.9.0 on macOS ARM64.

- Locked NuGet restore and Release publish succeeded, with no compiler warnings.
- **12 xUnit tests passed** for interest aggregation, playback completion, manual-entry persistence, active sessions, user isolation, stale items/users, concurrent writes and schema rejection.
- **9 Node tests passed** for deletion cancellation/override, fresh status reads, failures, privacy, repeated installation, containing-series checks and queued bulk calls.
- **Docker integration passed** using official `jellyfin/jellyfin:12.0`, digest `sha256:baba630419915985442f315f08b0cf46d9f4c8a0cc4bd38e94a6d35751dd5ef5`.
- The inspected Injector commit `2758804c987d490ef32fc2fbdb8a73a44facdf2c` built with `-p:JellyfinVersion=12.0.0`; WatchGuard registered successfully and appeared in authenticated `private.js` delivery.
- Real HTTP checks exercised unauthenticated 401, non-admin 403, missing-item 404, native catalog queries, two-user watchlists, movie progress/completion, manual retention, two-episode series aggregation, and stale-entry cleanup.
- The actual JavaScript guard was connected to the live REST endpoints using a Node ApiClient adapter. Cancel issued no native DELETE and the synthetic movie remained accessible. Delete Anyway called native DELETE once and subsequent item/protection requests returned 404. This verifies the guard and server behavior, **not browser DOM rendering**.

The smoke test creates a temporary localhost-only container, random disposable credentials, a two-second synthetic movie and two synthetic episodes. It removes its container and configuration when finished. It does not mount an existing media library.

```sh
# Publish first using README instructions; Docker, Python 3 and Node are required.
python3 tests/docker-smoke.py

# Also verify registration with your Jellyfin 12 Injector DLL:
python3 tests/docker-smoke.py --injector-dll /path/to/Jellyfin.Plugin.JavaScriptInjector.dll
```

The first run may download the pinned image. The script uses the final published WatchGuard DLL; republish after code changes.

## Remaining browser acceptance checks

No connected browser surface was available in the implementation environment. The following visual and navigation checks remain manual, using disposable media:

1. Sign in as a normal user in Jellyfin Web's legacy layout. Open movie/series details; toggle Watchlist, reload, and verify persistence. Open My Watchlist and follow a title link.
2. Add interest as a second user. Sign in as administrator and confirm the detail indication shows the second user's name and reason. A normal user must see no cross-user indication.
3. Use the native delete menu. After the native confirmation, verify WatchGuard's dialog. Cancel and Escape must preserve the item; the native generic failure alert may appear. Reopen and choose Delete Anyway to delete only the test title.
4. Exercise native multi-select deletion. Each title receives an independent queued check. Cancel all dialogs to preserve all items; earlier approved items are already deleted.
5. Test direct links, restored/cached detail pages, logout/login and a configured Jellyfin base URL. Verify the UI is not duplicated and account changes do not expose stale status.
6. Disable the backend or interrupt connectivity; wrapped deletion must reject instead of sending DELETE. Disable Injector separately to demonstrate the documented warning bypass.
7. Repeat after Jellyfin/Web/Injector upgrades. Modern React details and native clients are not validated or claimed as supported UI surfaces.

The MVP has no server-side veto, atomic check-and-delete transaction, or universal client protection. See the bypass list in `architecture.md`.
