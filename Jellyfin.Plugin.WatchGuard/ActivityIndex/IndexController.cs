using Jellyfin.Data;
using Jellyfin.Database.Implementations.Enums;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Net;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MediaBrowser.Model.Tasks;

namespace Jellyfin.Plugin.WatchGuard.ActivityIndex;

[ApiController, Authorize, Route("WatchGuard/ActivityIndex")]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class IndexController(IAuthorizationContext auth, IUserManager users, IndexQuery query, IndexWorker worker) : ControllerBase
{
    [HttpGet("Status")]
    public Task<IActionResult> Status([FromQuery] string owner = "mine") => Get(owner: owner, statusOnly: true);

    [HttpGet]
    public async Task<IActionResult> Get([FromQuery] string owner = "mine", [FromQuery] int days = 30,
        [FromQuery] bool older = true, [FromQuery] string? continuation = null, [FromQuery] bool refresh = false, bool statusOnly = false)
    {
        var identity = await auth.GetAuthorizationInfo(HttpContext);
        if (!identity.IsAuthenticated || identity.IsApiKey || identity.UserId == Guid.Empty) return Unauthorized();
        var user = users.GetUserById(identity.UserId);
        if (user is null || user.HasPermission(PermissionKind.IsDisabled)) return Unauthorized();
        Guid? scope;
        if (owner == "mine") scope = user.Id;
        else if (owner == "all") scope = null;
        else if (Guid.TryParse(owner, out var id)) scope = id;
        else return BadRequest();
        if (scope != user.Id && !user.HasPermission(PermissionKind.IsAdministrator)) return Forbid();
        try
        {
            if (statusOnly) return Ok(new { Freshness = query.Status(user, scope) });
            if (refresh) worker.RequestRefresh(scope);
            return Ok(query.Read(user, scope, days, older, continuation, HttpContext.RequestAborted));
        }
        catch (ArgumentException) { return BadRequest(new { Code = "InvalidIndexQuery", Message = "Invalid or expired activity page; refresh this view." }); }
        catch (OperationCanceledException) when (HttpContext.RequestAborted.IsCancellationRequested) { throw; }
        catch { return StatusCode(503, new { Code = "ActivityIndexUnavailable", Message = "Indexed activity is unavailable; existing memberships are unaffected." }); }
    }
}

public sealed class IndexTask(IndexWorker worker) : IScheduledTask
{
    public string Name => "Reconcile WatchGuard activity index";
    public string Key => "WatchGuardActivityIndex";
    public string Description => "Rebuild derived viewing activity in bounded batches. Remaining discovery resumes in the background; deletion protection is independent.";
    public string Category => "WatchGuard";
    public IEnumerable<TaskTriggerInfo> GetDefaultTriggers() => [new() { Type = TaskTriggerInfoType.IntervalTrigger, IntervalTicks = TimeSpan.FromHours(6).Ticks }];
    public Task ExecuteAsync(IProgress<double> progress, CancellationToken cancellationToken) => worker.Reconcile(progress, cancellationToken);
}
