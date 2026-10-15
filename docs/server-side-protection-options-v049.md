# v0.4.9 server-side protection options

## Recommendation

**Option 2: only a constrained subset is technically feasible through standard framework extension mechanisms. No native supported Jellyfin pre-delete veto contract was found.** Retain the existing Web protection in production. Do not create a v0.4.9 release for this research alone.

The evidence supports a narrowly attached ASP.NET Core MVC action filter as a possible way to stop the two native HTTP item-delete actions before they execute. It does **not** establish a qualified WatchGuard implementation, an officially supported Jellyfin deletion extension, universal interception, or a stock-client approval experience. The native event occurs after mutation. Internal cleanup, recording retention and filesystem changes bypass those HTTP actions.

No prototype was added: the investigation did not find the native supported pre-delete hook that would justify immediately implementing one. The framework-filter candidate needs a separately qualified, version-specific design and the tests in the [coverage matrix](deletion-coverage-matrix-v049.md). It should not be silently promoted to “supported server enforcement.” Source-level feasibility and proven deployment safety are different claims.

## Options compared

All source references and exact signatures are in [deletion architecture](deletion-architecture-v049.md).

| Option | Prevention and coverage | Compatibility/security/performance | Complexity and rollback | Decision |
| --- | --- | --- | --- | --- |
| A. Native cancellable pre-delete authorization hook | No such hook found. ItemRemoved is post-delete and exceptions are swallowed | No safe enforcement through this event; cannot undo filesystem mutation | Would require an upstream contract, not a plugin workaround | Prefer an upstream hook long-term; unavailable at the pinned version |
| B1. Exact MVC action filter | Can short-circuit the two HTTP item actions, independent of client; no internal/file coverage | Supported ASP.NET mechanism, version-specific native action attachment. Runs before inline CanDelete, requiring careful native preflight/privacy. Interest work only on delete requests | Moderate/high: bulk, keys, permissions, client challenges, concurrency. Restart/removal restores native behavior | Best constrained research candidate; not implemented or qualified |
| B2. Startup request middleware | Can reject a matched request before downstream execution | Standard IStartupFilter exists, but outer middleware lacks downstream native auth/route state; string matching/base paths and duplicate authorization are fragile. After-next interception is too late | High if reproducing native routing/auth. Rollback removes enforcement | No raw-path guard or global expensive middleware |
| C. Decorate/replace ILibraryManager or authorization services | Could affect some internal calls, but completeness across overloads/direct filesystem paths is unproven | DI capability is not a supported core-service replacement contract. Broad compatibility, lifecycle, cleanup and security impact | Very high, sensitive to upgrades and singleton dependencies | Reject; no runtime patches, binary changes or global auth replacement |
| D. Existing Web adapter plus diagnostics | Already prevents supported Web calls before DELETE; not native-client/API enforcement | Version-specific but tested, preserves native request contract and fresh checks. No unrelated server-request work | Lowest incremental risk; reinstall/rollback known. Browser delivery must actually be verified | Retain unchanged; current audit found no reproducible defect |
| E. Separate explicit administrator deletion workflow | Can guard operations initiated through that workflow only | Plugin-owned controller can use native services/permissions and fresh checks. Other native delete routes remain available unless separately constrained | Moderate/high; new workflow and approval protocol. Stock clients will not automatically use it | Possible opt-in workflow, not universal enforcement or a reason to replace the current UI now |

A separate workflow cannot be made exclusive just by adding a new endpoint. Removing native deletion permission also removes permission for a workflow that correctly preserves native permissions. An exclusivity design needs a real native guard/upstream hook; do not give the plugin privileged deletion rights to circumvent this.

## Narrow filter design to investigate, not shipped behavior

Use the supported `IPluginServiceRegistrator` to configure MVC application-model conventions, and attach a filter only to the exact native `LibraryController.DeleteItem` and `DeleteItems` identities. Validate method signatures and action metadata at startup. Never replace MVC providers, controller binaries, global authentication or bundled Web code. An incompatible version must report enforcement unavailable; it must not quietly advertise successful protection. Unknown routes added by a future server remain an explicit compatibility risk.

A filter can reject before the action executes. Framework authentication/authorization has already run, but native item visibility and CanDelete checks inside the action have not. Before exposing a challenge, use the same native item lookup and permission APIs, without broadening API-key or human-user rights. Let the original action perform its checks again on continuation. Do not call LibraryManager separately and then continue the action: that risks double deletion.

