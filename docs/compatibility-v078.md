# WatchGuard v0.7.8 compatibility and action verification

Preparation evidence; full qualification is pending.

## Official changes reviewed

The [Server v12.3…v12.4 comparison](https://github.com/jellyfin/jellyfin/compare/v12.3...v12.4) changes .NET packages/tooling to 10.0.14 and release version metadata. Native deletion controller, binding, authentication, library/user-data/session interfaces and loader routes have no source changes in this delta.

The [Web comparison](https://github.com/jellyfin/jellyfin-web/compare/v12.3...v12.4) changes package version metadata and `@jellyfin/sdk` 1.0.1 → 1.0.2; no native layout/routing source files change. The [SDK comparison](https://github.com/jellyfin/jellyfin-sdk-typescript/compare/v1.0.1...v1.0.2) prevents WebSocket URL updates without a session, clears the retained socket URL on disconnect and clears the session token even if logout fails. Generated API version metadata moves to 12.3.0. These changes specifically justify retaining websocket/logout/account-isolation regressions rather than assuming unchanged behavior from unchanged DOM files.

Both actual released image assemblies passed preliminary structural inspection before extending the range: `DeleteItem(Guid itemId)` and `DeleteItems(Guid[] ids)`, ActionResult, native DELETE routes, default authorization and native comma-delimited query binding. This inspection did not claim active enforcement: the previous version envelope still rejected 12.4. Runtime configurations in both images specify .NET/ASP.NET 10.0.14. Integration tests must additionally establish final attachment, native behavior and actual Server/Web versions.

Minimum catalog ABI remains 12.2.0.0; Controller/Model dependencies remain 12.2.0 and the target remains .NET 10. The same package is required on all three hosts. The bounded release envelope is 12.2.x, 12.3.x and 12.4.x; later minors, majors, prereleases and nonzero revision builds remain unsupported. Patch simulations are not real-release qualification. No structural, authorization or actual-enforcement checks are relaxed.

## Images

- Official: `jellyfin/jellyfin:12.4@sha256:fea863d0cd9ec445985d9c75fc6ed64e38a1d2766cf0c250a33d553f4fc1b771`
- LinuxServer: `lscr.io/linuxserver/jellyfin:12.4ubu2604-ls57@sha256:3894d9eae88418d3cf9ac6349392d2c4dad818365a59565d19edc38098897044`

Existing 12.2/12.3 immutable fixtures remain unchanged in `tests/fixture_images.py`. Local preflight uses arm64; hosted qualification uses amd64.

## Watchlist action

The actionable detail button changes from a plain bookmark to `bookmark_remove` when saved. Plain membership status indicators, turquoise active styling, accessible labels and tooltips remain unchanged. Native desktop/mobile tests exercise add/remove, both failed writes, repeated activation while a request is pending, node identity, keyboard focus after success/failure, visible minus without hover, unchanged media/user data and another account’s retained membership. Existing navigation/account switching regressions remain required.

The native preflight exposed an existing self-invalidation: the shared membership callback remounted the detail button before its own write completion. Detail-origin writes now finish in place; menu/card writes still invalidate details. The existing request, error and identity checks remain, with a disabled-action guard and focus restoration only if the same view/account is current and the user has not focused another control. No additional request, timer or listener is introduced.
