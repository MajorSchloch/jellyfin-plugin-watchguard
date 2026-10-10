namespace Jellyfin.Plugin.WatchGuard;

public sealed record Viewer(Guid Id, string Name, bool IsAdmin);
public sealed record Title(Guid Id, string Name, bool IsSeries);
public sealed record Playback(bool Played, long PositionTicks, bool Active = false);
public sealed record Interest(Guid UserId, string Name, string[] Reasons);
public sealed record Protection(Guid ItemId, string Name, Interest[] Users);

public interface ICatalog
{
    Viewer? FindUser(Guid id);
    IEnumerable<Viewer> Users();
    Title? FindTitle(Guid itemId, Guid userId);
    IReadOnlyList<Playback> PlaybackFor(Title title, Guid userId);
}

public static class InterestRules
{
    public static string[] Reasons(bool watchlisted, IReadOnlyList<Playback> playback)
    {
        var reasons = new List<string>();
        if (watchlisted) reasons.Add("Watchlisted");
        if (playback.Any(p => p.Active)) reasons.Add("Currently watching");
        if (playback.Any(p => p.Played || p.PositionTicks > 0) && playback.Any(p => !p.Played))
            reasons.Add("Partially watched");
        return reasons.ToArray();
    }
}

public sealed class ProtectionService(ICatalog catalog, WatchlistStore store)
{
    public Protection Get(Title title, Viewer requester)
    {
        if (!requester.IsAdmin) throw new UnauthorizedAccessException("Administrator required.");
        var entries = store.Snapshot();
        var interested = catalog.Users()
            .Where(user => catalog.FindTitle(title.Id, user.Id) is not null)
            .Select(user => new Interest(user.Id, user.Name,
                InterestRules.Reasons(entries.Contains(new Entry(user.Id, title.Id)), catalog.PlaybackFor(title, user.Id))))
            .Where(user => user.Reasons.Length > 0)
            .OrderBy(user => user.Name, StringComparer.OrdinalIgnoreCase)
            .ToArray();
        return new Protection(title.Id, title.Name, interested);
    }
}
