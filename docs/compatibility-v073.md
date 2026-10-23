# WatchGuard v0.7.3 — Jellyfin 12.3 compatibility

Qualification is in progress; exact final commits, checksums and outcomes will be recorded here before review.

## Official source review

Compared server tags [v12.2…v12.3](https://github.com/jellyfin/jellyfin/compare/v12.2...v12.3) (`ca0f16eb7c195f720a1493ed469a27c4657db0c6` → `06de749d435e2d0be0c5119a41f2300fdd7143e5`) and Web tags [v12.2…v12.3](https://github.com/jellyfin/jellyfin-web/compare/v12.2...v12.3) (`61b1f890365ad15138e943e694af723c1d47df2a` → `c06cb17b274c10f9015412305edb0afdc010ae7a`).

Server changes do not alter LibraryController deletion routes, native authorization, user-data/session APIs, plugin registration or middleware integration. BaseItem now normalizes non-finite ratings/audio gains to null; its relevant public signatures are unchanged. Microsoft packages move from 10.0.11 to 10.0.12 (System.Text.Json to 10.0.13). Other changes concern media probing/subtitles, TMDb ranking and logging.

Web adds UserDataChanged WebSocket subscriptions to invalidate modern item queries. Its SDK moves 1.0.0 → 1.0.1; the [SDK patch](https://github.com/jellyfin/jellyfin-sdk-typescript/compare/v1.0.0...v1.0.1) fixes stable-release generation, updates the generated API version to 12.2.0 and clarifies ForceKeepAliveMessage documentation, without changing the ApiClient adapter used by WatchGuard. Modern library titles/suggestion headers and Live TV tab selection change, but Home/details routes, native deletion dialogs, standalone index loading and item action placement remain unchanged in the tagged diff. Playback removes a duplicate MediaSegmentManager binding. Native watched-state updates, playback, account switching and navigation still require runtime qualification.

Both released image binaries were inspected before changing the guard. Each declares authorized `ActionResult DeleteItem(Guid itemId)` at `DELETE Items/{itemId}` and `ActionResult DeleteItems(Guid[] ids)` at `DELETE Items`, including the bulk query binder. Official and LinuxServer API assembly version numbers differ; the guard continues to use the native host version plus structural checks, not the API assembly version as a host-version proxy.

[Source inventory](evidence/compatibility-v073/source-review.json), [official binary preflight](evidence/compatibility-v073/official-preflight.json) and [LinuxServer binary preflight](evidence/compatibility-v073/linuxserver-preflight.json) retain exact identities.

## Fixture and support contract

`tests/fixture_images.py` pins official Jellyfin 12.3 and LinuxServer `12.3ubu2604-ls56` by registry digest, and retains the previous immutable 12.2 images. `WATCHGUARD_JELLYFIN_VERSION=12.2` selects the regression fixture; unknown selections fail. The release workflow exposes the same explicit selector.

Every disposable fixture verifies the exact native Server version, reflects packaged deletion signatures/authorization, and applies the production convention to both actual actions. Native browser login verifies Web's ApiClient app version. Enforcement tests separately verify real filter attachment, enabled/disabled behavior, vetoes, approvals and native continuations against synthetic files and records.

Only 12.2.0 and 12.3.0 are supported (optional zero fourth version component); unknown minor, patch and revision versions remain unsupported. Existing structural checks remain. Package references and minimum catalog ABI remain 12.2.0.0: no new API is used, and the same candidate is qualified on both versions. Plugin GUID, personal formats, enforcement semantics and browser/query runtime are unchanged.

The [manifest inventory](evidence/compatibility-v073/image-manifests.json) records architecture-specific digests as well as these immutable image references:

| Host | Official | LinuxServer |
| --- | --- | --- |
| 12.3.0 | `jellyfin/jellyfin:12.3@sha256:2038fe038ab3876a80f6e7b7e0aef6607b032c7dc0c9b3ad3296d0b2eba3bbb5` | `lscr.io/linuxserver/jellyfin:12.3ubu2604-ls56@sha256:4212ca390fbc6bd5002048d2d2ce2b8a5b1ad278ec4cbabe6519869117404308` |
| 12.2.0 | `jellyfin/jellyfin:12.2@sha256:357724bf0ae27a672c7cbaa899db2d9abeb13dbd8657ccce750258a4c059d037` | `lscr.io/linuxserver/jellyfin:12.2ubu2604-ls53@sha256:1bb4f88d822a0510bb3604b68aacb80d77c1d2a30181e500090c65111b98723b` |

## Qualification plan

Full eleven-suite qualification on both versions, with `publish=false`, `proxy_matrix=true`: standalone and rollback/catalog paths; legacy Injector; native navigation at desktop/390px through a base path; WebSocket/compression; activity filtering, global sorting, pagination, preparation, polling, playback and watched-state changes; security/permissions/account switching; native deletion enforcement on official/LinuxServer, base paths, reverse proxies and HTTPS. All data is disposable. Public releases and catalog remain unchanged.
