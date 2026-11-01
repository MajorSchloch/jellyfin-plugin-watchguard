# Watchlists return position — v0.7.15 preparation

**Unpublished.** This patch restores the selected title, approximate scroll position and useful focus after a return from native item details. Published packages and catalog entries remain unchanged.

## Observed baseline

The native fixture ran the exact published v0.7.14 DLL, SHA-256 `1a0ceb832b36543d7c0217ebfe67038715a31d75a65a5727a84fec4c065e614e`. It opened a title from a scrolled Watchlists view, then used browser Back. The title remained in the returned results, but the panel returned to scroll position zero. Focus moved to `BODY` in all three cases. The fixture did **not** observe focus on the first toolbar control.

| Native layout and engine | Panel scroll before → after Back | Title top before → after Back | Focus after Back |
| --- | --- | --- | --- |
| Desktop Legacy, Chromium 141, 1280 × 700 | 493 → 0 px | 272.44 → 765.44 px | `BODY` |
| Mobile Legacy, Chromium 141, 390 × 700 | 2242 → 0 px | 257.86 → 2499.86 px | `BODY` |
| TV, actual Chromium 79, 1280 × 700 | 621 → 0 px | 289.67 → 910.67 px | `BODY` |

The [current-browser measurements](evidence/return-position-v0715/baseline/current.json) and [Chromium 79 measurements](evidence/return-position-v0715/baseline/chromium79.json) retain the engine, deployed DLL hash, item position, panel depth and focus evidence. These are observations from disposable native Jellyfin fixtures, not assumptions from source inspection.

| Before opening details | After Back on published v0.7.14 |
| --- | --- |
| ![Desktop Legacy before opening details](evidence/return-position-v0715/baseline/desktop-before.png) | ![Desktop Legacy after Back; previous position lost](evidence/return-position-v0715/baseline/desktop-after.png) |
| ![Mobile Legacy before opening details](evidence/return-position-v0715/baseline/mobile-before.png) | ![Mobile Legacy after Back; previous position lost](evidence/return-position-v0715/baseline/mobile-after.png) |
| ![Chromium 79 TV before opening details](evidence/return-position-v0715/baseline/tv79-before.png) | ![Chromium 79 TV after Back; previous position lost](evidence/return-position-v0715/baseline/tv79-after.png) |

## Behavior and history

WatchGuard records a small navigation context before an item opens. It contains the stable title ID, viewport offset, loaded depth, title ordinal, focused action and effective query. A WatchGuard marker identifies the originating history entry. The marker preserves Jellyfin's existing history fields. Unsupported history-state shapes disable restoration instead of replacing native data.

Back to that entry creates a new Watchlists panel and fetches current, authorized results. When the title appears, WatchGuard restores its action focus and approximate viewport position. If the title moved in the current ordering, it uses that ordering and shows a brief explanation. It does not reorder results to reconstruct an old list.

Fresh visits remain normal entries. Back and Forward use native history. Filter changes retain the existing in-place URL behavior. The outgoing cover and incoming startup handoff remain separate from position restoration. Leaving Watchlists still aborts its requests, listeners and polling, and removes the old panel.

## Bounds and privacy

The navigation memory retains at most **four contexts**, each for at most **ten minutes**. Contexts remain in memory for the current document only. They are tied to the API instance, account, authentication token, server, query and history entry. Identity changes and authentication denial clear them. The token only participates in the existing in-memory identity check; it is not added to the URL or history state.

No cards, owner rows, membership data, dates or continuation tokens are retained for restoration. A history marker cannot authorize cached content. Every returned page uses the existing account checks, query serialization and authorization rules. Detail and Watchlists `401`/`403` handling also clear the restoration memory.

The initial **four-request preparation budget** is unchanged. Restoration can make at most **two additional result requests**, reach at most **three loaded pages**, and never exceed the saved depth. It stops as soon as the title is available. Saved depth is a search bound, not a promise to replay every old page. Ordinary pagination still requires **Load more results**.

These limits bound work even if a title moved far down the result set. Restoration does not extend preparation, refresh expired continuations automatically, or follow a continuation that makes no progress.

## Interaction and fallback

Pointer, touch, wheel or keyboard input cancels automatic focus and scroll restoration. It also stops additional automatic page requests. An in-flight response may finish the current authorized view, but it cannot move the user afterward. Route, query, account and generation checks prevent late results from moving another view.

If the title is absent, the budget is exhausted, preparation pauses, or the query fails, the current authorized results remain usable. A short notice explains that the previous place could not be restored. The heading receives focus unless the user has already interacted. Normal filters and loading controls remain available. An expired continuation exposes the existing **Refresh this view** action instead of a replay loop.

A changed ordering can still restore the same available title. Removed or unauthorized titles disclose no remembered title text or membership. Removal errors, ordinary refresh, preparation limits, polling and deletion protection keep their existing behavior.

## Validation status

The baseline is complete. Candidate validation is in progress; the following fields must be completed before review:

- Exact tested source commit: **pending**.
- Candidate ZIP and DLL SHA-256: **pending deterministic packaging**.
- Final native desktop/mobile and Chromium 79 results: **pending**.
- Candidate screenshots and frame observations: **pending**.

Completed fast checks at this preparation stage: **293 JavaScript tests** and **376 backend tests** passed. The final validation record must distinguish these results from later package and native checks.

Focused regressions cover first-page and deeper-list returns, history, delayed data, unavailable titles, bounded work, continuation expiry, account changes and user interruption. Existing startup, departure-cover, filter, permission and removal-feedback assertions remain required. The native fixture checks actual card activation and return behavior; screenshots alone do not establish correct transitions.

The current qualification policy remains unchanged: Jellyfin **12.4 full** and **12.3 core**, current Chromium and actual Chromium 79, with a direct upgrade from published v0.7.14. The minimum package ABI remains 12.2.0.0. It is not a claim of current native qualification on Jellyfin 12.2. No full branch matrix or additional historical matrix is required for these focused checks. After merge, automatic qualification must validate the exact master package before release approval.

## Physical TV check

Browser evidence uses disposable Jellyfin fixtures and desktop/mobile viewport emulation. The older-engine evidence uses an actual Chromium `79.0.3945.0` executable, not a changed user agent. No physical LG TV test has been performed for this patch.

On the LG TV:

1. Open Watchlists and move focus to a movie or series below the first visible row.
2. Press OK to open details, then press Back.
3. Confirm that the title returns near its previous position with visible remote focus.
4. Load another page and repeat the same steps.
5. While the return view loads, press an arrow key. Confirm that later results do not move focus or scroll.
6. Repeat after a filter change and after a sign-out/sign-in. Confirm that the previous account's place is not restored.

These branch checks do not authorize publication. The [preparation record](release-v0715.md) and [publication copy](releases/v0.7.15.md) remain separate from completed qualification evidence.
