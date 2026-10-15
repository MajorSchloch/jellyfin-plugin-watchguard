# Isolated HTTP deletion guard PoC

Research prototype, baseline **published WatchGuard v0.4.8**, Jellyfin Server 12.2.0, .NET 10. Not a production v0.4.9 feature or release. See [results](server-guard-poc-results-v049.md) before interpreting attachment logs as protection.

## Isolation and installation

Source is in [`experiments/ServerGuardPoC`](../experiments/ServerGuardPoC). It is not referenced by the production solution, packaging or workflows. The separate `WatchGuard.ServerGuardPoC.dll` registers nothing unless the server process has `WATCHGUARD_DISPOSABLE_SERVER_GUARD=1`. There is no production setting. It adds no override route, header or token. The existing loader, adapter, InterestService and Protection controller are unchanged.

Prerequisites: .NET 10, Docker, Python 3, curl with valid TLS trust, and the repository's Playwright test installation. Build/run from the repository root:

```sh
dotnet build experiments/ServerGuardPoC -c Release
dotnet test experiments/ServerGuardPoC.Tests -c Release
python3 experiments/ServerGuardPoC/docker-test.py
python3 experiments/ServerGuardPoC/docker-test.py --base-path /jellyfin
```

The fixture accepts **no remote server, config or media path**. It creates a temporary config and generated media, binds an ephemeral localhost port, mounts only those temporary directories, and removes the container/directories in `finally`. It downloads the actual published v0.4.8 ZIP and requires SHA-256 `06f33f62d06d864b63c879213ec1b3536d81c8ebb0ab7ac186b6820580aa24d5` before extracting the baseline DLL. It pins the official image to `jellyfin/jellyfin:12.2@sha256:357724bf0ae27a672c7cbaa899db2d9abeb13dbd8657ccce750258a4c059d037`. No Injector is installed.

**Load-context constraint:** the experiment DLL must share the disposable WatchGuard plugin folder with the published WatchGuard DLL. A separate folder attached the MVC filter but could not resolve InterestService's assembly at request time. Jellyfin uses separate plugin load contexts. Co-location reuses the actual service without copying its logic or replacing a native service. This folder is one native plugin-manager lifecycle unit; the companion assembly is not separately listed in Dashboard. Do not copy it into a real installation.

The fixture writes an explicit *temporary* `meta.json` with WatchGuard's existing GUID/version, `targetAbi: 12.2.0.0`, `status: Active`, `autoUpdate: false`. Without a versioned folder/manifest, Jellyfin infers a manual folder's local version from the server version, which does not match the assembly version displayed by `/Plugins`; versioned Disable requests can return 404. No public manifest or release metadata is modified.

Removal in a manually maintained **disposable** fixture: stop Jellyfin, remove only `WatchGuard.ServerGuardPoC.dll`, unset the environment variable, restart and confirm no new `WG-GUARD-POC attached` log. Keep the published WatchGuard DLL and its JSON/configuration. Environment opt-out requires container recreation or a fresh process with the new environment. Native plugin disable acts on the whole co-located folder and takes effect on restart. Existing MVC descriptors do not dynamically detach in a running server.

## Exact attachment and diagnostics

The [architecture investigation](deletion-architecture-v049.md) pins the source and execution order. `IPluginServiceRegistrator` registers an `MvcOptions` application-model convention, a transient `IAsyncActionFilter` and a startup attachment reporter. The convention requires:

- Native assembly name `Jellyfin.Api`, controller full name `Jellyfin.Api.Controllers.LibraryController`.
- Both methods, exactly once: `ActionResult DeleteItem(Guid itemId)` and `ActionResult DeleteItems(Guid[] ids)`.
- Their native `HttpDelete` templates, `Items/{itemId}` and `Items`.
- Native host application version 12.2.0. The API assembly itself reports 1.0.0.0; using that as the Jellyfin version would be incorrect.

