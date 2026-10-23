namespace Jellyfin.Plugin.WatchGuard;

internal static class JellyfinCompatibility
{
    // Keep status reporting and native route attachment on the same exact allowlist.
    internal static bool IsTestedVersion(Version version) =>
        version is { Major: 12, Minor: 2 or 3, Build: 0, Revision: -1 or 0 };
}
