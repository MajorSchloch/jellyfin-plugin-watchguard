# WatchGuard v0.7.10 native navigation

Unpublished navigation-only patch, based on master `3ec1df3` and checksum-verified published v0.7.9. No query, storage, permission, deletion, approval, ABI or dependency changes. Public catalog and existing release packages remain unchanged.

## Reproduced cause

The Modern header reused Legacy `emby-button` presentation. At 1280px, its 14.88px/600 text and 7.44px/10.416px padding differed from native Favorites' 13.02px/500 and 6px/8px. Hover also differed (turquoise text/gray background versus native white text/white-tinted background).

Navigation was mounted by the authenticated activity runtime, then reconciled every 500ms. Initial-document observations of the published package found native navigation without Watchlists. With a 1.4-second runtime delay, arrival lag reached 1.447 seconds. Adding the Legacy sibling afterward recentered neighboring controls by as much as 60.86px. These are local Chromium measurements, not production latency estimates.

## Implementation

A small static navigation module runs from the existing entry-document injection. It reads authenticated native ApiClient identity and recognized rendered navigation slots, and adds links during the native DOM commit, before the next paint. It makes no requests, reads no activity or user directory, and claims no protection status. Native DOM commits also wake bootstrap readiness on Home; the existing bounded fallback remains for auth changes without DOM events.

The authenticated runtime includes the same idempotent module as a fallback when inline scripting is disallowed. CSP is unchanged. Its connection to the shell mounts Watchlists immediately when runtime prerequisites are ready. Early navigation into Watchlists uses the existing exact-route startup handoff, including timeout, failure and navigation-away recovery. An early-entry test also exposed Legacy’s bubbling DIV `pagehide`: it previously dismissed the handoff as though the document had unloaded. Only actual document/window lifecycle events now do so. Home and other native pages are never covered to conceal navigation arrival.

Modern buttons and drawer entries use presentation classes from verified rendered native navigation and its semantic MUI icon/text slots. Header buttons use a neutral native color variant; selecting Favorites must not transfer its active generated class to inactive Watchlists. If no neutral peer exists, a scoped theme fallback retains native structural measurements until one is available. Mouse hover uses native primary-color opacity, while touch layouts suppress hover styling as Jellyfin does. Generated classes are discovered from that verified element, never hardcoded. Owned SVG bookmark paths replace the native icon; IDs, React handlers, tab indices, ripple children and transient state classes are not cloned. Theme-variable CSS supplies selected/focus fallbacks. Legacy indexed tab handling remains native. Detail and library pages retain a separate icon-button shortcut beside native Home, with a Watchlists tooltip and accessible name.

Each surface retains its owned anchor across ordinary reconciliation and responsive reattachment. Opening a drawer does not relocate a header link. Class reconciliation changes attributes only when necessary; the observer ignores owned changes and activity/card mutations. The existing runtime identity fence and poll limits are unchanged. Filter/history behavior is unchanged.

## Before/after observations

[Published baseline](evidence/navigation-v0710/baseline.json) and [local candidate](evidence/navigation-v0710/local-arrival.json) use native Jellyfin Server/Web 12.4.0. The published ZIP was verified as SHA-256 `75caecd64bcd3b8137ba33e199ab04fc75c0becfd613cd8904cde95cd8239c6a` before fixture installation. Each captures 48 document arrivals (four layouts × three widths × four startup conditions), plus 12 normal/hover/focus/selected comparisons. Modern mobile appropriately puts Watchlists in its drawer, not a desktop header row; drawer frames are observed when it opens.

Maximum delay from first native header paint to Watchlists, in milliseconds:

| Layout group | Warm cache: before → after | Cold cache: before → after | Delayed runtime: before → after | Delayed bootstrap: before → after |
|---|---:|---:|---:|---:|
| Auto / Modern desktop headers | 33.7 → 0 | 42.6 → 0 | 1445.9 → 0 | 1217.2 → 0 |
| Desktop Legacy / Mobile Legacy | 33.1 → 0 | 37.5 → 0 | 1447.1 → 0 | 1234.3 → 0 |

Observed movement of the native Favorites control **when Watchlists was inserted** fell from up to 60.86px to zero in Legacy; Modern was zero before and after. The candidate had zero missing-entry frames, insertion movements or entry replacements in these local arrival observations. This does not claim zero layout movement caused by Jellyfin itself: a supplemental delayed-library-navigation inspection saw native font geometry change by 1.5px with both native and Watchlists text widths changing. We do not hide native rendering to prevent that.

The observer is installed before any entry-document script. Per-frame positions and timings are retained in [before frames](evidence/navigation-v0710/baseline-frames.json) and [after frames](evidence/navigation-v0710/after-frames.json); these are observed browser frames, not synthetic screenshots. Representative 2048px frame sequences show the native header while the runtime is delayed, then after it loads:

