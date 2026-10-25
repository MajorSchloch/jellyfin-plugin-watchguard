# v0.7.6 compatibility qualification

The runtime under test is `72d0973035cd02caafc9ba6464b3d421ec942ec9`, from current master `54e7ad8`. The [unified workflow](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/40204322776) completed successfully with `publish=false` and `proxy_matrix=true`: **all 22 integration suites plus the evidence gate passed; publication was skipped**. All suites used the same ZIP and DLL hashes below. No publication or deployment is part of this change.

| Artifact | SHA-256 |
| --- | --- |
| `Jellyfin.Plugin.WatchGuard-v0.7.6.zip` | `fb39974d66d93d56959c5b97d6b0fca77a6bc1e8b9803db17dfb56eac36c950b` |
| Packaged DLL | `c9f94ee475886b73d1ed847c7cdb8ee9a75ed7b6c10101aeb3158b3b7ac8734d` |

## Policy and negative coverage

See the [implemented compatibility policy](compatibility-capabilities.md). The real qualified Server/Web releases remain **12.2.0 and 12.3.0**. Acceptance expands only to structurally compatible patches in these two minor families. Hypothetical 12.2.1/12.3.1 and unknown-family cases are **simulations**, not qualification of real releases. .NET 10, the 12.2 dependencies and minimum catalog ABI 12.2.0.0 are retained.

Focused regression checks cover missing/changed actions, signatures and routes; added DELETE actions; absent/anonymous/changed authorization; missing or renamed query binding; an effective binder with the same full name from another assembly; missing/duplicated filters; modified final descriptors and conflicting item routes; missing runtime services, native policy/scheme/handler or startup configuration; unknown minor/major, incomplete, revision and prerelease versions. A convention match cannot activate enforcement. An attached enabled guard without final verification rejects with 503 before native continuation or interest reads; disabled mode still delegates.

Browser checks cover independent API/loader/layout/history status, a missing optional method, an optional version accessor throwing, adapter replacement, unavailable dashboard navigation, and recovery retaining the server attachment report. Real open-drawer tests inspect the capability report on both native layouts and widths. Existing security and account-isolation assertions remain in place.

Local checks: **354 backend**, **193 JavaScript**, **26 infrastructure** and **4 catalog** tests passed. A deterministic asynchronous-policy regression reproduced premature activation on the preceding runtime; readiness now remains unavailable until the policy check finishes. The [startup-readiness regression record](evidence/capabilities-v076/startup-readiness-regression.json) preserves the failing baseline and correction. Final native results are below.

## Native evidence

| Check per host | Jellyfin 12.2.0 | Jellyfin 12.3.0 |
| --- | --- | --- |
| Official direct HTTP enforcement | 77 cases passed | 77 cases passed |
| Official base-path enforcement | 77 cases passed | 77 cases passed |
| LinuxServer enforcement | 77 cases passed | 77 cases passed |
| Open drawer, both layouts | 6 cases passed; all browser capabilities verified | 6 cases passed; all browser capabilities verified |
| Filter navigation and travel | 36 transitions + 6 travel cases passed | 36 transitions + 6 travel cases passed |
| Initial-document startup / Refresh / recovery | 24 / 4 / 14 passed | 24 / 4 / 14 passed |
| Integration-page browser failure/recovery | Passed, server report retained | Passed, server report retained |
| Activity filtering, preparation, paging, polling and account isolation | Passed | Passed |

Startup observed zero Home frames. Filter transitions observed zero Home exposures, overlays, panel replacements or focus losses. Both activity suites passed initial background population, watched/unwatched and playback polling, deeper-view change-check recovery, filtering/pagination and account isolation. No hidden test retry was used.

The direct enforcement suites include Caddy, Nginx, Traefik, a tunnel-style proxy and native HTTPS, plus the separate native remote-access/known-proxy boundary. A tunnel-style fixture is not independent certification of a hosted tunnel service.

Pinned images (verified native Server/Web versions, not mutable tag assumptions):

- Official 12.2: `jellyfin/jellyfin:12.2@sha256:357724bf0ae27a672c7cbaa899db2d9abeb13dbd8657ccce750258a4c059d037`
- LinuxServer 12.2: `lscr.io/linuxserver/jellyfin:12.2ubu2604-ls53@sha256:1bb4f88d822a0510bb3604b68aacb80d77c1d2a30181e500090c65111b98723b`
- Official 12.3: `jellyfin/jellyfin:12.3@sha256:2038fe038ab3876a80f6e7b7e0aef6607b032c7dc0c9b3ad3296d0b2eba3bbb5`
- LinuxServer 12.3: `lscr.io/linuxserver/jellyfin:12.3ubu2604-ls56@sha256:4212ca390fbc6bd5002048d2d2ce2b8a5b1ad278ec4cbabe6519869117404308`

[Machine-readable qualification](evidence/capabilities-v076/qualification.json) records every suite, command, duration, tool version, image digest, tested commit and artifact checksum. Per-host files alongside it preserve native controller/binding/authorization metadata, active-enforcement checks, proxy boundaries, drawer/navigation/startup observations and activity results.

CI used .NET SDK 10.0.302, Node.js 24.22.0, Python 3.12.0, Playwright 1.56.1 and Chromium 141.0.7390.37. Local preflights used disposable data only; the definitive evidence is the unified workflow on the exact runtime commit above. Subsequent commits contain documentation/evidence only.

Integration status screenshots from the final 12.3 native fixture: [desktop](screenshots/capabilities-v076/settings-desktop.png) and [390px mobile](screenshots/capabilities-v076/settings-mobile.png). The screenshots show configured and actual active enforcement separately; navigation is correctly unavailable for inspection on the dashboard screen.

## Remaining limits

Reflection and metadata resolution establish structural readiness, not future method semantics. Unknown minor/major families require review and integration qualification. Plugin load failures before probes require server-log diagnosis. Web reports its own version; a custom bundle reporting a qualified version is not independently certified.

Incomplete interception retains the existing failure behavior: unrecognized endpoints receive no guessed guard and native deletion can remain unguarded. Attached enabled guards reject incomplete/unavailable protection. There is no server-wide blocking mechanism; external deletion tools and filesystem operations remain outside coverage. Missing optional browser support does not deactivate the server guard.

Three earlier workflow attempts, [40202030761](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/40202030761), [40202233686](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/40202233686), and [40202827556](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/40202827556), were deliberately cancelled during review for the final binder-identity, browser-diagnostic isolation and asynchronous startup-readiness corrections. They are not qualification evidence for this artifact. Historical release evidence and the published catalog remain unchanged.
