using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Net;
using MediaBrowser.Controller.Session;
using MediaBrowser.Controller.Entities;
using Jellyfin.Database.Implementations.Entities;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;

namespace Jellyfin.Plugin.WatchGuard;

public sealed record CapabilityCheck(string Id, string Status, string Detail, string Action = "")
{
    public bool Passed => Status is "Tested" or "CompatibleUntested";
}

internal static class JellyfinCompatibility
{
    internal static readonly string[] TestedVersions = ["12.2.0", "12.3.0", "12.4.0"];
    internal const string Range = "12.2.x, 12.3.x and 12.4.x release versions; .NET 10; minimum ABI 12.2.0.0";
    internal static bool IsTestedVersion(Version version) =>
        version is { Major: 12, Minor: 2 or 3 or 4, Build: 0, Revision: -1 or 0 };
    // Patch releases only. New minor/major families need behavioral and ABI review.
    internal static bool InRange(Version version) =>
        version is { Major: 12, Minor: 2 or 3 or 4, Build: >= 0, Revision: -1 or 0 };
    internal static string AcceptedStatus(Version version) => IsTestedVersion(version) ? "Tested" : "CompatibleUntested";
    internal static CapabilityCheck VersionCheck(Version version, string? reportedVersion = null)
    {
        var release = reportedVersion is null || Version.TryParse(reportedVersion, out var parsed) &&
            InRange(parsed) && parsed.Major == version.Major && parsed.Minor == version.Minor && parsed.Build == version.Build;
        return new("version-range", InRange(version) && release ? AcceptedStatus(version) : "Unsupported", Range,
            InRange(version) && release ? "" : "Use a qualified release or obtain a WatchGuard build qualified for this server family. Prereleases, revision builds and incomplete versions are not qualified release versions.");
    }

    // Resolve this artifact's compiled Jellyfin member signatures against the loaded
    // host. No native method is invoked. This catches return-type/member ABI changes
    // that a method-name probe misses; it cannot certify implementation semantics.
    private static int ResolveNativeReferences()
    {
        var assembly = typeof(Plugin).Assembly;
        using var stream = File.OpenRead(assembly.Location);
        using var pe = new PEReader(stream);
        var metadata = pe.GetMetadataReader();
        bool Native(TypeReferenceHandle handle)
        {
            var type = metadata.GetTypeReference(handle);
            var ns = metadata.GetString(type.Namespace);
            return ns.StartsWith("MediaBrowser.", StringComparison.Ordinal) ||
                ns.StartsWith("Jellyfin.", StringComparison.Ordinal) && !ns.StartsWith("Jellyfin.Plugin.WatchGuard", StringComparison.Ordinal);
        }
        var count = 0;
        foreach (var handle in metadata.TypeReferences.Where(Native))
        {
            if (++count > 4096) throw new InvalidOperationException("API reference limit");
            _ = assembly.ManifestModule.ResolveType(MetadataTokens.GetToken(handle));
        }
        foreach (var handle in metadata.MemberReferences)
        {
            var member = metadata.GetMemberReference(handle);
            if (member.Parent.Kind != HandleKind.TypeReference || !Native((TypeReferenceHandle)member.Parent)) continue;
            if (++count > 4096) throw new InvalidOperationException("API reference limit");
            _ = assembly.ManifestModule.ResolveMember(MetadataTokens.GetToken(handle)) ?? throw new MissingMemberException();
        }
        return count;
    }

    // This is a bounded startup probe of the APIs used for identity, interest and live
    // playback, not a library scan or a proof of future implementation semantics.
    internal static CapabilityCheck RuntimeCheck(Version version, IServiceProvider services)
    {
        int references;
        try { references = ResolveNativeReferences(); }
        catch (Exception error)
        {
            return new("runtime-api", "Unsupported", "Compiled Jellyfin API references could not be verified (" + error.GetType().Name + ").",
                "Use a qualified Jellyfin/WatchGuard combination and restart; inspect assembly loading in the server log. No active enforcement is claimed.");
        }
        var checks = new (Type Type, string Method, Type[] Parameters)[] {
            (typeof(IAuthorizationContext), "GetAuthorizationInfo", [typeof(HttpRequest)]),
            (typeof(IAuthorizationContext), "GetAuthorizationInfo", [typeof(HttpContext)]),
            (typeof(IUserManager), "GetUserById", [typeof(Guid)]),
            (typeof(IUserManager), "GetUsers", []),
            (typeof(IUserDataManager), "GetUserDataBatch", [typeof(IReadOnlyList<BaseItem>), typeof(User)]),
            (typeof(IUserDataManager), "GetResumeUserDataBatch", [typeof(IReadOnlyList<BaseItem>), typeof(User)]),
            (typeof(ILibraryManager), "GetItemList", [typeof(InternalItemsQuery)])
        };
        var missing = checks.Where(c => c.Type.GetMethod(c.Method, c.Parameters) is null).Select(c => c.Type.Name + "." + c.Method).ToList();
        if (typeof(ISessionManager).GetProperty("Sessions") is null) missing.Add("ISessionManager.Sessions");
        var registered = services.GetService<IServiceProviderIsService>();
        foreach (var type in checks.Select(c => c.Type).Append(typeof(ISessionManager)).Distinct())
            if (registered?.IsService(type) != true) missing.Add(type.Name + " service");
        if (Environment.Version.Major != 10) missing.Add(".NET 10");
        return new("runtime-api", missing.Count == 0 && InRange(version) ? AcceptedStatus(version) : "Unsupported",
            missing.Count == 0 ? "Plugin loaded; " + references + " compiled Jellyfin type/member references resolved; required identity, library, user-data and session services are present. Behavioral coverage is limited to qualified releases." : "Missing requirements: " + string.Join(", ", missing),
            missing.Count == 0 && InRange(version) ? "" : "Install a qualified Jellyfin/WatchGuard combination and restart. Assembly-load failures before this probe require checking the server log.");
    }
}
