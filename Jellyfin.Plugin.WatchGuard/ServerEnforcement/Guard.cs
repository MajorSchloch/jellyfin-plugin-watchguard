using System.Diagnostics;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.WatchGuard.ServerEnforcement;

public static class Responses
{
    public static ObjectResult Error(HttpContext context, GuardFailure failure)
    {
        context.Response.Headers.CacheControl = "no-store";
        return new(new { Code = failure.Code, Message = "Deletion guard did not authorize this operation." }) { StatusCode = failure.Status };
    }
    public static ObjectResult Required(HttpContext context, Ticket? ticket)
    {
        context.Response.Headers.CacheControl = "no-store";
        return new(new { Code = "ProtectionRequired", ChallengeId = ticket?.Id, ExpiresAt = ticket?.ExpiresAt }) { StatusCode = 409 };
    }
}

public sealed class Guard(Identity identity, Evaluator evaluator, ApprovalStore store, WorkAdmission work,
    Attachment attachment, ILogger<Guard> logger) : IAsyncActionFilter
{
    public const string ApprovalHeader = "X-WatchGuard-Approval";
    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        if (!attachment.EnabledAtStartup) { await next(); return; } // No auth/interest work when off.
        var started = Stopwatch.GetTimestamp();
        IDisposable? admission = null, reservation = null;
        Principal? principal = null;
        string? id = null;
        Operation? matchedApproval = null;
        var outcome = "ProtectionUnavailable";
        var proceed = false;
        try
        {
            if (!attachment.ConfigurationCaptured || !attachment.Supported) throw new GuardFailure(503, "ServerGuardUnsupported");
            principal = await identity.Read(context.HttpContext);
            admission = work.Enter(principal.User.Id);
            var header = context.HttpContext.Request.Headers[ApprovalHeader];
            if (header.Count > 1 || header.Count == 1 && header[0]?.Length != 64) throw new GuardFailure(409, "ApprovalInvalid");
            id = header.Count == 1 ? header[0] : null;
            var single = context.ActionArguments.TryGetValue("itemId", out var value);
            var operation = Operation.Create(single ? "DeleteItem" : "DeleteItems", single && value is Guid one ? [one] :
                context.ActionArguments.TryGetValue("ids", out var many) ? many as Guid[] : null);
            if (id is not null)
            {
                if (!principal.IsAdmin) throw new GuardFailure(403, "NativePermissionDenied");
                var ticket = store.Read(id, principal.Owner); // Reject retries before looking up an already-deleted target.
                if (ticket.State != ApprovalState.Approved || ticket.Operation.Key != operation.Key) throw new GuardFailure(409, "ApprovalInvalid");
                matchedApproval = operation;
            }
            var evaluated = evaluator.Read(operation, principal.User, context.HttpContext.RequestAborted);
            if (id is null && evaluated.Protected)
            {
                var ticket = principal.IsAdmin ? store.Create(principal.Owner, operation, evaluated.Fingerprint, evaluated.Resources) : null;
                context.Result = Responses.Required(context.HttpContext, ticket);
                outcome = "ProtectionRequired";
                return;
            }
            var final = await identity.Read(context.HttpContext, administrator: id is not null);
            if (final.Owner != principal.Owner) throw new GuardFailure(409, "ApprovalInvalid");
            evaluator.CheckPermissions(operation, final.User, context.HttpContext.RequestAborted);
            reservation = id is null ? store.ReserveClear(evaluated.Resources) : store.Consume(id, principal.Owner, operation, evaluated.Fingerprint);
            context.HttpContext.RequestAborted.ThrowIfCancellationRequested();
            proceed = true;
            outcome = "ContinueNative";
        }
        catch (Exception error)
        {
            var failure = error as GuardFailure ?? new GuardFailure(503, "ProtectionUnavailable");
            // Both requests may pass Read before one consumes and removes the targets.
            // Only that specific missing-target failure gets consumed-ticket precedence.
            // Revalidate identity first; never mask permission failures, cancellation,
            // lookup exceptions, or exceptions from the native action (outside this catch).
            if (failure is { Status: 404, Code: "TargetUnavailable" } && matchedApproval is not null && id is not null && principal is not null)
            {
                try
                {
                    var current = await identity.Read(context.HttpContext, administrator: true);
                    if (current.Owner != principal.Owner) throw new GuardFailure(409, "ApprovalInvalid");
                    if (store.WasConsumed(id, current.Owner, matchedApproval)) failure = new GuardFailure(409, "ApprovalAlreadyUsed");
                }
                catch (Exception recheckError)
                {
                    failure = recheckError as GuardFailure ?? new GuardFailure(503, "ProtectionUnavailable");
                }
            }
            if (id is not null && principal is not null) store.Revoke(id, principal.Owner);
            outcome = failure.Code;
            context.Result = Responses.Error(context.HttpContext, failure);
        }
        finally
        {
            logger.LogInformation("WG-GUARD guard outcome={Outcome} elapsedMs={Elapsed}", outcome, Stopwatch.GetElapsedTime(started).TotalMilliseconds);
            if (!proceed) { reservation?.Dispose(); admission?.Dispose(); }
        }
        if (!proceed) return;
        try { await next(); } // Exactly one continuation; preserve native result/exception. Never invoke LibraryManager here.
        finally { reservation?.Dispose(); admission?.Dispose(); }
    }
}
