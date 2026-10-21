# Activity browser usability — v0.7.1 qualification

Unpublished candidate based on published v0.7.0 at master `70c5c7d`.
Final runtime and fixture commit: `372f7c7172d8b08581131ec3dadb49ab5fba683e`.
[Full qualification](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/39644129864)
passed its build and all eleven integration suites with `publish=false` and
`proxy_matrix=true`; publication was skipped. The later evidence commit changes
only documentation and screenshots. [Machine-readable provenance](evidence/activity-browser-v071/qualification.json)
records the exact tested commit, jobs, artifacts and screenshot checksums.

Candidate ZIP SHA-256:
`63044644339d9db93f45cb936dc93de17517c5a2c1a6854bc45b32b367058424`.
The local and downloaded CI packages match. CI's deterministic rebuild also
passes. The ZIP contains only the plugin DLL and LICENSE; the web adapter is
embedded. The public catalog is unchanged.

The qualification build passes 288 backend tests, 166 JavaScript tests, 19 Python
infrastructure checks and four catalog tests. Fixtures use Jellyfin Server/Web
12.2.0, .NET SDK 10.0.302, Node 24.22.0, Python 3.12.0 and Playwright 1.56.1 on
disposable Ubuntu runners with the existing digest-pinned images.

## User-visible behavior

Search, owner, status and sorting remain directly available. On a 390px screen,
the date controls share a compact disclosure whose summary shows the selected
window and whether older current interest is included. Result count and state
replace repeated coverage prose. About these results contains the complete
server explanation and the scope of title search: known activity/watchlists,
not an exhaustive library search. Coverage warnings and recovery actions
stay visible outside that disclosure.

The screen distinguishes initial loading, preliminary watchlists, background
population, updating/checking, preparation paused after four requests, updates
available, expiry and update failure with retained cards. An empty known result
and an empty status selection have separate presentations. No response timestamp
is described as verification time, and the opaque revision is never converted
to a timestamp. A deduplicated live region announces settled result/status
changes; unchanged routine polls do not reannounce the screen.

Cards show two user rows initially and offer a native details/summary expansion
for additional people. Names wrap, rows have no internal scrolling, status icons
retain accessible labels, and dates explicitly say Added and Last played.
Date disclosures expose exact localized timestamps and preserve unknown added
dates. Per-user rows and disclosures are reused when data changes. Episode
extras retain the existing keyboard/touch dialog and aired-versus-future/uncertain
classification. Retained playback state stays visibly labelled as potentially
stale, with contrast independent of the surrounding theme.

## Preserved boundaries

Expanding coverage, dates or additional people adds no server request. Server
query, sorting, scope,
status OR semantics, Watching/Caught Up, authorization and personal data formats
are unchanged. The four-request automatic preparation ceiling, ordinary manual
pagination, 30-second visible-page polling, deeper-view comparisons, hidden-page
pausing, serialized requests, generation fencing and 401/403 clearing remain in
place. No deletion, approval, Protection, GUID or ABI changes are included.

The public v0.7.0 description was edited as text only, with absolute links.
[Recorded metadata checks](evidence/activity-browser-v071/published-v070-description-edit.json)
verify unchanged tag and assets. Publication-ready copy is now separate from
[preparation status](../release-preparation.md), and the workflow validates its
version, absolute documentation links and absence of preparation instructions.
The public catalog and historical qualification evidence remain unchanged.

## Validation scope and limitations

Focused tests cover persistent seven-user/date expansion, native date values,
unchanged-poll announcements, owner-option identity, pluralization and distinct
empty/paused/error recovery states. Existing security and query-race assertions
remain enabled. Native qualification also exercises actual background population,
watched/unwatched updates, playback start/stop, multi-request preparation and
stable deeper-page updates, plus 390px/desktop layout and episode extras.

Known coverage remains partial. Long expanded user lists increase the card's
height; they deliberately use the page's scrolling instead of a nested scrollbar.
Default cards display two people, so additional owners require expansion. Exact
dates require expanding the date disclosure. Snapshot and polling limitations
remain those of v0.7.0. Native fixture measurements describe disposable test
libraries, not a production-library or assistive-technology compatibility audit.

## Actual native browser behavior

[Native browser responses](evidence/activity-browser-v071/native-browser.json)
record every ActivityBrowser request, including preparation. The adapter runs
against real native user data and sessions. Browser ready times below are single
observations, including navigation/control handling, search debounce where
applicable, membership preview and rendering readiness. Counts include only
ActivityBrowser requests; account/bootstrap, membership and fixture-management
requests are excluded. A ready page may contain fewer than 25 titles because
ordinary pagination is never downloaded automatically to fill it.

| Operation | Ready (ms) | Query requests | Preparing responses | Titles |
| --- | ---: | ---: | ---: | ---: |
| initial background population | 339 | 2 | 1 | 9 |
| search | 433 | 1 | 0 | 1 |
| automatic multi-request preparation | 509 | 2 | 1 | 23 |
| native watched and unwatched polling | 109 | 1 | 0 | 1 |
| native playback start and stop | 113 | 1 | 0 | 0 |
| deeper view authorized changes | 246 | 2 | 1 | 23 |
| Open seven-user title | 145 | 1 | 0 | 1 |
| Open playing title before induced update failure | 113 | 1 | 0 | 1 |

