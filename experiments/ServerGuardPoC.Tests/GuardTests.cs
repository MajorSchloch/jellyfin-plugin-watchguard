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
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using WatchGuard.ServerGuardPoC;
using Xunit;

public class GuardTests
{
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

    public class DeletableMovie : Movie { public override bool CanDelete(User user) => true; }

    [Theory]
    [InlineData(false, false, false, 1, null, false)]
    [InlineData(false, false, false, 1, null, true)]
    [InlineData(true, false, false, 0, 409, false)]
    [InlineData(false, true, false, 0, 503, false)]
    [InlineData(false, false, true, 0, 503, false)]
    public async Task FreshStateFailureAndCancellation(bool listed, bool fail, bool cancelled, int expectedCalls, int? status, bool nativeFailure)
    {
        var folder = Path.Combine(Path.GetTempPath(), "guard-unit-" + Guid.NewGuid());
        try
        {
            var user = new User("fixture", "test", "test") { Id = Guid.NewGuid() };
            var item = new DeletableMovie { Id = Guid.NewGuid() };
            var library = new Mock<ILibraryManager>(); var users = new Mock<IUserManager>(); var auth = new Mock<IAuthorizationContext>();
            library.Setup(l => l.GetItemById<BaseItem>(item.Id, user)).Returns(item);
            users.Setup(u => u.GetUserById(user.Id)).Returns(user); users.Setup(u => u.GetUsers()).Returns([user]);
            auth.Setup(a => a.GetAuthorizationInfo(It.IsAny<HttpContext>())).ReturnsAsync(new AuthorizationInfo { IsAuthenticated = true, User = user });
            var data = new Mock<IUserDataManager>();
            data.Setup(d => d.GetUserDataBatch(It.IsAny<IReadOnlyList<BaseItem>>(), user)).Returns(new Dictionary<Guid, UserItemData> { [item.Id] = new() { Key = "fixture" } });
            if (fail) data.Setup(d => d.GetUserDataBatch(It.IsAny<IReadOnlyList<BaseItem>>(), user)).Throws<InvalidDataException>();
            data.Setup(d => d.GetResumeUserDataBatch(It.IsAny<IReadOnlyList<BaseItem>>(), user)).Returns(new Dictionary<Guid, VersionResumeData>());
            var sessions = new Mock<ISessionManager>(); sessions.Setup(s => s.Sessions).Returns(Array.Empty<SessionInfo>());
            var store = new WatchlistStore(folder); if (listed) store.Set(user.Id, item.Id, true);
            var service = new InterestService(store, library.Object, users.Object, data.Object, sessions.Object);
            var http = new DefaultHttpContext(); if (cancelled) http.RequestAborted = new CancellationToken(true);
            var action = new ActionContext(http, new RouteData(), new ActionDescriptor());
            var context = new ActionExecutingContext(action, [], new Dictionary<string, object?> { ["itemId"] = item.Id }, new object());
            var calls = 0;
            Task Execute() => new Guard(auth.Object, users.Object, library.Object, service, NullLogger<Guard>.Instance).OnActionExecutionAsync(context, () =>
            {
                calls++; if (nativeFailure) throw new InvalidOperationException("native failure");
                return Task.FromResult(new ActionExecutedContext(action, [], new object()) { Result = new NoContentResult() });
            });
            if (nativeFailure) await Assert.ThrowsAsync<InvalidOperationException>(Execute);
            else await Execute();
            Assert.Equal(expectedCalls, calls);
            Assert.Equal(status, (context.Result as ObjectResult)?.StatusCode);
        }
        finally { if (Directory.Exists(folder)) Directory.Delete(folder, true); }
    }
}
