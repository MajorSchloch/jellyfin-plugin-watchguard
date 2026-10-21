# Activity browser query contract — v0.7.0

The combined query unions explicit membership, eligible indexed native activity,
and currently authorized live sessions by title ID and user ID. Owner scope applies
first. Statuses match with OR; Watching includes Caught Up; an empty selection
matches nothing. The 7/30/90-day window and older-current-interest option apply
only to indexed activity. Membership and live playback are independent of them.
Automatic interest never writes a membership.

Title search is a trimmed, case-insensitive ordinal substring of the native title
name (maximum 120 characters). Title ordering uses ordinal case-insensitive text,
then ordinal text and title ID. Playback recency and Recently added use the latest
known respective date among authorized owners matching scope and status, descending,
then the title ordering. Unknown dates come last; legacy membership dates remain
unknown. Authorized indexed native dates on explicit/live rows remain usable for
ordering even when their automatic reasons fall outside the selected window.
There is no playing/current-interest priority.

Query preparation authorizes and filters known candidates before sorting and
pagination. It is bounded separately from the background classifier and performs
no playback classification. If preparation reaches its request budget, it returns
an explicit preparing state and a progressing continuation, without claiming a
partially ordered prefix is globally ordered. The browser may show a labelled
preliminary membership view while this happens, or when activity is unavailable.
Completing preparation replaces that preliminary view with the combined query.

Continuations are opaque, single-use, expire, and bind the caller and every query
control. Snapshots freeze eligible IDs, selected owners, metadata and ordering;
new activity or metadata is incorporated by first-page polling or a deeper-view refresh. Every result page repeats native owner,
requester and episode visibility checks. Policy changes invalidate the view; stale
activity is omitted or requires refresh rather than leaking historical counts.
An authorization change affecting an ordering contributor requires refresh.
Unchanged background reverification does not expire a view: verification timestamps
and row identities are not result changes. Fresh authorization and structural
comparison of the displayed activity, including extra-episode metadata, still apply.
Owner positions within a title survive a page budget. No exact library total is
reported; loaded counts describe only disclosed rows. Snapshot and request limits
are explicit and cannot be removed merely to fill a page.

Search is debounced and all control changes fence older requests immediately.
Pagination, preparation, polling and refresh share a serialized query slot.
Polling updates the first page or checks a deeper snapshot without replacing it;
Refresh retains controls and starts a new snapshot.
401/403 clears the captured account's data even from a superseded request.
Transport errors retain same-view results. Expired continuations offer Refresh.

Deletion protection, approvals, personal stores, plugin GUID and Jellyfin ABI are
outside this change. The published v0.6.0 package is the native performance
baseline. Qualification and exact bounds are recorded with the release evidence.

Read diagnostics count only currently authorized title/owner work and episode sets
visible to the caller. They are not a raw hidden-candidate counter. Native fixture
measurements use unrestricted disposable accounts; restricted views may perform
additional suppressed authorization work. Global worker totals and discovery state
are not exposed by the combined browser API. Population indications refer to known,
authorized rows awaiting verification; coverage always permits undiscovered data.
The fixed candidate and live-session ceilings are stated for every view; whether
hidden candidates reached a ceiling is not exposed as a count or explanation.

Selective statuses are screened using the existing projection before native item
checks. Search reads each known candidate title's native metadata once per request,
then authorizes matching owners. Native title and owner lookups share a 500-unit
request budget (plus one attempted pair at the boundary); pure projection scanning
is capped by the 10,000-pair snapshot. Episode visibility remains independently
bounded at 20,000 rows. This keeps selective movie/series queries useful without
raising classification or discovery limits.

## Correction: automatic updates and preparation

The visible first page is queried again every 30 seconds while the document is
visible. A browser operation automatically follows at most four sequential
query requests, each retaining the server's existing native/episode budgets,
until the first nonempty ordered page or an empty terminal result is available.
This includes the boundary response where preparation has finished but no title
fits the remaining request budget. It never automatically follows ordinary
result pagination. If the four-request budget is exhausted, Continue loading is
available; preliminary memberships remain visible. Expiry or a repeated cursor
stops the operation and offers Refresh with the same controls. A later first-page
poll may start a fresh query, but never loops on the failed continuation.

After Load more, polling retains the cards and their order. An opaque,
caller/query-bound revision identifies the authorized baseline snapshot, not a
global worker counter. Bounded checks compare freshly authorized known candidates
against that baseline, including membership, displayed activity and native live
sessions. A relevant difference offers Updates available. Incomplete checks
continue on a later poll, within the same finite per-poll budget. Hidden and
out-of-scope activity never contributes a change indication. Snapshot eviction
or expiry requires Refresh; revisions never replace native authorization.

Currently Playing on retained deeper views is explicitly labelled as the state
when the view was loaded. Failed automatic updates likewise mark live state as
potentially stale. Hidden documents pause polling. Query requests share one
serialized slot, and any control/account/navigation change immediately fences
queued requests and responses. Automatic preparation never retries expiry within the same operation; a first-page poll can start a fresh view on the next 30-second interval.

`Freshness.Revision` is an opaque snapshot handle, absent until preparation is
complete. `check=true&revision=…` binds the same caller and every query control;
its continuation cannot be used for result pagination. `Changed=true` means a
freshly checked matching entry differs from the baseline, or a baseline entry
is no longer eligible/visible. `Changed=false, Preparing=true` is an incomplete
check, never a claim that the entire known set is unchanged. The browser resumes
that check on a later poll after spending its four-request allowance. There is
at most one pending check cursor per watched snapshot, sharing the existing
sixteen-global/two-per-caller snapshot limit. Checks do not extend the five-minute
lifetime. The four-request browser budget multiplies the existing query item and
episode budgets; the separately bounded live overlay is checked on every request.
