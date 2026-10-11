using System.Text.Json;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.WatchGuard;

// Optional integration: use Injector's documented reflection interface, with no dependency on its assembly.
public sealed class InjectorRegistration(ILogger<InjectorRegistration> logger, IntegrationStatus status) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var plugin = Plugin.Instance!;
        using var changed = new SemaphoreSlim(0, 1);
        void OnChanged(object? sender, MediaBrowser.Model.Plugins.BasePluginConfiguration config)
        {
            try { changed.Release(); } catch (SemaphoreFullException) { }
        }
        plugin.ConfigurationChanged += OnChanged;
        try
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                for (var attempt = 0; attempt < 12; attempt++)
                {
                    try
                    {
                        var type = AppDomain.CurrentDomain.GetAssemblies()
                            .Select(a => a.GetType("Jellyfin.Plugin.JavaScriptInjector.PluginInterface"))
                            .FirstOrDefault(t => t is not null);
                        var register = IntegrationStatus.RegistrationMethod(type);
                        status.Set(new(type is not null, register is not null, false, null,
                            type is null ? "Injector not discovered" : register is null ? "Incompatible registration interface" : "Registering"));
                        if (register is not null)
                        {
                            using var stream = typeof(Plugin).Assembly.GetManifestResourceStream("Jellyfin.Plugin.WatchGuard.Web.watchguard.js")!;
                            using var reader = new StreamReader(stream);
                            var script = (await reader.ReadToEndAsync(stoppingToken)).Replace(
                                "/*WATCHGUARD_DIAGNOSTICS*/false",
                                Plugin.Instance!.Configuration.DiagnosticMode ? "true" : "false",
                                StringComparison.Ordinal);
                            var payload = JsonSerializer.Serialize(new
                            {
                                id = "watchguard-v1", name = "WatchGuard", script,
                                enabled = true, requiresAuthentication = true,
                                pluginId = Plugin.Instance!.Id.ToString(), pluginName = "WatchGuard", pluginVersion = typeof(Plugin).Assembly.GetName().Version!.ToString(3)
                            });
                            var payloadType = register.GetParameters().Single().ParameterType;
                            var parsed = payloadType.GetMethod("Parse", [typeof(string)])!.Invoke(null, [payload]);
                            if (register.Invoke(null, [parsed]) is true)
                            {
                                logger.LogInformation("WatchGuard web script registered with JavaScript Injector.");
                                status.Set(new(true, true, true, typeof(Plugin).Assembly.GetName().Version!.ToString(3), "Server registration succeeded; browser unverified"));
                                break;
                            }
                        }
                    }
                    catch (Exception ex) when (ex is not OperationCanceledException)
                    {
                        status.Set(status.Snapshot with { RegistrationSucceeded = false, ScriptVersion = null, State = "Registration failed; retrying" });
                        logger.LogDebug("WatchGuard Injector registration failed ({ExceptionType}); retrying.", ex.GetType().Name);
                    }
                    await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);
                }
                if (!status.Snapshot.RegistrationSucceeded)
                {
                    status.Set(status.Snapshot with { State = status.Snapshot.State + "; registration unsuccessful — check Injector and retry" });
                    logger.LogWarning("WatchGuard web script was not registered. No deletion confirmation is active. Install/enable JavaScript Injector 4.0.0.0 jf12 (.NET 10), keep DisableScriptInjectionMiddleware=false, and restart Jellyfin. Check the RegisterScript(JObject) interface and verify watchguard-v1 in Plugin Scripts; the catalog does not install this dependency.");
                }
                await changed.WaitAsync(stoppingToken);
            }
        }
        finally { plugin.ConfigurationChanged -= OnChanged; }
    }
}
