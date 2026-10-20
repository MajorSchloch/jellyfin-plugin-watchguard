# WatchGuard v0.7.0 — Combined activity browser

**Unpublished release candidate.** Starts from master `6ed56ea` after published v0.6.0. Do not merge, publish or deploy as part of this preparation.

Filtering, title search and all three sort modes now run in one bounded server query across known eligible explicit watchlists, indexed activity and live playback. Statuses combine with OR, Watching includes Caught Up, and no statuses match nothing. Date controls only constrain automatic activity. Selected authorized owners supply date aggregates; unknown legacy dates remain unknown and sort last.

Title search is debounced, accessible and URL-backed. Pages preserve the server order. A separate preliminary membership view remains available while activity is prepared or unavailable. Controls invalidate prior requests, continuations bind every query field and the caller, and native authorization is repeated before disclosure. Expired/changed views offer Refresh with the same controls. Visible first pages update automatically every 30 seconds. Deeper views retain their order and offer Updates available after a bounded, authorized comparison. Retained live badges are explicitly marked as the state when loaded.

See the [query and pagination contract](activity-browser-v070.md). Existing deletion protection, approvals, authoritative Protection, personal storage formats, plugin GUID and Jellyfin ABI are unchanged. Target: Jellyfin Server/Web 12.2.0 / .NET 10; package 0.7.0, assembly/file 0.7.0.0. Public assets and catalog history are unchanged.

## Bounds and limitations

Known indexed data is not an exhaustive library audit. The browser advances preparation through up to four sequential requests to reach the first ordered page, including an empty prepared boundary. Continue loading appears only if that budget is exhausted; ordinary result pagination remains manual. A snapshot considers at most 10,000 title/owner pairs; each request spends at most 500 native title/owner lookups plus one bounded retry and at most 20,000 episode visibility rows. Pages disclose at most 25 titles and preserve partial-title owner continuation. Up to sixteen snapshots globally and two per caller expire after five minutes; capacity evicts the oldest view, requiring Refresh. Live sessions retain the existing 100-session/50-identities-per-session ceilings. No request reads full native playback classifications.

Metadata, membership, live or activity changes affecting a deeper frozen view can require Refresh; a visible first page is queried again automatically. Policy changes invalidate continuations; episode authorization protects progress and extra-episode details. Polling pauses in hidden documents, automatically updates a first-page view, and compares deeper views against an opaque caller/query-bound revision. Revisions identify the authorized snapshot; they are not global counters or authorization substitutes. Checks may continue over later polls, retain the existing snapshot limits, and never download all result pages.

## Validation

See the [qualification report](activity-browser-validation-v070.md) for the native v0.6.0 comparison, screenshots, regression coverage, exact tested commit and candidate checksum. No publication or deployment is part of this PR.