| Surface | Published: initial → settled | Candidate: initial → settled |
|---|---|---|
| Modern | [Initial](screenshots/navigation-v0710/before-modern-2048-slow-runtime-arrival.png) · [Settled](screenshots/navigation-v0710/before-modern-2048-slow-runtime-settled.png) | [Initial](screenshots/navigation-v0710/after-modern-2048-slow-runtime-arrival.png) · [Settled](screenshots/navigation-v0710/after-modern-2048-slow-runtime-settled.png) |
| Desktop Legacy | [Initial](screenshots/navigation-v0710/before-desktop-legacy-2048-slow-runtime-arrival.png) · [Settled](screenshots/navigation-v0710/before-desktop-legacy-2048-slow-runtime-settled.png) | [Initial](screenshots/navigation-v0710/after-desktop-legacy-2048-slow-runtime-arrival.png) · [Settled](screenshots/navigation-v0710/after-desktop-legacy-2048-slow-runtime-settled.png) |

Additional [2048px keyboard focus](screenshots/navigation-v0710/after-modern-2048-focus.png), [390px open Modern drawer](screenshots/navigation-v0710/after-modern-390-hover.png), and [Mobile Legacy selected state](screenshots/navigation-v0710/after-mobile-legacy-390-selected.png) captures show the entry beside native controls. Legacy detail shortcuts are shown at [2048px](screenshots/navigation-v0710/after-desktop-legacy-2048-detail.png) and [390px](screenshots/navigation-v0710/after-mobile-legacy-390-detail.png). Desktop widths use Chromium mouse input; 390px uses touch emulation. These are browser tests, not physical-device tests.

## Validation

Final qualification and artifact identity will be recorded here after the three-version workflow completes. The unified workflow still requires all 39 suite reports and one exact candidate package, with `publish=false`, `proxy_matrix=true`. The navigation scenario additionally executes initial-document arrival and presentation regressions. Existing scenario ordering and safety assertions remain required.

Local checks: 376 backend, 199 JavaScript, 37 infrastructure and 8 catalog tests passed. Native cases passed: [shell 8](evidence/navigation-v0710/local-shell.json), [open drawer 12](evidence/navigation-v0710/local-drawer.json), [filter/history 72](evidence/navigation-v0710/local-filter-history.json), [arrival 48 + presentation 12 + early entry 8](evidence/navigation-v0710/local-arrival.json), and [startup 48 + Refresh 8 + failure recovery 14](evidence/navigation-v0710/local-startup.json). The early-entry checks hold the real authenticated runtime request until after clicking the new link and assert zero exposed Home frames. A presentation-reconciliation check changes a native class and verifies propagation without copying IDs, tab indices or transient state, retaining the same owned anchor.

The [first qualification run](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/40754606666) is not qualifying evidence. Its 12.3 Caddy browser setup encountered `ERR_NETWORK_CHANGED`, leaving untranslated login labels before authentication. [Preserved failure record](evidence/navigation-v0710/superseded-run.json). The existing single pre-authentication network recovery now detects interrupted resources even when a form exists, preserving its first failure trace. Persistent interruption and any authentication/deletion failure still fail without retry. That fixture correction did not change the runtime/package. The next run then caught a missing Legacy detail-page shortcut on all three hosts; [that failure and correction are preserved separately](evidence/navigation-v0710/navigation-failed-run.json). The shortcut is restored using native icon-button styling, and the new focused regression includes native geometry, keyboard activation and Back. A third run was stopped after supplemental local state comparisons exposed active Favorites styling leaking into inactive Watchlists; [the correction is recorded](evidence/navigation-v0710/presentation-superseded-run.json). The final harness compares native selected/hover states, direct Favorites entry, mouse versus touch input, and a clearly labelled simulation with neutral native peers temporarily absent. The entire matrix is rerun for the corrected package, with no cross-run evidence promotion.

## Remaining integration limits

Jellyfin Web exposes no supported runtime API for registering these navigation entries. This is explicit DOM integration with recognized semantic slots, revalidated on each supported Web version. Custom themes or future Web layouts can require new validation. If a recognized slot is absent, the shell does not guess a placement.

Native React/MUI owns its animated touch ripples. WatchGuard shares presentation classes and supplies a visible keyboard-focus outline without cloning event behavior or installing another runtime. Under CSP that blocks inline scripts, the authenticated fallback remains usable but early first-paint insertion cannot be guaranteed. The patch does not hide native navigation to conceal that limitation.

## Other UI surfaces: follow-ups only

- Detail add/remove actions and the native action sheet already use Jellyfin icon/button structures. Audit focus/disabled/error contrast across themes; no action changes here.
- Activity cards, filters and disclosures retain the v0.7.1 usability work. A separate pass could replace remaining hardcoded colors with theme variables and compare dense multi-user layouts against native cards.
- Watchlists loading, stale playback and coverage messages remain explicit. Review their typography against each modern theme separately from query/polling behavior.
- Deletion/approval dialogs and Integration settings should receive a dedicated native spacing and keyboard review. Their protection wording and enforcement behavior are unchanged.
