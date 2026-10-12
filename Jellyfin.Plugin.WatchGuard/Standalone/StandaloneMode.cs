using System.Collections;

namespace Jellyfin.Plugin.WatchGuard.Standalone;

// Read-only coexistence inspection. No dependency, registration, or persisted setting writes.
public sealed class StandaloneMode
{
    public bool Enabled => true;
    public bool MiddlewareRegistered { get; set; }
    private long bootstrapResponses, scriptResponses;
    public void BootstrapDelivered() => Interlocked.Increment(ref bootstrapResponses);
    public void ScriptDelivered() => Interlocked.Increment(ref scriptResponses);
    public object Snapshot
    {
        get
        {
            var injector = InspectLoadedInjector();
            var allowed = !injector.Discovered || (injector.InterfaceCompatible && !injector.WatchGuardRegistration);
            return new {
                Enabled, LoaderActive = MiddlewareRegistered && allowed, Injector = injector,
                BootstrapResponsesCompleted = Interlocked.Read(ref bootstrapResponses),
                AuthenticatedScriptResponsesCompleted = Interlocked.Read(ref scriptResponses),
                ScriptVersion = typeof(Plugin).Assembly.GetName().Version!.ToString(3),
                BuildId = typeof(Plugin).Assembly.ManifestModule.ModuleVersionId.ToString("N"),
                BrowserExecutionVerified = false,
                State = allowed ? "Standalone server loader ready; browser unverified" :
                    "Standalone blocked: remove only watchguard-v1 from Injector; an unknown Injector interface also blocks loading"
            };
        }
    }
    private static InjectorState InspectLoadedInjector()
    {
        try
        {
            var type = AppDomain.CurrentDomain.GetAssemblies()
                .Select(a => a.GetType("Jellyfin.Plugin.JavaScriptInjector.Plugin")).FirstOrDefault(t => t is not null);
            return InspectInjector(type);
        }
        catch { return new(true, false, false); }
    }
    public bool CanLoad()
    {
        var status = InspectLoadedInjector();
        return !status.Discovered || (status.InterfaceCompatible && !status.WatchGuardRegistration);
    }
    public sealed record InjectorState(bool Discovered, bool InterfaceCompatible, bool WatchGuardRegistration);
    public static InjectorState InspectInjector(Type? type)
    {
        if (type is null) return new(false, false, false);
        try
        {
            var instance = type.GetProperty("Instance")?.GetValue(null);
            var configuration = type.GetProperty("Configuration")?.GetValue(instance);
            var entries = configuration?.GetType().GetProperty("PluginJavaScripts")?.GetValue(configuration) as IEnumerable;
            if (entries is null) return new(true, false, false);
            var conflict = false;
            foreach (var entry in entries)
            {
                var id = entry?.GetType().GetProperty("Id");
                if (id?.GetValue(entry) is not string value) return new(true, false, false);
                conflict |= value == "watchguard-v1"; // Disabled entries also block: do not leave a latent competing loader.
            }
            return new(true, true, conflict);
        }
        catch { return new(true, false, false); }
    }
}
