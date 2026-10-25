using System.Reflection;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.Extensions.DependencyInjection;
using System.Reflection.Emit;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Plugin.WatchGuard;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Movies;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Net;
using MediaBrowser.Controller.Session;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.ApplicationModels;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Mvc.Infrastructure;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Jellyfin.Plugin.WatchGuard.ServerEnforcement;
using Xunit;

public class AttachmentTests
{
    private static int assemblyId;
    static AttachmentTests() => AppDomain.CurrentDomain.AssemblyResolve += (_, args) =>
        AppDomain.CurrentDomain.GetAssemblies().FirstOrDefault(a => a.IsDynamic && a.FullName == args.Name);
    [Fact]
    public void NoStoreRunsBeforeAutomaticModelValidation()
    {
        foreach (var type in new[] { typeof(ApprovalController), typeof(WebProtocol) })
        {
            var policy = type.GetCustomAttribute<ResponseCacheAttribute>()!;
            Assert.True(policy.NoStore); Assert.True(policy.Order < -2000);
        }
    }
    [Fact]
    public void ProductionAssemblyHasOnePluginIdentityAndOneServiceRegistrator()
    {
        var assembly = typeof(Plugin).Assembly;
        Assert.Single(assembly.GetTypes(), t => !t.IsAbstract && typeof(MediaBrowser.Common.Plugins.IPlugin).IsAssignableFrom(t));
        Assert.Single(assembly.GetTypes(), t => !t.IsAbstract && typeof(MediaBrowser.Controller.Plugins.IPluginServiceRegistrator).IsAssignableFrom(t));
        Assert.DoesNotContain(assembly.GetReferencedAssemblies(), a => a.Name == "WatchGuard.ServerApproval");
        Assert.DoesNotContain(assembly.GetManifestResourceNames(), n => n.Contains("Experimental", StringComparison.Ordinal));
    }
    [Fact]
    public void StartupSnapshotIsCapturedOnceAndUnknownDoesNotBecomeActive()
    {
        var off = new Attachment { Supported = true };
        Assert.False(off.Active); Assert.True(off.EnabledAtStartup); // Unknown is fail-closed, never a bypass.
        off.Capture(false); Assert.False(off.Active); Assert.False(off.EnabledAtStartup);
        Assert.Throws<InvalidOperationException>(() => off.Capture(true));
        var on = Ready(); on.Capture(true); Assert.True(on.Active);
        Assert.Throws<InvalidOperationException>(() => on.Capture(false));
    }
    [Fact]
    public async Task UnverifiedDescriptorsCannotEnableProtocol()
    {
        var provider = new Mock<IActionDescriptorCollectionProvider>();
        provider.Setup(p => p.ActionDescriptors).Returns(new ActionDescriptorCollection([], 0));
        var state = new Attachment { Supported = true, EnabledAtStartup = true };
        await new AttachmentReport(provider.Object, state, NullLogger<AttachmentReport>.Instance, new ServiceCollection().BuildServiceProvider()).StartAsync(default);
        Assert.False(state.Supported);
    }

