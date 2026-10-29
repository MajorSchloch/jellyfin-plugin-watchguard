# v0.7.10 native ordering qualification correction

The release qualification at master `c8f030e6b880bd8f96ce8ed4861f357e552cd1a3` failed in [12.4 / activity-native](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/40847683501/job/123359607051), scenario `single-recent`. Artifact `12885824760` records the assertion and candidate DLL hash but does not contain the returned rows. The exact offending pair cannot be recovered from that artifact.

The Python comparison oracle used serialized timestamps for both each title's maximum owner date and descending title order. For example, `.1Z` sorts lexically after `.11Z`, although 100 ms precedes 110 ms. Equivalent offsets and trailing-zero precision also invalidate string ordering. The runtime's `BrowserQuery.Sort` already compares nullable UTC ticks.

The corrected oracle parses explicit `Z` or signed `HH:MM` offsets into integer UTC ticks since 0001-01-01, retaining all seven fractional digits (100 ns). Missing/null dates remain unknown and sort last. Ambiguous, invalid or out-of-range timestamps fail rather than silently becoming unknown. Status filtering still precedes date aggregation; existing title/ID tie-breaks remain unchanged. No plugin runtime, activity-query, pagination, limits or retry changes are included.

Every comparison sample now writes an allowlisted `order-<candidate>-<scenario>-<sample>.json` before checking ordering, membership, owners or reasons. It contains the scenario/query/sample, actual and expected IDs, raw owner dates, normalized UTC ticks, title tie-breaks and expected aggregate date keys. API envelopes, credentials and continuation tokens are excluded. These files travel with the existing activity-native failure artifacts; their number is bounded by the existing six scenarios and four samples for each candidate.

Ten focused tests cover fractional precision, whole seconds, 100 ns precision, equivalent and differing offsets, null/missing dates, multi-owner maxima for both date fields, status-scoped aggregation, title/ID ties, invalid input, and rejection of genuinely wrong order with evidence already on disk. Existing strict membership, owner, reason, permission and no-background-reclassification assertions remain in place.

## Validation

Local fast checks: 376 backend tests, 199 JavaScript tests, 47 Python infrastructure/oracle tests (including the ten new tests), eight catalog tests, release-note validation and whitespace checks passed. Deterministic packaging retains ZIP SHA-256 `fd4e0301c312406e4ada3301e64bcb504aa29fd16c80157beb735b5ddc2b0681` and DLL SHA-256 `5ddb76713367f3bc8f1559285db26ec68a07f188d868d095f3a721c9c6e48a95`, matching the failed qualification candidate.

Native reproduction and full qualification results will be recorded here after they complete. v0.7.10 remains unpublished. The public catalog and historical release packages are unchanged.
