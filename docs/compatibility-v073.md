# WatchGuard v0.7.3 — Jellyfin 12.3 compatibility

Full qualification passed on Jellyfin Server/Web **12.3.0 and 12.2.0**, using the same v0.7.3 artifact. Public releases, catalog entries and historical evidence remain unchanged.

## Official source review

Compared server tags [v12.2…v12.3](https://github.com/jellyfin/jellyfin/compare/v12.2...v12.3) (`ca0f16eb7c195f720a1493ed469a27c4657db0c6` → `06de749d435e2d0be0c5119a41f2300fdd7143e5`) and Web tags [v12.2…v12.3](https://github.com/jellyfin/jellyfin-web/compare/v12.2...v12.3) (`61b1f890365ad15138e943e694af723c1d47df2a` → `c06cb17b274c10f9015412305edb0afdc010ae7a`).

Server changes do not alter LibraryController deletion routes, native authorization, user-data/session APIs, plugin registration or middleware integration. BaseItem now normalizes non-finite ratings/audio gains to null; its relevant public signatures are unchanged. Microsoft packages move from 10.0.11 to 10.0.12 (System.Text.Json to 10.0.13). Other changes concern media probing/subtitles, TMDb ranking and logging.

Web adds UserDataChanged WebSocket subscriptions to invalidate modern item queries. Its SDK moves 1.0.0 → 1.0.1; the [SDK patch](https://github.com/jellyfin/jellyfin-sdk-typescript/compare/v1.0.0...v1.0.1) fixes stable-release generation, updates the generated API version to 12.2.0 and clarifies ForceKeepAliveMessage documentation, without changing the ApiClient adapter used by WatchGuard. Modern library titles/suggestion headers and Live TV tab selection change, but Home/details routes, native deletion dialogs, standalone index loading and item action placement remain unchanged in the tagged diff. Playback removes a duplicate MediaSegmentManager binding. These watched-state, playback, account-switching and navigation paths were then exercised in the native qualification below.

Both released image binaries were inspected before changing the guard. Each declares authorized `ActionResult DeleteItem(Guid itemId)` at `DELETE Items/{itemId}` and `ActionResult DeleteItems(Guid[] ids)` at `DELETE Items`, including the bulk query binder. Official and LinuxServer API assembly version numbers differ; the guard continues to use the native host version plus structural checks, not the API assembly version as a host-version proxy.

[Source inventory](evidence/compatibility-v073/source-review.json), [official binary preflight](evidence/compatibility-v073/official-preflight.json) and [LinuxServer binary preflight](evidence/compatibility-v073/linuxserver-preflight.json) retain exact identities.

## Fixture and support contract

`tests/fixture_images.py` pins official Jellyfin 12.3 and LinuxServer `12.3ubu2604-ls56` by registry digest, and retains the previous immutable 12.2 images. `WATCHGUARD_JELLYFIN_VERSION=12.2` selects the regression fixture; unknown selections fail. The release workflow exposes the same explicit selector.

Every disposable fixture verifies the exact native Server version, reflects packaged deletion signatures/authorization, and applies the production convention to both actual actions. Native browser login verifies Web's ApiClient app version. Enforcement tests separately verify real filter attachment, enabled/disabled behavior, vetoes, approvals and native continuations against synthetic files and records.

Only 12.2.0 and 12.3.0 are supported (optional zero fourth version component); unknown minor, patch and revision versions remain unsupported. Enforcement attachment and the administrator IntegrationStatus match flag use the same exact-version predicate; the human-readable compatibility field names both releases. Existing structural checks remain. Package references and minimum catalog ABI remain 12.2.0.0: no new API is used, and the same candidate is qualified on both versions. Plugin GUID, personal formats, enforcement semantics and browser/query runtime are unchanged.

The [manifest inventory](evidence/compatibility-v073/image-manifests.json) records architecture-specific digests as well as these immutable image references:

| Host | Official | LinuxServer |
| --- | --- | --- |
| 12.3.0 | `jellyfin/jellyfin:12.3@sha256:2038fe038ab3876a80f6e7b7e0aef6607b032c7dc0c9b3ad3296d0b2eba3bbb5` | `lscr.io/linuxserver/jellyfin:12.3ubu2604-ls56@sha256:4212ca390fbc6bd5002048d2d2ce2b8a5b1ad278ec4cbabe6519869117404308` |
| 12.2.0 | `jellyfin/jellyfin:12.2@sha256:357724bf0ae27a672c7cbaa899db2d9abeb13dbd8657ccce750258a4c059d037` | `lscr.io/linuxserver/jellyfin:12.2ubu2604-ls53@sha256:1bb4f88d822a0510bb3604b68aacb80d77c1d2a30181e500090c65111b98723b` |

## Qualification

Exact tested runtime and fixture commit: `79f6cf86a053fe86450ec44f30842d6535448762`. Later evidence commits change documentation, JSON reports and screenshots only.

- Candidate ZIP SHA-256: `8082c08a96e4aee46fea8dc22fbde84bdd0c107cb5cc410dd49efaedbc0da20e`.
- Candidate DLL SHA-256: `9b462b86f99111ffc3a8c530cb788abc4be89b4e852dc3d8d5b3af6aef905eea`.
- Local build, both downloaded CI packages and deterministic rebuilds agree.
- **320 backend, 171 JavaScript, 21 infrastructure and 4 catalog tests** passed in both builds.

| Server/Web | Full qualification | Result |
| --- | --- | --- |
| 12.3.0 | [Run 40019755421](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/40019755421) | Build + all 11 integration suites passed; publish skipped |
| 12.2.0 | [Run 40019760086](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/40019760086) | Build + all 11 integration suites passed; publish skipped |

Both runs used `publish=false`, `proxy_matrix=true`, and their explicit `jellyfin_version`. [Qualification provenance](evidence/compatibility-v073/qualification.json) records exact images, native Server/Web versions, package and GitHub artifact checksums, job outcomes and suite commands.

For each host, the native official and LinuxServer enforcement reports pass 77 cases: enabled/disabled behavior, protected/unprotected synthetic files and records, single/bulk deletion, approvals, expiry/replay/concurrency, permission/session changes, account switching, upgrade/rollback and unchanged personal stores. The official matrix also passes Caddy HTTPS, Nginx, Traefik, simulated tunnel forwarding, native HTTPS and remote-access trust boundaries. Base-path enforcement is a separate passing job. The native status endpoint reports the matching server version and supported-version flag while retaining `BrowserExecutionVerified=false`.

The actual packaged controller has both expected authorized deletion methods; the production convention attaches to exactly two actions, confirmed separately by native startup/capability checks. Both host versions keep the v0.7.2 navigation contract: 36 desktop/mobile control operations per host, delayed API requests, rapid changes, Back/Forward, direct links, reload, details/return and Home/Favourites. Transition observation records no native routing, panel replacement or focus loss during filter edits.

Activity-index and native browser suites pass filtering/search/global order, selected-owner aggregation, pagination/preparation, initial population, polling, watched/unwatched changes, playback start/stop, deeper-view stability, failure recovery and permission revocation. The unchanged security assertions remain enabled. See the per-host [12.3 navigation](evidence/compatibility-v073/12.3/native-navigation.json), [12.2 navigation](evidence/compatibility-v073/12.2/native-navigation.json), [12.3 activity UI](evidence/compatibility-v073/12.3/native-activity-ui.json) and [12.2 activity UI](evidence/compatibility-v073/12.2/native-activity-ui.json) reports.

The [12.3 native query comparison](evidence/compatibility-v073/12.3/native-activity-queries.json) and [12.2 comparison](evidence/compatibility-v073/12.2/native-activity-queries.json) also pass permission revocation between pages and record zero query-triggered playback-classification batches. Timings include preparation and remain fixture measurements, not production capacity claims.

Local final-runtime arm64 checks also passed all 36 native navigation operations and 77 LinuxServer enforcement cases; [local provenance](evidence/compatibility-v073/local-arm64/provenance.json) identifies the same candidate checksum.

## Reproduction and limits

Use the locked toolchain in `global.json` and `tests/run_suite.py`. Build once with `python3 scripts/build-release.py`; select a retained host with `WATCHGUARD_JELLYFIN_VERSION=12.2` or `12.3` when running a suite. The release workflow accepts `jellyfin_version`, `proxy_matrix=true` and `publish=false`. Qualification copies only generated fixture configuration/media into short-lived containers.

The full matrices use Linux/amd64 images and Chromium. Local arm64 checks covered 12.3 native navigation and LinuxServer enforcement; they do not constitute a full arm64 matrix. These results do not qualify other Jellyfin releases, third-party Web builds or native mobile/TV clients. Native HTTP enforcement still covers only the two verified library deletion routes; external filesystem deletion and unrelated APIs are outside its scope. Proxy evidence uses disposable Caddy/Nginx/Traefik and simulated tunnel forwarding, not a production proxy deployment.

The initial `d672793` qualifications were intentionally cancelled after review found the separate status match flag still checked only 12.2. The corrected runtime shares one predicate and adds backend plus native reporting assertions. Cancelled runs are not passing qualification evidence.