    [Theory]
    [InlineData("12.2.0", true, true)]
    [InlineData("12.3.0", true, true)]
    [InlineData("12.2.0.0", true, true)]
    [InlineData("12.3.0.0", true, true)]
    [InlineData("12.2.0", false, false)]
    [InlineData("12.3.0", false, false)]
    [InlineData("12.4.0", true, false)]
    [InlineData("13.0.0", true, false)]
    [InlineData("12.1.0", true, false)]
    [InlineData("12.3.1", true, true)]
    [InlineData("12.2.1", true, true)]
    [InlineData("12.3.0.1", true, false)]
    [InlineData("12.2.0.1", true, false)]
    [InlineData("12.3", true, false)]
    [InlineData("12.2.0", true, false, "route")]
    [InlineData("12.3.0", true, false, "route")]
    [InlineData("12.2.0", true, false, "return")]
    [InlineData("12.3.0", true, false, "return")]
    [InlineData("12.2.0", true, false, "parameter")]
    [InlineData("12.3.0", true, false, "parameter")]
    [InlineData("12.2.0", true, false, "name")]
    [InlineData("12.3.0", true, false, "name")]
    [InlineData("12.3.1", true, false, "authorization")]
    [InlineData("12.3.0", true, false, "authorization")]
    [InlineData("12.3.0", true, false, "anonymous")]
    [InlineData("12.3.0", true, false, "policy")]
    [InlineData("12.3.0", true, false, "binding")]
    [InlineData("12.3.0", true, false, "binder")]
    [InlineData("12.3.0", true, false, "query-name")]
    [InlineData("12.3.0", true, false, "extra-route")]
    [InlineData("12.3.0", true, false, "extra-delete")]
    [InlineData("12.2.0", true, false, "assembly")]
    [InlineData("12.3.0", true, false, "assembly")]
    public void ContractAndBoundedVersionMatching_IncludingSimulatedPatchVersions(string version, bool both, bool expected, string? fault = null)
    {
        var model = Model(both, fault);
        var controller = model.Controllers.Single();
        var state = new Attachment { ServerVersion = Version.Parse(version) };
        new Convention(state, NullLogger<Convention>.Instance).Apply(model);
        Assert.Equal(expected, state.Supported);
        Assert.False(state.Active); // A convention match is not final attachment.
        Assert.False(state.Compatible);
        if (expected && version.EndsWith(".1", StringComparison.Ordinal)) Assert.All(state.Checks, c => Assert.Equal("CompatibleUntested", c.Status));
        Assert.Equal(expected ? 2 : 0, controller.Actions.Sum(a => a.Filters.Count));
    }

    [Theory]
    [InlineData("12.3.0-preview")]
    [InlineData("12.3.0.1")]
    [InlineData("12.4.0")]
    public void ReportedPrereleaseOrMismatchedVersionCannotUseNumericAllowRange(string reported)
    {
        var state = new Attachment { ServerVersion = new Version(12, 3, 0), ReportedVersion = reported };
        var model = Model();
        new Convention(state, NullLogger<Convention>.Instance).Apply(model);
        Assert.False(state.Supported);
        Assert.All(model.Controllers.Single().Actions, a => Assert.Empty(a.Filters));
    }

