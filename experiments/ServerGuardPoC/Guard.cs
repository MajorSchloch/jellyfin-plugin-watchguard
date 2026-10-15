using System.Diagnostics;
using Jellyfin.Data;
using Jellyfin.Database.Implementations.Enums;
using Jellyfin.Plugin.WatchGuard;
using MediaBrowser.Controller;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Net;
using MediaBrowser.Controller.Plugins;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ApplicationModels;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Mvc.Infrastructure;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace WatchGuard.ServerGuardPoC;

// Companion assembly in a disposable WatchGuard load context; never packaged for production.
public sealed class Registration : IPluginServiceRegistrator
{
    public void RegisterServices(IServiceCollection serviceCollection, IServerApplicationHost applicationHost)
    {
        if (Environment.GetEnvironmentVariable("WATCHGUARD_DISPOSABLE_SERVER_GUARD") != "1") return;
        serviceCollection.AddSingleton(new Attachment { ServerVersion = applicationHost.ApplicationVersion });
        serviceCollection.AddTransient<Guard>();
        serviceCollection.AddOptions<MvcOptions>().Configure<Attachment, ILogger<Convention>>((options, state, logger) => options.Conventions.Add(new Convention(state, logger)));
        serviceCollection.AddHostedService<AttachmentReport>();
    }
}

public sealed class Attachment
{
    public Version ServerVersion { get; init; } = new(0, 0);
    public bool Supported { get; set; }
    public int Count { get; set; }
}

public sealed class Convention(Attachment state, ILogger<Convention> logger) : IApplicationModelConvention
{
    public void Apply(ApplicationModel application)
    {
        var controllers = application.Controllers.Where(c => c.ControllerType.FullName == "Jellyfin.Api.Controllers.LibraryController" &&
            c.ControllerType.Assembly.GetName().Name == "Jellyfin.Api").ToArray();
        var actions = controllers.SelectMany(c => c.Actions).Where(a => a.ActionMethod.Name is "DeleteItem" or "DeleteItems").ToArray();
        state.Supported = controllers.Length == 1 && state.ServerVersion.Major == 12 && state.ServerVersion.Minor == 2 && state.ServerVersion.Build == 0 &&
            actions.Length == 2 && actions.All(a => a.ActionMethod.ReturnType == typeof(ActionResult) &&
                a.ActionMethod.GetParameters() is [var p] &&
                p.ParameterType == (a.ActionMethod.Name == "DeleteItem" ? typeof(Guid) : typeof(Guid[])) &&
                p.Name == (a.ActionMethod.Name == "DeleteItem" ? "itemId" : "ids") &&
                a.Attributes.OfType<HttpDeleteAttribute>().SingleOrDefault()?.Template ==
                    (a.ActionMethod.Name == "DeleteItem" ? "Items/{itemId}" : "Items"));
        // Do not claim interception when only one target is present. No broad fallback.
        if (!state.Supported)
        {
            logger.LogCritical("WG-GUARD-POC mismatch controllers={Controllers} actions={Actions} versions={Versions} signatures={Signatures}",
                controllers.Length, actions.Length, string.Join(",", controllers.Select(c => c.ControllerType.Assembly.GetName().Version)),
                string.Join(";", actions.Select(a => a.ActionMethod.ToString() + ":" + string.Join(",", a.Attributes.OfType<HttpDeleteAttribute>().Select(h => h.Template)))));
            return;
        }
        foreach (var action in actions) action.Filters.Add(new ServiceFilterAttribute(typeof(Guard)));
        state.Count = actions.Length;
    }
}

public sealed class AttachmentReport(IActionDescriptorCollectionProvider descriptors, Attachment state,
    ILogger<AttachmentReport> logger) : IHostedService
{
    public Task StartAsync(CancellationToken cancellationToken)
    {
        _ = descriptors.ActionDescriptors; // Force application-model construction before reporting.
        var attached = descriptors.ActionDescriptors.Items.Count(a => a.FilterDescriptors.Any(f =>
            f.Filter is ServiceFilterAttribute s && s.ServiceType == typeof(Guard)));
        if (state.Supported && attached == 2)
            logger.LogWarning("WG-GUARD-POC attached=2 supported=true veto-only; interception still requires HTTP qualification");
        else logger.LogCritical("WG-GUARD-POC UNSUPPORTED attached={Count}; no server enforcement claimed", attached);
        return Task.CompletedTask;
    }
    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}

