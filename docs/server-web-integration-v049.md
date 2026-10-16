# Stage B: isolated secure Web approval integration

This is a disposable research configuration, not a v0.4.9 release. Production v0.4.8, its loader/adapter, GUID, JSON schemas, deployment workflows and catalog stay unchanged. Read the [Stage A threat model](server-approval-threat-model-v049.md), [protocol](server-approval-protocol-v049.md) and [Stage B results](server-web-integration-results-v049.md).

## Delivery and native boundaries

The existing companion assembly gains two read/prepare routes and a disposable-only Web asset result filter. `WATCHGUARD_DISPOSABLE_SERVER_APPROVAL=1` still controls server enforcement. `WATCHGUARD_DISPOSABLE_SERVER_WEB=1` separately enables the experimental adapter. Neither flag is a production setting.

The Web filter matches exactly the existing `Jellyfin.Plugin.WatchGuard.Standalone.StandaloneController.Script` action. It runs only after the original action returns authenticated JavaScript successfully. It inserts the experimental adapter into that response and adds the already-resolved protection scope ID to the dialog's internal data. It does not modify Web files, bootstrap, middleware, unrelated HTML, error responses or authentication. Exact source markers must appear once; an unexpected source fails delivery instead of silently patching another module. No second BasePlugin identity is introduced. This response substitution is an isolation technique, not the recommended production packaging.

Only the qualified `LibraryController.DeleteItem/DeleteItems` actions enforce approval. Other HTTP actions, filesystem operations, internal cleanup, Sonarr/Radarr and Tdarr remain outside this boundary. See [coverage matrix](deletion-coverage-matrix-v049.md).

## Native transport evidence

Pinned Jellyfin Web commit `61b1f890365ad15138e943e694af723c1d47df2a` uses `jellyfin-apiclient` **1.11.0** in package-lock.json. The published npm tarball was verified against that lockfile's SHA-512 integrity. Its source-map `src/apiClient.js` shows:

- `deleteItem(itemId)`, lines 2030–2040: validate ID, `this.getUrl(Items/{itemId})`, then `this.ajax({type:'DELETE',url})`.
- `ajax`, lines 422–428: delegates to native `fetch`.
- `fetch`, lines 336 onward: adds native Authorization to request-local headers; non-GET requests use the non-reconnecting path. HTTP failures reject with the original Response; successful non-text responses resolve with the native Response.
- `fetchWithFailover` is used for eligible GET requests, not DELETE. No approval transport uses this retry path for mutation.

