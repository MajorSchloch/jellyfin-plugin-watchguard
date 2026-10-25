using System.Reflection;
using System.Runtime.Loader;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ApplicationModels;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.Extensions.Logging.Abstractions;

// Test executable only: inspect assemblies copied from a disposable native host.
var folder = args[0];
AssemblyLoadContext.Default.Resolving += (_, name) =>
{
    var path = Path.Combine(folder, name.Name + ".dll");
    return File.Exists(path) ? AssemblyLoadContext.Default.LoadFromAssemblyPath(path) : null;
};
var assembly = AssemblyLoadContext.Default.LoadFromAssemblyPath(Path.Combine(folder, "Jellyfin.Api.dll"));
var type = assembly.GetType("Jellyfin.Api.Controllers.LibraryController", true)!;
var actions = type.GetMethods().Where(m => m.Name is "DeleteItem" or "DeleteItems").ToArray();
if (actions.Length != 2) throw new InvalidOperationException("Unexpected deletion actions");
foreach (var method in actions)
{
    var single = method.Name == "DeleteItem";
    if (method.ReturnType != typeof(ActionResult) || method.GetParameters() is not [var parameter] ||
        parameter.ParameterType != (single ? typeof(Guid) : typeof(Guid[])) ||
        parameter.Name != (single ? "itemId" : "ids") ||
        method.GetCustomAttributes<HttpDeleteAttribute>().Single().Template != (single ? "Items/{itemId}" : "Items") ||
        method.GetCustomAttribute<AuthorizeAttribute>() is null)
        throw new InvalidOperationException("Unverified route/signature/authorization");
    if (!single && (parameter.GetCustomAttribute<FromQueryAttribute>() is null ||
        parameter.GetCustomAttribute<ModelBinderAttribute>()?.BinderType?.FullName != "Jellyfin.Api.ModelBinders.CommaDelimitedCollectionModelBinder"))
        throw new InvalidOperationException("Unverified bulk query binding");
}

// Exercise the production convention against the actual packaged controller.
var plugin = AssemblyLoadContext.Default.LoadFromAssemblyPath(Path.GetFullPath(args[1]));
var stateType = plugin.GetType("Jellyfin.Plugin.WatchGuard.ServerEnforcement.Attachment", true)!;
var state = Activator.CreateInstance(stateType)!;
stateType.GetProperty("ServerVersion")!.SetValue(state, Version.Parse(args[2]));
var conventionType = plugin.GetType("Jellyfin.Plugin.WatchGuard.ServerEnforcement.Convention", true)!;
var logger = Activator.CreateInstance(typeof(NullLogger<>).MakeGenericType(conventionType));
var convention = (IApplicationModelConvention)Activator.CreateInstance(conventionType, state, logger)!;
var controller = new ControllerModel(type.GetTypeInfo(), type.GetCustomAttributes().ToArray());
foreach (var action in type.GetMethods().Where(m => m.GetCustomAttributes<HttpDeleteAttribute>().Any() || m.Name is "DeleteItem" or "DeleteItems")) controller.Actions.Add(new ActionModel(action, action.GetCustomAttributes().ToArray()));

var model = new ApplicationModel();
model.Controllers.Add(controller);
convention.Apply(model);
var attached = controller.Actions.Count(a => a.Filters.OfType<ServiceFilterAttribute>().Any(f =>
    f.ServiceType.FullName == "Jellyfin.Plugin.WatchGuard.ServerEnforcement.Guard"));
if (!(bool)stateType.GetProperty("Supported")!.GetValue(state)! || attached != 2)
    throw new InvalidOperationException("Production convention did not attach to both native actions: " + JsonSerializer.Serialize(stateType.GetProperty("Checks")!.GetValue(state)));

Console.WriteLine(JsonSerializer.Serialize(new
{
    serverVersion = args[2], attached, checks = stateType.GetProperty("Checks")!.GetValue(state), assembly = assembly.FullName, controller = type.FullName,
    authenticationTypes = assembly.GetTypes().Where(t => t.Namespace?.Contains("Auth", StringComparison.Ordinal) == true && (t.Name.Contains("DefaultAuthorization", StringComparison.Ordinal) || t.Name.Contains("CustomAuthentication", StringComparison.Ordinal))).Select(t => t.FullName),
    actions = actions.Select(m => new
    {
        method = m.Name, returns = m.ReturnType.FullName,
        authorization = m.GetCustomAttributes<AuthorizeAttribute>().Select(a => new { a.Policy, a.Roles, a.AuthenticationSchemes }),
        controllerAttributes = type.CustomAttributes.Select(a => a.ToString()),
        parameters = m.GetParameters().Select(p => new
        {
            name = p.Name, type = p.ParameterType.FullName,
            attributes = p.CustomAttributes.Select(a => a.AttributeType.FullName),
            binder = p.GetCustomAttribute<ModelBinderAttribute>()?.BinderType?.FullName
        }),
        route = m.GetCustomAttribute<HttpDeleteAttribute>()!.Template,
        authorized = m.GetCustomAttribute<AuthorizeAttribute>() is not null
    }),
    result = "PASS"
}, new JsonSerializerOptions { WriteIndented = true }));
