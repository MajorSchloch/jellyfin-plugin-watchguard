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
    public bool DiagnosticMode { get; set; }
}

public sealed class Plugin : BasePlugin<Configuration>
{
    public Plugin(IApplicationPaths paths, IXmlSerializer serializer) : base(paths, serializer) => Instance = this;
    public static Plugin? Instance { get; private set; }
    public override string Name => "WatchGuard";
    public override Guid Id => Guid.Parse("a3c6bc84-783d-4ba8-a0db-89bfb83ab486");
    public override string Description => "Personal watchlists, native interest detection and a web deletion proof of concept.";
}

public sealed class ServiceRegistrator : IPluginServiceRegistrator
{
    public void RegisterServices(IServiceCollection serviceCollection, IServerApplicationHost applicationHost)
    {
        serviceCollection.AddSingleton(_ => new WatchlistStore(Plugin.Instance?.DataFolderPath
            ?? throw new InvalidOperationException("WatchGuard plugin is unavailable.")));
        serviceCollection.AddSingleton<InterestService>();
        serviceCollection.AddHostedService<InjectorRegistration>();
    }
}
