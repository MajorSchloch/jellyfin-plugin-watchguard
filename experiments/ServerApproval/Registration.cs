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

namespace WatchGuard.ServerApproval;

// Companion assembly in a disposable WatchGuard load context; never packaged for production.
public sealed class Registration : IPluginServiceRegistrator
{
    public void RegisterServices(IServiceCollection serviceCollection, IServerApplicationHost applicationHost)
    {
        if (Environment.GetEnvironmentVariable("WATCHGUARD_DISPOSABLE_SERVER_WEB") == "1")
            serviceCollection.Configure<MvcOptions>(options => options.Conventions.Add(new WebAssetConvention()));
        if (Environment.GetEnvironmentVariable("WATCHGUARD_DISPOSABLE_SERVER_APPROVAL") != "1") return;
        serviceCollection.AddSingleton(new Attachment { ServerVersion = applicationHost.ApplicationVersion });
        if (Environment.GetEnvironmentVariable("WATCHGUARD_DISPOSABLE_SERVER_GUARD") == "1")
            throw new InvalidOperationException("Do not enable both experimental guards.");
        serviceCollection.AddSingleton(TimeProvider.System);
        serviceCollection.AddSingleton<ApprovalStore>();
        serviceCollection.AddSingleton<WorkAdmission>();
        serviceCollection.AddTransient<Identity>();
        serviceCollection.AddTransient<Evaluator>();
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
            logger.LogCritical("WG-APPROVAL mismatch controllers={Controllers} actions={Actions} versions={Versions} signatures={Signatures}",
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
            logger.LogWarning("WG-APPROVAL attached=2 supported=true Stage-A; interception still requires HTTP qualification");
        else
        {
            state.Supported = false;
            logger.LogCritical("WG-APPROVAL UNSUPPORTED attached={Count}; no server enforcement claimed", attached);
        }
        return Task.CompletedTask;
    }
    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}