public sealed class Guard(IAuthorizationContext authorization, IUserManager users, ILibraryManager library,
    InterestService interest, ILogger<Guard> logger) : IAsyncActionFilter
{
    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        var timer = Stopwatch.StartNew();
        var evaluations = 0;
        var outcome = "Unavailable";
        void Deny(int status, string code)
        {
            outcome = code;
            context.HttpContext.Response.Headers.CacheControl = "no-store";
            context.Result = new ObjectResult(new { Code = code, Message = "Research deletion guard rejected this operation." }) { StatusCode = status };
        }
        var proceed = false;
        try
        {
            context.HttpContext.RequestAborted.ThrowIfCancellationRequested();
            var auth = await authorization.GetAuthorizationInfo(context.HttpContext);
            // Deliberately restrictive PoC policy. Keys cannot identify a human approver.
            if (!auth.IsAuthenticated) { Deny(401, "AuthenticationRequired"); return; }
            if (auth.IsApiKey) { Deny(403, "ApiKeyDeletionUnsupported"); return; }
            var user = users.GetUserById(auth.UserId);
            if (user is null || user.HasPermission(PermissionKind.IsDisabled)) { Deny(401, "AuthenticationRequired"); return; }
            var ids = context.ActionArguments.TryGetValue("itemId", out var single) && single is Guid id ? new[] { id } :
                (context.ActionArguments.TryGetValue("ids", out var bulk) ? bulk as Guid[] : null);
            // Additional explicit research work bound; no truncation or partial approval.
            if (ids is null || ids.Length is 0 or > 100 || ids.Any(i => i == Guid.Empty) || ids.Distinct().Count() != ids.Length)
            { Deny(400, "InvalidTargetSet"); return; }
            var targets = new List<BaseItem>();
            foreach (var target in ids)
            {
                var item = library.GetItemById<BaseItem>(target, user);
                if (item is null) { Deny(404, "TargetUnavailable"); return; }
                if (!item.CanDelete(user)) { Deny(401, "DeletionNotPermitted"); return; }
                targets.Add(item);
            }
            var scopes = new List<BaseItem>();
            foreach (var item in targets)
            {
                var seriesId = item switch { Episode e => e.SeriesId, Season s => s.SeriesId, _ => Guid.Empty };
                if (item is Episode or Season)
                {
                    if (seriesId == Guid.Empty || library.GetItemById<BaseItem>(seriesId, user) is not Series series)
                    { Deny(409, "ScopeUnavailable"); return; }
                    if (ids.Contains(seriesId) || item is Episode ep && ids.Contains(ep.SeasonId))
                    { Deny(400, "OverlappingTargets"); return; }
                    scopes.Add(series);
                }
                else if (InterestService.Supported(item)) scopes.Add(item);
                else { Deny(409, "UnsupportedTarget"); return; }
            }
            // All targets/permissions resolved before any interest response or native mutation.
            foreach (var scope in scopes.DistinctBy(i => i.Id))
            {
                context.HttpContext.RequestAborted.ThrowIfCancellationRequested();
                evaluations++;
                if (interest.Get(scope, user.Id).HasInterest) { Deny(409, "WatchGuardProtectionRequired"); return; }
            }
            context.HttpContext.RequestAborted.ThrowIfCancellationRequested();
            proceed = true;
            outcome = "ContinueNative";
        }
        catch (Exception)
        {
            // Never log native exception messages (paths/history), and never convert a lookup error to zero interest.
            Deny(503, "ProtectionUnavailable");
        }
        finally
        {
            logger.LogWarning("WG-GUARD-POC outcome={Outcome} evaluations={Evaluations} elapsedMs={Elapsed}", outcome, evaluations, timer.Elapsed.TotalMilliseconds);
        }
        // Outside catch: preserve original native execution/result/exception. No direct deletion call here.
        if (proceed) await next();
    }
}
