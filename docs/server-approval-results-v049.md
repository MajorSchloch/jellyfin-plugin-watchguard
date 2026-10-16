# Stage A approval qualification results

2026-10-16. **Feasible for the qualified native HTTP actions, as an isolated research prototype.** Stage B and production deployment remain unapproved. This is implementation review and automated qualification, not an independent security audit.

The published v0.4.8 plugin, production Web adapter, loader, protection endpoint, configuration, storage schemas, workflows and public catalog remain unchanged. No v0.4.9 production ZIP was produced.

## Reproduction and evidence

See [protocol](server-approval-protocol-v049.md), [threat model](server-approval-threat-model-v049.md) and [experiment instructions](../experiments/ServerApproval/README.md). Tests use generated disposable movies, a two-episode series and a 300-episode series, fresh accounts/configuration, and the checksum-verified published v0.4.8 DLL. No production access is accepted by the fixture.

- Published baseline ZIP SHA-256: `06f33f62d06d864b63c879213ec1b3536d81c8ebb0ab7ac186b6820580aa24d5`.
- Native image: `jellyfin/jellyfin:12.2@sha256:357724bf0ae27a672c7cbaa899db2d9abeb13dbd8657ccce750258a4c059d037`.
- Caddy: `caddy:2@sha256:f2a1290d0463aad60660d4ec134943f183ee2a5f6c3eb7bf32dd984f2f020772`.
- [Direct results](../experiments/ServerApproval/evidence/direct/results.json), [base-path results](../experiments/ServerApproval/evidence/basepath/results.json) and adjacent aggregate `guard.log` files.
- [Regression summary and tested companion hash](../experiments/ServerApproval/evidence/regressions.json); [bounded memory sample](../experiments/ServerApproval/evidence/memory.json).

Both exact native actions attach, confirmed by startup descriptors and real HTTP requests. The filter runs before filesystem mutation; registration alone was not considered a pass. Every recorded native veto checks surviving target/descendant paths and native library records, and verifies no native-continuation diagnostic. Allowed operations check record/file removal and one continuation. Native deletion completion itself is not a filesystem transaction.

## Tests

| Suite | Result |
| --- | --- |
| Stage A state machine, ownership, security boundary and attachment | 30 passed |
| Unchanged production backend/standalone unit tests | 105 passed |
| Unchanged production JavaScript tests | 53 passed |
| Catalog manifest/checksum unit tests | 4 passed |
| Prior veto-only PoC units | 8 passed |
| Prior veto-only Docker direct / base path | 31 / 31 recorded cases passed |
| Stage A Docker direct / base path | 72 / 72 recorded native cases passed, plus protocol-step assertions |
| Existing actual Web adapter | Both fixtures: Cancel zero DELETE; Delete Anyway one DELETE rejected 409 |
| Caddy HTTPS | Same-origin challenge, presentation, approval and redemption passed after exact trusted-proxy configuration |
| Unrelated proxy traffic | gzip/zstd/identity HTML, HEAD, conditional/range handling, authenticated private script and persistent WebSocket ping/pong passed; zero additional guard evaluations |

The full production release CI matrix (including LinuxServer catalog installation, legacy and discovery/verification benchmarks) was **not** rerun for this isolated non-release assembly. Those suites and their assertions are unchanged. The previous PoC evidence was retained; fresh rerun summaries are copied into the new experiment's evidence directory.

### Qualified negative and positive paths

- Anonymous/missing token, API keys, foreign Origin/Fetch Metadata, query credentials, different session of the same account and ordinary-user approval all reject. Ordinary users receive no names, reasons or override-capable challenge. Hidden targets return unavailable; native permission remains required even for administrators.
- Created cannot be redeemed or approved without presentation. Explicit revocation, 60-second native expiry, unknown/malformed IDs, changed action, changed target and changed bulk order reject. Native model binding rejects malformed target IDs.
- New watchlist interest, new resume interest, removed interest and native target metadata changes invalidate approval. Removing interest does not turn an invalid supplied header into an unprotected bypass. Parent changes, alternate-version inventory changes, lookup failures and cancellation have unit coverage; corrupt watchlist lookup fails closed in Docker.
- Native deletion permission revocation, administrator demotion, account disabling and token logout reject redemption. Jellyfin prohibits directly disabling a current administrator; the fixture first demotes, then disables that account. Disabling revokes its session, so subsequent independent logout testing uses a new login.
- Duplicate bulk IDs, overlapping series/episode targets, a missing final target and a protected final target veto the whole request before any mutation. Approved ordered bulk operations invoke the native action once. No claim of atomicity after native continuation.
- Simultaneous single and bulk redemptions produce one success, one AlreadyUsed rejection and one continuation. Consuming one challenge revokes another outstanding challenge sharing target inventory. Native exceptions consume approval without retry/refund in unit tests.
- Movie, series, season and episode approved deletions remove the intended disposable target. The 300-episode protected series successfully completes challenge/presentation/approval; revocation then preserves all files and native records. This is not a production-scale benchmark.
- Native errors and successful return behavior are preserved; approval is never followed by a separate plugin-initiated LibraryManager deletion.
- All protocol successes and guard error objects are asserted `Cache-Control: no-store`. Native authentication/model-validation responses retain their native format.
- Restart invalidates approvals. Opt-out with the DLL present reports ServerGuardUnsupported at the protocol and restores native deletion. Removing the companion and restarting also restores native deletion. Watchlists/preferences remain byte-identical; approved deletion does not clear memberships.

## Performance observations

