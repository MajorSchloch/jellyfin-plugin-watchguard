# WatchGuard v0.4.1 — self-protection and Caught Up

Release candidate for Jellyfin Server/Web **12.2**, .NET **10**. Assembly/file version **0.4.1.0**, target ABI **12.2.0.0**, GUID **a3c6bc84-783d-4ba8-a0db-89bfb83ab486**. No publication or production deployment is performed.

## Deletion protection includes you

The existing `Protection/{id}` response already includes the requester. The Web adapter now evaluates all validated `Users`, instead of discarding the requester. `HasOtherInterestedUsers` retains its original meaning and is still checked for consistency; it no longer determines whether a warning is necessary. No backend authorization, response fields or protection rules change.

- Your explicit membership: **This title is on your watchlist.**
- Your unfinished viewing: **You haven't finished watching this title.**
- Your active session: **You are currently playing this title.**
- Other users retain their display names and interest reasons. Multiple reasons/users share one dialog, rendered as text.

Native Jellyfin permission checks and its native confirmation still run first. The installed `ApiClient.deleteItem` adapter resolves the target, then performs the same fresh protection request. There are no extra network requests: one target lookup and one protection lookup for movies/series; the existing additional parent verification for episodes/seasons. Season/episode warnings still name the actual deletion target and its parent series. No activity snapshot or cache decides deletion.

Cancel, Escape and dialog close reject without a DELETE. Delete Anyway invokes the original method once with its original receiver/arguments/result/error behavior. Failed/malformed status, unsupported targets and changed authentication remain fail-closed. Jellyfin's generic error after cancellation remains visible. Bulk deletion remains per-item and nontransactional: cancelling one item does not roll back or cancel other independently approved/clear items.

`Watchlisted`, `InProgress` and `CurrentlyPlaying` remain the only valid protection reasons. Neither `Watched` nor `CaughtUp` is accepted in a protection response. Completed viewing history alone does not warn; an explicit membership or active session still protects completed media, including your own.

This is advisory **Web-only** protection after adapter installation. Native clients, direct API calls, server cleanup plugins and filesystem deletion bypass it. There is no server-side deletion hook or bypass introduced here.

## Native Caught Up classification

Source inspected at Jellyfin 12.2 commit `ca0f16eb7c195f720a1493ed469a27c4657db0c6`:

