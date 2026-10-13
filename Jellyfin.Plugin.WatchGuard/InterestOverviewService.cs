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

public sealed record OverviewUser(Guid UserId, string DisplayName, string[] Reasons, DateTime? LastPlayedDate, int? AvailableEpisodes = null, int? WatchedEpisodes = null);
public sealed record OverviewItem(Guid ItemId, string Name, OverviewUser[] Users);
public sealed record InterestOverview(OverviewItem[] Items, bool IsComplete, bool LimitReached, string Notice);

internal sealed record OverviewPlayback(string DisplayName, DateTime? LastPlayedDate, bool Completed, int? AvailableEpisodes, int? WatchedEpisodes)
{
    public bool CaughtUp { get; init; }
}

// Request-local safety budget, never used by deletion/protection checks.
internal sealed class OverviewBudget(WatchlistEntry[] entries, User[] accounts)
{
    public User[] Accounts { get; } = accounts;
    public bool IncludeActivity { get; init; }
    public bool IncompleteCoverage { get; set; }
    public HashSet<WatchlistEntry> Entries { get; } = entries.ToHashSet();
    public Dictionary<Guid, DateTime?> PlaybackDates { get; } = new();
    public Dictionary<Guid, OverviewPlayback> Playback { get; } = new();
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

    public InterestOverview GetActivity(User caller, bool ownOnly = false, int days = 30, int limit = CandidateLimit, Guid? scopeUserId = null) =>
        Get(caller, ownOnly, automaticOnly: true, activityDays: Math.Clamp(days, 1, 90), candidateLimit: Math.Clamp(limit, 1, CandidateLimit), scopeUserId: scopeUserId);

    public InterestOverview Get(User caller, bool ownOnly = false, bool automaticOnly = false, int? activityDays = null, int candidateLimit = CandidateLimit, Guid? scopeUserId = null)
    {
        var now = DateTime.UtcNow;
        var cutoff = now.AddDays(-(activityDays ?? 30));
        var enabled = (scopeUserId.HasValue ? new[] { users.GetUserById(scopeUserId.Value) }.OfType<User>() : ownOnly ? new[] { caller } : users.GetUsers()).Select(u => users.GetUserById(u.Id))
            .Where(u => u is not null && !u.HasPermission(PermissionKind.IsDisabled)).Cast<User>().Take(UserLimit + 1).ToArray();
        if (enabled.Length > UserLimit) throw new InvalidOperationException("Overview user budget exceeded.");
        WatchlistEntry[] entries;
        using (OverviewTiming.Begin("StoreRead", logger)) entries = automaticOnly ? [] : store.Read().Where(e => !ownOnly || e.UserId == caller.Id).ToArray();
        var budget = new OverviewBudget(entries, enabled) { IncludeActivity = activityDays.HasValue };
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
            if (candidates.Count == candidateLimit) { limited = true; return; }
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
        // Keep resume/series candidates ahead of completed movies. No unbounded date/history scan.
        if (activityDays.HasValue)
            foreach (var user in enabled)
            {
                using var completedTiming = OverviewTiming.Begin("CompletedMovieDiscovery", logger);
                var found = library.GetItemList(new InternalItemsQuery(user)
                {
                    Recursive = true, IsVirtualItem = false, IsMissing = false,
                    IncludeItemTypes = [BaseItemKind.Movie], IsPlayed = true,
                    OrderBy = [(ItemSortBy.DatePlayed, SortOrder.Descending)], Limit = candidateLimit + 1,
                    EnableTotalRecordCount = false
                });
                if (found.Count > candidateLimit) limited = true;
                foreach (var item in found.Take(candidateLimit)) Add(item.Id, user);
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
                budget.Playback.Clear();
                var status = interest.GetForOverview(item, caller.Id, budget);
                var owners = status.Users.ToDictionary(u => u.UserId, u => u);
                if (activityDays.HasValue)
                    foreach (var (id, playback) in budget.Playback)
                        if (playback.CaughtUp || (playback.Completed && playback.LastPlayedDate >= cutoff && playback.LastPlayedDate <= now))
                        {
                            var reason = playback.CaughtUp ? "CaughtUp" : "Watched";
                            if (owners.TryGetValue(id, out var owner)) owners[id] = owner with { Reasons = [.. owner.Reasons, reason] };
                            else owners[id] = new(id, playback.DisplayName, [reason]);
                        }
                if (owners.Count > 0) result.Add(new(item.Id, item.Name, owners.Values.Select(u =>
                {
                    var playback = budget.Playback.GetValueOrDefault(u.UserId);
                    return new OverviewUser(u.UserId, u.DisplayName, u.Reasons, budget.PlaybackDates.GetValueOrDefault(u.UserId),
                        activityDays.HasValue ? playback?.AvailableEpisodes : null, activityDays.HasValue ? playback?.WatchedEpisodes : null);
                }).ToArray()));
            }
            catch (OverviewLimitException) { limited = true; break; }
        }
        // Candidate discovery is deliberately bounded. Even below the caps it is not an exhaustive audit.
        return new(result.OrderBy(i => i.Name, StringComparer.OrdinalIgnoreCase).ThenBy(i => i.ItemId).ToArray(), false, limited,
            (activityDays.HasValue ? $"Recent viewing activity: completed titles with a native playback date in the last {activityDays} days, plus current viewing interest; not an exhaustive library audit." : automaticOnly ? "Recent viewing interest; not an exhaustive library audit." : "Recent viewing interest and explicit watchlists; not an exhaustive library audit.")
            + (budget.IncompleteCoverage ? " Some continuing series lack episode or air-date coverage; Caught Up is not inferred for them." : string.Empty)
            + (limited ? " A safety limit was reached; some items are omitted." : string.Empty));
    }
}
