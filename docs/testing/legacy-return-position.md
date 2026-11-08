# Legacy Back position measurement

## Failure and reproduction

Qualification [42474246785](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/42474246785), job 128712291128, artifact 13615098397 failed in the desktop-legacy mouse return to **Return Position 04**. Focus was restored and `scrollTop` remained 888. The screenshots show that the native header tab row was absent after Back. The former report saved only the pre-navigation offset, because the offset assertion preceded insertion of the result row.

The isolated case and full native navigation sequence passed locally on the unchanged package. A separate controlled case reproduces the roughly 53 px difference: the test holds native Home `viewbeforeshow`/`viewshow` delivery while WatchGuard's real activity response finishes, then releases those same lifecycle events. It does not replace API data, cards, styles, or plugin code. This is controlled evidence, not an unmodified native failure.

In pinned Jellyfin Web 12.4, the legacy Home controller installs tabs in its `viewbeforeshow` listener. WatchGuard's route/data/focus work can finish before that native layout step. The old test waited three frames after focus, which did not establish native layout readiness. The original artifact does not establish the exact event ordering; it cannot prove how long the missing tab row persisted.

## Measurements

Local Chromium 141, desktop-legacy, 1280 × 700, unchanged v0.7.17. Viewport coordinates in CSS pixels:

| Measurement | Activation | Early Back, lifecycle held | Native layout complete |
| --- | ---: | ---: | ---: |
| Title text top | 509.50 | 456.58 | 509.50 |
| Card / title-link top | 272.45 | 219.53 | 272.45 |
| Panel top | 110.36 | 57.44 | 110.36 |
| Panel scrollTop | 888 | 888 | 888 |
| Visible header height | 110.36 | 57.44 | 110.36 |
| Focus on originating title | yes | yes | yes |
| Within 48 px | — | **FAIL** | **PASS (0 px)** |

The controlled jump is temporary. Releasing the native lifecycle restores the original geometry without changing scrollTop or the runtime. No lasting position error was observed in the unmodified local navigation sequence.

[Activation](legacy-return-position/activation.png) · [Early Back](legacy-return-position/early-back.png) · [Native layout complete](legacy-return-position/native-layout-ready.png) · [Full local measurements](legacy-return-position/local-results.json)

## Test correction

The ordinary test now waits for the specific layout: visible native Home/Favorites tabs on legacy/TV surfaces, a visible header, and panel top aligned with the header bottom. Modern retains its own header contract. The predicate does **not** wait for the expected card position. A persistent missing header or a real position error still fails. The 48 px assertion, request budget, focus, history, authorization and zero-Home-exposure assertions remain strict.

The controlled case demonstrates that the former three-frame sample fails, then verifies the same 48 px assertion after native layout completion. Ordinary desktop, mobile and Modern cases remain separate. Reports save title, anchor, card, panel and header rectangles, scrollTop and focus before layout waiting and before position assertions. Failure capture records the current geometry; the report is written before cleanup.

No fixed delay, action retry, timeout increase, runtime change or version change is included.

## Validation

- Local unchanged baseline: full `tests/navigation-browser.cjs` passed.
- Local corrected return suite: 28 cases passed, including controlled reproduction, desktop mouse, mobile touch, Modern, deeper pages, removed membership, native expired continuation, interaction/navigation cancellation, authorization denial and account change.
- Fast readiness regression checks missing tabs, incomplete panel alignment, missing native entries, Modern header handling and a wrong offset that must still fail.
- Hosted 12.4 navigation result: pending.

Pinned server/Web image: `jellyfin/jellyfin:12.4@sha256:fea863d0cd9ec445985d9c75fc6ed64e38a1d2766cf0c250a33d553f4fc1b771`.

Unchanged v0.7.17 ZIP SHA-256: `9b53815b0e7bcbcf99feaa694f36a310235408e5ff27730801f77b695f2e5266`.

DLL SHA-256: `75d0dddc6f9ffcd5dd8a8edd1e35ec14c8335f145f8a6617f96d5524e7523be1`.
