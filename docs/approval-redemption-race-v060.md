# v0.6.0 concurrent approval redemption response ordering

This is an unpublished fix on top of merged PR #40. No catalog, published asset, storage format, approval lifetime, deletion policy or Web behavior changes.

## Reproduction and cause

[Master run 39253745693, job 118064182974](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/39253745693/job/118064182974) failed `concurrent-bulk-approval`: the losing request returned `404 TargetUnavailable` instead of `409 ApprovalAlreadyUsed`. Both requests could pass `ApprovalStore.Read` while the approval was still Approved. One then completed fresh verification, atomically consumed the approval and continued the native action. The other reached a target lookup after native removal, before its own `Consume` call.

The previous logs showed one continuation, but the failing test stopped before its final file/database assertions. The passing PR #40 run did not resolve that race. The original evidence in `docs/evidence/v060-qualification.json` is retained as historical evidence.

Four deterministic regressions reproduce this ordering using the real Guard, Evaluator and ApprovalStore with a native-library interface model. They cover single and bulk operations, paused after the initial approval read either before first target lookup or before final permission verification. Explicit barriers let the winner consume and remove targets before the loser continues; there are no timing sleeps or destructive retries. All four failed against the unchanged master guard with expected 409 / actual 404, then passed after the fix.

## Resolution and security boundaries

The guard remembers only that it matched an Approved ticket to the caller/session and exact ordered operation. If subsequent pre-continuation evaluation fails with **404 TargetUnavailable**, it:

1. Revalidates native authentication, enabled account, administrator privilege, token transport and origin through the existing Identity service.
2. Requires the same user/session identity as the initial check.
3. Reads the consumed tombstone under the approval-store lock, matching the exact identity and ordered operation.
4. Returns **409 ApprovalAlreadyUsed** only if that exact approval was actually consumed. Otherwise the genuine missing-target failure remains 404.

This read cannot authorize deletion, consume or renew a ticket, change expiry, reserve resources or invoke the native action. Existing bounded tombstone cleanup remains unchanged; after a tombstone has been removed the fix does not infer past consumption. It adds one identity recheck only on this narrow failed-redemption path. Normal successful requests and unrelated requests do no additional work.

Fresh native permission/protection checks, fingerprint matching, inventory reservation and atomic `Consume` remain in their original order. Existing 401/403 failures, cancellation, native lookup exceptions and state-change failures do not receive this normalization. Identity changes during the missing-target race are rejected before consumed state is reported. Native continuation remains outside this catch; its original result/exception is preserved, even a native 404, and there is no retry or refund.

Tests also cover disabled accounts, revoked administrator privilege, changed/revoked sessions, changed Origin, cancellation, native permission denial, lookup failure, a genuinely missing target without consumption, read-only owner/session/operation binding, and native exceptions after consumption. The deterministic model checks disposable files and model records, leaves an unrelated file intact and asserts one winner/zero losing continuations. It does not substitute for native database testing.

## Qualification

Local checks: **60 focused guard/store tests**, **267 full backend tests**, **132 JavaScript tests**, **15 Python tests**, **four catalog tests** passed. The original native single/bulk concurrency tests and all file/database assertions in `tests/server-enforcement.py` are unchanged. Full hosted qualification with `publish=false`, `proxy_matrix=true` is pending; exact tested commit, artifact checksum and native outcomes will be recorded after completion.

No merge, publication or production deployment. Upgrade/rollback instructions and the checksum-verified published v0.5.2 baseline remain unchanged. This only changes the losing request's response when consumption is independently established; it does not make deletion transactional or guarantee filesystem completion across crashes.