    private static ApplicationModel Model(bool both = true, string? fault = null)
    {
        var asm = AssemblyBuilder.DefineDynamicAssembly(new AssemblyName(fault == "assembly" ? "Other.Api" : "Jellyfin.Api") { Version = new Version(1, 0, Interlocked.Increment(ref assemblyId), 0) }, AssemblyBuilderAccess.Run);
        var module = asm.DefineDynamicModule("test");
        module.DefineType("Jellyfin.Api.Auth.DefaultAuthorizationPolicy.DefaultAuthorizationRequirement", TypeAttributes.Public, typeof(TestRequirement)).CreateType();
        module.DefineType("Jellyfin.Api.Auth.DefaultAuthorizationPolicy.DefaultAuthorizationHandler", TypeAttributes.Public, typeof(TestAuthorizationHandler)).CreateType();
        module.DefineType("Jellyfin.Api.Auth.CustomAuthenticationHandler", TypeAttributes.Public, typeof(TestAuthenticationHandler)).CreateType();
        var binderBuilder = module.DefineType("Jellyfin.Api.ModelBinders.CommaDelimitedCollectionModelBinder", TypeAttributes.Public, typeof(TestBinder));
        var binderType = binderBuilder.CreateType()!;
        var builder = module.DefineType("Jellyfin.Api.Controllers.LibraryController", TypeAttributes.Public);
        builder.SetCustomAttribute(new CustomAttributeBuilder(typeof(RouteAttribute).GetConstructor([typeof(string)])!, [""]));
        foreach (var name in !both ? new[] { "DeleteItem" } : fault == "extra-delete" ? new[] { "DeleteItem", "DeleteItems", "DeleteNew" } : new[] { "DeleteItem", "DeleteItems" })
        {
            var method = builder.DefineMethod(name, MethodAttributes.Public, fault == "return" ? typeof(object) : typeof(ActionResult), [fault == "parameter" ? typeof(string) : name == "DeleteItem" ? typeof(Guid) : typeof(Guid[])]);
            var param = method.DefineParameter(1, ParameterAttributes.None, fault == "name" ? "other" : name == "DeleteItem" ? "itemId" : "ids");
            if (name == "DeleteItems") {
                if (fault != "binding") param.SetCustomAttribute(new CustomAttributeBuilder(typeof(FromQueryAttribute).GetConstructor(Type.EmptyTypes)!, [],
                    [typeof(FromQueryAttribute).GetProperty("Name")!], [fault == "query-name" ? "other" : null!]));
                if (fault != "binder") param.SetCustomAttribute(new CustomAttributeBuilder(typeof(ModelBinderAttribute).GetConstructor([typeof(Type)])!, [binderType]));
            }
            if (fault != "authorization") method.SetCustomAttribute(fault == "policy" ?
                new CustomAttributeBuilder(typeof(AuthorizeAttribute).GetConstructor([typeof(string)])!, ["Changed"]) :
                new CustomAttributeBuilder(typeof(AuthorizeAttribute).GetConstructor(Type.EmptyTypes)!, []));
            if (fault == "anonymous") method.SetCustomAttribute(new CustomAttributeBuilder(typeof(AllowAnonymousAttribute).GetConstructor(Type.EmptyTypes)!, []));
            if (fault == "extra-route") method.SetCustomAttribute(new CustomAttributeBuilder(typeof(HttpDeleteAttribute).GetConstructor([typeof(string)])!, ["Other"]));
            method.SetCustomAttribute(new CustomAttributeBuilder(typeof(HttpDeleteAttribute).GetConstructor([typeof(string)])!, [fault == "route" ? "Other" : name == "DeleteItem" ? "Items/{itemId}" : "Items"]));
            var il = method.GetILGenerator(); il.Emit(OpCodes.Ldnull); il.Emit(OpCodes.Ret);
        }
        var type = builder.CreateType()!;
        var controller = new ControllerModel(type.GetTypeInfo(), []);
        foreach (var method in type.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly))
            controller.Actions.Add(new ActionModel(method, method.GetCustomAttributes().Cast<object>().ToArray()));
        var model = new ApplicationModel(); model.Controllers.Add(controller);
        return model;
    }

    [Theory]
    [InlineData(null, true)]
    [InlineData("pending-authentication", true)]
    [InlineData(null, true, "12.3.1")] // Simulated patch with unchanged contracts.
    [InlineData(null, false, "12.4.0")] // Simulated new minor, outside envelope.
    [InlineData("missing-filter", false)]
    [InlineData("duplicate-filter", false)]
    [InlineData("binding-source", false)]
    [InlineData("binding-name", false)]
    [InlineData("replacement-binder", false)]
    [InlineData("route", false)]
    [InlineData("anonymous", false)]
    [InlineData("authorization", false)]
    [InlineData("extra-selector", false)]
    [InlineData("foreign-route", false)]
    [InlineData("native-policy", false)]
    [InlineData("native-scheme", false)]
    [InlineData("native-handler", false)]
    [InlineData("missing-service", false)]
    [InlineData("configuration", false)]
    public async Task FinalDescriptorsAndNativeServicesMustRemainComplete(string? fault, bool expected, string version = "12.3.0")
    {
        var model = Model();
        var state = new Attachment { ServerVersion = Version.Parse(version) };
        if (fault != "configuration") state.Capture(true);
        new Convention(state, NullLogger<Convention>.Instance).Apply(model);
        var actions = model.Controllers.Single().Actions.Select(a => {
            var p = a.ActionMethod.GetParameters().Single();
            var single = p.Name == "itemId";
            return new Microsoft.AspNetCore.Mvc.Controllers.ControllerActionDescriptor {
                ControllerTypeInfo = a.ActionMethod.DeclaringType!.GetTypeInfo(), MethodInfo = a.ActionMethod,
                AttributeRouteInfo = new Microsoft.AspNetCore.Mvc.Routing.AttributeRouteInfo { Template = single ? "Items/{itemId}" : "Items" },
                ActionConstraints = [new Microsoft.AspNetCore.Mvc.ActionConstraints.HttpMethodActionConstraint(["DELETE"])],
                EndpointMetadata = a.Attributes.ToList(),
                Parameters = [new Microsoft.AspNetCore.Mvc.Controllers.ControllerParameterDescriptor { Name = p.Name!, ParameterType = p.ParameterType, ParameterInfo = p,
                    BindingInfo = new BindingInfo { BindingSource = single ? BindingSource.Path : BindingSource.Query,
                        BinderType = p.GetCustomAttribute<ModelBinderAttribute>()?.BinderType } }],
                FilterDescriptors = a.Filters.Select(f => new FilterDescriptor(f, 30)).ToList()
            };
        }).ToList();
        var first = actions[0];
        switch (fault) {
            case "missing-filter": first.FilterDescriptors.Clear(); break;
            case "duplicate-filter": first.FilterDescriptors.Add(first.FilterDescriptors[0]); break;
            case "binding-source": first.Parameters[0].BindingInfo!.BindingSource = BindingSource.Body; break;
            case "replacement-binder":
                var foreign = AssemblyBuilder.DefineDynamicAssembly(new AssemblyName("ForeignBinder"), AssemblyBuilderAccess.Run).DefineDynamicModule("binder")
                    .DefineType("Jellyfin.Api.ModelBinders.CommaDelimitedCollectionModelBinder", TypeAttributes.Public, typeof(TestBinder)).CreateType();
                actions.Single(a => a.MethodInfo.Name == "DeleteItems").Parameters[0].BindingInfo!.BinderType = foreign;
                break;
            case "binding-name": first.Parameters[0].BindingInfo!.BinderModelName = "other"; break;
            case "route": first.AttributeRouteInfo!.Template = "New/Items/{itemId}"; break;
            case "anonymous": first.EndpointMetadata.Add(new AllowAnonymousAttribute()); break;
            case "authorization": first.EndpointMetadata = first.EndpointMetadata.Where(a => a is not AuthorizeAttribute).ToList(); break;
            case "extra-selector": actions.Add(first); break;
            case "foreign-route": actions.Add(new Microsoft.AspNetCore.Mvc.Controllers.ControllerActionDescriptor {
                ControllerTypeInfo = typeof(AttachmentTests).GetTypeInfo(), MethodInfo = typeof(AttachmentTests).GetMethod(nameof(NoStoreRunsBeforeAutomaticModelValidation))!,
                AttributeRouteInfo = new Microsoft.AspNetCore.Mvc.Routing.AttributeRouteInfo { Template = "items/{otherId}" },
                ActionConstraints = [new Microsoft.AspNetCore.Mvc.ActionConstraints.HttpMethodActionConstraint(["DELETE"])], FilterDescriptors = []
            }); break;
        }
        var descriptors = new Mock<IActionDescriptorCollectionProvider>();
        descriptors.SetupGet(p => p.ActionDescriptors).Returns(new ActionDescriptorCollection(actions.Cast<ActionDescriptor>().ToArray(), 0));
        var policy = new Mock<IAuthorizationPolicyProvider>();
        var pendingPolicy = new TaskCompletionSource<AuthorizationPolicy>(TaskCreationOptions.RunContinuationsAsynchronously);
        policy.Setup(p => p.GetDefaultPolicyAsync()).ReturnsAsync(fault == "native-policy" ? new AuthorizationPolicyBuilder().RequireAssertion(_ => true).Build() : new AuthorizationPolicyBuilder("CustomAuthentication").AddRequirements((IAuthorizationRequirement)Activator.CreateInstance(first.ControllerTypeInfo.Assembly.GetType("Jellyfin.Api.Auth.DefaultAuthorizationPolicy.DefaultAuthorizationRequirement")!)!).Build());
        var verifiedPolicy = await policy.Object.GetDefaultPolicyAsync();
        if (fault == "pending-authentication") policy.Setup(p => p.GetDefaultPolicyAsync()).Returns(pendingPolicy.Task);
        var scheme = new Mock<Microsoft.AspNetCore.Authentication.IAuthenticationSchemeProvider>();
        scheme.Setup(p => p.GetDefaultAuthenticateSchemeAsync()).ReturnsAsync(fault == "native-scheme" ? null :
            new Microsoft.AspNetCore.Authentication.AuthenticationScheme("CustomAuthentication", null, first.ControllerTypeInfo.Assembly.GetType("Jellyfin.Api.Auth.CustomAuthenticationHandler")!));
        var collection = new ServiceCollection().AddSingleton(policy.Object).AddSingleton(scheme.Object)
            .AddSingleton(Mock.Of<IAuthorizationContext>()).AddSingleton(Mock.Of<IUserManager>())
            .AddSingleton(Mock.Of<IUserDataManager>()).AddSingleton(Mock.Of<ISessionManager>());
        if (fault != "native-handler") collection.AddSingleton((IAuthorizationHandler)Activator.CreateInstance(first.ControllerTypeInfo.Assembly.GetType("Jellyfin.Api.Auth.DefaultAuthorizationPolicy.DefaultAuthorizationHandler")!)!);
        if (fault != "missing-service") collection.AddSingleton(Mock.Of<ILibraryManager>());
        using var services = collection.BuildServiceProvider();
        var reporting = new AttachmentReport(descriptors.Object, state, NullLogger<AttachmentReport>.Instance, services).StartAsync(default);
        if (fault == "pending-authentication") {
            try { Assert.False(state.Active); Assert.False(state.Compatible); }
            finally { pendingPolicy.SetResult(verifiedPolicy); }
        }
        await reporting;
        Assert.Equal(expected, state.Active);
        Assert.Equal(expected, state.Compatible);
        Assert.Equal(expected ? version == "12.3.1" ? "CompatibleUntested" : "Tested" : "Unsupported", state.CompatibilityStatus);
    }

    public class TestRequirement : IAuthorizationRequirement { }
    public class TestAuthorizationHandler : IAuthorizationHandler { public Task HandleAsync(AuthorizationHandlerContext context) => Task.CompletedTask; }
    public class TestAuthenticationHandler : Microsoft.AspNetCore.Authentication.IAuthenticationHandler {
        public Task InitializeAsync(Microsoft.AspNetCore.Authentication.AuthenticationScheme scheme, HttpContext context) => Task.CompletedTask;
        public Task<Microsoft.AspNetCore.Authentication.AuthenticateResult> AuthenticateAsync() => Task.FromResult(Microsoft.AspNetCore.Authentication.AuthenticateResult.NoResult());
        public Task ChallengeAsync(Microsoft.AspNetCore.Authentication.AuthenticationProperties? properties) => Task.CompletedTask;
        public Task ForbidAsync(Microsoft.AspNetCore.Authentication.AuthenticationProperties? properties) => Task.CompletedTask;
    }
    public class TestBinder : IModelBinder { public Task BindModelAsync(ModelBindingContext bindingContext) => Task.CompletedTask; }
    internal static Attachment Ready() => new() { Supported = true, AttachmentVerified = true, Count = 2, Runtime = new("runtime-api", "Tested", "test fixture") };
}
