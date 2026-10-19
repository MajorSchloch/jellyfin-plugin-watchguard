# WatchGuard v0.5.1 — Saved Recently added sorting

**Published [v0.5.1](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/releases/tag/v0.5.1).**

WatchGuard v0.5.1 adds persistent **Recently added** sorting to personal Watchlists defaults.

Target: Jellyfin Server/Web 12.2.0, .NET 10; stable plugin GUID and ABI unchanged.

- Save **Recently added** as the authenticated account's default Watchlists sort.
- Explicit owner/status/sort URL parameters independently override saved defaults without saving shared links or ordinary filter changes.
- Saving Title or Playback recency replaces the override; Reset removes the complete saved view.
- Existing save/reset errors and account-isolation checks remain visible and enforced.

## Storage, downgrade and recovery

`preferences.json` remains strict schema 1 and uses Title as the fallback for added sorting. Only the new `preference-sorts.json` records added overrides. Published v0.5.0/v0.4.10 can read and write the legacy file unchanged. Their saves/resets invalidate stale overrides conservatively across all accounts; old defaults are not intentionally resurrected on re-upgrade. No watchlist/date schema, deletion rule, approval protocol or loader change.

Back up both preference files with Jellyfin stopped. Reload clients after any version change. Downgrade uses Title with saved owner/status fields; untouched re-upgrade restores added, while a legacy save/reset requires explicitly saving added again. Corrupt data blocks reads/writes and is preserved. Interrupted writes can lose added overrides or partially commit legacy preferences and report an error. See [storage design and filesystem limitations](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/blob/5da0d56be6324326b5826e303fbbe583f12f0de6/docs/saved-sort-v051.md).

## Verified qualification

[Publication run 39173529151](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/39173529151) passed on commit `925a4fba061c8ecc79f01fa4626fd7aa4e5e3989`: build, all ten integration suites and publication succeeded. The catalog now lists 0.5.1.0; the checksums below are unchanged.

[Release qualification run 39156214258](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/39156214258) passed on [commit `5da0d56be6324326b5826e303fbbe583f12f0de6`](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/commit/5da0d56be6324326b5826e303fbbe583f12f0de6), with `proxy_matrix` enabled. The build and all ten integration suites passed; the publish job was skipped.

- **207 backend tests** passed, including strict legacy schema, API authorization, concurrent saves, replacement/reset, corruption and interrupted-write states.
- **109 JavaScript tests** passed across the Web, bootstrap, server-enforcement and browser-readiness suites, including saved sorting, independent URL precedence, stale-account responses and diagnostic/trace lifecycle failures.
- **14 Python infrastructure/hygiene tests** and **4 catalog tests** passed.
- All ten integration suites passed: standalone/Caddy, migration, official-image base path, legacy/rollback, WebSocket, discovery, verification performance, server enforcement, server enforcement with a base path, and LinuxServer server enforcement.
- The pinned LinuxServer Jellyfin 12.2 fixture in the standalone/Caddy suite verified preference persistence across server restarts and all eight downgrade/re-upgrade cases against checksum-verified published v0.5.0/v0.4.10 DLLs: untouched downgrade, identical legacy save, Playback recency save and reset. Native HTTP corruption checks preserved both preference files on 503 responses; watchlist/date files remained byte-identical. Structured evidence in the run artifacts: `preference-roundtrip-v051.json`.
- Browser checks through Caddy HTTPS verified Recently added save/reload, independent URL fields, dropdown sort replacement, reset, visible failed mutations and native login switching between administrator and ordinary accounts. Preference browser checks also passed in migration and official-image base-path suites. Structured evidence in the run artifacts: `settings-validation.json`.
- Two builds produced identical `Jellyfin.Plugin.WatchGuard-v0.5.1.zip` SHA-256 `61148bd7db0ac4d3f309b2a3e05d633aed893800b4092fa78c1d400f15b8d2bc`; runtime payload remains only the plugin DLL and LICENSE. Catalog validation passed without changing the public manifest.

## Resolved test-infrastructure issue

The earlier [LinuxServer failure in run 39147837958](https://github.com/MajorSchloch/jellyfin-plugin-watchguard/actions/runs/39147837958/job/117735436717) exposed a diagnostic cleanup bug: failed page-state or screenshot capture could leave tracing active, and restarting tracing masked the original navigation failure. The qualified commit fixes independent diagnostic capture and trace cleanup, restarts tracing only after a successful stop, and retains the sanitized original error while reporting diagnostic failures separately. Raw traces remain outside uploaded artifacts. The single pre-authentication `ERR_NETWORK_CHANGED` navigation retry is preserved; authentication, approval and deletion operations are never retried. The subsequent qualification run passed the previously failing LinuxServer suite and the full matrix without relaxing security assertions or checksum validation.
