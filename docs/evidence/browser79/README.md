# Chromium 79 and TV validation

Runtime commit: `62bc4c0e491a864fbc021e21093af21fb4a5dff1`, based on master `7d329af`. Candidate: unpublished v0.7.12. Public catalog and published binaries are unchanged.

- ZIP SHA-256: `e825e51bff1ff5b974ba558379cbfeb7e3f95d0fc688fdedf172c8fa4d24cccd`
- DLL SHA-256: `847a754bfb55b4da6b8e25ed3957c6df21425aba0c399c1e1b3ca83f82704c61`

## Confirmed failures and fixes

The anonymous public v0.7.11 ZIP and sidecar match SHA-256 `c48fc7150da44e6e37670bd2be41813ee1590c931b29a964a110fdb06e7a534b`. Extracted scripts from all five resources fail in actual Chromium 79 with `SyntaxError: Unexpected token '.'`. See [published package results](published-v0711-parse.json). This establishes a shipped syntax failure; it does not establish the only cause of the reported TV problem.

Build-time transformation fixes syntax. Separate API/CSS checks found unsupported own-property checks, string/DOM methods, listener cleanup, selectors, layers, flex gaps and poster sizing. Native tests also found that status disclosures needed a focus container and that membership completion could restore focus too late for a second OK action.

Jellyfin's native select implementation avoids platform popups on webOS. Its component is absent on direct Watchlists entry. The TV fallback uses an owned choice dialog and retains select values/change events. A native test caught a label-activation click reopening that dialog after selection. Keeping dialog buttons outside the select label resolves it; repeated actions and stale options/accounts are rejected. Choosing the current option emits no change event, so it cannot invalidate an in-flight query.

## Actual old engine

Chromium **79.0.3945.0**, official snapshot **706915**, macOS Intel under Rosetta. Archive SHA-256: `e6b754d211e4ad264c163b5a9e2fda9b2c07ab014402e8ee29e97de620ccefe6`. This is an old executable, not a user-agent override. It is not LG hardware or a webOS application wrapper.

| Native Server/Web | Result | Evidence |
| --- | --- | --- |
| 12.2.0 | Pass | [Exact image digest, package hashes and cases](native-12.2.json) |
| 12.3.0 | Pass | [Exact image digest, package hashes and cases](native-12.3.json) |
| 12.4.0 | Pass | [Exact image digest, package hashes and cases](native-12.4.json) |

Each test uses the same ZIP/DLL in disposable synthetic fixtures. Coverage includes native login, direct Watchlists entry/reload, TV navigation from Favorites, directional traversal, owner/sort/range selection, status OK/Back, search, membership add/remove, focus return, deletion-warning cancellation with zero native media DELETE requests, settings inline execution and outside-listener cleanup on leaving. Layouts: TV, Desktop Legacy, Mobile Legacy at 390px, and Modern. No page script errors were recorded.

The new harness waits for an explicit ready/empty/populating state. An absent state attribute during initial page creation is not readiness. An earlier immediate-input run stalled while preferences initialized; activity-query initialization is unchanged in this compatibility patch. Input before initialization remains a separate follow-up, not a demonstrated LG-specific failure.

## Modern and fast checks

[Modern native controls](modern-controls.json): all 12 combinations of Auto, Modern, Desktop Legacy and Mobile Legacy at 390, 1280 and 2048px passed. Themes checked: light, purplehaze, blueradiance, appletv, wmc and dark. Mouse/touch contexts are browser emulation, not physical-device tests. Existing delayed/failed write, focus, menu, preference, filter and history assertions remain in place.

[Fast CI](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/41212065523) passed: 376 backend, 210 JavaScript, 85 Python and eight catalog tests, plus release-note/history checks and packaged-resource validation. Negative asset checks reject missing scripts, unsupported syntax/APIs, lost server switches and stale extraction files masking a missing resource.

[41212060761, attempt 1](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/41212060761) passed **all 39 suites** and the **complete compatibility evidence gate**, with `publish=false` and `proxy_matrix=true`. Each of 12.2, 12.3 and 12.4 passed all 13 suites against the identical package. See the [qualification result](qualification.json), [sealed provenance record](qualification-record.json) and [timings with separate elapsed/execution definitions](qualification-timings.json).

Package artifact: `13046726283`; sealed record artifact: `13047349090`; diagnostics artifact: `13047244351`. The downloaded CI package is byte-for-byte identical to the local old-engine package.

**The overall workflow is red because the read-only publication rehearsal was blocked**, not because a compatibility suite failed. Master still declares v0.7.11; this branch prepares v0.7.12. `publish_release.py` rejects that version mismatch before planning writes. See the [retained blocked result](publication-rehearsal.json), artifact `13046774204`, job `124576645867`. The guard and permissions are unchanged. Publication requires the normal exact merged-commit qualification and release-environment approval; this branch record does not authorize it.

Earlier evidence remains available: [41207590338](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/41207590338) stopped at the preparation-note check, which was corrected. [41207748864](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/41207748864) was cancelled before the matrix for the poster fallback. [41208704618](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/41208704618) was cancelled when TV select testing required another runtime change. [41210556813](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/41210556813) was cancelled for the unchanged-selection guard. None is presented as successful qualification. No assertion was weakened or retried to hide a failure.

## Screenshots and remaining hardware work

These show actual Chromium 79 with pinned Jellyfin 12.3 and synthetic data:

- [TV Watchlists and focus](tv-watchlists.png)
- [TV owner choices](tv-watchlist-owner-choices.png)
- [TV activity-range choices](tv-activity-range-choices.png)
- [TV detail action](tv-detail.png)
- [TV deletion warning](tv-dialog.png)
- [390px Mobile Legacy](mobile-legacy-watchlists.png)

Follow the [short physical-TV procedure](../../browser-compatibility.md#physical-tv-procedure). The reported LG model is unconfirmed. webOS 6.5.3-47 / firmware 03.53.45, the on-screen keyboard, pointer remote, overscan, suspend/resume and the installed client's loader path have not been tested on hardware. The navigation-fixture reliability chore remains separate.
