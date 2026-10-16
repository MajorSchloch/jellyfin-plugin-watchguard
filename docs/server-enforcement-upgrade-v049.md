# v0.4.9 upgrade and rollback

This candidate is not published. Do not point a production catalog at test artifacts. Normal installation after publication uses the existing WatchGuard catalog and stable plugin GUID; the package contains one WatchGuard DLL and LICENSE. No companion assembly, Injector, environment variable or Web-file modification is required.

## Before upgrading

1. Record the running Jellyfin image and retain the published v0.4.8 ZIP. Its SHA-256 is `06f33f62d06d864b63c879213ec1b3536d81c8ebb0ab7ac186b6820580aa24d5`.
2. Stop Jellyfin and back up its configuration volume, including WatchGuard's configuration XML, `watchlists.json` and `preferences.json`. Preserve ownership and permissions. See [deployment paths](deployment.md). LinuxServer.io discovers plugins under `/config/data/plugins`; use the actual configured plugin data directory, not an assumed version-folder location, for the JSON stores.
3. Ensure no experimental ServerApproval/ServerGuardPoC companion DLL is installed. Do not place the candidate beside another manually installed WatchGuard DLL. Native catalog version directories may coexist as superseded versions; only one should be active.

## Upgrade and opt in

Install the published version through native plugin management, restart Jellyfin and fully reload Web clients. An old XML configuration with no `EnableServerEnforcement` field loads **false**. Existing activity settings, DiagnosticMode and ProtectCaughtUpSeries values remain; both JSON schemas remain 1.

First verify Web-only operation. Settings must show configured off and runtime disabled. A successfully attached but inactive filter is not server enforcement. The default path adds no server challenge or veto.

Before opting in, review [client restrictions and coverage](server-enforcement-v049.md) and [security/proxy requirements](server-enforcement-security-v049.md). Clients without the approval protocol cannot override protected deletions. API keys are rejected by the enabled guard. Configure Jellyfin's native trusted proxies using the actual Caddy IP/subnet under your control; a Docker service name is not automatically trusted.

Save `EnableServerEnforcement=true` in WatchGuard's native dashboard page. Until restart, runtime remains disabled and restart-required must be visible. Restart, reload clients, and verify both exact native actions are attached, the runtime is active, and the current browser's authenticated capabilities are healthy. Verify cancellation and approval with disposable media before relying on this installation. A true checkbox alone proves none of these properties.

## Disable and rollback

1. Stop initiating deletion operations. Save enforcement off if the current version is healthy. Saving does not disable the running guard; restart is required.
2. Restart and fully reload clients. A tab that already observed active enforcement deliberately refuses to downgrade until reloaded. Pending approvals never survive a process restart.
3. For rollback, install the retained, checksum-verified published v0.4.8 through native plugin management, removing/deactivating the candidate as required by Jellyfin's version selection. If native management is unavailable, stop Jellyfin first, move the candidate plugin directory out of discovery, and restore the known-good v0.4.8 package and its valid native metadata. Never edit `meta.json` to impersonate another version or leave duplicate active assemblies.
4. Restart and confirm one active v0.4.8 plugin. Fully reload every Web client. Rollback restores Web-only protection; the new server approval routes no longer exist. Verify personal memberships, preferences and existing configuration values against the backup.

v0.4.8 tolerates the unknown enforcement XML element but may omit it when saving its older configuration model. Therefore do not rely on the opt-in preference surviving an old-version save; recheck it after upgrading again. No JSON restoration or migration is required merely to change plugin versions. Restore backups only for an actual recovery, accounting for any legitimate memberships/preferences changed since the backup.

Native Jellyfin can reactivate an older superseded plugin when the newest is uninstalled. Inspect all retained versions. To remove WatchGuard entirely, remove unwanted historical versions through native plugin management and restart. Close/reload existing tabs; no native Web files need repair. Retain plugin data if later reinstall is intended.

## Disposable validation

The native catalog fixture exercises v0.4.8 → v0.4.9 with the old version directory left in place, no manual DLL retirement, old XML missing the new field, both schema-1 stores and one active candidate. Separate enforcement fixtures test activation, deactivation, restart invalidation and rollback to the exact published v0.4.8 artifact. The normal regression matrix also retains v0.3.1 migration and historical catalog round trips. See [qualification results](server-enforcement-v049.md) for the final artifact and observed results.
