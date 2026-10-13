using Jellyfin.Data;
using Jellyfin.Data.Enums;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Database.Implementations.Enums;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Movies;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Session;
using MediaBrowser.Model.Entities;

namespace Jellyfin.Plugin.WatchGuard;

public sealed record InterestedUser(Guid UserId, string DisplayName, string[] Reasons);
public sealed record ProtectionStatus(Guid ItemId, bool HasInterest, bool HasOtherInterestedUsers, InterestedUser[] Users);

public sealed class InterestService(WatchlistStore store, ILibraryManager library, IUserManager users,
    IUserDataManager data, ISessionManager sessions)
{
    public static bool Supported(BaseItem? item) => item is Movie or Series;

    public ProtectionStatus Get(BaseItem item, Guid requester) => GetCore(item, requester, null);

    internal ProtectionStatus GetForOverview(BaseItem item, Guid requester, OverviewBudget budget) => GetCore(item, requester, budget);

    private ProtectionStatus GetCore(BaseItem item, Guid requester, OverviewBudget? budget)
    {
        var entries = budget?.Entries ?? store.Read().ToHashSet();
        var playing = sessions.Sessions.Where(s => s.IsActive && s.NowPlayingItem is not null)
            .Select(s => (ItemId: s.NowPlayingItem.Id,
                Users: s.AdditionalUsers.Select(u => u.UserId).Append(s.UserId).ToHashSet())).ToArray();
        var result = new List<InterestedUser>();
        foreach (var candidate in budget?.Accounts ?? users.GetUsers())
        {
            budget?.Consume(1);
            var user = users.GetUserById(candidate.Id);
            if (user is null || user.HasPermission(PermissionKind.IsDisabled)) continue;
            var visible = library.GetItemById<BaseItem>(item.Id, user);
            if (!Supported(visible)) continue;
            var reasons = new List<string>();
            if (entries.Contains(new(user.Id, item.Id))) reasons.Add("Watchlisted");
            // Activity alone inspects native virtual/missing rows in the same bounded query.
            // Fresh protection keeps its existing available-episode query and semantics.
            var continuingActivity = budget?.IncludeActivity == true && visible is Series { Status: SeriesStatus.Continuing };
            IReadOnlyList<BaseItem> items = item is Series
                ? library.GetItemList(new InternalItemsQuery(user)
                {
                    AncestorIds = [item.Id], Recursive = true, IncludeItemTypes = [BaseItemKind.Episode],
                    IsVirtualItem = continuingActivity ? null : false, IsMissing = continuingActivity ? null : false, Limit = budget is null ? null : InterestOverviewService.EpisodeLimit + 1
                })
                : [visible!];
            if (budget is not null && items.Count > InterestOverviewService.EpisodeLimit) throw new OverviewLimitException();
            budget?.Consume(items.Count);
            // Active playback still covers available future episodes; only completion/progress
            // classification is restricted to aired episodes in the activity overview.
            var ids = items.Where(i => !continuingActivity || (!i.IsVirtualItem && i is Episode { IsMissingEpisode: false }))
                .Select(i => i.Id).ToHashSet();
            var coverageComplete = true;
            if (continuingActivity)
            {
                // A future virtual episode is not a gap. An aired/undated missing row is.
                coverageComplete = items.All(i => i.IsUnaired ||
                    (!i.IsVirtualItem && i is Episode { IsMissingEpisode: false } && i.PremiereDate.HasValue));
                if (!coverageComplete) budget!.IncompleteCoverage = true;
                items = items.Where(i => !i.IsUnaired && !i.IsVirtualItem && i is Episode { IsMissingEpisode: false }).ToArray();
            }
            var states = data.GetUserDataBatch(items, user);
            var resumes = data.GetResumeUserDataBatch(items, user);
            var effective = items.Select(i =>
            {
                if (!states.TryGetValue(i.Id, out var state))
                    throw new InvalidDataException("Native playback lookup was incomplete.");
                // Native selection includes completion of a more recently played alternate version.
                if (!resumes.TryGetValue(i.Id, out var resume)) return state;
                return new UserItemData
                {
                    Key = state.Key,
                    Played = state.Played || resume.UserData.Played,
                    PlaybackPositionTicks = resume.UserData.PlaybackPositionTicks
                };
            }).ToArray();
            if (item is Movie && effective.Any(s => !s.Played && s.PlaybackPositionTicks > 0)) reasons.Add("InProgress");
            if (item is Series && effective.Any(s => s.Played || s.PlaybackPositionTicks > 0) && effective.Any(s => !s.Played))
                reasons.Add("InProgress");
            if (budget is not null)
            {
                budget.PlaybackDates[user.Id] = states.Values.Select(s => s.LastPlayedDate)
                    .Concat(resumes.Values.Select(r => r.UserData.LastPlayedDate)).Max();
                // Overview-only observations reuse these reads. Completed history is never a protection reason.
                budget.Playback[user.Id] = new(user.Username, budget.PlaybackDates[user.Id],
                    !continuingActivity && effective.Length > 0 && effective.All(s => s.Played),
                    item is Series ? effective.Length : null, item is Series ? effective.Count(s => s.Played) : null)
                {
                    CaughtUp = continuingActivity && coverageComplete && effective.Length > 0 && effective.All(s => s.Played)
                };
            }
            if (playing.Any(s => s.Users.Contains(user.Id) &&
                (ids.Contains(s.ItemId) || library.GetItemById<BaseItem>(s.ItemId, user) is Video
                    { PrimaryVersionId: { } primaryId } && ids.Contains(primaryId))))
                reasons.Add("CurrentlyPlaying");
            if (reasons.Count > 0) result.Add(new(user.Id, user.Username, reasons.ToArray()));
        }
        return new(item.Id, result.Count > 0, result.Any(u => u.UserId != requester), result.ToArray());
    }
}