Initial population changed 9 → 23 displayed titles without
Refresh. Observing the fixture through background verification took
274.0 s; this is not the time to the first newly populated card.
Native watched/unwatched and playback start/stop mutations updated through
30-second polling. After Load more, 47 distinct titles retained their
order, first poster and scrollTop 400; an authorized change check offered
Updates available, with retained playback explicitly labelled as potentially stale.

Seven-user and long-name checks pass. User/date expansion, keyboard focus and the
poster survive a real routine poll. Expanding presentation controls makes zero
additional query requests. At 390px the single-title, seven-user capture starts
the first card at 377.0px, without horizontal or nested card scrolling.
The induced update transport failure retains the existing card and a readable
stale playback label. Empty results have a distinct presentation.

[The basepath browser report](evidence/activity-browser-v071/native-basepath-browser.json)
also covers preliminary membership, coverage warnings, literal unsafe names,
light colors, 44px controls, future/uncertain episode details, account switching,
permissions and deletion assertions. Focused tests cover paused preparation,
expiry, unselected statuses and overlapping request cancellation. The previous
run failed because the new fixture assumed an owner disclosure was closed even
though it had correctly retained its expanded state from a previous view. The
corrected fixture explicitly checks keyboard close/open and is included in the
successful run above; the failed run is not counted as completed qualification.

## Native API measurements

The existing regression benchmark still compares against the checksum-verified
published v0.6.0 package in the same mixed fixture: 120 movies, one 300-episode
series, six viewing accounts plus the administrator, six explicit memberships
and one live owner. This is a repeated query regression measurement, not a claim
that this UI pass makes v0.7.0 server queries faster. Server query code is unchanged.
Each scenario has one warm-up and three sequential samples. First ordered page
includes preparation requests. HTTP timings exclude browser paint and the
optional preliminary membership request. The baseline needs complete index
pagination plus membership/filter/sort work to produce a global answer; the
candidate browser does not implement that baseline workaround.

Median milliseconds:

| Query | Titles | v0.6 global answer / complete | v0.7.1 first ordered page | v0.7.1 complete | First / all candidate requests |
| --- | ---: | ---: | ---: | ---: | ---: |
| All owners · Title | 122 | 227.2 | 106.4 | 266.4 | 2 / 6 |
| One owner · Playback recency | 121 | 139.3 | 23.1 | 118.2 | 1 / 5 |
| Watchlisted · Recently added | 3 | 229.0 | 27.5 | 27.5 | 1 / 1 |
| Watched · title search | 1 | 221.6 | 35.6 | 35.6 | 1 / 1 |
| Watching · Playback recency | 1 | 217.0 | 47.1 | 47.2 | 1 / 1 |
| Currently playing · Title | 1 | 216.8 | 18.2 | 18.2 | 1 / 1 |

[Raw samples and work counters](evidence/activity-browser-v071/native-comparison.json)
include the baseline raw-first-page timing, preparation responses, authorized
pair resolutions and episode visibility queries/rows. The baseline does not
expose a pair-resolution counter; its zero in that field means unavailable.
Both versions trigger zero playback classification batches during the measured warm scenarios. The native
permission-revocation continuation check passes. These are single-client warm
fixture timings, not a load test or production-library forecast. Initial
background population is outside the warm API timings and is observed separately
by the browser test above. The existing snapshot, authorization and work ceilings
are unchanged; see the [v0.7.0 query contract](activity-browser-v070.md).

## Native captures

These captures use the embedded adapter in disposable Jellyfin Server/Web 12.2.0
fixtures. The existing v0.7.0 captures remain unchanged. At 390px the ordinary
v0.7.1 overview places the first posters about 376px from the top, compared with
about 618px in the retained v0.7.0 mobile capture. These are different fixture
views, so the comparison describes the toolbar/result area rather than card data.
Warnings deliberately use additional space when relevant.

| Native view | Capture |
| --- | --- |
| Compact mobile controls and concise result count | [390px overview](screenshots/v0.7.1/overview-390.png) |
| Readable desktop rows and labelled dates | [1280px overview](screenshots/v0.7.1/overview-1280.png) |
| Preliminary memberships while activity is held | [Preliminary loading](screenshots/v0.7.1/preliminary-1280.png) |
| Future episode separate from aired progress | [Touch episode dialog](screenshots/v0.7.1/episode-extras-390.png) |
| Coverage warning remains visible; long unsafe text is literal | [Mobile coverage warning](screenshots/v0.7.1/coverage-warning-390.png) |
| Native light palette and visible focus | [Light overview](screenshots/v0.7.1/light-1280.png) |
| Seven users, persistent expanded people/dates | [Desktop](screenshots/v0.7.1/people-1280.png), [390px](screenshots/v0.7.1/people-390.png) |
| Definite empty selected result | [Empty view](screenshots/v0.7.1/empty-1280.png) |
| Deep view retains ordering and offers refresh | [Updates available](screenshots/v0.7.1/updates-1280.png) |
| Failed update retains card and stale playback explanation | [Mobile failure](screenshots/v0.7.1/failed-390.png) |

The basepath fixture deliberately holds the activity response for the preliminary
capture and injects coverage/name presentation cases; its native episode and
membership actions still use the disposable server. The activity-index fixture
uses real native activity and session mutations for automatic-update checks.
An update failure is induced by aborting a browser request, retaining the last
successful native result. These distinctions matter: presentation fixtures do
not constitute additional server authorization evidence.
