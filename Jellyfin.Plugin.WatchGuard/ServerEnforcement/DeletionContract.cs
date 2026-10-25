using System.Reflection;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.Authorization;
using Microsoft.AspNetCore.Mvc.ActionConstraints;
using Microsoft.AspNetCore.Mvc.Controllers;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.AspNetCore.Mvc.Routing;

namespace Jellyfin.Plugin.WatchGuard.ServerEnforcement;

// Native contracts observed on BOTH packaged 12.2.0 and 12.3.0 controllers.
// An attribute match is only preparation: final MVC descriptors are checked too.
internal static class DeletionContract
{
    internal const string Controller = "Jellyfin.Api.Controllers.LibraryController";
    internal const string Binder = "Jellyfin.Api.ModelBinders.CommaDelimitedCollectionModelBinder";
    internal static bool Native(Type type) => type.FullName == Controller && type.Assembly.GetName().Name == "Jellyfin.Api";
    internal static bool Target(MethodInfo method) => method.Name is "DeleteItem" or "DeleteItems";
    internal static string Route(MethodInfo method) => method.Name == "DeleteItem" ? "Items/{itemId}" : "Items";
    internal static bool Delete(IEnumerable<object> attributes) => attributes.OfType<IActionHttpMethodProvider>().Any(a => a.HttpMethods.Contains("DELETE", StringComparer.OrdinalIgnoreCase));
    internal static bool Authorization(IEnumerable<object> attributes)
    {
        var all = attributes.ToArray();
        var auth = all.OfType<IAuthorizeData>().ToArray();
        return !all.OfType<IAllowAnonymous>().Any() && auth.Length > 0 &&
            auth.All(a => string.IsNullOrEmpty(a.Policy) && string.IsNullOrEmpty(a.Roles) && string.IsNullOrEmpty(a.AuthenticationSchemes));
    }
    internal static bool Signature(MethodInfo method) => Target(method) && method.ReturnType == typeof(ActionResult) &&
        method.GetParameters() is [var p] && !p.IsOptional && !p.IsOut &&
        p.ParameterType == (method.Name == "DeleteItem" ? typeof(Guid) : typeof(Guid[])) &&
        p.Name == (method.Name == "DeleteItem" ? "itemId" : "ids");
    internal static bool Binding(MethodInfo method)
    {
        if (method.GetParameters() is not [var p]) return false;
        var attrs = p.GetCustomAttributes().ToArray();
        if (method.Name == "DeleteItem") return !attrs.OfType<IBindingSourceMetadata>().Any() && !attrs.OfType<IModelNameProvider>().Any();
        return attrs.OfType<FromQueryAttribute>().ToArray() is [{ Name: null }] &&
            attrs.OfType<ModelBinderAttribute>().ToArray() is [var binder] && binder.Name is null &&
            binder.BinderType?.FullName == Binder && binder.BinderType.Assembly.GetName().Name == "Jellyfin.Api" &&
            typeof(IModelBinder).IsAssignableFrom(binder.BinderType) &&
            !attrs.OfType<IBindingSourceMetadata>().Any(a => a is not FromQueryAttribute && a is not ModelBinderAttribute);
    }
    internal static bool Routes(IEnumerable<object> attributes, string expected) =>
        attributes.OfType<IRouteTemplateProvider>().ToArray() is [HttpDeleteAttribute route] && route.Template == expected;
    internal static bool ItemRoute(string? template)
    {
        var parts = (template ?? "").Trim('/').Split('/');
        return parts[0].Equals("Items", StringComparison.OrdinalIgnoreCase) &&
            (parts.Length == 1 || parts.Length == 2 && parts[1].StartsWith('{') && parts[1].EndsWith('}'));
    }
    internal static bool Descriptor(ControllerActionDescriptor action)
    {
        var metadata = action.EndpointMetadata;
        var filters = action.FilterDescriptors;
        var single = action.MethodInfo.Name == "DeleteItem";
        return Native(action.ControllerTypeInfo.AsType()) && Signature(action.MethodInfo) && Binding(action.MethodInfo) &&
            action.AttributeRouteInfo?.Template?.TrimStart('/') == Route(action.MethodInfo) &&
            action.ActionConstraints?.OfType<HttpMethodActionConstraint>().ToArray() is [var constraint] &&
            constraint.HttpMethods.SequenceEqual(["DELETE"]) && Authorization(metadata) &&
            !filters.Any(f => f.Filter is IAllowAnonymousFilter) &&
            action.Parameters is [ControllerParameterDescriptor p] && p.Name == (single ? "itemId" : "ids") &&
            p.ParameterType == (single ? typeof(Guid) : typeof(Guid[])) && p.BindingInfo?.BinderModelName is null &&
            // Single Guid is inferred from the route. Bulk uses the explicit query binder.
            (single ? p.BindingInfo?.BinderType is null && (p.BindingInfo?.BindingSource is null || p.BindingInfo.BindingSource == BindingSource.Path) :
                p.BindingInfo?.BindingSource == BindingSource.Query && p.BindingInfo.BinderType?.FullName == Binder) &&
            filters.Count(f => f.Filter is ServiceFilterAttribute s && s.ServiceType == typeof(Guard) && s.Order == 0 && !s.IsReusable) == 1;
    }
}