[Structured measurements](../experiments/ServerApproval/evidence/performance.json) come from the final direct/base-path runs on the same local Docker host. HTTP times include transport and native processing; evaluation timings cover fresh permission/inventory/interest work, not native deletion. These are small disposable fixtures, with concurrent qualification workloads and no statistically controlled production comparison.

| Measurement | Direct | Base path |
| --- | ---: | ---: |
| Challenge creation, median of 28 | 21.82 ms | 23.07 ms |
| Presentation, median of 27 successful requests | 26.18 ms | 28.62 ms |
| Approval, median of 27 successful requests | 24.84 ms | 26.34 ms |
| Approved single movie redemption, one sample | 33.22 ms | 32.38 ms |
| Approved two-movie bulk redemption, one sample | 50.42 ms | 50.58 ms |
| Unprotected ordinary-user movie deletion, one sample | 55.07 ms | 51.50 ms |
| 300-episode series challenge, one sample | 152.71 ms | 170.32 ms |
| 300-episode presentation / approval | 83.98 / 83.68 ms | 89.73 / 93.81 ms |
| Fresh evaluation median / maximum, all outcomes | 11.80 / 142.84 ms | 12.56 / 160.77 ms |

Redemption includes a new evaluation; it does not reuse presentation/approval decisions. Single and bulk concurrent native tests each recorded exactly one continuation. Thirty-two simultaneous store-consumption attempts in the unit test produce one winner and 31 Used rejections. Unrelated HTTP and proxy/WebSocket traffic produces zero guard interest work.

The isolated managed-heap sample with 256 records, 100 targets and 4,000 inventory IDs per record retained approximately **35.8 MB** above its pre-fill baseline. This is a GC-based process sample (including runtime/test allocation effects), not a precise object census or native server RSS. It deliberately uses the maximum stored inventory; real challenges usually contain much less. Admission/storage bounds prevent unbounded accumulation, but this footprint and synchronous native work deserve further review before production packaging.

## Security review findings and remaining gaps

The review checked identity before challenge-state disclosure, the explicit API-key distinction, native permission preflight before interest disclosure, fresh state at every step, terminal-state atomicity, copy isolation of stored target arrays, native exception propagation, and bounded admission/storage. A startup edge case was tightened: descriptor mismatch now sets Supported=false as well as logging failure. Tests reject version/action mismatch and unverifiable descriptors.

Caddy initially returned a safe 403 because default Jellyfin configuration did not trust forwarded headers. The test configures only the exact disposable proxy address in native KnownProxies, restarts, and verifies HTTPS approval without weakening Origin validation. No production proxy configuration changed. Different proxy topologies and browser-specific CORS behavior require Stage B qualification.

A same-token tab is the same identity. A stolen administrator token together with an approval identifier carries the administrator's authority. Human intent is represented by an authenticated explicit Approve request, not proved cryptographically. A malicious administrator can use the protocol directly. No secrets or identifiers are put into URLs or persisted in browser storage by this prototype.

There is no atomic transaction spanning playback state, permission changes, metadata and native filesystem deletion. External same-path replacement invisible to native metadata and changes after the final recheck remain TOCTOU risks. Tests do not simulate a crash during filesystem mutation; exactly-once filesystem completion is not promised. Native version/parent mutation is covered by interface tests, not a full native alternate-version mutation fixture. Multi-instance coordination, distributed challenges and external/internal deletion services remain unsupported.

The admission limits protect concurrent work, not a hard preemption deadline inside synchronous native calls. Informational overview caches never authorize deletion. Failures deny, not silently convert to zero interest. Large or restricted inventories can be conservatively refused. No override exists for unsupported inventory or API keys.

## Differences from veto-only PoC

| Veto-only PoC | Stage A |
| --- | --- |
| Protected native DELETE always rejected | Eligible admin receives a non-authorizing, session-bound challenge |
| No approval state | Bounded process-local Created → Presented → Approved → Consumed state with expiry/revocation |
| No redemption | One-use request header on the original native action; fresh checks before atomic consumption |
| Protection lookup at veto | Fresh creation, presentation, approval and redemption checks plus native inventory/state fingerprint |
| No resource reservation | Overlapping inventory reservation and revocation of outstanding conflicting approvals |
| Existing API-key veto | Retained; no conversion to human administrator |
| Production Web Delete Anyway rejected | Still rejected: Stage A deliberately has no Web approval integration |

## Stage B recommendation, upgrade and rollback

Proceed to a **separately reviewed Stage B design**, not production activation. Use the protocol plan in the companion document: receive a challenge, present current administrator-authorized details, obtain deliberate approval and carry the one-use identifier on precisely the original native operation. Keep native confirmation, Cancel focus, account/navigation cancellation and no automatic retries. Revisit how existing bulk Web behavior maps to a native ordered target set. Do not turn a ProtectionRequired response into automatic approval.

Before packaging, review safe activation/version-mismatch behavior, proxy origin configuration, expiry during slow dialogs, stale clients, quota UX and operational diagnostics. Repeat the full production catalog/upgrade/rollback and browser matrix. No published assets or GUIDs change in Stage A.

For disposable rollback: remove only `WatchGuard.ServerApproval.dll`, remove its opt-in environment variable and restart. Keep the published v0.4.8 DLL/configuration/data. Do not load the previous veto-only companion simultaneously. Disable/uninstall is a restart boundary; it is not dynamic removal of an already-built MVC pipeline. Restart/removal loses every pending approval. Existing v0.4.8 browser tabs continue their original Web-only behavior after rollback and should be fully reloaded before any future Stage B deployment.
