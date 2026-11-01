# v0.7.13 removal feedback

The removal handler wrote an error directly into the alert. Activity completion then rendered the unrelated activity-error array over that text. A failed DELETE could therefore leave its card present with no visible error.

The correction stores removal failures by title, separately from activity failures. Background completion, polling and Refresh retain that feedback. Retry clears only that title's failure; success preserves failures for other titles. A new filter/search context, authorization denial or page/account teardown clears action feedback. The captured context prevents a late response from restoring it. One pending removal per title prevents duplicate requests, including during the indexed refresh after success.

No endpoint, membership format, native history or deletion-protection rule changes. The reviewed outgoing handoff and navigation implementation remain byte-for-byte unchanged. The version remains **0.7.13**, unpublished. Public catalog entries and previous release assets remain unchanged.

## Original failure and historical package

[Qualification run 41252629663](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/41252629663), attempt 1, failed in job `124689435061`. Artifact `13061947766` retains the original browser evidence. The `legacy-browser` scenario ran the immutable published **v0.3.1 Injector package**, not the v0.7.13 candidate. Its SHA-256 is `c4ac915c3f35a28e6737bd68580f712cd0e0e113735a6d399c2a889c7ae7b2f2`.

The shared browser regression now forces this order:

1. Reload Watchlists and hold the initial native activity request.
2. Show preliminary membership cards and click Remove.
3. Return 503 for exactly one DELETE and verify the visible error.
4. Release activity, wait for its loading state to finish, then check the error and both cards.
5. Retry successfully and verify removal feedback clears.

There are no sleeps, automatic retries, longer timeouts or relaxed assertions. The legacy package fails at step 4: its alert becomes empty. This is a deterministic reproduction of its existing defect. A source correction cannot change those published bytes. The original reproduction failed and remains in the evidence below. The accepted historical policy now records this exact loss as **KNOWN_LIMITATION**, then continues all remaining historical assertions. It does not count the lost error as passing.

The fixture verifies the published ZIP hash, its DLL hash and the actual container DLL hash before the browser starts. Native plugin enumeration must show exactly one active WatchGuard with the expected assembly version. Integration status must report that version both during deployment verification and during the browser scenario. The browser independently checks those identity fields against the pinned v0.3.1 identity. A legacy-mode flag alone cannot enable the exception.

Published v0.3.1 DLL SHA-256: `a03f3a566823a9a37c9b92f0f00365ade5cdbf780c4e3a4c6b3feb9b843a73d7`.

Only an empty post-completion alert in that exact package receives the limitation outcome. A candidate must retain its error. Unknown or mismatched package/DLL identity, changed live version, unexpected feedback, extra DELETEs, changed cards/membership or any failed retry still fails. The historical outcome appears separately in browser JSON, console output and the qualification summary. The gate and suite inventory are unchanged.

## Initial focused validation

Runtime/test commit: `25f91bfe522fd45189c5f66a9f004a30f70b826c`.

- Eleven focused tests pass. The first eight reproduced five failures on unchanged master, including both preliminary-query paths, polling and authorization denial.
- All 226 JavaScript tests, 94 Python tests, eight catalog tests and 376 backend tests pass.
- The actual package's five browser resources, settings scripts and combined startup parse as ES2019 and in real Chromium `79.0.3945.0`.
- Candidate ZIP SHA-256: `7b1d029d0e0e35947b70154e1fa1ec1f9cfad87164d9609059331d18640f44df`.
- Candidate DLL SHA-256: `608ea2c650d64f3919db1adc09cdccea4216745aa8460ca433a4f83a8fa48fe4`.
- Native tests use Jellyfin Server/Web **12.3.0**, official image `jellyfin/jellyfin:12.3@sha256:2038fe038ab3876a80f6e7b7e0aef6607b032c7dc0c9b3ad3296d0b2eba3bbb5`, locked Playwright 1.56.1 and Chromium 141 on macOS. This is browser automation, not physical-TV validation.

The full candidate fixture passed in 392.762 seconds, including 32 recorded browser paths and zero ordering violations. Its browser actions/permissions phase took 357.289 seconds. Removal retry, native history, permissions, account isolation, deletion checks and cleanup passed. [Native results](evidence/removal-feedback-v0713/native-candidate.json) retain the paths and phase timings.

[Normal PR checks, run 41256467437](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/41256467437), attempt 1, passed in 42 seconds. Package artifact `13063516160` is byte-identical to the locally tested ZIP. [Validation summary](evidence/removal-feedback-v0713/validation.json) records the hashes and distinction between candidate success and historical failure.

The candidate retains the error after activity completion, with two cards and one failed DELETE. The first candidate run passed this race but stopped at a new success assertion: an empty alert has no visible accessibility box. The assertion now reads its DOM text directly. No assertion or timeout was weakened. Original reports remain under `artifacts/v049/official/direct/standalone/watchguard-poc-9baa26f451` locally.

[Historical lost error](evidence/removal-feedback-v0713/published-v031-error-lost.png) · [Candidate retained error](evidence/removal-feedback-v0713/candidate-error-retained.png) · [Historical observations](evidence/removal-feedback-v0713/published-v031.json) · [Candidate observations](evidence/removal-feedback-v0713/candidate.json)

## Accepted historical policy validation

The reviewed runtime, package hashes and v0.7.13 version remain unchanged. The policy adds negative tests for missing, changed and duplicate deployment identities; version mismatches; unknown ZIPs/DLLs; candidate error loss; and unexpected historical feedback. It retains every catalog, migration and rollback scenario.

The full fast suite now includes 228 JavaScript tests, 100 Python tests and eight catalog tests. Focused native results for both identities are recorded after the runs finish. Original failure evidence remains above and in the earlier validation record.

## Qualification after merge

Do not reuse run 41245891354 or the failed run 41252629663 as publication authority for the changed package. No full branch matrix was run for this correction.

After merge, manually dispatch **Qualify WatchGuard** on `master` with `publish=true` and `proxy_matrix=true`:

```sh
gh workflow run release.yaml --ref master -f publish=true -f proxy_matrix=true
```

This command is an operator instruction; it was not executed during this work. `Directory.Build.props` is unchanged, so the automatic push trigger will not fire. Fresh master qualification must validate the changed package, and release-environment approval remains required before publication.
