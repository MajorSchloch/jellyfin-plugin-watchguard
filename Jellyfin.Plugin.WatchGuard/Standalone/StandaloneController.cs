using Jellyfin.Data;
using Jellyfin.Database.Implementations.Enums;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Net;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.WatchGuard.Standalone;

[ApiController, Route("WatchGuard/Standalone"), ResponseCache(NoStore = true, Location = ResponseCacheLocation.None, VaryByHeader = "Authorization")]
public sealed class StandaloneController(StandaloneMode mode, ServerEnforcement.Attachment guard, IAuthorizationContext authorization, IUserManager users) : ControllerBase
{
    private static string Read(string resource)
    {
        using var stream = typeof(Plugin).Assembly.GetManifestResourceStream(resource)!;
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    }
    [AllowAnonymous, HttpGet("bootstrap.js")]
    public IActionResult Bootstrap()
    {
        if (!mode.CanLoad()) return Conflict("Remove only watchguard-v1 from Injector to activate standalone loading.");
        Response.OnCompleted(() => { if (Response.StatusCode == 200) mode.BootstrapDelivered(); return Task.CompletedTask; });
        return Content(Read("Jellyfin.Plugin.WatchGuard.Standalone.bootstrap.js").Replace("WATCHGUARD_BUILD_ID",
            typeof(Plugin).Assembly.ManifestModule.ModuleVersionId.ToString("N"), StringComparison.Ordinal), "application/javascript; charset=utf-8");
    }
    [Authorize, HttpGet("script.js")]
    public async Task<IActionResult> Script()
    {
        var info = await authorization.GetAuthorizationInfo(HttpContext);
        var user = info.IsAuthenticated && !info.IsApiKey && info.UserId != Guid.Empty ? users.GetUserById(info.UserId) : null;
        if (user is null || user.HasPermission(PermissionKind.IsDisabled)) return Unauthorized();
        if (!mode.CanLoad()) return Conflict("Conflicting or unverifiable Injector registration.");
        Response.OnCompleted(() => { if (Response.StatusCode == 200) mode.ScriptDelivered(); return Task.CompletedTask; });
        return Content(Read("Jellyfin.Plugin.WatchGuard.Web.watchguard.js").Replace("/*WATCHGUARD_DIAGNOSTICS*/false",
            Plugin.Instance!.Configuration.DiagnosticMode ? "true" : "false", StringComparison.Ordinal)
            .Replace("/*WATCHGUARD_SERVER_EXPECTED*/false", guard.EnabledAtStartup ? "true" : "false", StringComparison.Ordinal), "application/javascript; charset=utf-8");
    }
}
