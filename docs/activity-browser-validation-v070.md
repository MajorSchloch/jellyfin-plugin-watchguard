# Activity browser v0.7.0 qualification

Unpublished candidate; no merge, release, catalog update or deployment.

## Reproducible candidate

The implementation and fixture commit qualified by this run is
`38271c552b075a589b7caa84eb96cae9462f596c`.
[Full qualification](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/39464779136)
passed its build and all eleven integration suites with `publish=false` and
`proxy_matrix=true`; publication was skipped. The later evidence commit changes
only documentation and screenshots. [Machine-readable provenance](evidence/activity-browser-v070/qualification.json)
records the jobs, artifacts and checksums.

Candidate ZIP SHA-256:
`99e97d991cd16fa8313c68d632601abd7d8ffdbd4a8d971a7bf9d56aadd5a0c7`.
The local build and downloaded CI package have identical checksums. CI also
rebuilds the package and compares checksums. The archive contains only the plugin
DLL and LICENSE; the Web adapter is embedded. Public `manifest.json` is unchanged.

Qualification uses Jellyfin Server/Web 12.2.0, .NET SDK 10.0.302, Node 24.22.0,
Python 3.12.0 and Playwright 1.56.1 on disposable Ubuntu 24.04 GitHub runners.
Official and LinuxServer Jellyfin images remain digest-pinned by the workflow.

## Regression coverage

The qualification build passes 288 backend tests, 161 JavaScript tests, 15 Python infrastructure
checks and four catalog tests. The existing deletion, approval and security
assertions remain enabled.

| Failure mode | Evidence |
| --- | --- |
| Match beyond the former first page | Backend: 71 titles, unique Watching/search match; selective 720-owner-row fixture returns its match immediately without playback classification |
| Global ordering and unknown dates | Three sort modes over multiple pages; selected status/owner contributions; unknown legacy membership dates; independent native comparison |
| Explicit, automatic and live union | Stable title/user deduplication, independent explicit date window, native viewing dates, Watching/Caught Up, 3/3 +N details |
| Authorization changes | Current requester/owner item access, episode-set revocation, policy invalidation, disabled native owner, private work diagnostics and candidate bounds |
| Continuations | Complete query/caller binding, expiry, partial-title owner continuation under episode limits, no duplicate owners, bounded progress and stable ordering across unchanged reverification |
| Browser races | Debounced search, superseded responses, checkbox/filter changes while paging, account switch, 401/403 clearing, both poll/pagination and refresh/pagination orders |
| Automatic updates | First-page population and activity replacement; authorized deeper-view comparisons; hidden/unselected changes ignored; native playback start/stop; stale retained live labels |
| Automatic preparation | Four-request ceiling, empty prepared boundary, terminal empty result, duplicate/missing progress, expiry, manual continuation after exhaustion, filter/search/account/navigation cancellation |
| Retained view | Inline expired-view Refresh retains controls/cards; unchanged poster and focused removal button survive pagination; ordinary update failures and failed Updates available actions retain loaded data |

## Native v0.6.0 comparison

The benchmark downloads the published v0.6.0 package and verifies SHA-256
`3542b971231b51a78d9783b490f1438b231cd0fca48b61c6aad5098528d50bd7`
before loading its DLL. It then loads the exact candidate DLL in the same
disposable fixture, waiting for background verification after each restart.

The fixture adds 120 movies, one 300-episode continuing series, six viewing
accounts plus the administrator, six explicit memberships and one live playback
owner. Existing fixture titles provide an explicit-only movie. Each scenario has
one warm-up and three measured samples, with sequential requests. The native
comparison checks title IDs, selected owner IDs, reasons and global ordering,
and asserts that page queries cause zero background playback-classification
batches. A native owner-policy revocation must invalidate a saved continuation
before another page is disclosed.

v0.6.0 has no combined filtered/sorted query. Its raw index first-page latency is
recorded separately; a globally comparable answer requires its membership request
and complete index pagination followed by benchmark-side filtering/sorting.
That benchmark operation is not implemented in the browser. Candidate
first-ordered-page latency includes any bounded preparation requests.
Timings cover native HTTP queries, not browser paint. The candidate browser also
fetches a separately labelled membership preview; that optional preliminary
request is not needed by its combined-query API and is outside these timings.

