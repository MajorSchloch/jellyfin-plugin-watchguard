using System.ComponentModel.DataAnnotations;
using System.Diagnostics;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace WatchGuard.ServerApproval;

public sealed record ApprovalRequest([Required, StringLength(64, MinimumLength = 64)] string ChallengeId, string? Decision);

[ApiController]
[Authorize]
[Route("WatchGuard/ExperimentalApproval")]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class ApprovalController(IServiceProvider services, ILogger<ApprovalController> logger) : ControllerBase
{
    [HttpPost("Present"), Consumes("application/json"), RequestSizeLimit(1024)]
    public Task<IActionResult> Present(ApprovalRequest request) => Execute(request, ApprovalState.Presented);
    [HttpPost("Approve"), Consumes("application/json"), RequestSizeLimit(1024)]
    public Task<IActionResult> Approve(ApprovalRequest request) => Execute(request, ApprovalState.Approved);
    [HttpPost("Revoke"), Consumes("application/json"), RequestSizeLimit(1024)]
    public Task<IActionResult> Revoke(ApprovalRequest request) => Execute(request, ApprovalState.Revoked);

    private async Task<IActionResult> Execute(ApprovalRequest request, ApprovalState desired)
    {
        var started = Stopwatch.GetTimestamp();
        var outcome = "ProtectionUnavailable";
        Principal? principal = null;
        ApprovalStore? store = null;
        try
        {
            if (services.GetService<Attachment>()?.Supported != true) throw new GuardFailure(503, "ServerGuardUnsupported");
            var identity = services.GetRequiredService<Identity>();
            principal = await identity.Read(HttpContext, administrator: true);
            using var admission = services.GetRequiredService<WorkAdmission>().Enter(principal.User.Id);
            store = services.GetRequiredService<ApprovalStore>();
            var ticket = store.Read(request.ChallengeId, principal.Owner);
            if (desired == ApprovalState.Revoked)
            {
                store.Revoke(request.ChallengeId, principal.Owner); outcome = "Revoked";
                return Ok(new { State = outcome });
            }
            if (desired == ApprovalState.Approved && request.Decision != "Approve") throw new GuardFailure(400, "ApprovalInvalid");
            var evaluator = services.GetRequiredService<Evaluator>();
            var fresh = evaluator.Read(ticket.Operation, principal.User, HttpContext.RequestAborted);
            var final = await identity.Read(HttpContext, administrator: true);
            if (final.Owner != principal.Owner) throw new GuardFailure(409, "ApprovalInvalid");
            evaluator.CheckPermissions(ticket.Operation, final.User, HttpContext.RequestAborted);
            ticket = store.Transition(request.ChallengeId, principal.Owner, ticket.Operation, fresh.Fingerprint, desired);
            outcome = desired.ToString();
            return Ok(new { State = outcome, ticket.ExpiresAt, Action = ticket.Operation.Action, Targets = ticket.Operation.Targets, Scopes = fresh.Scopes, Generation = store.Generation,
                // Only Present returns admin-authorized detail. No details are stored in approvals.
                Protection = desired == ApprovalState.Presented ? fresh.Protection : null });
        }
        catch (Exception error)
        {
            var failure = error as GuardFailure ?? new GuardFailure(503, "ProtectionUnavailable");
            if (principal is not null) store?.Revoke(request.ChallengeId, principal.Owner);
            outcome = failure.Code;
            return Responses.Error(HttpContext, failure);
        }
        finally
        {
            Response.Headers.CacheControl = "no-store";
            logger.LogInformation("WG-APPROVAL protocol outcome={Outcome} elapsedMs={Elapsed}", outcome, Stopwatch.GetElapsedTime(started).TotalMilliseconds);
        }
    }
}
