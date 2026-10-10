using System.Reflection;
using System.Text.Json;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.WatchGuard;

// Optional integration: use Injector's documented reflection interface, with no dependency on its assembly.
public sealed class InjectorRegistration(ILogger<InjectorRegistration> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        for (var attempt = 0; attempt < 12; attempt++)
        {
            try
            {
                var type = AppDomain.CurrentDomain.GetAssemblies()
                    .Select(a => a.GetType("Jellyfin.Plugin.JavaScriptInjector.PluginInterface"))
                    .FirstOrDefault(t => t is not null);
                var register = type?.GetMethod("RegisterScript", BindingFlags.Public | BindingFlags.Static);
                if (register is not null)
                {
                    using var stream = typeof(Plugin).Assembly.GetManifestResourceStream("Jellyfin.Plugin.WatchGuard.Web.watchguard.js")!;
                    using var reader = new StreamReader(stream);
                    var payload = JsonSerializer.Serialize(new
                    {
                        id = "watchguard-v1", name = "WatchGuard", script = await reader.ReadToEndAsync(stoppingToken),
                        enabled = true, requiresAuthentication = true,
                        pluginId = Plugin.Instance!.Id.ToString(), pluginName = "WatchGuard", pluginVersion = "1.0.0"
                    });
                    var payloadType = register.GetParameters().Single().ParameterType;
                    var parsed = payloadType.GetMethod("Parse", [typeof(string)])!.Invoke(null, [payload]);
                    if (register.Invoke(null, [parsed]) is true)
                    {
                        logger.LogInformation("WatchGuard web script registered with JavaScript Injector.");
                        return;
                    }
                }
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogDebug(ex, "WatchGuard is waiting for JavaScript Injector registration.");
            }
            await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);
        }
        logger.LogWarning("WatchGuard UI was not registered. Install/enable JavaScript Injector and restart Jellyfin. Backend remains available.");
    }
}
