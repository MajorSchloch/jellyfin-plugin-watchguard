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

namespace Jellyfin.Plugin.WatchGuard.ServerEnforcement;

// Capture activation once; registered filters never consult mutable configuration for permission to bypass.
internal sealed class Registration
{
    public void RegisterServices(IServiceCollection serviceCollection, IServerApplicationHost applicationHost)
    {
        serviceCollection.AddSingleton(new Attachment { ServerVersion = applicationHost.ApplicationVersion });
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
    private bool? startup;
    public bool ConfigurationCaptured => startup.HasValue;
    public bool EnabledAtStartup { get => startup ?? true; init => startup = value; }
    public void Capture(bool enabled)
    {
        if (startup.HasValue) throw new InvalidOperationException("Enforcement activation was already captured.");
        startup = enabled;
    }
    public bool Supported { get; set; }
    public bool Active => ConfigurationCaptured && EnabledAtStartup && Supported;
    public bool RestartRequired => EnabledAtStartup != (Plugin.Instance?.Configuration.EnableServerEnforcement ?? false);
    public int Count { get; set; }
}

public sealed class Convention(Attachment state, ILogger<Convention> logger) : IApplicationModelConvention
{
    public void Apply(ApplicationModel application)
    {
        var controllers = application.Controllers.Where(c => c.ControllerType.FullName == "Jellyfin.Api.Controllers.LibraryController" &&
            c.ControllerType.Assembly.GetName().Name == "Jellyfin.Api").ToArray();
        var actions = controllers.SelectMany(c => c.Actions).Where(a => a.ActionMethod.Name is "DeleteItem" or "DeleteItems").ToArray();
        state.Supported = controllers.Length == 1 && state.ServerVersion.Major == 12 &&
            (state.ServerVersion.Minor is 2 or 3) && state.ServerVersion.Build == 0 && (state.ServerVersion.Revision is -1 or 0) &&
            actions.Length == 2 && actions.All(a => a.ActionMethod.ReturnType == typeof(ActionResult) &&
                a.ActionMethod.GetParameters() is [var p] &&
                p.ParameterType == (a.ActionMethod.Name == "DeleteItem" ? typeof(Guid) : typeof(Guid[])) &&
                p.Name == (a.ActionMethod.Name == "DeleteItem" ? "itemId" : "ids") &&
                a.Attributes.OfType<HttpDeleteAttribute>().SingleOrDefault()?.Template ==
                    (a.ActionMethod.Name == "DeleteItem" ? "Items/{itemId}" : "Items"));
        // Do not claim interception when only one target is present. No broad fallback.
        if (!state.Supported)
        {
            logger.LogCritical("WG-GUARD mismatch controllers={Controllers} actions={Actions} versions={Versions} signatures={Signatures}",
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
        state.Count = attached;
        if (state.Supported && attached == 2 && state.ConfigurationCaptured)
            logger.LogInformation("WG-GUARD attached=2 supported=true enabledAtStartup={Enabled}; native HTTP item routes only", state.EnabledAtStartup);
        else
        {
            state.Supported = false;
            logger.LogCritical("WG-GUARD UNSUPPORTED attached={Count}; no server enforcement claimed", attached);
        }
        return Task.CompletedTask;
    }
    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}