Only those two actions receive the service filter. The reporter forces descriptor construction and checks that exactly two descriptor filter entries exist. Success logs `attached=2 supported=true veto-only; interception still requires HTTP qualification`. Mismatch logs `UNSUPPORTED`/critical diagnostics and attaches nothing; **it does not fail the entire server closed or guarantee protection on an unsupported server**. Unit tests check version mismatch and a missing action. No non-12.2 container was used.

Per-invocation logs contain only an outcome code, number of authoritative scope evaluations and pre-action elapsed milliseconds. They do not include targets, usernames, tokens, playback records or exception messages. No interest work is performed for unrelated actions. Startup attachment is necessary but insufficient: actual veto evidence is required.

## Request behavior

Framework authentication/authorization and native action binding remain in place. The filter then:

1. Requires an authenticated, enabled native user. **All API-key deletion is rejected with 403**, a deliberately restrictive PoC policy, even for unprotected targets. It never manufactures an administrator.
2. Validates the bound GUID/array. Empty IDs/sets, duplicates and more than 100 targets are rejected without truncation. This is a PoC request bound, not a change to production configuration.
3. Resolves every target through native user-scoped `GetItemById<BaseItem>` and checks `CanDelete(user)` before evaluating interest. Missing/inaccessible items return 404; failed native permission returns 401. It never exposes interested users in any response, including to administrators.
4. Accepts movies and series. Episodes/seasons require a visible native Series from their SeriesId. A series plus its season/episode, or a season plus its episode, is rejected as overlapping. Unsupported targets and unresolved scope fail closed.
5. Deduplicates resolved *protection scopes within this request* and calls the unchanged fresh `InterestService.Get(scope, requesterId)`. There is no overview, cached authorization or persistent approval. Explicit watchlists, unfinished viewing, current playback, configurable CaughtUp and self/other interest use existing semantics.
6. Returns 409 with `Code: WatchGuardProtectionRequired` if protected. Lookup exceptions return 503 `ProtectionUnavailable`; cancellation before native continuation does not execute the action. Responses have `Cache-Control: no-store` and generic text only.
7. If every target is clear, calls `next()` once, outside the lookup-error catch. The native controller repeats its own checks, produces its normal result and retains its normal exception handling. The filter never calls a deletion service itself.

Other codes include `InvalidTargetSet`, `OverlappingTargets`, `TargetUnavailable`, `DeletionNotPermitted`, `ApiKeyDeletionUnsupported`, `ScopeUnavailable` and `UnsupportedTarget`. Native framework failures may have their own response schema. For example, the native library-root item is undeletable and fails permission before type evaluation.

Bulk preflight prevents a known protected last item from causing deletion of earlier items. It does **not** create a filesystem transaction: failures and concurrent changes after continuation can still cause partial native deletion. Distinct IDs referencing the same physical path are not a filesystem-level deduplication guarantee. Concurrent clear requests retain native behavior; no lock or idempotency protocol is introduced.

## Web behavior and boundaries

The unchanged Web adapter still makes its fresh Protection request and presents its normal dialog. Cancel sends zero DELETEs. In this PoC, Delete Anyway sends one DELETE that the server rejects with 409; Jellyfin displays its existing generic error and media survives. This is intentionally **not** the full production deletion UX. No confirmation bypass is provided.

Only the two native HTTP actions are guarded. Internal cleanup, retention, other plugin deletion services, Live TV recording routes, library configuration changes and external filesystem tools remain outside this scope. No source/binary patches, replacement core services, global authorization changes or broad DELETE URL matcher are used.

This is supported ASP.NET extension machinery attached to version-specific Jellyfin action identities, not an upstream Jellyfin pre-delete contract. Same-process races between preflight and mutation remain. A future confirmation protocol needs separate design for exact target/identity binding, native permission rechecks, expiry, replay/race handling and bulk semantics. It must not trust a client “override” flag or ActivityOverview. No such protocol is implemented here.
