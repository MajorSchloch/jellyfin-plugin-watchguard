# WatchGuard v0.7.12 preparation

Unpublished compatibility patch. Do not publish until review and the release-environment approval are complete. The public catalog and published binaries remain unchanged.

See [browser changes, validation and remaining physical-TV work](browser-compatibility.md). Publication copy is maintained separately in [release notes](releases/v0.7.12.md).

The minimum Jellyfin ABI remains 12.2. The unchanged qualification matrix requires Server/Web 12.2, 12.3 and 12.4 before this candidate can be published. This change does not alter the plugin GUID, host dependencies, authorization, deletion enforcement or storage formats.

[Validation evidence](evidence/browser79/README.md): all 39 compatibility suites passed for runtime commit `62bc4c0e491a864fbc021e21093af21fb4a5dff1`. The read-only publication rehearsal is blocked by the master/candidate version mismatch; no publication was requested or performed. Physical-TV validation remains pending.
