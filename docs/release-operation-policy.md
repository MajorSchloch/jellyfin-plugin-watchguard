# Release policy implementation

This tooling change leaves the v0.7.13 version, runtime, published packages and catalog unchanged.

The single policy is `scripts/qualification-policy.json`. It supplies workflow matrix selection, suite commands, shard assignments, the qualification gate, the sealed record and generated [coverage documentation](qualification-policy.md). `python3 scripts/qualification_policy.py --check` rejects stale generated documentation. Each retained host/suite pair is blocking. Missing, duplicate, failed, reordered or mismatched evidence, package hashes, commits or attempts stops the gate.

Qualification builds the candidate and intentionally rebuilds it to test determinism. Browser assets are generated within those package builds; integration jobs only extract the verified DLL. The previous stable ZIP and sidecar are downloaded and verified once, then shared as an immutable input with the two upgrade fixtures. Each job owns its disposable server. Startup and navigation use separate browser contexts on one server; native catalog installation keeps a separate fixture because it changes plugin installation. LinuxServer upgrade shares its fixture with TLS/WebSocket and current browser checks. Real polling intervals and server work limits are unchanged.

The upgrade baseline is the greatest published catalog version strictly below the candidate. Public SHA-256/asset checks and catalog installation metadata must agree. The fixture verifies the deployed previous DLL and active plugin version, writes personal data through the old API, installs the candidate through Jellyfin's package API, and verifies the candidate DLL, data bytes, dates, preferences, owner isolation and retained media. v0.7.13 validation therefore upgrades from v0.7.12. A future v0.7.14 upgrades from v0.7.13.

## Publication state and retries

The draft creation response is validated and retained. Uploads address that exact release ID. After each write, the exact-ID endpoint and authenticated complete release inventory must converge. Missing entries and the known pre-write state can be retried for four read rounds, within a 90-second deadline and a 20-second per-request bound. Conflicting IDs, targets, tags, provenance or assets fail immediately. Upload and publication responses are checked against the expected transition. No write is retried blindly.

The original qualification seal identifies repository, source commit, qualification run/attempt, policy, required hosts/scenarios, proxy coverage, artifact IDs/digests, ZIP hash and DLL hash. The publisher verifies the original completed jobs and every recorded artifact. Automatic handoff accepts only one sealed record in that exact qualification run; it never selects a latest artifact or another run. Read-only inspection passes the original qualification attempt and record artifact ID to the approved publisher. GitHub retains these successful job outputs when rerunning only the failed publisher job. Publication run/attempt are reported separately.

Canonical concurrent-change checks ignore download counters and presentation metadata but retain release identity, exact qualification markers and asset identity/integrity. Existing assets are downloaded and checked byte-for-byte. A catalog-only retry still verifies public assets anonymously. Catalog updates use the existing blob SHA as a compare-and-swap; an unchanged manifest succeeds without a write.

Master pushes can start qualification for an unpublished candidate even when the version metadata did not change. Documentation, artwork and generated catalog-only pushes do not start it. For an already completed release, the plan verifies public assets/catalog and stops before the build. Runtime changes under an already published version fail with an instruction to prepare a new version. Validation-only requests remain explicit. Approval, read-only inspection, publisher-only write permissions and global publication locking remain in place.

## Coverage changes and limits

The prior policy required 39 reports, 18 integration jobs and 54 primary fixture commands across 12.2/12.3/12.4. The new generated policy lists the exact retained inventory. Current browser authorization, deletion protection/approvals, watchlist errors, account isolation, activity ordering/filtering/pagination, actual polling, navigation, startup and proxy/base-path checks remain. Chromium 79 is now a mandatory native engine job on 12.4. This does not certify a physical TV or the webOS application wrapper.

Jellyfin 12.3 receives core enforcement, full base-path browser behavior and LinuxServer direct-upgrade/TLS coverage. The broader activity, native episode/tag/rating/folder visibility, layout, catalog and old-engine matrix runs on 12.4. Jellyfin 12.2 retains its minimum ABI and historical qualification; it is no longer in the mandatory native release matrix. Runtime tested-version reporting is unchanged in this tooling-only PR; the CI policy is deliberately narrower than accumulated historical runtime qualification.

Historical Injector tests, migration/rollback ladders and old performance comparisons remain in the repository for manual investigation. The active policy does not invoke them. Existing data migrations, historical catalog entries, published assets and evidence remain unchanged. The current activity oracle uses current native indexed rows plus explicit memberships to check the combined query, including strict UTC-tick ordering, owners, reasons, live playback and permission changes; it no longer installs old packages for performance comparisons.

The intermittent native menu timeout recorded in run 41075911155, attempt 1, job 124132556154 remains separate follow-up work. This change adds no test retries, longer sleeps or weakened menu assertions.

Validation and measured timing evidence will be recorded after the validation-only run completes. Publication recovery is tested with a deterministic fake GitHub API and read-only public checks; no live release write is used as a test.
