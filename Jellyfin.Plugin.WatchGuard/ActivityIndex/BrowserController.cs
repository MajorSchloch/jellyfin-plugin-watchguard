using Jellyfin.Data;
using Jellyfin.Database.Implementations.Enums;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Net;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.WatchGuard.ActivityIndex;

[ApiController, Authorize, Route("WatchGuard/ActivityBrowser")]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class BrowserController(IAuthorizationContext auth, IUserManager users, BrowserQuery query, IndexWorker worker) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> Get([FromQuery] string owner = "mine", [FromQuery] int days = 30,
        [FromQuery] bool older = true, [FromQuery] string statuses = "watchlisted,watching,playing",
        [FromQuery] string sort = "title", [FromQuery] string search = "", [FromQuery] string? continuation = null,
        [FromQuery] bool refresh = false, [FromQuery] bool check = false)
    {
        var identity = await auth.GetAuthorizationInfo(HttpContext);
        if (!identity.IsAuthenticated || identity.IsApiKey || identity.UserId == Guid.Empty) return Unauthorized();
        var caller = users.GetUserById(identity.UserId);
        if (caller == null || caller.HasPermission(PermissionKind.IsDisabled)) return Unauthorized();
        Guid? scope;
        if (owner == "mine") scope = caller.Id;
        else if (owner == "all") scope = null;
        else if (Guid.TryParse(owner, out var id)) scope = id;
        else return BadRequest();
        if (scope != caller.Id && !caller.HasPermission(PermissionKind.IsAdministrator)) return Forbid();
        try
        {
            var options = BrowserOptions.Create(scope, days, older, statuses, sort, search);
            if (check) return Ok(new { Authorized = true }); // Bounded identity check, no global activity counters.
            if (refresh) worker.RequestRefresh(scope);
            return Ok(query.Read(caller, options, continuation, HttpContext.RequestAborted));
        }
        catch (BrowserViewExpiredException) { return Conflict(new { Code = "ActivityViewExpired", Message = "This view expired or changed. Refresh to restart with the same filters." }); }
        catch (ArgumentException) { return BadRequest(new { Code = "InvalidActivityQuery" }); }
        catch (UnauthorizedAccessException) { return Forbid(); }
        catch (OperationCanceledException) when (HttpContext.RequestAborted.IsCancellationRequested) { throw; }
        catch { return StatusCode(503, new { Code = "ActivityBrowserUnavailable", Message = "Activity is unavailable; explicit watchlists remain accessible." }); }
    }
}
