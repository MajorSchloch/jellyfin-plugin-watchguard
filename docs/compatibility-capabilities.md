# Compatibility capabilities (v0.7.6)

WatchGuard separates runtime/API requirements, native deletion interception and browser integration. The qualified Server/Web releases are **12.2.0 and 12.3.0**. Qualification uses one package on both hosts, including official and LinuxServer images. A version match alone never means that server enforcement is active.

## Bounded acceptance

The runtime/deletion envelope is **12.2.x and 12.3.x release versions on .NET 10**, with a nonnegative patch number and no nonzero fourth revision. Unknown minor/major families, incomplete versions and revision builds are unsupported. Patch releases within these two already-qualified API families may pass the mandatory capability checks, but are labelled **compatible but untested** until their exact release is integration-qualified. Tests using 12.2.1/12.3.1 are simulations, not qualification of real releases.

This deliberately small expansion removes the exact patch-zero restriction. It does not assume a new minor release preserves ABI, authentication, controller semantics or Web routing. There is no remaining exact server-release gate: exact versions identify the real qualification set; the minor-family/runtime boundary and explicit structural contracts restrict acceptance. Method signatures alone cannot prove implementation behavior.

The package still references Jellyfin Controller/Model **12.2.0**, targets .NET 10 and keeps the minimum catalog ABI **12.2.0.0**. The same artifact must continue passing both hosts. A catalog minimum is an installation floor, not an open-ended compatibility claim. Assembly/type/member resolution can fail before WatchGuard loads; those failures require server-log diagnosis and cannot be reported by an unloaded plugin.

## Independent checks

- **Runtime/API:** plugin assembly loaded; compiled Jellyfin type/member signatures resolve against the loaded host; required identity, user, library, user-data and live-session APIs and service registrations present; .NET and version envelope satisfied. Resolving the artifact’s metadata is capped at 4,096 native references and invokes no library or playback methods. This bounded startup probe does not scan media or certify every future API implementation.
- **Deletion surface:** exactly the native LibraryController and both deletion methods; expected return/parameter contracts; single DELETE templates and empty native controller prefix; default authorization without anonymous/policy/scheme overrides; route Guid and the native comma-delimited query binder. An additional DELETE action in this controller is unsupported.
- **Final attachment:** after all MVC conventions run, inspect the actual descriptors for both actions, final routes, authorization metadata, effective parameter binding and one non-reusable guard per action. Missing, duplicate or conflicting selectors cannot pass merely because two filters were counted. Check the native DefaultAuthorizationRequirement/DefaultAuthorizationHandler and CustomAuthentication scheme/handler from the same native API assembly. A generic ASP.NET authenticated-user policy is not a substitute for Jellyfin’s permission contract. Live identity, target permissions and protection are still revalidated on each guarded operation.
- **Browser:** report Web's own version separately from Server; check authenticated request methods, Watchlists methods, the current deletion adapter, standalone bootstrap execution, recognized native layout/navigation and History API. No additional requests or timers support these diagnostics. Missing optional navigation or browser support does not deactivate the server guard or unrelated API features. On dashboard/login/playback, navigation is unavailable for inspection; open Home to check it. Loader delivery/build availability checks do not prove every browser path works.

The Integration status page presents **tested**, **compatible but untested**, **unsupported**, or **unavailable**, with failed checks and recovery actions visible and passing details expandable. Configured enforcement, restart requirement and **actual active enforcement** are separate. Even on a qualified version, missing required hooks means no protection claim. Browser failure does not change the server's protection status.

The MVC convention prepares attachment; final descriptor verification establishes structural attachment. This follows the [ASP.NET Core application-model lifecycle](https://learn.microsoft.com/en-us/aspnet/core/mvc/controllers/application-model?view=aspnetcore-10.0). Native integration tests, rather than reflection, establish observed deletion/permission/approval behavior.

## Unchanged deletion-failure boundary

If the convention cannot recognize the endpoints, it attaches no filters and reports unsupported. **Native deletion may remain usable without WatchGuard enforcement.** This is not a server-wide fail-closed barrier. If already-attached, enabled guards encounter incomplete verification or unavailable protection, they reject intercepted operations (503) without invoking the native action. Explicitly disabled enforcement delegates to native behavior. A future startup refusal or narrow deny barrier requires a separate security/availability decision; this change introduces neither.

Coverage is the verified native HTTP item deletion surface only. A new unrelated controller, non-HTTP deletion mechanism, direct filesystem access, changed method internals or third-party middleware can exceed what static probes establish. Approvals, permissions, account isolation and native continuation regressions therefore remain mandatory. Browser warnings and authoritative Protection are not substitutes for server attachment.

## Evidence

See [v0.7.6 preparation and qualification](../release-preparation.md). Historical [v0.7.3 compatibility](compatibility-v073.md) and [v0.7.5 two-host qualification](drawer-qualification-v075.md) remain preserved. Simulated future contracts must stay labelled separately from real host qualification.
