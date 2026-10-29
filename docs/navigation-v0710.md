# WatchGuard v0.7.10 native navigation

Unpublished navigation-only patch, based on master `3ec1df3` and checksum-verified published v0.7.9. No query, storage, permission, deletion, approval, ABI or dependency changes. Public catalog and existing release packages remain unchanged.

## Reproduced cause

The Modern header reused Legacy `emby-button` presentation. At 1280px, its 14.88px/600 text and 7.44px/10.416px padding differed from native Favorites' 13.02px/500 and 6px/8px. Hover also differed (turquoise text/gray background versus native white text/white-tinted background).

Navigation was mounted by the authenticated activity runtime, then reconciled every 500ms. Initial-document observations of the published package found native navigation without Watchlists. With a 1.4-second runtime delay, arrival lag reached 1.450 seconds. Adding the Legacy sibling afterward recentered neighboring controls by as much as 60.86px. These are local Chromium measurements, not production latency estimates.

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
| Auto / Modern desktop headers | 36.8 → 0 | 33.7 → 0 | 1448.9 → 0 | 1180.0 → 0 |
| Desktop Legacy / Mobile Legacy | 28.4 → 0 | 39.9 → 0 | 1450.4 → 0 | 1204.8 → 0 |

Observed movement of the native Favorites control **when Watchlists was inserted** fell from up to 60.86px to zero in Legacy; Modern was zero before and after. The candidate had zero missing-entry frames, insertion movements or entry replacements in these local arrival observations. This does not claim zero layout movement caused by Jellyfin itself: a supplemental delayed-library-navigation inspection saw native font geometry change by 1.5px with both native and Watchlists text widths changing. We do not hide native rendering to prevent that.

The observer is installed before any entry-document script. Per-frame positions and timings are retained in [before frames](evidence/navigation-v0710/baseline-frames.json) and [after frames](evidence/navigation-v0710/after-frames.json); these are observed browser frames, not synthetic screenshots. Supplementary 2048px screenshots hold the actual authenticated runtime request until native Favorites is visible and the first frame is captured, then release it. This makes the insertion boundary visible without relying on screenshot timing. [Before](evidence/navigation-v0710/before-sequence.json) and [after](evidence/navigation-v0710/after-sequence.json) capture metadata is retained; mobile coordinate changes in those supplementary files include the native drawer slide animation, not an insertion measurement. The per-frame test above measures WatchGuard insertion separately:

| Surface | Published: initial → settled | Candidate: initial → settled |
|---|---|---|
| Modern | [Initial](screenshots/navigation-v0710/before-modern-2048-native-ready.png) · [Settled](screenshots/navigation-v0710/before-modern-2048-runtime-ready.png) | [Initial](screenshots/navigation-v0710/after-modern-2048-native-ready.png) · [Settled](screenshots/navigation-v0710/after-modern-2048-runtime-ready.png) |
| Desktop Legacy | [Initial](screenshots/navigation-v0710/before-desktop-legacy-2048-native-ready.png) · [Settled](screenshots/navigation-v0710/before-desktop-legacy-2048-runtime-ready.png) | [Initial](screenshots/navigation-v0710/after-desktop-legacy-2048-native-ready.png) · [Settled](screenshots/navigation-v0710/after-desktop-legacy-2048-runtime-ready.png) |

Additional [Modern hover](screenshots/navigation-v0710/after-modern-2048-hover.png), [selected state](screenshots/navigation-v0710/after-modern-2048-selected.png), [2048px keyboard focus](screenshots/navigation-v0710/after-modern-2048-focus.png), [390px open Modern drawer](screenshots/navigation-v0710/after-modern-390-hover.png), and [Mobile Legacy selected state](screenshots/navigation-v0710/after-mobile-legacy-390-selected.png) captures show the entry beside native controls. Legacy detail shortcuts are shown at [2048px](screenshots/navigation-v0710/after-desktop-legacy-2048-detail.png) and [390px](screenshots/navigation-v0710/after-mobile-legacy-390-detail.png). Desktop widths use Chromium mouse input; 390px uses touch emulation. These are browser tests, not physical-device tests.

## Validation

[Full unified qualification](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/40769893542) **passed** on tested commit `2fffa6cca2440dfb0f6a32f7df00256359edc429`, with `publish=false`, `proxy_matrix=true`: 20 successful jobs, 39 distinct suite reports and 54 ordered fixture commands; publication was skipped. The [strict evidence gate](evidence/navigation-v0710/qualification.json) verifies that every suite used the same commit, ZIP and runtime. The downloaded CI ZIP also matches the locally tested ZIP byte for byte.

- Package: `Jellyfin.Plugin.WatchGuard-v0.7.10.zip`
- ZIP SHA-256: `fd4e0301c312406e4ada3301e64bcb504aa29fd16c80157beb735b5ddc2b0681`
- DLL SHA-256: `5ddb76713367f3bc8f1559285db26ec68a07f188d868d095f3a721c9c6e48a95`
- Exact Server/Web versions: **12.2.0, 12.3.0, 12.4.0**, using the pinned official and LinuxServer image digests retained in the [qualification summary](evidence/navigation-v0710/summary.json).
- Workflow elapsed: **30m 58s**. [Timing evidence](evidence/navigation-v0710/timings.json) separately records combined job execution and dependency-ready-to-start delay; neither is elapsed time.

