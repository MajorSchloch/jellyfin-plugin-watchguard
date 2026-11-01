# Release policy implementation

This tooling change leaves the v0.7.13 version, runtime, published packages and catalog unchanged.

The single policy is `scripts/qualification-policy.json`. It supplies workflow matrix selection, suite commands, shard assignments, the qualification gate, the sealed record and generated [coverage documentation](qualification-policy.md). `python3 scripts/qualification_policy.py --check` rejects stale generated documentation. Each retained host/suite pair is blocking. Missing, duplicate, failed, reordered or mismatched evidence, package hashes, commits or attempts stops the gate.

Qualification builds the candidate and intentionally rebuilds it to test determinism. Browser assets are generated within those package builds; integration jobs only extract the verified DLL. The previous stable ZIP and sidecar are downloaded and verified once, then shared as an immutable input with the two upgrade fixtures. Each job owns its disposable server. Startup and navigation use separate browser contexts on one server; native catalog installation keeps a separate fixture because it changes plugin installation. LinuxServer upgrade shares its fixture with TLS/WebSocket and current browser checks. Real polling intervals and server work limits are unchanged.

The upgrade baseline is the greatest published catalog version strictly below the candidate. Public SHA-256/asset checks and catalog installation metadata must agree. The fixture verifies the deployed previous DLL and active plugin version, writes personal data through the old API, installs the candidate through Jellyfin's package API, and verifies the candidate DLL, data bytes, dates, preferences, owner isolation and retained media. v0.7.13 validation therefore upgrades from v0.7.12. A future v0.7.14 upgrades from v0.7.13.

## Publication state and retries

[Publication run 41260733852](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/41260733852) stopped before its first upload with “Release state changed concurrently.” The original code discarded the POST response, read a temporarily incomplete release list, then treated the draft's later appearance as an external change. The [deterministic baseline reproduction](evidence/release-policy/draft-baseline-reproduction.txt) produces that same error from the original master code. The corrected test passes without a live write.

The draft creation response is validated and retained. Uploads address that exact release ID. After each write, the exact-ID endpoint and authenticated complete release inventory must converge. Missing entries and the known pre-write state can be retried for four read rounds, within a 90-second deadline and a 20-second per-request bound. Conflicting IDs, targets, tags, provenance or assets fail immediately. Upload and publication responses are checked against the expected transition. No write is retried blindly.

The original qualification seal identifies repository, source commit, qualification run/attempt, policy, required hosts/scenarios, proxy coverage, artifact IDs/digests, ZIP hash and DLL hash. The publisher reads the policy from that exact source commit and verifies the original completed jobs and every recorded artifact. Later policy edits do not select a different package or force requalification of a sealed run. Pre-policy records still require their original full host/shard/scenario inventory; their source is parsed as data and is never executed. Automatic handoff accepts only one sealed record in that exact qualification run; it never selects a latest artifact or another run. Read-only inspection passes the original qualification attempt and record artifact ID to the approved publisher. GitHub retains these successful job outputs when rerunning only the failed publisher job. Publication run/attempt are reported separately.

Canonical concurrent-change checks ignore download counters and presentation metadata but retain release identity, exact qualification markers and asset identity/integrity. Existing assets are downloaded and checked byte-for-byte. A catalog-only retry still verifies public assets anonymously. Catalog updates use the existing blob SHA as a compare-and-swap; an unchanged manifest succeeds without a write. A completed release is not requalified when the policy changes. Its retained original seal still supplies expected ZIP/DLL hashes; public bytes must match. If that old seal has expired, verified public assets, sidecar and catalog are sufficient only for a no-write result. They never authorize a new or partial publication.

Master pushes can start qualification for an unpublished candidate even when the version metadata did not change. Generated catalog-only pushes do not start a workflow. Other master pushes receive a read-only state check, so documentation fixes to an unpublished candidate can also qualify. Documentation-only changes to a completed release do not start a build or matrix. For an already completed release, the plan verifies public assets/catalog and stops before the build. Runtime changes under an already published version fail with an instruction to prepare a new version. Validation-only requests remain explicit. Approval, read-only inspection, publisher-only write permissions and global publication locking remain in place.

## Coverage changes and limits

The prior policy required 39 reports, 18 integration jobs and 54 primary fixture commands across 12.2/12.3/12.4. The new generated policy lists the exact retained inventory. Current browser authorization, deletion protection/approvals, watchlist errors, account isolation, activity ordering/filtering/pagination, actual polling, navigation, startup and proxy/base-path checks remain. Chromium 79 is now a mandatory native engine job on 12.4. This does not certify a physical TV or the webOS application wrapper.

Jellyfin 12.3 receives core enforcement, full base-path browser behavior and LinuxServer direct-upgrade/TLS coverage. The broader activity, native episode/tag/rating/folder visibility, layout, catalog and old-engine matrix runs on 12.4. Jellyfin 12.2 retains its minimum ABI and historical qualification; it is no longer in the mandatory native release matrix. Runtime tested-version reporting is unchanged in this tooling-only PR; the CI policy is deliberately narrower than accumulated historical runtime qualification.

