using System.Text.RegularExpressions;
using Jellyfin.Data;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Database.Implementations.Enums;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Net;
using Microsoft.AspNetCore.Http;

namespace Jellyfin.Plugin.WatchGuard.ServerEnforcement;

public sealed record Principal(User User, Owner Owner)
{
    public bool IsAdmin => User.HasPermission(PermissionKind.IsAdministrator);
}
public sealed class Identity(IAuthorizationContext authorization, IUserManager users, ApprovalStore store)
{
    public async Task<Principal> Read(HttpContext context, bool administrator = false)
    {
        context.RequestAborted.ThrowIfCancellationRequested();
        var request = context.Request;
        // This overload deliberately bypasses the per-HttpContext authorization-info cache.
        var auth = await authorization.GetAuthorizationInfo(request);
        if (!auth.IsAuthenticated || !auth.HasToken || auth.UserId == Guid.Empty || auth.IsApiKey)
            throw new GuardFailure(auth.IsApiKey ? 403 : 401, "NativePermissionDenied");
        var user = users.GetUserById(auth.UserId);
        if (user is null || user.HasPermission(PermissionKind.IsDisabled)) throw new GuardFailure(401, "NativePermissionDenied");
        var owner = new Owner(user.Id, store.SessionDigest(auth.Token));
        if (administrator && !user.HasPermission(PermissionKind.IsAdministrator)) throw new GuardFailure(403, "NativePermissionDenied");
        // Never accept native URL-token fallback or ambient cookie credentials for this protocol.
        if (request.Query.Keys.Any(k => k.Equals("ApiKey", StringComparison.OrdinalIgnoreCase) || k.Equals("api_key", StringComparison.OrdinalIgnoreCase)))
            throw new GuardFailure(403, "ApprovalInvalid");
        var header = request.Headers.Authorization;
        if (header.Count != 1 || !header.ToString().StartsWith("MediaBrowser ", StringComparison.OrdinalIgnoreCase))
            throw new GuardFailure(403, "ApprovalInvalid");
        var matches = Regex.Matches(header.ToString()[13..], "(?:^|,)\\s*Token=\"([^\"]+)\"(?=\\s*(?:,|$))", RegexOptions.CultureInvariant, TimeSpan.FromMilliseconds(100));
        if (matches.Count != 1 || matches[0].Groups[1].Value != auth.Token) throw new GuardFailure(403, "ApprovalInvalid");
        var origin = request.Headers.Origin;
        if (origin.Count > 0 && (origin.Count != 1 || !Uri.TryCreate(origin.ToString(), UriKind.Absolute, out var uri) ||
            uri.GetLeftPart(UriPartial.Authority) != request.Scheme + "://" + request.Host.Value || uri.AbsolutePath != "/" || !string.IsNullOrEmpty(uri.Query) || !string.IsNullOrEmpty(uri.Fragment)))
            throw new GuardFailure(403, "ApprovalInvalid");
        var site = request.Headers["Sec-Fetch-Site"].ToString();
        if (site.Length > 0 && site is not ("same-origin" or "none")) throw new GuardFailure(403, "ApprovalInvalid");
        return new(user, owner);
    }
}
