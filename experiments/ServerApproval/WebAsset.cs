using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ApplicationModels;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.Extensions.DependencyInjection;

namespace WatchGuard.ServerApproval;

// Disposable-only substitution AFTER the original authenticated asset action succeeds.
// The original standalone middleware, bootstrap, auth, content type and no-store policy stay intact.
public sealed class WebAssetConvention : IApplicationModelConvention
{
    public void Apply(ApplicationModel application)
    {
        var actions = application.Controllers.Where(c => c.ControllerType.FullName == "Jellyfin.Plugin.WatchGuard.Standalone.StandaloneController")
            .SelectMany(c => c.Actions).Where(a => a.ActionMethod.Name == "Script").ToArray();
        if (actions.Length != 1) throw new InvalidOperationException("Experimental Web asset action unavailable.");
        actions[0].Filters.Add(new WebAsset());
    }
}
public sealed class WebAsset : IAsyncResultFilter
{
    public async Task OnResultExecutionAsync(ResultExecutingContext context, ResultExecutionDelegate next)
    {
        if (context.Result is ContentResult result && result.ContentType?.StartsWith("application/javascript", StringComparison.Ordinal) == true && result.Content is string script)
        {
            const string marker = "    const adapter = createAdapter(";
            if (script.Split(marker, StringSplitOptions.None).Length != 2) throw new InvalidOperationException("Experimental Web source mismatch.");
            using var stream = typeof(WebAsset).Assembly.GetManifestResourceStream("WatchGuard.ServerApproval.server-web.js")!;
            using var reader = new StreamReader(stream);
            const string scopeMarker = "parentName: scope === item ? null";
            if (script.Split(scopeMarker, StringSplitOptions.None).Length != 2) throw new InvalidOperationException("Experimental protection source mismatch.");
            script = script.Replace(scopeMarker, "scopeId: scope.Id, " + scopeMarker, StringComparison.Ordinal);
            result.Content = script.Replace(marker, await reader.ReadToEndAsync() + "\n    const adapter = createServerAdapter(", StringComparison.Ordinal).Replace("/*STAGE_B_EXPECTED*/false",
                context.HttpContext.RequestServices.GetService<Attachment>() is null ? "false" : "true", StringComparison.Ordinal);
        }
        await next();
    }
}