The package is [published here](https://registry.npmjs.org/jellyfin-apiclient/-/jellyfin-apiclient-1.11.0.tgz); [native deleteHelper](https://github.com/jellyfin/jellyfin-web/blob/61b1f890365ad15138e943e694af723c1d47df2a/src/scripts/deleteHelper.js) retains the native first confirmation and generic cancellation error. [Multi-select](https://github.com/jellyfin/jellyfin-web/blob/61b1f890365ad15138e943e694af723c1d47df2a/src/components/multiSelect/multiSelect.js) invokes individual `deleteItem` calls.

For approved protected single-item operations, the adapter uses that same native `ajax` transport and receiver with exactly one request-local `X-WatchGuard-Approval` header. Native authorization remains native. It neither invokes the original delete method again nor wraps all Ajax/fetch/XHR. Original response/rejection objects propagate. Clear and fallback paths invoke the captured original method with its receiver and arguments. Protected operations require the verified one-ID signature; unsupported signatures fail closed. The native bulk route remains Stage A-qualified, but Stage B does not introduce a bulk Web workflow.

## Capability and consent flow

`GET /WatchGuard/ExperimentalApproval/Capabilities` requires a current enabled human Jellyfin identity and returns no-store `{Protocol:1,State,Expected,Generation,Coverage}`. State is Enabled only after exact server action descriptor verification; registered-but-unverified is Unhealthy, explicit opt-out is Disabled. A genuine missing companion returns native 404. Protocol/schema errors, auth failures and network failures are never treated as absence.

The experimental asset carries only a server-enforcement **expectation**, used to fail closed on later absence. It is not proof of enforcement: every deletion queries fresh capabilities. Once enforcement is expected or observed enabled, Disabled/404 cannot silently downgrade that tab. Reload after deliberate removal/opt-out. A genuinely unavailable/disabled guard on a fresh non-expecting tab may use v0.4.8 behavior only after its normal fresh Protection check succeeds. No frontend variable or cached status approves deletion.

1. Native Jellyfin confirmation remains first.
2. The adapter captures ApiClient, receiver, user ID, token, native target URL and navigation location. It checks fresh capabilities and the existing authoritative Protection API, resolving and binding the exact movie/series or parent series.
3. The existing polished dialog displays the same reasons and users. Cancel starts focused; Escape/close still cancel. A compact text label says server approval is required or the warning is Web-only. No protocol challenge exists yet.
4. Only a true Delete Anyway decision starts `POST Prepare` with `{Action:'DeleteItem',Targets:[id]}`. Prepare performs fresh native identity/admin/visibility/CanDelete and InterestService checks. It creates a Stage A Created challenge, never invokes deletion, and returns its exact action, target, scope, generation and expiry. If fresh interest has disappeared, it returns Clear without creating an approval; the already-confirmed protected flow stops for renewed review.
5. Present returns fresh authorized protection plus operation/scope/generation fields. The adapter validates shape, exact ordered target set, parent scope, expiry and normalized user/reason sets against the warning already confirmed. It re-resolves target/name/type/parent before approval. Any changed interest or target requires starting again, never silent renewed consent.
6. Approve requires the existing explicit `Decision:'Approve'`. Its complete response is validated against the same operation and expiry. Identity, native URL and navigation must still match at every asynchronous boundary.
7. One native DELETE carries the one-use header. The server independently rechecks identity, permissions, inventory and interest, atomically consumes and continues at most once.

Ordinary users and API keys gain no override. Existing ordinary-user Protection restrictions remain unchanged. Overview results never participate. No challenge is stored in local/session storage, URLs, logs or telemetry.

## Failure, lifecycle and queue semantics

A declined/closed dialog produces zero DELETE and no Prepare. Navigation closes a pending confirmation; account lifecycle uses the existing abort signal plus captured identity checks. Same-target concurrent calls share a pending operation; separate targets retain the existing serial dialog queue. Cancellation does not poison the queue.

Protocol requests use a 10-second timeout through native transport. This does not extend server expiry or retry mutations. An ambiguous Prepare/Approve timeout cannot cause automatic deletion. Abandoned identifiers are revoked best-effort only while the captured identity still matches; otherwise short server expiry is the fallback. No token is replayed under another account.

Expired/revoked/used challenges, restart, changed state, malformed responses, 401/403/409/410/429/503, unexpected capability loss and origin mismatch stop the flow. Before DELETE, feedback says no deletion was sent and asks for fresh review. After any native DELETE failure it explicitly says the outcome may be uncertain, directs the user to inspect the library and never claims file preservation. Native rejection remains intact; Jellyfin may still display its generic error. Error feedback has no Delete Anyway action and is not another approval dialog.

No automatic native DELETE retry, consumed approval reuse or expiry extension exists. Fresh rechecks reduce but do not eliminate the Stage A TOCTOU interval. The server remains authoritative even if a stale v0.4.8 tab sends Delete Anyway without approval: it receives 409.

## Disposable installation, proxy and rollback

```sh
dotnet test experiments/ServerApproval.Tests -c Release
node --test experiments/ServerApproval/server-web.test.cjs tests/*.test.cjs
python3 experiments/ServerApproval/docker-test.py --web
python3 experiments/ServerApproval/docker-test.py --web --base-path /jellyfin
```

The fixture co-locates the companion with the SHA-256-verified published v0.4.8 DLL, as required by native plugin load contexts. It preserves the original Stage A run before restarting with Web opt-in. All files/users are generated in temporary paths; no existing server configuration can be supplied. The direct fixture additionally qualifies the pinned Caddy HTTPS container and configures only its exact IP as a native trusted proxy. Origin validation is unchanged. Caddy/root-path and direct/base-path are distinct tested configurations, not proof for every proxy topology.

Rollback: stop the disposable server, remove only the companion and its two environment flags, keep v0.4.8/configuration/watchlists/preferences, restart and fully reload Web clients. Pending approvals vanish; no Web-file repair is required. Stage B tests also restart with guard disabled but the Web experiment present, verifying fresh-tab Web-only fallback. Old expecting tabs deliberately require reload rather than silent downgrade.

## Production packaging recommendation

Prefer a separately reviewed **single WatchGuard assembly** with normal embedded Web resources and supported MVC registration. Do not ship the companion as a second plugin identity or require manual co-location. Replace experimental response substitution with normal asset compilation only after approval; it exists here to leave production source untouched. Review explicit activation/migration, version-mismatch behavior, API-key policy, quota UX, stale tabs, proxy trust and diagnostics before changing defaults. Run the complete production catalog and platform matrix before release. Stage B is not authorization to package, publish or deploy v0.4.9.