Median milliseconds from three measured samples (one warm-up):

| Query | Titles | v0.6 raw first index page | v0.6 globally ordered answer / complete | v0.7 first ordered page | v0.7 complete |
| --- | ---: | ---: | ---: | ---: | ---: |
| All owners · Title | 122 | 49.0 | 234.0 | 108.3 | 264.6 |
| One owner · Playback recency | 121 | 23.4 | 125.6 | 22.9 | 109.5 |
| Watchlisted · Recently added | 3 | 47.7 | 228.0 | 27.4 | 27.4 |
| Watched · title search | 1 | 45.8 | 222.2 | 34.9 | 34.9 |
| Watching · Playback recency | 1 | 45.5 | 221.9 | 49.9 | 50.0 |
| Currently playing · Title | 1 | 45.8 | 222.2 | 18.1 | 18.1 |

The broad v0.7 query first returned bounded preparation in 56.3 ms, then its
first ordered page at 108.3 ms after two requests (one Preparing response).
Every other candidate scenario reached its first ordered page in one request.
Complete broad pagination took 264.6 ms versus 234.0 ms for the baseline combined
answer: the additional authorization work costs about 13% here. The selective
search reached its single title in 34.9 ms with one request; v0.6 needed all six
requests to establish the same global answer. No measured API sample encountered
the empty prepared boundary; focused regressions cover that boundary explicitly.

Work across complete pagination (stable across the three samples):

| Query | Requests v0.6 → v0.7 | Episode queries v0.6 → v0.7 | Episode rows v0.6 → v0.7 | v0.7 authorized pair resolutions |
| --- | ---: | ---: | ---: | ---: |
| All owners · Title | 6 → 6 | 7 → 14 | 2100 → 4200 | 1454 |
| One owner · Playback recency | 6 → 5 | 2 → 2 | 600 → 600 | 363 |
| Watchlisted · Recently added | 6 → 1 | 7 → 3 | 2100 → 900 | 15 |
| Watched · title search | 6 → 1 | 7 → 0 | 2100 → 0 | 12 |
| Watching · Playback recency | 6 → 1 | 7 → 7 | 2100 → 2100 | 13 |
| Currently playing · Title | 6 → 1 | 7 → 0 | 2100 → 0 | 2 |

v0.6 does not expose a pair-resolution counter; zero in that raw JSON field
means unavailable, not zero native work. Both versions caused **zero playback
classification batches** during every measured scenario. Broad v0.7 pagination
repeats episode authorization during preparation and disclosure, explaining the
higher episode-row count. Selective movie searches avoid episode queries.
Initial verification after package restart took 250.2 s for v0.6 and 250.2 s for
v0.7; warm timings exclude that background population.

[Raw samples and fixture](evidence/activity-browser-v070/native-comparison.json),
[native browser checks](evidence/activity-browser-v070/native-browser.json),
[proxy matrix](evidence/activity-browser-v070/proxy-compatibility.json) and
[native proxy-policy boundary](evidence/activity-browser-v070/native-remote-access-proxy.json)
are retained with this report.

## Actual native browser behavior

Playwright drives the embedded adapter against the real disposable Jellyfin
server. These checks use native user-data and session mutations, not substituted
ActivityBrowser responses. Initial population is exercised by invalidating
verification through a harmless native policy-field change on the six disposable
viewing accounts; it does not alter library visibility.

| Browser operation | Ready time | Query requests, including preparation | Observed result |
| --- | ---: | ---: | --- |
| Open during population | 336 ms | 2, including 1 Preparing | 3 explicit titles, known population pending |
| Search for Index Movie 120 | 448 ms | 1 | 1 title, focus retained |
| Clear search, warm broad view | 502 ms | 2, including 1 Preparing | 23 ordered titles, more available, no continuation click |
| Open one-owner Watched search | 103 ms | 1 | 1 title |
| Open Currently playing search | 96 ms | 1 | Empty before playback starts |
| Open broad view before Load more | 247 ms | 2, including 1 Preparing | 23 ordered titles |

