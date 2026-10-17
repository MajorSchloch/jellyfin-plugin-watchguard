# Repeatability qualification

Status: NOT QUALIFIED. Keep the v0.4.9 release freeze.

Historical runs 55–58 failed on different commits and do not count toward repeatability. Local checks and the first revised disposable enforcement run are in progress.

Required gate: focused regressions, complete local matrix, then three consecutive complete hosted `publish=false` runs on one unchanged candidate commit. Record commit, run URL, each suite outcome, setup/indexing/browser/scenario durations, retries and first-failure category. A failed run requires investigation; after a fix, restart the three-pass sequence. Never erase a first failure with a passing retry.

No new hosted qualification passes are claimed yet. No publication or production deployment has occurred.

## Initial local evidence (working tree, not hosted qualification)

- Official enforcement: PASS, 74 server cases plus old/current browser, Caddy and rollback.
- LinuxServer enforcement: PASS, 74 server cases plus browser/Caddy/rollback.
- Official base-path native UI: PASS, detail/context-menu/multi-select deletion.
- Backend: 147 passed. JavaScript suites: passed under Node 24.22.0.
- Infrastructure unit tests: 5 passed, including redaction and parent/inventory checks.
- Final helper changes still require repetition; these passes are not presented as an unchanged-candidate qualification.
