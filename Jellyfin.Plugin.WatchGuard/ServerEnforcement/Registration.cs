using System.Reflection;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Mvc.Controllers;
using Microsoft.AspNetCore.Mvc.ActionConstraints;
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
        serviceCollection.AddSingleton(new Attachment { ServerVersion = applicationHost.ApplicationVersion, ReportedVersion = applicationHost.ApplicationVersionString });
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
    public string? ReportedVersion { get; init; }
    private bool? startup;
    public bool ConfigurationCaptured => startup.HasValue;
    public bool EnabledAtStartup { get => startup ?? true; init => startup = value; }
    public void Capture(bool enabled)
    {
        if (startup.HasValue) throw new InvalidOperationException("Enforcement activation was already captured.");
        startup = enabled;
    }
    public bool Supported { get; set; }
    public bool AttachmentVerified { get; set; }
    public CapabilityCheck Runtime { get; set; } = new("runtime-api", "Unavailable", "Startup API checks have not completed.", "Restart and inspect the startup log.");
    public List<CapabilityCheck> Checks { get; } = [];
    public bool Compatible => Supported && AttachmentVerified && Runtime.Passed && Count == 2;
    public bool Active => ConfigurationCaptured && EnabledAtStartup && Compatible;
    public string CompatibilityStatus => Compatible ? JellyfinCompatibility.AcceptedStatus(ServerVersion) :
        Checks.Any(c => c.Status == "Unsupported") || Runtime.Status == "Unsupported" ? "Unsupported" : "Unavailable";
    public void Check(string id, bool passed, string detail, string action)
    {
        Checks.RemoveAll(c => c.Id == id);
        Checks.Add(new(id, passed ? JellyfinCompatibility.AcceptedStatus(ServerVersion) : "Unsupported", detail, passed ? "" : action));
    }
    public bool RestartRequired => EnabledAtStartup != (Plugin.Instance?.Configuration.EnableServerEnforcement ?? false);
    public int Count { get; set; }
}

