# Mobile drawer and unified qualification — v0.7.4

This follow-up starts from master `0d07009` and keeps the unpublished v0.7.4 candidate version. The public catalog still describes published v0.7.3. Historical [startup evidence](startup-validation-v074.md) remains unchanged; the follow-up is qualified separately because its embedded runtime differs.

## Reproduction and implementation

On native Jellyfin Web 12.3.0 at 390px and 600px, the old adapter appended Watchlists to Favourites' `<li>`. Both links occupied one row; the Watchlists link began at x=131.5 rather than the row’s x=0. The legacy drawer had no Watchlists entry. Baseline measurements are retained in `evidence/drawer-v074/baseline.json`.

The adapter now distinguishes the modern drawer list, legacy drawer scroll container and desktop/header navigation. It owns a sibling `<li>` in the modern drawer, and an anchor after Home in the legacy drawer. It removes only its own row/link when the layout, container or account changes. There is one owned navigation link at a time; existing reconciliation handles reopening/resizing without new timers or network requests.

Legacy styling uses the native `navMenuOption` icon/text contract. Modern styling reads a short whitelist of computed presentation properties from MUI's semantic slots: row padding/font, icon size/column width, text margin/font and selected color. It does not copy generated `css-*` classes or guess screen offsets. Native delegated click handling closes both drawers, including same-route activation. Modern Enter keydown is kept local so it produces exactly one native delegated click; otherwise the ancestor's early keydown dismissal can restore focus to the opener before activation finishes. Normal links/history, modifiers, authorization and the activity query are unchanged.

The native Web's configured custom-menu links are external-link integration, not a runtime registration point for this authenticated in-place view. This patch therefore uses explicit, tested layout adapters and native dismissal. Those DOM contracts still require qualification when Jellyfin Web changes.

## One qualification and publication gate

A single `release.yaml` dispatch builds the deterministic package once, then runs the eleven existing suites on **both** pinned versions. Every integration job downloads and checksum-verifies that same package. Evidence names include the host version to prevent collisions.

The final qualification job requires exactly 22 successful, non-retried suite reports, the requested commit, and matching package and DLL hashes. Missing hosts/suites, failures, duplicates and mixed artifacts fail the gate. Requested proxy coverage must be present for both hosts; publication always enables the full proxy matrix even if its optional dry-run input was false. Publication depends on build, the entire integration matrix and the evidence gate, still requires explicit `publish=true`, the default branch and release environment approval, and downloads the original build artifact without rebuilding it.

## Validation

The native drawer test observes the **open** drawer at 390px and 600px in both layouts, repeated opening, touch navigation, Enter activation on the current view, active state, alignment/row height/full width, overflow, breakpoint changes and desktop navigation. It asserts exactly one link and no generated classes. Existing filter transition and initial-document startup/reload observers remain in the base-path suite.

Final tested commit, checksums, screenshots and consolidated workflow results are recorded here after qualification completes.

The separate [capability-based compatibility proposal](compatibility-capabilities.md) does not change the exact-version allowlist, ABI or deletion-failure policy.
