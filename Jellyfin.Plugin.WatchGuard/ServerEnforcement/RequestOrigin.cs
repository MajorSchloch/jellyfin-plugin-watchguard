using Microsoft.AspNetCore.Http;

namespace Jellyfin.Plugin.WatchGuard.ServerEnforcement;

// Browser-origin evidence, not authentication or permission. Identity.Read must
// independently verify the explicit native session token before using this result.
public static class RequestOrigin
{
    public static string Evaluate(HttpRequest request)
    {
        var sites = request.Headers["Sec-Fetch-Site"];
        if (sites.Count > 1 || (sites.Count == 1 && sites[0] is not ("same-origin" or "none")))
            return "FetchMetadataRejected";
        var origins = request.Headers.Origin;
        if (origins.Count == 0) return "NoOriginObserved";
        if (origins.Count != 1 || !Uri.TryCreate(origins[0], UriKind.Absolute, out var origin) ||
            origin.Scheme is not ("http" or "https") || origin.UserInfo.Length != 0 ||
            origin.AbsolutePath != "/" || origin.Query.Length != 0 || origin.Fragment.Length != 0 ||
            !string.Equals(origins[0], origin.GetLeftPart(UriPartial.Authority), StringComparison.OrdinalIgnoreCase))
            return "OriginMalformed";
        // Reconstruct with the browser scheme to compare the public authority,
        // including non-default ports. Do not consult raw forwarding headers.
        if (!Uri.TryCreate(origin.Scheme + "://" + request.Host.Value, UriKind.Absolute, out var host) ||
            host.UserInfo.Length != 0 || host.AbsolutePath != "/" || host.Query.Length != 0 || host.Fragment.Length != 0 ||
            !string.Equals(origin.Authority, host.Authority, StringComparison.OrdinalIgnoreCase))
            return "OriginHostMismatch";
        if (origin.Scheme == request.Scheme) return "SameOrigin";
        // A browser cannot forge Sec-Fetch-Site, Origin or Host. A cross-scheme
        // browser initiator is same-site, not same-origin, and is rejected above.
        // Native callers can forge headers but still need the bound admin token.
        if (request.Scheme == "http" && origin.Scheme == "https" && sites.Count == 1 && sites[0] == "same-origin")
            return "HttpsProxySameOrigin";
        return "OriginSchemeMismatch";
    }

    public static bool Accepted(string result) => result is "SameOrigin" or "HttpsProxySameOrigin" or "NoOriginObserved";
}