public sealed class Convention(Attachment state, ILogger<Convention> logger) : IApplicationModelConvention
{
    public void Apply(ApplicationModel application)
    {
        state.AttachmentVerified = false;
        state.Checks.Clear();
        state.Checks.Add(JellyfinCompatibility.VersionCheck(state.ServerVersion, state.ReportedVersion));
        var controllers = application.Controllers.Where(c => DeletionContract.Native(c.ControllerType.AsType())).ToArray();
        var actions = controllers.SelectMany(c => c.Actions).Where(a => DeletionContract.Target(a.ActionMethod)).ToArray();
        const string repair = "Use a qualified server/plugin combination and restart. No complete native deletion interception is claimed.";
        state.Check("deletion-inventory", controllers.Length == 1 && actions.Length == 2 &&
            actions.Select(a => a.ActionMethod.Name).Distinct().Count() == 2 &&
            controllers.SelectMany(c => c.Actions).Where(a => DeletionContract.Delete(a.Attributes)).All(a => actions.Contains(a)),
            "Exactly one native LibraryController and both known deletion actions, with no additional DELETE actions in that controller.", repair);
        state.Check("deletion-signatures", actions.Length == 2 && actions.All(a => DeletionContract.Signature(a.ActionMethod)),
            "DeleteItem(Guid itemId) and DeleteItems(Guid[] ids), returning ActionResult.", repair);
        state.Check("deletion-routes", controllers.Length == 1 &&
            controllers[0].ControllerType.GetCustomAttributes<RouteAttribute>(inherit: false).ToArray() is [{ Template: "" }] &&
            actions.Length == 2 && actions.All(a => DeletionContract.Routes(a.Attributes, DeletionContract.Route(a.ActionMethod))),
            "Only DELETE Items/{itemId} and DELETE Items with the native empty controller prefix.", repair);
        state.Check("deletion-authorization", actions.Length == 2 && actions.All(a =>
            DeletionContract.Authorization(a.Attributes.Concat(controllers[0].Attributes))),
            "Native default authorization required; no anonymous override or changed policy/scheme/roles.", repair);
        state.Check("deletion-binding", actions.Length == 2 && actions.All(a => DeletionContract.Binding(a.ActionMethod)),
            "Native route Guid and query Guid[] with Jellyfin's comma-delimited model binder.", repair);
        state.Supported = state.Checks.All(c => c.Passed);
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
    ILogger<AttachmentReport> logger, IServiceProvider services) : IHostedService
{
    public async Task StartAsync(CancellationToken cancellationToken)
    {
        state.AttachmentVerified = false;
        _ = descriptors.ActionDescriptors; // Force all MVC conventions before checking final descriptors.
        state.Runtime = JellyfinCompatibility.RuntimeCheck(state.ServerVersion, services);
        var all = descriptors.ActionDescriptors.Items;
        var attached = all.Where(a => a.FilterDescriptors.Any(f => f.Filter is ServiceFilterAttribute s && s.ServiceType == typeof(Guard))).ToArray();
        state.Count = attached.Length;
        var native = all.OfType<ControllerActionDescriptor>().Where(a => DeletionContract.Native(a.ControllerTypeInfo.AsType()) &&
            (DeletionContract.Target(a.MethodInfo) || a.ActionConstraints?.OfType<HttpMethodActionConstraint>().Any(c => c.HttpMethods.Contains("DELETE")) == true)).ToArray();
        // Include conflicting item routes in other controllers; do not allow a duplicate
        // or alternative selector to be hidden by a count of two attached actions.
        var itemRoutes = all.OfType<ControllerActionDescriptor>().Where(a =>
            DeletionContract.ItemRoute(a.AttributeRouteInfo?.Template) &&
            (a.ActionConstraints?.OfType<HttpMethodActionConstraint>().Any() != true ||
                a.ActionConstraints.OfType<HttpMethodActionConstraint>().Any(c => c.HttpMethods.Contains("DELETE")))).ToArray();
        var verifiedAttachment = state.Supported && native.Length == 2 && attached.Length == 2 && itemRoutes.Length == 2 &&
            native.Select(a => a.MethodInfo.Name).Distinct().Count() == 2 && native.All(a => attached.Contains(a) && DeletionContract.Descriptor(a));
        state.Check("guard-attachment", verifiedAttachment,
            "Final MVC endpoints must each retain the expected route, authorization, binding and exactly one action guard; no extra item deletion selector.",
            "Restart with a qualified server/plugin combination. Native deletion may be unguarded when attachment is incomplete.");
        try
        {
            var policy = await services.GetRequiredService<IAuthorizationPolicyProvider>().GetDefaultPolicyAsync();
            var scheme = await services.GetRequiredService<IAuthenticationSchemeProvider>().GetDefaultAuthenticateSchemeAsync();
            var nativeAssembly = native.FirstOrDefault()?.ControllerTypeInfo.Assembly;
            bool NativeType(Type type, string name) => type.FullName == name && type.Assembly == nativeAssembly;
            var handlers = services.GetServices<IAuthorizationHandler>().ToArray();
            var verified = policy.Requirements.ToArray() is [var requirement] &&
                NativeType(requirement.GetType(), "Jellyfin.Api.Auth.DefaultAuthorizationPolicy.DefaultAuthorizationRequirement") &&
                policy.AuthenticationSchemes.SequenceEqual(["CustomAuthentication"]) && scheme?.Name == "CustomAuthentication" &&
                NativeType(scheme.HandlerType, "Jellyfin.Api.Auth.CustomAuthenticationHandler") &&
                handlers.Count(h => NativeType(h.GetType(), "Jellyfin.Api.Auth.DefaultAuthorizationPolicy.DefaultAuthorizationHandler")) == 1;
            state.Check("native-authentication", verified, "Native policy requirements: " + string.Join(", ", policy.Requirements.Select(r => r.GetType().FullName)) +
                "; policy schemes: " + string.Join(", ", policy.AuthenticationSchemes) + "; default scheme: " + (scheme?.Name ?? "none") + ". Live identity and permissions are rechecked per operation.",
                "Restore Jellyfin's native authentication/authorization configuration and restart.");
        }
        catch
        {
            state.Check("native-authentication", false, "Native authentication/authorization services are unavailable.", "Restore native authentication services and restart.");
        }
        state.Check("startup-configuration", state.ConfigurationCaptured, "Enforcement setting captured once at plugin startup.", "Restart and inspect plugin initialization errors.");
        state.Supported &= state.Runtime.Passed && state.Checks.All(c => c.Passed) && state.ConfigurationCaptured;
        // Publish readiness only after every required check, including asynchronous
        // native authorization validation, has finished successfully.
        state.AttachmentVerified = verifiedAttachment && state.Supported;
        if (state.Compatible)
            logger.LogInformation("WG-GUARD attached=2 supported=true enabledAtStartup={Enabled}; native HTTP item routes only", state.EnabledAtStartup);
        else
            logger.LogCritical("WG-GUARD UNSUPPORTED attached={Count}; no server enforcement claimed; failed checks={Checks}", state.Count,
                string.Join(",", state.Checks.Append(state.Runtime).Where(c => !c.Passed).Select(c => c.Id)));
    }
    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}