- [Series.Status](https://github.com/jellyfin/jellyfin/blob/ca0f16eb7c195f720a1493ed469a27c4657db0c6/MediaBrowser.Controller/Entities/TV/Series.cs) is nullable [SeriesStatus](https://github.com/jellyfin/jellyfin/blob/ca0f16eb7c195f720a1493ed469a27c4657db0c6/MediaBrowser.Model/Entities/SeriesStatus.cs): `Continuing`, `Ended`, `Unreleased`.
- [BaseItem.IsUnaired](https://github.com/jellyfin/jellyfin/blob/ca0f16eb7c195f720a1493ed469a27c4657db0c6/MediaBrowser.Controller/Entities/BaseItem.cs) uses native `PremiereDate` and the server's local calendar date. Episodes dated today are still unaired under this native property; no external air-time lookup is performed.
- [Episode.IsMissingEpisode](https://github.com/jellyfin/jellyfin/blob/ca0f16eb7c195f720a1493ed469a27c4657db0c6/MediaBrowser.Controller/Entities/TV/Episode.cs) identifies virtual locations. [Native query translation](https://github.com/jellyfin/jellyfin/blob/ca0f16eb7c195f720a1493ed469a27c4657db0c6/Jellyfin.Server.Implementations/Item/BaseItemRepository.TranslateQuery.cs) applies `IsVirtualItem ?? IsMissing` to the stored virtual flag.

Only the activity overview branch changes. For a Continuing series it includes native virtual/missing rows in the **existing bounded episode query**, checks coverage, and verifies the aired, available subset with the existing batch playback/resume services. There is no extra query per series or poster.

| Native state | Activity reason |
| --- | --- |
| Continuing; at least one aired available episode; every such episode played; known air dates and no known aired/undated missing rows | `CaughtUp` — Caught Up |
| Continuing; started; at least one unwatched available aired episode | `InProgress` — Watching |
| Ended; all available episodes played | Existing `Watched` history, subject to the native-date activity window |
| Unknown/null or Unreleased status | Existing behavior, including Watched when eligible |
| Empty series, incomplete episode coverage, unknown available-episode air dates | Never inferred as Caught Up |

Future virtual/missing episodes do not prevent Caught Up. Future available episodes do not enter aired completion/progress counts, but active playback on them still contributes `CurrentlyPlaying`. A new aired unwatched episode changes Caught Up to Watching on the next request. Counts and native dates reuse the same batch reads. Nothing writes playback state or creates a permanent membership.

`CaughtUp` appears only in `ActivityOverview` variants. It belongs to the existing **Watching** filter, with its own compact icon/accessible label and native playback date. It can combine with explicit membership or active playback without duplicate users/cards. No new checkbox or preference value is stored. The old interest-only endpoints and detail-page protection indicators retain their protection-only meanings.

Caught Up describes an ongoing series, so it is not subject to the completed-history date window. Discovery is still bounded by native resume/played-episode/session candidates; old or displaced candidates can be absent. The limits remain 100 candidates per discovery query, configured automatic-title limit (1–100), 50 enabled accounts, 1,000 episode rows per series/user plus a truncation probe, and 20,000 verification units. Including virtual rows can hit the episode cap sooner. Truncated series are omitted, never marked Caught Up. Missing user-data lookups remain errors, not successful empty/completed state.

All overview responses remain `IsComplete:false`. Known coverage gaps add a notice. Coverage is limited to native metadata and episodes visible to that user: the plugin cannot discover absent provider metadata or invisible episodes, nor verify a broadcaster's full release catalog. No external provider, filesystem scan, activity database or cache is added. Protection continues to evaluate its original available-episode scope independently, even when the activity overview excludes future episodes.

## Upgrade and rollback from v0.4.0

No migration of `watchlists.json` schema 1, `preferences.json` schema 1 or settings XML is required. The standalone loader, bootstrap, asset controllers and settings infrastructure are unchanged. No Injector dependency or Web-file changes are introduced.

1. Back up the stopped configuration volume, including both JSON stores, their recovery files and plugin XML. LinuxServer.io paths are in [deployment.md](deployment.md).
2. After a separately authorized publication, install v0.4.1 through the existing catalog and restart. For this unpublished candidate, use the disposable catalog harness; do not add speculative release URLs to the public manifest.
3. Confirm one active `WatchGuard_0.4.1.0` installation, then fully reload **every** Web tab/client. Check the native settings page's current-build/authenticated-script/browser-adapter diagnostics. Old v0.4.0 tabs retain their old self-exclusion behavior until reloaded; server health alone does not upgrade them.
4. On disposable media, verify self-only membership and unfinished/active playback warnings, Cancel/Escape/close sending zero DELETEs, and Delete Anyway sending one. Verify Caught Up in Watching and history-only deletion without an additional warning.
5. To roll back, uninstall v0.4.1 through the native dashboard, restart, install retained v0.4.0 through the catalog's version selection, and restart/reload all clients. Preserve the data directory and settings. If version selection is unavailable, restore the backed-up v0.4.0 installation with Jellyfin stopped, outside any duplicate discovery folder; do not overwrite native metadata while running. Rollback restores **other-users-only** warnings and the older Watched classification.

The published v0.4.0 ZIP is retained unchanged: SHA-256 `439fdc1accf4922e7f6eb8d01451e8d83f3343d656ef65d778f5dc99163bda4d`. Its public GitHub release/asset digest was verified on 2026-10-13. The local manifest was behind publication; it is synchronized with the existing public v0.4.0 manifest, preserving all published version objects. No v0.4.1 entry is advertised, and nothing is pushed. Older Injector migrations remain documented/tested separately in [migration-v040.md](migration-v040.md).

## Package and validation

Build with SDK 10.0.302 using `python3 scripts/build-release.py`. The ZIP contains only `Jellyfin.Plugin.WatchGuard.dll` and `LICENSE`, with embedded Web assets. Native catalog validation uses the ZIP's MD5; the SHA-256 sidecar is additional verification. The release workflow defaults to validation only and preserves immutable published assets. See [plugin-repository.md](plugin-repository.md).

Validated locally on 2026-10-13. [Machine-readable report](performance-data/release-v041.json); [Caught Up browser screenshot](screenshots/v0.4.1/caught-up.png).

- **83 .NET tests, 47 JavaScript tests, 4 catalog tests passed.** Includes self-only/all-user interest, original arguments/results, zero-interest/history-only decisions, invalid responses, all target types, native series statuses, new/missing/future episodes, user progress/isolation, settings/preferences/storage and standalone middleware regressions.
- **LinuxServer.io 12.2 + Caddy HTTPS**, clean native catalog installation without Injector, v0.4.1 → v0.4.0 → v0.4.1 round trip, exact JSON/XML preservation, one active assembly, full backend/auth/settings/browser/deletion suite, restart/uninstall and native Web integrity: passed.
- **Official Jellyfin 12.2 under `/jellyfin` with gzip proxy**, complete backend/auth/browser/deletion suite and uninstall: passed.
- **Published v0.3.1 + Injector → v0.4.1 → v0.3.1 → v0.4.1**, checksum rejection, conflicting-registration refusal, explicit WatchGuard-only cleanup, unrelated-script/data/config preservation, full browser suite: passed.
- Retained v0.3.0/v0.3.1 catalog, missing-Injector and v0.3.1 browser regressions: passed against immutable old artifacts. Their historical self-only behavior is asserted separately.
- Every final full browser run recorded **13 native item DELETE requests and zero ordering violations**. Self-only membership/resume/session Cancel, Escape and dialog-close attempts produced zero DELETEs; explicit override deleted once. Movie/series/episode/season, context-menu and bulk paths retain their assertions. Real native metadata verified Continuing → Caught Up, new unwatched aired episode → Watching, future episode exclusion, Ended → Watched and no permanent membership.
- HEAD, compression, conditional GET/ranges, private no-store/authentication, CSP refusal, stale tabs, account changes, native permissions, configuration pages and Caddy WebSocket upgrade/ping-pong: passed. The native browser WebSocket status helper remained false despite a captured 101/open connection, as in v0.4.0; this is not presented as new loader success. The raw authenticated ping/pong check passed separately.
- Forced deterministic rebuild and archive allowlist verification: passed. The standalone loader source is unchanged. Local direct index measurement: 10 samples, median **0.913 ms**, maximum **1.908 ms**, 5,540 bytes. These fixture measurements are not a production performance estimate.

One parallel legacy-migration attempt returned HTTP 500 from Jellyfin's catalog installer during the final re-upgrade. Its original server exception was not retained; cause is undetermined. A fresh fixture passed the identical round trip and full regression suite with scoped exception diagnostics added. No automatic retry or weakened assertion masks this observation. The test-only base-path proxy also logged client disconnects during navigation; the full run passed.

Final ZIP: `artifacts/Jellyfin.Plugin.WatchGuard-v0.4.1.zip`.

```text
SHA-256 b679195d7bc914ff64c6b311fa2938de0084ef195f447b92338284e10dd8411e
MD5     3484d80f51d1570d033f305a1179ac1f
```

Reproduce the integration matrix after building and installing test prerequisites:

```sh
python3 tests/docker-smoke.py --linuxserver --catalog --caddy
python3 tests/docker-smoke.py --base-path /jellyfin --proxy
python3 tests/docker-smoke.py --linuxserver --migration --injector-dll /path/to/pinned-Injector.dll
python3 tests/docker-smoke.py --legacy-injector --catalog --injector-dll /path/to/pinned-Injector.dll
python3 tests/docker-smoke.py --legacy-injector --injector-dll /path/to/pinned-Injector.dll
python3 tests/docker-smoke.py --linuxserver --caddy --measure
```

The workflow downloads/checks published rollback ZIPs and builds the pinned rollback-only Injector fixture. Image digests and Docker/Compose paths are retained in [deployment.md](deployment.md). The production domain, its effective browser CSP, plugins/themes and production-sized library are not directly tested; no production access or deployment occurred.
