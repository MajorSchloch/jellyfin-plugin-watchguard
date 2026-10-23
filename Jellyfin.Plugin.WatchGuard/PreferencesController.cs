using Jellyfin.Data;
using Jellyfin.Database.Implementations.Enums;
using MediaBrowser.Controller;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Net;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.WatchGuard;

[ApiController, Authorize, Route("WatchGuard"), ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class PreferencesController(IAuthorizationContext authorization, IUserManager users, PreferenceStore store,
    Standalone.StandaloneMode standalone, IServerApplicationHost host, ILogger<PreferencesController> logger) : ControllerBase
{
    private async Task<IActionResult> Execute(Func<Jellyfin.Database.Implementations.Entities.User, IActionResult> action)
    {
        try
        {
            var info = await authorization.GetAuthorizationInfo(HttpContext);
            var user = info.IsAuthenticated && !info.IsApiKey && info.UserId != Guid.Empty ? users.GetUserById(info.UserId) : null;
            return user is null || user.HasPermission(PermissionKind.IsDisabled) ? Unauthorized() : action(user);
        }
        catch (Exception ex)
        {
            logger.LogWarning("WatchGuard preferences/status unavailable ({ErrorType})", ex.GetType().Name);
            return Problem(statusCode: 503, title: "WatchGuard preferences/status unavailable. Reload to check saved state; corrupt data is preserved.");
        }
    }
    private ViewPreferences Effective(ViewPreferences value, Jellyfin.Database.Implementations.Entities.User caller)
    {
        if (value.Owner == "mine") return value;
        if (!caller.HasPermission(PermissionKind.IsAdministrator)) return value with { Owner = "mine" };
        if (value.Owner == "all") return value;
        var owner = users.GetUserById(Guid.Parse(value.Owner));
        return owner is null || owner.HasPermission(PermissionKind.IsDisabled) ? value with { Owner = "mine" } : value with { Owner = owner.Id.ToString("N") };
    }
    [HttpGet("Preferences")]
    public Task<IActionResult> Get() => Execute(user => Ok(Effective(store.Read(user.Id), user)));
    [HttpPut("Preferences")]
    public Task<IActionResult> Put([FromBody] ViewPreferences value) => Execute(user =>
    {
        if (!ViewPreferences.Valid(value)) return BadRequest("Invalid owner, statuses or sort.");
        if (value.Owner != "mine" && !user.HasPermission(PermissionKind.IsAdministrator)) return Forbid();
        var effective = Effective(value, user);
        store.Set(user.Id, effective);
        return Ok(effective);
    });
    [HttpDelete("Preferences")]
    public Task<IActionResult> Reset() => Execute(user => { store.Set(user.Id, null); return Ok(ViewPreferences.Defaults); });
    [HttpGet("IntegrationStatus")]
    public Task<IActionResult> Status() => Execute(user =>
    {
        if (!user.HasPermission(PermissionKind.IsAdministrator)) return Forbid();
        return Ok(new { PluginVersion = typeof(Plugin).Assembly.GetName().Version!.ToString(3),
            JellyfinVersion = host.ApplicationVersionString, TestedCompatibility = "Jellyfin Server/Web 12.2.0 and 12.3.0 / .NET 10",
            ServerMatchesTestedVersion = host.ApplicationVersion.Major == 12 && host.ApplicationVersion.Minor == 2,
            PluginLoaded = true,
            Standalone = standalone.Snapshot,
            BrowserExecutionVerified = false,
            Instructions = "Standalone loading. No Injector dependency. Completed responses do not verify browser execution. Fully reload clients and check this browser; CSP must permit Blob scripts. If Injector conflicts, remove only its watchguard-v1 entry; preserve other scripts and settings." });
    });
}