These are single observed browser operations, not medians. Ready time includes
navigation/control handling, search debounce where applicable, membership preview
when fetched, and rendering readiness. Request counts cover ActivityBrowser only;
they exclude membership, account/bootstrap and fixture-management requests. A page
may contain fewer than 25 titles because authorization and owner continuation
remain bounded; the browser does not fetch ordinary pages to fill it.

The first automatic poll after the initial three-title view returned 25 titles
while population was still pending. The fixture continued observing background
verification for 275.8 s and ended with 23 ordered titles and more available,
without Refresh. That duration includes waiting for verification of the whole
fixture, not latency to the first newly populated card. Broad first-page polls
used two sequential query requests each; they did not paginate the ordinary
result set. Selected-owner Watched changed 1 → 0 → 1 after native unwatched/watched
mutations. Currently playing changed 0 → 1 → 0 after native start/stop mutations,
all through automatic polling without Refresh.

After one Load more, the browser retained 47 distinct titles, the first poster
node and scrollTop 400. Stopping playback triggered an authorized check with
Changed=true, zero returned cards, 100 authorized pair resolutions and no episode
queries (64 ms HTTP response time). Updates available appeared without reordering
the view. The retained playback label explicitly said it may have stopped. The
Updates available action then loaded a fresh view. This is a changed-view check,
not a benchmark of worst-case unchanged checks. Search focus, clearing search,
poster identity and the 390px no-overflow assertion also passed. Existing native
basepath tests retain overlapping filter/response and security assertions.

Focused tests additionally cover four-request exhaustion and manual resumption,
expiry, non-progress, empty prepared boundaries, cancellation, overlapping
requests, account isolation, permission changes, 401/403 clearing, hidden-page
pausing and multi-poll checks. Native HTTP responses for every browser query,
including preparation, are retained in the linked JSON.

## Screenshots

All captures come from the same qualification run's disposable libraries.
The activity-index suite provides the search and mobile captures; the basepath
suite deliberately holds the activity response for the preliminary state.

Desktop title search reaches its matching title without loading unrelated cards, while retaining focus:

![Native title search at 1280px](screenshots/v0.7.0/search-1280.png)

Recently added at 390px preserves the poster layout and reports loaded results and more pages:

![Native Recently added view at 390px](screenshots/v0.7.0/added-390.png)

Explicit memberships remain available during loading, labelled as preliminary:

![Preliminary memberships during loading](screenshots/v0.7.0/preliminary-1280.png)

## Limits

These are warm, single-client fixture measurements, not a load test or a claim
about the user's production library. Read diagnostics count authorized work;
restricted views can perform additional suppressed authorization work.
Uninstrumented native title lookups and file-store reads are not reported as
playback classification.

Each snapshot considers at most 10,000 candidate title/owner pairs. A request
spends at most 500 native title/owner lookups plus one attempted pair at the
boundary, and at most 20,000 episode visibility rows, alongside the bounded live
overlay. An automatic operation issues at most four sequential requests; those
limits therefore apply up to four times per operation. Continue loading appears
only after that allowance is exhausted. Ordinary result pages remain under Load
more. Fixed candidate/live ceilings are disclosed without revealing hidden
candidate cardinality. Coverage remains partial even at the end of pagination.

Visible first pages requery every 30 seconds, after the previous operation has
finished. Native event classification can add delay before that next poll.
Deeper views keep their order and use authorized comparisons with the same
four-request allowance per poll; unfinished checks resume later. Live labels in
retained deeper views are explicitly stale. There is at most one pending check
cursor per baseline. Baselines and continuations share the sixteen-global and
two-per-caller snapshot allowance and five-minute lifetime; checks do not extend
it. Expiry/eviction or relevant policy changes offer Refresh with the same
controls. Query changes fence superseded work, hidden documents pause polling,
and revisions are opaque caller/query handles rather than global counters.

An earlier correction run passed its native API comparison and ten integration
suites but failed in browser setup because the fixture tried to parse an empty
204 policy-update response as JSON. The helper now accepts empty mutation
responses. Earlier failed/superseded runs are not counted as successful
qualification. The final successful run above qualifies the corrected runtime
and its native automatic-update/preparation checks.
