using Jellyfin.Plugin.WatchGuard.Standalone;
using Microsoft.AspNetCore.Hosting;
using MediaBrowser.Common.Configuration;
using MediaBrowser.Common.Plugins;
using MediaBrowser.Controller;
using MediaBrowser.Controller.Plugins;
using MediaBrowser.Model.Plugins;
using MediaBrowser.Model.Serialization;
using Microsoft.Extensions.DependencyInjection;

namespace Jellyfin.Plugin.WatchGuard;

public sealed class Configuration : BasePluginConfiguration
{
    private int activityWindowDays = 30;
    public int ActivityWindowDays { get => activityWindowDays; set => activityWindowDays = Math.Clamp(value, 1, 90); }
    private int activityLimit = 100;
    public int ActivityLimit { get => activityLimit; set => activityLimit = Math.Clamp(value, 1, 100); }
    public bool EnableServerEnforcement { get; set; } = false;
    public bool ProtectCaughtUpSeries { get; set; } = true;
    public bool DiagnosticMode { get; set; } = false;
}

public sealed class Plugin : BasePlugin<Configuration>, IHasWebPages
{
    public Plugin(IApplicationPaths paths, IXmlSerializer serializer, ServerEnforcement.Attachment guard) : base(paths, serializer)
    {
        Instance = this;
        guard.Capture(Configuration.EnableServerEnforcement);
    }
    public static Plugin? Instance { get; private set; }
    public IEnumerable<PluginPageInfo> GetPages() => [new() { Name = "WatchGuard", EmbeddedResourcePath = "Jellyfin.Plugin.WatchGuard.Web.settings.html" }];
    public override string Name => "WatchGuard";
    public override Guid Id => Guid.Parse("a3c6bc84-783d-4ba8-a0db-89bfb83ab486");
    public override string Description => "Personal watchlists, native interest detection, Web warnings and opt-in HTTP deletion enforcement.";
}

public sealed class ServiceRegistrator : IPluginServiceRegistrator
{
    public void RegisterServices(IServiceCollection serviceCollection, IServerApplicationHost applicationHost)
    {
        new ServerEnforcement.Registration().RegisterServices(serviceCollection, applicationHost);
        serviceCollection.AddSingleton(_ => new WatchlistStore(Plugin.Instance?.DataFolderPath
            ?? throw new InvalidOperationException("WatchGuard plugin is unavailable.")));
        serviceCollection.AddSingleton(_ => new PreferenceStore(Plugin.Instance!.DataFolderPath));
        serviceCollection.AddSingleton<InterestService>();
        serviceCollection.AddSingleton<InterestOverviewService>();
        serviceCollection.AddSingleton(_ => new ActivityIndex.IndexStore(Plugin.Instance!.DataFolderPath));
        serviceCollection.AddSingleton<ActivityIndex.IndexWorker>();
        serviceCollection.AddSingleton<Microsoft.Extensions.Hosting.IHostedService>(sp => sp.GetRequiredService<ActivityIndex.IndexWorker>());
        serviceCollection.AddSingleton<ActivityIndex.IndexQuery>();
        serviceCollection.AddSingleton<ActivityIndex.BrowserQuery>();
        serviceCollection.AddSingleton<StandaloneMode>();
        serviceCollection.AddSingleton<IStartupFilter, StandaloneStartupFilter>();
    }
}
