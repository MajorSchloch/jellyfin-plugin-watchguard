using System.Diagnostics;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.WatchGuard;

// Opt-in diagnostics: fixed stage names and elapsed milliseconds only, never media/user IDs or tokens.
internal sealed class OverviewTiming(string stage, ILogger logger) : IDisposable
{
    private readonly Stopwatch _watch = Stopwatch.StartNew();
    public static IDisposable? Begin(string stage, ILogger? logger) =>
        Plugin.Instance?.Configuration.DiagnosticMode == true && logger is not null ? new OverviewTiming(stage, logger) : null;
    public void Dispose() => logger.LogInformation("WatchGuard timing {Stage}: {Milliseconds:F3} ms", stage, _watch.Elapsed.TotalMilliseconds);
}

// Measures the actual MVC result execution (serialization plus response writing), not a second serialization.
internal sealed class OverviewSerializationTimingAttribute : Attribute, IAsyncResultFilter
{
    public async Task OnResultExecutionAsync(ResultExecutingContext context, ResultExecutionDelegate next)
    {
        context.ActionDescriptor.RouteValues.TryGetValue("action", out var action);
        using var timing = action is "UserActivity" or "UserWatchlist" or "OverviewUsers" or "Activity" or "OwnActivity" or "Overview" or "OwnOverview" or "AllWatchlists" or "List"
            ? OverviewTiming.Begin("SerializationAndWrite", context.HttpContext.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger("WatchGuard.Performance")) : null;
        await next();
    }
}
