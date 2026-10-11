# WatchGuard v0.3.0 — scoped activity performance

## Measure before optimizing

Baseline is the actual v0.2.4 archive/source (`37e2c0f16a1da1d1495ce1a4ae3b8438aea2fdc7`), profiled **before** changing runtime behavior. After is the v0.3.0 packaged DLL with the final overview implementation; the subsequent missing-serverId menu compatibility fix does not change the measured overview paths. Both controlled runs used the same host, pinned official Jellyfin Server/Web 12.2 image, the same pinned 12.2 Injector source build, and fresh disposable configuration/generated media. The published jf12 Injector was additionally tested separately; its exploratory measurements are not mixed into the table.

Dataset: four enabled accounts, ten movies, three series, ten available episodes and **40 explicit memberships** (39 across the three viewing users plus one administrator membership). Each viewing user has an unfinished movie, started series, one completed movie and one completed series with recent native dates. The administrator has one explicit membership and no playback interest. This last distinction matters: My list's empty automatic result is cheaper to verify than an account with a large viewing history.

Seven sequential HTTP samples after warm-up; five browser visits each for My list and All users at 1280×900. Fixed-name diagnostic stages measure native query/discovery, episode/user verification and MVC serialization **plus response writing**. They exclude authorization and miscellaneous request overhead. Client first-card timing measures DOM insertion, not a full paint benchmark; insertion-after-response starts at the membership response (excluding the new user-directory response). No measurement uses production data.

Raw data: [v0.2.4 before](performance-data/v030-before.json), [v0.3.0 after](performance-data/v030-after.json). HTTP/client values below are medians in milliseconds; server stages are means.

| Measurement | v0.2.4 | v0.3.0 |
| --- | ---: | ---: |
| Own membership HTTP | 8.76 | 9.30 |
| All memberships HTTP | 76.56 | 78.58 |
| Own automatic activity HTTP | 23.09 | 24.33 |
| All-users automatic activity HTTP | 121.04 | 125.65 |
| Selected viewing user's automatic activity HTTP | No scoped endpoint | 38.48 |
| My list: first card | 84.90 | 32.40 |
| My list: both sources settled | 214.20 | 82.40 |
| My list: insertion after membership response | 0.90 | 0.70 |
| All users: first card | 101.60 | 108.70 |
| All users: both sources settled | 238.40 | 247.90 |
| All users: insertion after membership response | 1.70 | 1.70 |

| Server activity stage | Before: all users | After: all users | After: selected viewing user | After: current admin |
| --- | ---: | ---: | ---: | ---: |
| Resume candidate discovery | 22.26 | 23.06 | 5.95 | 5.80 |
| Played-episode discovery | 17.00 | 17.75 | 4.58 | 3.58 |
| Completed-movie discovery | 14.58 | 14.69 | 3.78 | 3.69 |
| Series/user verification | 46.80 | 46.68 | 11.69 | 0.01 |
| Serialization + response writing | 0.22 | 0.23 | 0.16 | 0.15 |

All-user explicit retrieval averaged 67.70 → 68.82 ms; after-change own retrieval averaged 0.35 ms inside its newly instrumented stage. The old own endpoint had no separate retrieval timer, so its 8.76 ms HTTP measurement is not mislabeled as server execution time.

**The improvement is selecting less work, not making all-user queries intrinsically faster.** Previously an administrator's My list downloaded all memberships and all users' automatic activity, then filtered in JavaScript. It now uses own endpoints. First-card and complete times fell about 62% in this fixture. All-users loading is slightly slower, including the new small account-directory request and run-to-run variation. Verification remains the largest individual all-user stage; serialization/rendering are tiny. These are small warm-fixture measurements, not production-scale throughput claims.

## Additive API and request scope

All existing routes/response contracts remain. New routes:

| Route | Authorization | Result |
| --- | --- | --- |
| `GET /WatchGuard/Users` | Enabled administrator | Enabled accounts as `{UserId, DisplayName}` for the owner selector; no watchlist/playback data |
| `GET /WatchGuard/Watchlists/{userId}` | Enabled administrator | Same explicit-item array as Watchlists, restricted to that owner |
| `GET /WatchGuard/ActivityOverview/Users/{userId}` | Enabled administrator | Same bounded activity envelope, discovery and verification restricted to that owner |

The controller resolves the current native account and rechecks administrative permissions. Non-admin requests receive 403 before data lookup; unauthenticated/userless identities are rejected. Selected-user discovery obtains the native user by ID. Disabled/deleted owners yield no entries. Item visibility is checked for **both** caller and owner; genuine lookup errors return 503. No usernames are persisted as identifiers and no activity becomes membership. Native series verification and reason aggregation remain in InterestService, not JavaScript.

The page requests:

- **My list**, including administrators: own `Watchlist`, then `ActivityOverview/Me`. Viewing/membership queries touch only the authenticated user. Administrators additionally retrieve account names for the selector, without downloading their activity.
- **Individual user**: scoped explicit route, then scoped activity route.
- **All users**: unchanged shared explicit route, then bounded all-user activity route.
- **Regular user**, even with a forged owner URL: own routes only, no directory/cross-user request.

Explicit cards still appear before automatic discovery. Changing owner clears the prior scope and starts a new guarded generation; pending responses for the old scope cannot merge into it. Changing status or sorting makes **zero** requests and retains the current card/image nodes. Refresh reloads the selected scope. User changes are now network scope changes, intentionally superseding v0.2.4's local owner filtering. Loading/error/completeness notices and history/reload behavior remain.

## Cache evaluation

A 60-second in-memory automatic-discovery cache was considered, but **not implemented**. Scoping reduces the default view substantially; current fixture own/selected activity takes about 24/38 ms and all-users about 126 ms. A warm cache could reduce repeated all-user work, but would add stale active/finished playback, policy/visibility revalidation and invalidation complexity without solving a demonstrated remaining default-loading problem. The observed improvement does not justify that additional state in this release.

Consequently there is no server cache TTL, account-sharing key, memory growth, expired-entry policy or cached-empty failure. Playback changes are visible on the next request; membership operations remain fresh. A future cache would require measured production-scale need, strict account/scope/configuration keys, size/entry bounds, permission revalidation, native playback/library/account invalidation and explicit freshness reporting before adoption.

Existing limits remain: 50 accounts for all-users aggregation, 100 resume/played candidates per owner plus probes, configured 1–100 automatic titles, 1,000 available episodes per series plus probe, 20,000 verification units and a 1–90 day completion window (default 30). Responses remain `IsComplete:false` even below caps. See [activity.md](activity.md) for omissions. Absence from the overview is never proof of safe deletion.

**`Protection/{id}` and the deletion adapter are unchanged and never use a cache or activity snapshot.** No production configuration, playback, Favorites, media or watchlist schema was modified.

## Reproduce

Build the v0.2.4 checkout and run this release's profiler harness against that packaged DLL using `--profile v030-before` (the fixture registration assertion must match the binary version). Build v0.3.0 and run:

```sh
python3 scripts/build-release.py
python3 tests/docker-smoke.py --injector-dll /path/to/pinned-Injector.dll --profile v030-after
```

Only one profiling fixture may run at once, because fixed diagnostic logs are aggregated without request/user identifiers. PerformanceObservers/MutationObservers exist only in the measurement harness, not production UI. The fixture cleans up its container, generated media and temporary account configuration. Ordinary browser/deletion tests use the runner without `--profile`; catalog/migration tests use `--catalog`.
