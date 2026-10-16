using Jellyfin.Data;
using Jellyfin.Database.Implementations.Enums;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Net;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.DependencyInjection;

namespace WatchGuard.ServerApproval;

public sealed record PrepareRequest(string Action, Guid[] Targets);

[ApiController, Authorize, Route("WatchGuard/ExperimentalApproval"), ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
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
        var state = attachment is null ? "Disabled" : attachment.Supported ? "Enabled" : "Unhealthy";
        return Ok(new { Protocol = 1, State = state, Expected = attachment is not null,
            Generation = attachment?.Supported == true ? services.GetRequiredService<ApprovalStore>().Generation : null,
            Coverage = "Native LibraryController.DeleteItem/DeleteItems only" });
    }

    [HttpPost("Prepare"), Consumes("application/json"), RequestSizeLimit(8192)]
    public async Task<IActionResult> Prepare(PrepareRequest request)
    {
        Response.Headers.CacheControl = "no-store";
        try
        {
            if (services.GetService<Attachment>()?.Supported != true) throw new GuardFailure(503, "ServerGuardUnsupported");
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
