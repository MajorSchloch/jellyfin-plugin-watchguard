# WatchGuard v0.7.10 native navigation

Unpublished navigation-only patch, based on master `3ec1df3` and checksum-verified published v0.7.9. No query, storage, permission, deletion, approval, ABI or dependency changes. Public catalog and existing release packages remain unchanged.

## Reproduced cause

The Modern header reused Legacy `emby-button` presentation. At 1280px, its 14.88px/600 text and 7.44px/10.416px padding differed from native Favorites' 13.02px/500 and 6px/8px. Hover also differed (turquoise text/gray background versus native white text/white-tinted background).

Navigation was mounted by the authenticated activity runtime, then reconciled every 500ms. Initial-document observations of the published package found native navigation without Watchlists. With a 1.4-second runtime delay, arrival lag reached 1.459 seconds. Adding the Legacy sibling afterward recentered neighboring controls by as much as 60.86px. These are local Chromium measurements, not production latency estimates.

## Implementation

A small static navigation module runs from the existing entry-document injection. It reads authenticated native ApiClient identity and recognized rendered navigation slots, and adds links during the native DOM commit, before the next paint. It makes no requests, reads no activity or user directory, and claims no protection status. Native DOM commits also wake bootstrap readiness on Home; the existing bounded fallback remains for auth changes without DOM events.

The authenticated runtime includes the same idempotent module as a fallback when inline scripting is disallowed. CSP is unchanged. Its connection to the shell mounts Watchlists immediately when runtime prerequisites are ready. Early navigation into Watchlists uses the existing exact-route startup handoff, including timeout, failure and navigation-away recovery. An early-entry test also exposed Legacy’s bubbling DIV `pagehide`: it previously dismissed the handoff as though the document had unloaded. Only actual document/window lifecycle events now do so. Home and other native pages are never covered to conceal navigation arrival.

Modern buttons and drawer entries use presentation classes from the rendered native Favorites link and its semantic MUI icon/text slots. Generated classes are discovered from that verified element, never hardcoded. Owned SVG bookmark paths replace the native icon; IDs, React handlers, tab indices, ripple children and transient state classes are not cloned. Theme-variable CSS supplies selected/focus fallbacks. Legacy indexed tab handling remains native.

Each surface retains its owned anchor across ordinary reconciliation and responsive reattachment. Opening a drawer does not relocate a header link. Class reconciliation changes attributes only when necessary; the observer ignores owned changes and activity/card mutations. The existing runtime identity fence and poll limits are unchanged. Filter/history behavior is unchanged.

## Validation

Final qualification and artifact identity will be recorded here after the three-version workflow completes. The unified workflow still requires all 39 suite reports and one exact candidate package, with `publish=false`, `proxy_matrix=true`. The navigation scenario additionally executes initial-document arrival and presentation regressions.

Coverage includes Auto, Modern, Desktop Legacy and Mobile Legacy at 390px, 1280px and 2048px; warm/cold cache, delayed bootstrap/runtime delivery, native hover/focus/selected states and responsive identity. Existing open-drawer, direct-link, reload, filter/history, account isolation, startup recovery and activity suites remain required on Server/Web 12.2.0, 12.3.0 and 12.4.0. Browser measurements use Chromium viewport/touch emulation, not physical devices.

## Remaining integration limits

Jellyfin Web exposes no supported runtime API for registering these navigation entries. This is explicit DOM integration with recognized semantic slots, revalidated on each supported Web version. Custom themes or future Web layouts can require new validation. If a recognized slot is absent, the shell does not guess a placement.

Native React/MUI owns its animated touch ripples. WatchGuard shares presentation classes and supplies a visible keyboard-focus outline without cloning event behavior or installing another runtime. Under CSP that blocks inline scripts, the authenticated fallback remains usable but early first-paint insertion cannot be guaranteed. The patch does not hide native navigation to conceal that limitation.

## Other UI surfaces: follow-ups only

- Detail add/remove actions and the native action sheet already use Jellyfin icon/button structures. Audit focus/disabled/error contrast across themes; no action changes here.
- Activity cards, filters and disclosures retain the v0.7.1 usability work. A separate pass could replace remaining hardcoded colors with theme variables and compare dense multi-user layouts against native cards.
- Watchlists loading, stale playback and coverage messages remain explicit. Review their typography against each modern theme separately from query/polling behavior.
- Deletion/approval dialogs and Integration settings should receive a dedicated native spacing and keyboard review. Their protection wording and enforcement behavior are unchanged.
