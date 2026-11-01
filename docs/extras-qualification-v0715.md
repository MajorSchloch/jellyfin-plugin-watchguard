# v0.7.15 extras qualification investigation

This is a test-only change. The v0.7.15 runtime, version, published catalog, release assets, workflow requirements and token permissions are unchanged.

The [failed qualification](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/41336407691/attempts/1) tested commit `7c63b26afb2215130c12a479915ffb361abfd8bc`. Job `124937483105` passed the desktop extras check, then timed out on the 390px check for BrowserMember on **PoC Parent Clear**. Artifact `13095637537` shows “No matches for these filters.” Its trace does not contain the ActivityBrowser response.

The exact cause of that CI response remains unconfirmed. The [unmodified local sequence](evidence/extras-qualification-v0715/baseline/extras-activity.json), with diagnostics added, passed on the pinned 12.3 `/jellyfin` fixture. Both Refresh clicks issued `refresh=true`. Playwright waited for the initially disabled control. Both indexed results agreed with the fresh APIs: Caught Up, 3/3 aired episodes, one future unwatched extra. No fixture data changed between those desktop and mobile iterations.

A separate controlled experiment confirmed a test synchronization defect. A native metadata update invalidated the index without changing the expected episode classification. The accepted Refresh returned HTTP 200 with an empty target result, `PendingVerification` and `PopulationPending=true`. The old `aria-busy=false` condition succeeded. The extras assertion then timed out before the next normal poll. Fresh ActivityOverview and SeriesActivity results still reported Caught Up and 3/3 +1. See the [captured responses and fresh classification](evidence/extras-qualification-v0715/controlled-baseline/extras-activity.json).

This controlled response differs from the original screenshot's plain empty state. It establishes the synchronization defect, not the missing original response. No incorrect current indexed classification was demonstrated. An unexplained empty result must still fail.

The revised check waits for an enabled Refresh control and observes its actual `refresh=true` response. It verifies the exact title/member IDs, Caught Up reason, 3/3 aired counts, and one future unwatched extra. Only a response with both pending-verification signals permits a wait for one normal 30-second UI poll. The 45-second bound covers that scheduled poll; it does not change the existing card timeout. The first matching poll response is checked, even if wrong. There are no repeated Refresh clicks, repeat-until-success requests, or server response substitutions.

The browser fixture retains the ordinary 1280px and 390px checks. A separate third iteration holds initial loading, activates Refresh with a real pointer while disabled, and verifies that it issues no extra refresh. It then re-saves identical native playback data to invalidate the target row. The real pending response is held until native verification completes. The page must recover through its normal poll, with all original extras, focus, poster identity, overflow, membership, permission and deletion assertions intact.

`extras-activity.json` is written before assertions. It contains the selected query fields, response status, target-only results, coverage flags, index freshness and fresh on-demand classification. It records Refresh acceptance and UI state. Credentials, request headers, continuation values, opaque browser revisions and unrelated titles are excluded. Unit tests also verify this projection.

A development version of the new delay fixture removed interception before it fulfilled the held request. That run failed with `Route is already handled`. Cleanup now occurs after the controlled flow. It is recorded as a development failure, not a passing validation result.

Final native validation tested commit `63c6cc71e920bfaf9e179e4d7c97e5c4b4cd9f2f`. The complete `/jellyfin --proxy` browser fixtures passed on Server/Web 12.3.0 and 12.4.0, including their remaining security and uninstall checks. Elapsed times were 443.937 and 443.841 seconds. Fast checks passed: 304 JavaScript, 376 .NET, 120 Python and eight catalog tests.

Validation results and exact identities are retained in [validation.json](evidence/extras-qualification-v0715/validation.json). The package matches artifact `13094943539` from the failed qualification:

- ZIP SHA-256: `40b81b2b0ec716b3834085a31d7eab3ed4f9752e3b54a9307333462976897db2`
- DLL SHA-256: `545c591ef8bc1926f03122ab75c89fbd490876a34e942d4d8c042a2ebbd9a834`

The package and its sidecar were verified before fixture use. Deterministic packaging reproduced the same ZIP. The packaged ES2019 checks cover all five browser assets, settings inline code and startup concatenation. No runtime change warrants a new return-position or Chromium 79 native run for this PR. The existing qualification policy remains blocking and runs automatically after merge; these focused checks are not a release qualification record.

The controlled UI was still empty after native verification finished. One ordinary poll restored the target after 30.047 seconds on 12.3 and 30.026 seconds on 12.4. Each controlled case issued exactly one accepted Refresh. The original two viewport iterations still run without intervening fixture mutations.

| 12.3: response completed, background snapshot still pending | 12.3: first ordinary poll restored 3/3 +1 |
| --- | --- |
| ![Pending verification](evidence/extras-qualification-v0715/12.3/extra-card-390-pending.png) | ![Extras available after poll](evidence/extras-qualification-v0715/12.3/extra-card-390-delayed.png) |

The [12.4 response record](evidence/extras-qualification-v0715/12.4/extras-activity.json) and [screenshot](evidence/extras-qualification-v0715/12.4/extra-card-390-delayed.png) show the same sequence. These are local headless Chromium 141.0.7390.37 tests with locked Playwright 1.56.1 on macOS arm64. They are not physical-TV tests or a complete CI qualification. The local Node version was 25.9.0; the unchanged CI environment uses its pinned Node version.
