using System.Reflection;
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
        var on = new Attachment { Supported = true }; on.Capture(true); Assert.True(on.Active);
        Assert.Throws<InvalidOperationException>(() => on.Capture(false));
    }
    [Fact]
    public async Task UnverifiedDescriptorsCannotEnableProtocol()
    {
        var provider = new Mock<IActionDescriptorCollectionProvider>();
        provider.Setup(p => p.ActionDescriptors).Returns(new ActionDescriptorCollection([], 0));
        var state = new Attachment { Supported = true, EnabledAtStartup = true };
        await new AttachmentReport(provider.Object, state, NullLogger<AttachmentReport>.Instance).StartAsync(default);
        Assert.False(state.Supported);
    }

    [Theory]
    [InlineData(12, 2, true, true)]
    [InlineData(12, 3, true, false)]
    [InlineData(12, 2, false, false)]
    public void ExactActionAndVersionMatching(int major, int minor, bool both, bool expected)
    {
        var asm = AssemblyBuilder.DefineDynamicAssembly(new AssemblyName("Jellyfin.Api"), AssemblyBuilderAccess.Run);
        var builder = asm.DefineDynamicModule("test").DefineType("Jellyfin.Api.Controllers.LibraryController", TypeAttributes.Public);
        foreach (var name in both ? new[] { "DeleteItem", "DeleteItems" } : new[] { "DeleteItem" })
        {
            var method = builder.DefineMethod(name, MethodAttributes.Public, typeof(ActionResult), [name == "DeleteItem" ? typeof(Guid) : typeof(Guid[])]);
            method.DefineParameter(1, ParameterAttributes.None, name == "DeleteItem" ? "itemId" : "ids");
            method.SetCustomAttribute(new CustomAttributeBuilder(typeof(HttpDeleteAttribute).GetConstructor([typeof(string)])!, [name == "DeleteItem" ? "Items/{itemId}" : "Items"]));
            var il = method.GetILGenerator(); il.Emit(OpCodes.Ldnull); il.Emit(OpCodes.Ret);
        }
        var type = builder.CreateType()!;
        var controller = new ControllerModel(type.GetTypeInfo(), []);
        foreach (var method in type.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly))
            controller.Actions.Add(new ActionModel(method, method.GetCustomAttributes().Cast<object>().ToArray()));
        var model = new ApplicationModel(); model.Controllers.Add(controller);
        var state = new Attachment { ServerVersion = new Version(major, minor, 0) };
        new Convention(state, NullLogger<Convention>.Instance).Apply(model);
        Assert.Equal(expected, state.Supported);
        Assert.Equal(expected ? 2 : 0, controller.Actions.Sum(a => a.Filters.Count));
    }

}
