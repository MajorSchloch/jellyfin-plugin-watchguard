using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Jellyfin.Plugin.WatchGuard;

[ApiController]
[Authorize]
[Route("WatchGuard")]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class WatchGuardController(ICatalog catalog, WatchlistStore store, ProtectionService protection) : ControllerBase
{
    // Jellyfin 12's authenticated user claim. Never accept a user ID from the request.
    private Viewer? CurrentUser => User.Identity?.IsAuthenticated == true &&
        Guid.TryParse(User.FindFirst("Jellyfin-UserId")?.Value, out var id) ? catalog.FindUser(id) : null;

    [HttpGet("Watchlist")]
    public ActionResult<Title[]> List()
    {
        var user = CurrentUser;
        if (user is null) return Unauthorized();
        return store.Snapshot().Where(e => e.UserId == user.Id)
            .Select(e => catalog.FindTitle(e.ItemId, user.Id)).OfType<Title>().ToArray();
    }

    [HttpGet("Watchlist/{itemId:guid}")]
    public IActionResult Contains(Guid itemId)
    {
        var user = CurrentUser;
        if (user is null) return Unauthorized();
        if (catalog.FindTitle(itemId, user.Id) is null) return NotFound();
        return Ok(new { Watchlisted = store.Snapshot().Contains(new Entry(user.Id, itemId)) });
    }

    [HttpPut("Watchlist/{itemId:guid}")]
    public IActionResult Add(Guid itemId)
    {
        var user = CurrentUser;
        if (user is null) return Unauthorized();
        if (catalog.FindTitle(itemId, user.Id) is null) return NotFound();
        store.Set(user.Id, itemId, true);
        return NoContent();
    }

    [HttpDelete("Watchlist/{itemId:guid}")]
    public IActionResult Remove(Guid itemId)
    {
        var user = CurrentUser;
        if (user is null) return Unauthorized();
        if (itemId == Guid.Empty) return BadRequest();
        // Permit removal of stale own entries even after a library item disappears.
        store.Set(user.Id, itemId, false);
        return NoContent();
    }

    [HttpGet("Protection/{itemId:guid}")]
    public ActionResult<Protection> Status(Guid itemId)
    {
        var user = CurrentUser;
        if (user is null) return Unauthorized();
        if (!user.IsAdmin) return Forbid();
        var title = catalog.FindTitle(itemId, user.Id);
        if (title is null) return NotFound();
        return protection.Get(title, user);
    }
}
