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

The local fixture passes all six open-drawer cases, two desktop layouts and breakpoint transitions. All 36 native filter transitions and six history/navigation travel cases pass, with no Home exposure, panel replacement, unexpected overlay or focus loss. The startup suite passes 24 initial-document scenarios with zero Home-visible frames, four Refresh scenarios and 14 recovery scenarios. Fast checks pass: 321 backend tests, 191 JavaScript tests, 26 infrastructure tests and four catalog tests.

[Consolidated qualification run 40081087661](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/40081087661) **passed** with `publish=false`, `proxy_matrix=true` on runtime commit **`ef982ccfb2211ebcca597edd094fa3756660bf2f`**. The build, all 22 integration jobs and the final evidence gate passed; publication was skipped. Subsequent changes are documentation/evidence only.

| Native Server / Web | Integration suites | Open-drawer cases | Filter transitions | Startup / Refresh / recovery |
| --- | --- | --- | --- | --- |
| 12.2.0 / 12.2.0 | 11 PASS | 6 PASS | 36 PASS | 24 / 4 / 14 PASS |
| 12.3.0 / 12.3.0 | 11 PASS | 6 PASS | 36 PASS | 24 / 4 / 14 PASS |

Both hosts recorded zero Home-visible startup frames, zero filter-transition Home exposure, unexpected overlays, panel replacements or focus losses. Both official and LinuxServer enforcement fixtures passed; both full proxy/security matrices passed. Activity population, filtering/pagination, watched-state and playback polling, deeper-view recovery and account-isolation assertions also passed.

The single package is `Jellyfin.Plugin.WatchGuard-v0.7.4.zip`:

- ZIP SHA-256: `6d1a6ac52b3dbc2c8e677ca2c52f9a9140c40166b2a95787923eed3c68b035a1`
- DLL SHA-256: `3cca83c537f0962f7e7444a5a53a359c903deaf7637dfdd4b513f82d25761374`

CI and local package bytes match. The [consolidated evidence](evidence/drawer-v074/qualification.json) records all suite commands/outcomes, timings, tested commit, immutable official/LinuxServer image digests, native Server/Web versions and job URLs. Version-specific drawer/navigation/startup reports and local baseline reports are retained beside it. The initial-document startup observers remain unchanged. No merge, publication or deployment was performed.

| Baseline, modern 390px | Corrected modern 390px | Corrected legacy 390px |
| --- | --- | --- |
| ![Baseline shared row](screenshots/drawer-v074/before-modern-390.png) | ![Separate active row](screenshots/drawer-v074/after-modern-390.png) | ![Legacy drawer entry](screenshots/drawer-v074/after-legacy-390.png) |

[Desktop screenshot](screenshots/drawer-v074/desktop-modern.png). Chromium is the qualified browser; other browser engines and arbitrary custom themes remain unqualified. No new compatibility policy is enabled.

The separate [capability-based compatibility proposal](compatibility-capabilities.md) does not change the exact-version allowlist, ABI or deletion-failure policy.
