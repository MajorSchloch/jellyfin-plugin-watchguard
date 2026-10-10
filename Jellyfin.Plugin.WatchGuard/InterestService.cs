using Jellyfin.Data;
using Jellyfin.Data.Enums;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Database.Implementations.Enums;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Movies;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Session;

namespace Jellyfin.Plugin.WatchGuard;

public sealed record InterestedUser(Guid UserId, string DisplayName, string[] Reasons);
public sealed record ProtectionStatus(Guid ItemId, bool HasInterest, bool HasOtherInterestedUsers, InterestedUser[] Users);

public sealed class InterestService(WatchlistStore store, ILibraryManager library, IUserManager users,
    IUserDataManager data, ISessionManager sessions)
{
    public static bool Supported(BaseItem? item) => item is Movie or Series;

    public ProtectionStatus Get(BaseItem item, Guid requester)
    {
        var entries = store.Read().ToHashSet();
        var playing = sessions.Sessions.Where(s => s.IsActive && s.NowPlayingItem is not null)
            .Select(s => (ItemId: s.NowPlayingItem.Id,
                Users: s.AdditionalUsers.Select(u => u.UserId).Append(s.UserId).ToHashSet())).ToArray();
        var result = new List<InterestedUser>();
        foreach (var candidate in users.GetUsers())
        {
            var user = users.GetUserById(candidate.Id);
            if (user is null || user.HasPermission(PermissionKind.IsDisabled)) continue;
            var visible = library.GetItemById<BaseItem>(item.Id, user);
            if (!Supported(visible)) continue;
            var reasons = new List<string>();
            if (entries.Contains(new(user.Id, item.Id))) reasons.Add("Watchlisted");
            IReadOnlyList<BaseItem> items = item is Series
                ? library.GetItemList(new InternalItemsQuery(user)
                {
                    AncestorIds = [item.Id], Recursive = true, IncludeItemTypes = [BaseItemKind.Episode],
                    IsVirtualItem = false, IsMissing = false
                })
                : [visible!];
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
            var ids = items.Select(i => i.Id).ToHashSet();
            if (playing.Any(s => s.Users.Contains(user.Id) &&
                (ids.Contains(s.ItemId) || library.GetItemById<BaseItem>(s.ItemId, user) is Video
                    { PrimaryVersionId: { } primaryId } && ids.Contains(primaryId))))
                reasons.Add("CurrentlyPlaying");
            if (reasons.Count > 0) result.Add(new(user.Id, user.Username, reasons.ToArray()));
        }
        return new(item.Id, result.Count > 0, result.Any(u => u.UserId != requester), result.ToArray());
    }
}
