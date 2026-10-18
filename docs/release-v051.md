# WatchGuard v0.5.1 — Saved Recently added sorting

**Unreleased candidate.** The public release/catalog remains v0.5.0. Merging and publication require review.

Target: Jellyfin Server/Web 12.2.0, .NET 10; stable plugin GUID and ABI unchanged.

- Save **Recently added** as the authenticated account's default Watchlists sort.
- Explicit owner/status/sort URL parameters independently override saved defaults without saving shared links or ordinary filter changes.
- Saving Title or Playback recency replaces the override; Reset removes the complete saved view.
- Existing save/reset errors and account-isolation checks remain visible and enforced.

## Storage, downgrade and recovery

`preferences.json` remains strict schema 1 and uses Title as the fallback for added sorting. Only the new `preference-sorts.json` records added overrides. Published v0.5.0/v0.4.10 can read and write the legacy file unchanged. Their saves/resets invalidate stale overrides conservatively across all accounts; old defaults are not intentionally resurrected on re-upgrade. No watchlist/date schema, deletion rule, approval protocol or loader change.

Back up both preference files with Jellyfin stopped. Reload clients after any version change. Downgrade uses Title with saved owner/status fields; untouched re-upgrade restores added, while a legacy save/reset requires explicitly saving added again. Corrupt data blocks reads/writes and is preserved. Interrupted writes can lose added overrides or partially commit legacy preferences and report an error. See [storage design and filesystem limitations](saved-sort-v051.md).

## Actual validation

- 207 backend tests passed, including strict legacy schema, API authorization, concurrent saves, replacement/reset, corruption and interrupted-write states.
- 96 JavaScript/bootstrap/server-enforcement tests passed, including added save/reload, independent URL precedence and stale-account responses.
- 14 Python infrastructure/hygiene tests, 4 catalog tests, candidate/current-document link checks and syntax checks passed.
- The pinned official Jellyfin 12.2 Docker fixture passed actual server-restart persistence and all eight downgrade/re-upgrade cases against checksum-verified published v0.5.0/v0.4.10 DLLs: untouched downgrade, identical legacy save, Playback recency save and reset. Native HTTP corruption checks preserved both preference files on 503 responses; watchlist/date files remained byte-identical. Structured evidence: `artifacts/preference-roundtrip-v051.json`.
- Native settings/browser checks passed: added save/reload, independent URL fields, dropdown sort replacement, reset, visible failed mutations and native login switching between administrator and ordinary accounts. Structured evidence: `artifacts/settings-validation.json`.
- The complete direct official-image `tests/docker-smoke.py` run passed: backend HTTP, standalone authentication/CSP, native configuration and preference browser checks, existing movie/series/context-menu/Escape/bulk deletion regressions, and uninstall with retained data and unchanged Web files. The separate `--preference-roundtrip` run completed its native round-trip phase before exposing the browser readiness issue described below; the corrected browser was then exercised by the successful complete direct run.
- Two builds produced identical candidate ZIP SHA-256 `61148bd7db0ac4d3f309b2a3e05d633aed893800b4092fa78c1d400f15b8d2bc`; runtime payload remains only the plugin DLL and LICENSE. Catalog validation passed without changing the public manifest.

Development fixture failures were retained and corrected: checksum validation rejected a stale local v0.4.10 ZIP (replaced with the actual published asset); live host-file repair was replaced with the documented stop/restore/restart procedure; browser helpers now wait for fresh documents and actual mutation responses instead of old ready/saved UI state. Security assertions and checksum pins were not relaxed.

The full hosted release matrix, LinuxServer/Caddy and catalog migration suites have not been rerun for this candidate. The existing parallel workflow includes the new preference round-trip in its standalone/Caddy job and retains all previous suites. Full release qualification and publication remain separate review gates; this candidate is not a published release.