Resolve movie/series scope with the existing authoritative service; episodes/seasons inherit verified parent-series protection. Fresh Watchlisted, InProgress, CurrentlyPlaying and configured CaughtUp checks must remain separate from bounded ActivityOverview. Unknown/missing targets, failed queries and unsupported recursive/container semantics cannot be treated as no interest. Ordinary users must not receive other users' names or playback records. A permitted non-admin deletion may require a generic protected response and administrator approval rather than disclosure.

Preflight the whole bulk request before allowing its native action to begin. This can avoid a *known* protected later target causing partial deletion, but native I/O failures and concurrent changes can still cause partial completion. A filter cannot make LibraryManager/filesystem mutation transactional.

Normal playback, streaming, browsing and scans must not execute this filter or any playback verification. No cross-request protection cache. A guard would add fresh work to delete requests; measured cost and cancellation must be qualified with long-series fixtures.

## Client response and approval constraints

There is no existing native-client WatchGuard challenge protocol. A possible response is a non-success Problem Details result (for example 409 with a stable protection-required code). Stock clients may show a generic failure, not names or a usable approval dialog. They must remain blocked rather than implicitly bypassing protection. Cross-user detail retrieval/approval remains administrator-authorized. The current Web adapter must stay functional during any isolated prototype; avoiding duplicate prompts would need an explicit tested protocol, not automatic trust in a client header.

Any future override must satisfy all of the following:

1. Authenticate an enabled user and preserve native visibility/deletion permission both when issuing approval and immediately before execution. Cross-user information stays admin-only. API keys need an explicit restrictive policy; no synthetic administrator identity.
2. Use an unpredictable, short-lived, single-use server-held challenge bound to authenticated identity/session, server instance, exact target IDs, method, operation scope and a canonical target-set representation. Never a reusable global bypass query parameter or token in logs/URLs.
3. Require deliberate approval through an authenticated operation. Bind approval to the displayed protection state and resolved series/target identity. Re-evaluate fresh protection and native permissions before execution; materially changed interest/scope should require renewed confirmation.
4. Consume approval atomically and serialize competing approvals for the same operation. Reject tampering, cross-account replay, expiration and duplicate use. Continue the native action at most once, without skipping its checks.
5. Invalidate pending approvals on restart and define logout/session-revocation behavior. Cancellation must never consume approval into an execution request. Do not automatically retry after a timeout: the server may already have deleted the item.
6. Document the remaining race: native playback/watchlist state and filesystem deletion are not one transaction. A short-lived token plus recheck narrows this gap but does not eliminate it. Process failure after deletion but before responding also prevents an honest exactly-once-completion guarantee without additional durable coordination.

This protocol is a design constraint, not a delivered API. No override endpoints, tokens, settings or storage were added.

## Practical protection and rollback

Keep current fresh Web checks, self/other-user warnings, native confirmation, Cancel/Escape/close and explicit Delete Anyway. Retain the generic native cancellation error rather than spoofing success. Keep native account deletion permissions narrow and maintain backups independently; neither a Web adapter nor an HTTP guard protects media changes performed outside Jellyfin.

There is no migration for this investigation: plugin GUID/version, JSON schemas, preferences, configuration, loader and public catalog are untouched. No production deployment occurred. Current uninstall/rollback procedures still apply. If a future guard is disabled or removed, protection reverts to native permissions and any still-working Web adapter; it must never be described as server-enforced while disabled. Reload clients after plugin changes; old tabs are not reliable evidence of the current integration.

An upstream cancellable hook would be preferable if it covers all intended native deletion entry points **before the first external/filesystem mutation**, carries operation/caller context, defines failure/cancellation behavior, and preserves native authorization. Internal maintenance callers without an authenticated administrator would need an explicit policy. Such a hook still cannot intercept external filesystem tools.

## Validation and release decision

The [audit results and future regression plan](deletion-coverage-matrix-v049.md) separate tests actually run from unimplemented server scenarios. Current backend, JavaScript and LinuxServer.io/Caddy browser checks passed unchanged. No universal/server-side claim is justified by those tests. Existing full regression suites remain intact.

**Deliver research only.** No version bump, release ZIP, catalog update or production change is warranted. Revisit implementation after an upstream pre-delete contract or an explicitly scoped HTTP-filter prototype has demonstrated native permission/privacy preservation, bulk behavior, direct-API veto before mutation, secure approval, client behavior and safe rollback.
