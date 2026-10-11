using Jellyfin.Data;
using Jellyfin.Database.Implementations.Enums;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Net;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.WatchGuard;

[ApiController]
[Authorize]
[Route("WatchGuard")]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class WatchGuardController(IAuthorizationContext authorization, IUserManager users,
    ILibraryManager library, WatchlistStore store, InterestService interest, ILogger<WatchGuardController> logger, InterestOverviewService overview) : ControllerBase
{
    private async Task<Jellyfin.Database.Implementations.Entities.User?> CurrentUser()
    {
        var info = await authorization.GetAuthorizationInfo(HttpContext);
        if (!info.IsAuthenticated || info.IsApiKey || info.UserId == Guid.Empty) return null;
        var user = users.GetUserById(info.UserId);
        return user is not null && !user.HasPermission(PermissionKind.IsDisabled) ? user : null;
    }

    private async Task<IActionResult> Execute(Func<Task<IActionResult>> action)
    {
        try { return await action(); }
        catch (Exception exception)
        {
            // Do not expose file paths, tokens, native payloads or partial interest results.
            logger.LogWarning("WatchGuard lookup/storage failed ({ErrorType})", exception.GetType().Name);
            return Problem(statusCode: 503, title: "WatchGuard state unavailable", detail: "Interest could not be determined. Retry after resolving the server error.");
        }
    }

    [HttpGet("Watchlist")]
    public Task<IActionResult> List() => Execute(async () =>
    {
        var user = await CurrentUser();
        if (user is null) return Unauthorized();
        var items = store.Read().Where(e => e.UserId == user.Id)
            .Select(e => library.GetItemById<BaseItem>(e.ItemId, user))
            .Where(InterestService.Supported).Select(i => new { ItemId = i!.Id, Name = i.Name }).ToArray();
        return Ok(items);
    });

    [HttpPut("Watchlist/{itemId:guid}")]
    public Task<IActionResult> Add(Guid itemId) => Change(itemId, true);

    [HttpDelete("Watchlist/{itemId:guid}")]
    public Task<IActionResult> Remove(Guid itemId) => Change(itemId, false);

    [HttpGet("Watchlists")]
    public Task<IActionResult> AllWatchlists() => Execute(async () =>
    {
        var caller = await CurrentUser();
        if (caller is null) return Unauthorized();
        if (!caller.HasPermission(PermissionKind.IsAdministrator)) return Forbid();
        var result = new List<SharedWatchlistItem>();
        foreach (var group in store.Read().GroupBy(e => e.ItemId))
        {
            var item = library.GetItemById<BaseItem>(group.Key, caller);
            if (!InterestService.Supported(item)) continue;
            var owners = new List<WatchlistOwner>();
            foreach (var entry in group)
            {
                var owner = users.GetUserById(entry.UserId);
                if (owner is null || owner.HasPermission(PermissionKind.IsDisabled)) continue;
                if (!InterestService.Supported(library.GetItemById<BaseItem>(entry.ItemId, owner))) continue;
                owners.Add(new(owner.Id, owner.Username));
            }
            if (owners.Count > 0) result.Add(new(item!.Id, item.Name,
                owners.OrderBy(o => o.DisplayName, StringComparer.OrdinalIgnoreCase).ThenBy(o => o.UserId).ToArray()));
        }
        return Ok(result.OrderBy(i => i.Name, StringComparer.OrdinalIgnoreCase).ThenBy(i => i.ItemId).ToArray());
    });

    private Task<IActionResult> Change(Guid itemId, bool present) => Execute(async () =>
    {
        var user = await CurrentUser();
        if (user is null) return Unauthorized();
        if (itemId == Guid.Empty) return BadRequest();
        if (present && !InterestService.Supported(library.GetItemById<BaseItem>(itemId, user))) return NotFound();
        // Removing one's own stale/inaccessible ID reveals nothing about the library.
        store.Set(user.Id, itemId, present);
        return NoContent();
    });

    [HttpGet("InterestOverview/Me")]
    public Task<IActionResult> OwnOverview() => Execute(async () =>
    {
        var user = await CurrentUser();
        return user is null ? Unauthorized() : Ok(overview.Get(user, ownOnly: true));
    });

    [HttpGet("InterestOverview")]
    public Task<IActionResult> Overview() => Execute(async () =>
    {
        var user = await CurrentUser();
        if (user is null) return Unauthorized();
        if (!user.HasPermission(PermissionKind.IsAdministrator)) return Forbid();
        return Ok(overview.Get(user));
    });

    [HttpGet("Protection/{itemId:guid}")]
    public Task<IActionResult> Protection(Guid itemId) => Execute(async () =>
    {
        var user = await CurrentUser();
        if (user is null) return Unauthorized();
        if (!user.HasPermission(PermissionKind.IsAdministrator)) return Forbid();
        var item = library.GetItemById<BaseItem>(itemId, user);
        if (!InterestService.Supported(item)) return NotFound();
        return Ok(interest.Get(item!, user.Id));
    });
}

public sealed record WatchlistOwner(Guid UserId, string DisplayName);
public sealed record SharedWatchlistItem(Guid ItemId, string Name, WatchlistOwner[] Users);