Historical Injector tests, migration/rollback ladders and old performance comparisons remain in the repository for manual investigation. The active policy does not invoke them. Existing data migrations, historical catalog entries, published assets and evidence remain unchanged. The current activity oracle uses current native indexed rows plus explicit memberships to check the combined query, including strict UTC-tick ordering, owners, reasons, live playback and permission changes; it no longer installs old packages for performance comparisons.

The intermittent native menu timeout recorded in run 41075911155, attempt 1, job 124132556154 remains separate follow-up work. This change adds no test retries, longer sleeps or weakened menu assertions.

Publication recovery is tested with a deterministic fake GitHub API and read-only public checks. No live release write is used as a test. The completed results are below.

## Validation and measured results

[Reduced qualification 41290602965](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/41290602965), attempt 1, passed all **13 reports in 12 integration jobs**, the seal gate and read-only publisher rehearsal. It tested commit `514d33349c82793b0d682d325c237b5210501e74` with `publish=false` and `proxy_matrix=true`. Subsequent publisher/trigger/timing-report refinements are covered by fast tests and read-only verification of that exact record; they do not change the runtime or required native scenarios.

- Candidate package artifact: `13076658146`; qualification record artifact: `13077184691`.
- ZIP SHA-256: `7b1d029d0e0e35947b70154e1fa1ec1f9cfad87164d9609059331d18640f44df`.
- DLL SHA-256: `608ea2c650d64f3919db1adc09cdccea4216745aa8460ca433a4f83a8fa48fe4`.
- Both hashes match published v0.7.13. No version, runtime, public catalog or release asset changed.
- Fast validation: 111 Python tests, 47 targeted publication/provenance tests (included in the Python total), eight catalog tests, 228 JavaScript tests, packaged ES2019 checks, release-note checks and workflow lint. The qualified build also passed all 376 backend tests and deterministic packaging.
- The real Chromium 79 job passed on Linux snapshot 706915; the archive is pinned to SHA-256 `647c9f1a9be953a7bdbcb59ec52fece3ef192945a674443114572e98b56b7e59`. Physical TV validation remains separate.
- [Original-seal verification](evidence/release-policy/original-seal-verification.json) rechecked the published release's original run `41258353082`, attempt 1, including its full 39-suite policy. [Final publisher rehearsal](evidence/release-policy/final-publisher-rehearsal.json) verified the new 13-suite record using the final publisher. Both returned **already published and verified**, with no writes.

The before sample is the successful [v0.7.13 master qualification](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/41258353082). The after sample uses the reduced policy above. These are measured samples with different coverage, not a claim that the same test inventory became faster.

| Measure | Before | After |
|---|---:|---:|
| Required reports / integration jobs / primary fixture commands | 39 / 18 / 54 | 13 / 12 / 14 |
| First recorded step to last recorded step | 32m 40s | 18m 58s |
| Combined recorded step execution | 6h 8m 46s | 1h 52m 22s |
| Workflow elapsed from Actions metadata | 32m 48s | Unavailable: inconsistent timestamps |
| Combined job execution / dependency-ready delay | 6h 10m 9s / 50s | Unavailable: inconsistent timestamps |

Recorded step span decreased by 42%; combined step execution decreased by 69.5%. Neither is an estimate of end-to-end elapsed time. The final API returned, for example, a job start at `09:55:53Z` and completion at `09:09:38Z`, while its step intervals were internally ordered. The reporter now retains these raw timestamps and returns `null` for invalid totals. It does not silently clamp them to zero or assume a one-hour correction. The final run also waited behind the superseded preliminary run; do not compare its initial wait as a clean runner-concurrency benchmark.

The remaining longest job step spans were activity-browser **16m 50s**, navigation **16m 10s**, and activity-native **13m 41s**. Real polling, full responsive/layout transitions and synthetic activity population remain the main costs. Their assertions, waits and resource limits are unchanged. Native visibility checks passed in their separate current-only fixture.

[Read-only inspection](evidence/release-policy/inspect-only-timings.json) completed in **19s**, with no build or matrix; the state check itself took **2.769s**. Three [local public/recovery measurements](evidence/release-policy/public-recovery-timings.json) gave medians of **1.425s** for public verification and **0.353s** for catalog recovery into a temporary file. These exclude approval, uploads and a remote catalog commit. The [local direct-upgrade fixture](evidence/release-policy/local-upgrade-phases.json) passed in **409.880s**, including **9.509s** for upgrade/data preservation.

The [sealed record](evidence/release-policy/qualification-record.json), [suite evidence](evidence/release-policy/qualification.json), [before timings](evidence/release-policy/baseline-timings.json), [after timings](evidence/release-policy/final-timings.json) and [summary](evidence/release-policy/summary.json) retain the exact source and artifact identities. Preliminary run `41290244643` is retained as cancelled, superseded work; it does not authorize publication. No live publication was used to validate recovery.
