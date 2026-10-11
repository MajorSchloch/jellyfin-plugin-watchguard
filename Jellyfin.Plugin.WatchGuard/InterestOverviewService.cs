using Microsoft.Extensions.Logging;
using Jellyfin.Data;
using Jellyfin.Data.Enums;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Database.Implementations.Enums;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Session;
using MediaBrowser.Model.Entities;

namespace Jellyfin.Plugin.WatchGuard;

public sealed record OverviewUser(Guid UserId, string DisplayName, string[] Reasons, DateTime? LastPlayedDate);
public sealed record OverviewItem(Guid ItemId, string Name, OverviewUser[] Users);
public sealed record InterestOverview(OverviewItem[] Items, bool IsComplete, bool LimitReached, string Notice);

// Request-local safety budget, never used by deletion/protection checks.
internal sealed class OverviewBudget(WatchlistEntry[] entries, User[] accounts)
{
    public User[] Accounts { get; } = accounts;
    public HashSet<WatchlistEntry> Entries { get; } = entries.ToHashSet();
    public Dictionary<Guid, DateTime?> PlaybackDates { get; } = new();
    public int Remaining { get; private set; } = 20000;
    public void Consume(int count)
    {
        Remaining -= count;
        if (Remaining < 0) throw new OverviewLimitException();
    }
}
internal sealed class OverviewLimitException : Exception;

public sealed class InterestOverviewService(WatchlistStore store, ILibraryManager library, IUserManager users,
    ISessionManager sessions, InterestService interest, ILogger<InterestOverviewService>? logger = null)
{
    public const int CandidateLimit = 100;
    public const int DiscoveryLimit = 100;
    public const int UserLimit = 50;
    public const int EpisodeLimit = 1000;

    public InterestOverview Get(User caller, bool ownOnly = false, bool automaticOnly = false)
    {
        var enabled = (ownOnly ? new[] { caller } : users.GetUsers()).Select(u => users.GetUserById(u.Id))
            .Where(u => u is not null && !u.HasPermission(PermissionKind.IsDisabled)).Cast<User>().Take(UserLimit + 1).ToArray();
        if (enabled.Length > UserLimit) throw new InvalidOperationException("Overview user budget exceeded.");
        WatchlistEntry[] entries;
        using (OverviewTiming.Begin("StoreRead", logger)) entries = automaticOnly ? [] : store.Read().Where(e => !ownOnly || e.UserId == caller.Id).ToArray();
        var budget = new OverviewBudget(entries, enabled);
        var candidates = new Dictionary<Guid, BaseItem>();
        var limited = false;
        void Add(Guid id, User owner)
        {
            var item = library.GetItemById<BaseItem>(id, owner);
            if (item is Video { PrimaryVersionId: { } primary } && primary != Guid.Empty)
                item = library.GetItemById<BaseItem>(primary, owner);
            if (item is Episode episode) item = library.GetItemById<BaseItem>(episode.SeriesId, owner);
            if (!InterestService.Supported(item)) return;
            var visible = library.GetItemById<BaseItem>(item!.Id, caller);
            if (!InterestService.Supported(visible) || candidates.ContainsKey(item.Id)) return;
            if (candidates.Count == CandidateLimit) { limited = true; return; }
            candidates.Add(item.Id, visible!);
        }
        // Active playback gets first priority; additional session users are verified natively too.
        foreach (var session in sessions.Sessions.Where(s => s.IsActive && s.NowPlayingItem is not null))
            foreach (var id in session.AdditionalUsers.Select(u => u.UserId).Append(session.UserId).Distinct())
                if (enabled.FirstOrDefault(u => u.Id == id) is { } owner) Add(session.NowPlayingItem!.Id, owner);
        foreach (var user in enabled)
        {
            foreach (var resumable in new[] { true, false })
            {
                using var discoveryTiming = OverviewTiming.Begin(resumable ? "ResumeDiscovery" : "PlayedDiscovery", logger);
                // Same native query family as Continue Watching, plus completed episodes to discover
                // series between episodes. Limit is applied in the database, not after a library scan.
                var found = library.GetItemList(new InternalItemsQuery(user)
                {
                    Recursive = true, IsVirtualItem = false, IsMissing = false,
                    IncludeItemTypes = resumable ? [BaseItemKind.Movie, BaseItemKind.Episode] : [BaseItemKind.Episode],
                    IsResumable = resumable ? true : null, IsPlayed = resumable ? null : true,
                    OrderBy = [(ItemSortBy.DatePlayed, SortOrder.Descending)], Limit = DiscoveryLimit + 1,
                    EnableTotalRecordCount = false
                });
                if (found.Count > DiscoveryLimit) limited = true;
                foreach (var item in found.Take(DiscoveryLimit)) Add(item.Id, user);
            }
        }
        foreach (var entry in budget.Entries)
            if (enabled.FirstOrDefault(u => u.Id == entry.UserId) is { } owner) Add(entry.ItemId, owner);
        var result = new List<OverviewItem>();
        using var verificationTiming = OverviewTiming.Begin("Verification", logger);
        foreach (var item in candidates.Values)
        {
            try
            {
                budget.PlaybackDates.Clear();
                var status = interest.GetForOverview(item, caller.Id, budget);
                if (status.HasInterest) result.Add(new(item.Id, item.Name, status.Users.Select(u =>
                    new OverviewUser(u.UserId, u.DisplayName, u.Reasons, budget.PlaybackDates.GetValueOrDefault(u.UserId))).ToArray()));
            }
            catch (OverviewLimitException) { limited = true; break; }
        }
        // Candidate discovery is deliberately bounded. Even below the caps it is not an exhaustive audit.
        return new(result.OrderBy(i => i.Name, StringComparer.OrdinalIgnoreCase).ThenBy(i => i.ItemId).ToArray(), false, limited,
            (automaticOnly ? "Recent viewing interest; not an exhaustive library audit." : "Recent viewing interest and explicit watchlists; not an exhaustive library audit.")
            + (limited ? " A safety limit was reached; some items are omitted." : string.Empty));
    }
}