| Server/Web | Required suites | Arrival / presentation / early entry | Filter transitions | Startup / Refresh / recovery | Enforcement cases |
|---|---:|---:|---:|---:|---:|
| 12.2.0 | 13 PASS | 48 / 12 / 8 PASS | 72 PASS | 48 / 8 / 14 PASS | 231 PASS |
| 12.3.0 | 13 PASS | 48 / 12 / 8 PASS | 72 PASS | 48 / 8 / 14 PASS | 231 PASS |
| 12.4.0 | 13 PASS | 48 / 12 / 8 PASS | 72 PASS | 48 / 8 / 14 PASS | 231 PASS |

Each host additionally passed eight native shell cases, 12 open-drawer cases, six Legacy detail-shortcut cases, four native catalog cases, activity/polling and the existing migration, approval, permission, account-isolation and proxy/base-path regressions. Arrival checks observed zero missing-entry frames, insertion movements and replacements; early entry exposed zero Home frames. The navigation scenario now executes these initial-document and presentation checks alongside all prior assertions. [Per-host evidence](evidence/navigation-v0710/summary.json) and the workflow artifacts retain the underlying results. Retained CI screenshots show [12.2 Modern desktop](screenshots/navigation-v0710/ci-12.2-modern-2048-selected.png), [12.3 Modern mobile drawer](screenshots/navigation-v0710/ci-12.3-modern-390-selected.png), and [12.4 Mobile Legacy](screenshots/navigation-v0710/ci-12.4-mobile-legacy-390-warm-settled.png). Subsequent PR changes are evidence/documentation only.

Local checks: 376 backend, 199 JavaScript, 37 infrastructure and 8 catalog tests passed. Native cases passed: [shell 8](evidence/navigation-v0710/local-shell.json), [open drawer 12](evidence/navigation-v0710/local-drawer.json), [filter/history 72](evidence/navigation-v0710/local-filter-history.json), [arrival 48 + presentation 12 + early entry 8](evidence/navigation-v0710/local-arrival.json), and [startup 48 + Refresh 8 + failure recovery 14](evidence/navigation-v0710/local-startup.json). The early-entry checks hold the real authenticated runtime request until after clicking the new link and assert zero exposed Home frames. A presentation-reconciliation check changes a native class and verifies propagation without copying IDs, tab indices or transient state, retaining the same owned anchor.

The [first qualification run](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/40754606666) is not qualifying evidence. Its 12.3 Caddy browser setup encountered `ERR_NETWORK_CHANGED`, leaving untranslated login labels before authentication. [Preserved failure record](evidence/navigation-v0710/superseded-run.json). The existing single pre-authentication network recovery now detects interrupted resources even when a form exists, preserving its first failure trace. Persistent interruption and any authentication/deletion failure still fail without retry. That fixture correction did not change the runtime/package. The next run then caught a missing Legacy detail-page shortcut on all three hosts; [that failure and correction are preserved separately](evidence/navigation-v0710/navigation-failed-run.json). The shortcut is restored using native icon-button styling, and the new focused regression includes native geometry, keyboard activation and Back. A third run was stopped after supplemental local state comparisons exposed active Favorites styling leaking into inactive Watchlists; [the correction is recorded](evidence/navigation-v0710/presentation-superseded-run.json). The final harness compares native selected/hover states, direct Favorites entry, mouse versus touch input, and a clearly labelled simulation with neutral native peers temporarily absent. The subsequent [Linux input-mode failure](evidence/navigation-v0710/input-context-failed-run.json) correctly rejected desktop comparisons after CDP touch toggling left hover disabled. An [isolated pinned-image probe](evidence/navigation-v0710/linux-input-probe.json) reproduced this browser behavior. The harness now uses dedicated mouse and touch contexts, preserving all interaction assertions; the runtime package is unchanged by that fixture correction. All 48 arrivals, 12 interactions and eight early entries also passed in a [supplemental native run inside the pinned Linux browser image](evidence/navigation-v0710/local-linux-arrival.json) before restarting full qualification. The final matrix above passed for the corrected package, with no cross-run evidence promotion.

## Remaining integration limits

Jellyfin Web exposes no supported runtime API for registering these navigation entries. This is explicit DOM integration with recognized semantic slots, revalidated on each supported Web version. Custom themes or future Web layouts can require new validation. If a recognized slot is absent, the shell does not guess a placement.

Native React/MUI owns its animated touch ripples. WatchGuard shares presentation classes and supplies a visible keyboard-focus outline without cloning event behavior or installing another runtime. Under CSP that blocks inline scripts, the authenticated fallback remains usable but early first-paint insertion cannot be guaranteed. The patch does not hide native navigation to conceal that limitation.

## Other UI surfaces: follow-ups only

- Detail add/remove actions and the native action sheet already use Jellyfin icon/button structures. Audit focus/disabled/error contrast across themes; no action changes here.
- Activity cards, filters and disclosures retain the v0.7.1 usability work. A separate pass could replace remaining hardcoded colors with theme variables and compare dense multi-user layouts against native cards.
- Watchlists loading, stale playback and coverage messages remain explicit. Review their typography against each modern theme separately from query/polling behavior.
- Deletion/approval dialogs and Integration settings should receive a dedicated native spacing and keyboard review. Their protection wording and enforcement behavior are unchanged.
