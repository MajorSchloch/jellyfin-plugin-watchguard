using Jellyfin.Data;
using Jellyfin.Database.Implementations.Enums;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Net;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.DependencyInjection;

namespace Jellyfin.Plugin.WatchGuard.ServerEnforcement;

public sealed record PrepareRequest(string Action, Guid[] Targets);

[ApiController, Authorize, Route("WatchGuard/ServerApproval"), ResponseCache(NoStore = true, Location = ResponseCacheLocation.None, Order = int.MinValue)]
public sealed class WebProtocol(IServiceProvider services, IAuthorizationContext authorization, IUserManager users) : ControllerBase
{
    [HttpGet("Capabilities")]
    public async Task<IActionResult> Capabilities()
    {
        Response.Headers.CacheControl = "no-store";
        var auth = await authorization.GetAuthorizationInfo(Request);
        var user = auth.IsAuthenticated && !auth.IsApiKey ? users.GetUserById(auth.UserId) : null;
        if (user is null || user.HasPermission(PermissionKind.IsDisabled)) return Unauthorized();
        var attachment = services.GetService<Attachment>();
        var environment = EnvironmentStatus();
        var state = attachment?.ConfigurationCaptured != true ? "Unhealthy" : !attachment.EnabledAtStartup ? "Disabled" :
            attachment.Active && RequestOrigin.Accepted(environment) ? "Enabled" : "Unhealthy";
        var authorizationState = "NotRequiredWhileInactive";
        if (attachment?.Active == true)
        {
            try
            {
                await services.GetRequiredService<Identity>().Read(HttpContext);
                authorizationState = "NativeSessionVerified";
            }
            catch
            {
                state = "Unhealthy";
                authorizationState = "Unavailable; verify explicit native session authentication and request-origin diagnostics";
            }
        }
        return Ok(new { Protocol = 1, State = state, Expected = attachment?.EnabledAtStartup != false,
            Configured = Plugin.Instance?.Configuration.EnableServerEnforcement == true,
            RestartRequired = attachment?.RestartRequired == true,
            AttachedActions = attachment?.Count ?? 0, Compatible = attachment?.Supported == true,
            Runtime = attachment?.ConfigurationCaptured != true ? "RegistrationFailure" : attachment.Supported != true ? "Incompatible" : state,
            RequestEnvironment = environment, AuthorizationState = authorizationState,
            Generation = attachment?.Active == true ? services.GetRequiredService<ApprovalStore>().Generation : null,
            Coverage = "Native LibraryController.DeleteItem/DeleteItems only" });
    }

    private string EnvironmentStatus() => RequestOrigin.Evaluate(Request);

    // Exercises the same authentication/origin boundary as approval POSTs without
    // allocating a challenge, reading playback data, or mutating library state.
    [HttpPost("Readiness"), Consumes("application/json"), RequestSizeLimit(1024)]
    public async Task<IActionResult> Readiness()
    {
        Response.Headers.CacheControl = "no-store";
        var environment = EnvironmentStatus();
        try
        {
            await services.GetRequiredService<Identity>().Read(HttpContext, administrator: true);
            var attachment = services.GetService<Attachment>();
            return Ok(new { Authenticated = true, OriginStatus = environment,
                BrowserRequestVerified = environment is "SameOrigin" or "HttpsProxySameOrigin",
                GuardActive = attachment?.Active == true,
                ApprovalRequestsReady = attachment?.Active == true && environment is "SameOrigin" or "HttpsProxySameOrigin",
                Scope = "Request authentication and origin only; target permissions and fresh protection are checked per operation" });
        }
        catch (Exception error)
        {
            var failure = error as GuardFailure ?? new GuardFailure(503, "ProtectionUnavailable");
            return StatusCode(failure.Status, new { Code = failure.Code, OriginStatus = environment,
                ApprovalRequestsReady = false,
                Instructions = "Use an enabled administrator's explicit native session header. Preserve the public Host and browser Fetch Metadata. If the proxy rewrites Host or strips Fetch Metadata, configure Jellyfin's native trusted proxy handling; never trust arbitrary forwarded headers." });
        }
    }

    [HttpPost("Prepare"), Consumes("application/json"), RequestSizeLimit(8192)]
    public async Task<IActionResult> Prepare(PrepareRequest request)
    {
        Response.Headers.CacheControl = "no-store";
        try
        {
            if (services.GetService<Attachment>()?.Active != true) throw new GuardFailure(503, "ServerGuardUnsupported");
            var identity = services.GetRequiredService<Identity>();
            var principal = await identity.Read(HttpContext, administrator: true);
            using var admission = services.GetRequiredService<WorkAdmission>().Enter(principal.User.Id);
            var operation = Operation.Create(request.Action, request.Targets);
            var evaluator = services.GetRequiredService<Evaluator>();
            var fresh = evaluator.Read(operation, principal.User, HttpContext.RequestAborted);
            var final = await identity.Read(HttpContext, administrator: true);
            if (final.Owner != principal.Owner) throw new GuardFailure(409, "ApprovalInvalid");
            evaluator.CheckPermissions(operation, final.User, HttpContext.RequestAborted);
            var store = services.GetRequiredService<ApprovalStore>();
            var ticket = fresh.Protected ? store.Create(principal.Owner, operation, fresh.Fingerprint, fresh.Resources) : null;
            return Ok(new { State = ticket is null ? "Clear" : "Created", ChallengeId = ticket?.Id, ExpiresAt = ticket?.ExpiresAt,
                Action = operation.Action, Targets = operation.Targets, Scopes = fresh.Scopes, store.Generation });
        }
        catch (Exception e) { return Responses.Error(HttpContext, e as GuardFailure ?? new GuardFailure(503, "ProtectionUnavailable")); }
    }
}
