using Jellyfin.Data;
using Jellyfin.Data.Enums;
using Jellyfin.Database.Implementations.Enums;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Movies;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Session;

namespace Jellyfin.Plugin.WatchGuard;

public sealed class JellyfinCatalog(ILibraryManager library, IUserManager users, IUserDataManager data, ISessionManager sessions) : ICatalog
{
    public Viewer? FindUser(Guid id)
    {
        var user = id == Guid.Empty ? null : users.GetUserById(id);
        return user is null || user.HasPermission(PermissionKind.IsDisabled) ? null :
            new Viewer(user.Id, user.Username, user.HasPermission(PermissionKind.IsAdministrator));
    }

    public IEnumerable<Viewer> Users() => users.GetUsers().Select(u => FindUser(u.Id)).OfType<Viewer>();

    public Title? FindTitle(Guid itemId, Guid userId)
    {
        var user = users.GetUserById(userId);
        if (user is null) return null;
        var item = library.GetItemById<BaseItem>(itemId, user);
        return item is Movie or Series && !item.IsVirtualItem ? new Title(item.Id, item.Name, item is Series) : null;
    }

    public IReadOnlyList<Playback> PlaybackFor(Title title, Guid userId)
    {
        var user = users.GetUserById(userId);
        if (user is null) return [];
        var item = library.GetItemById<BaseItem>(title.Id, user);
        if (item is null) return [];
        IReadOnlyList<BaseItem> items = title.IsSeries
            ? library.GetItemList(new InternalItemsQuery(user)
            {
                AncestorIds = [title.Id], Recursive = true,
                IncludeItemTypes = [BaseItemKind.Episode], IsVirtualItem = false, IsMissing = false
            })
            : [item];
        var active = sessions.Sessions
            .Where(s => s.UserId == userId || s.AdditionalUsers.Any(u => u.UserId == userId))
            .Where(s => s.NowPlayingItem is not null).Select(s => s.NowPlayingItem.Id).ToHashSet();
        return items.Select(i =>
        {
            var state = data.GetUserData(user, i);
            return new Playback(state?.Played ?? false, state?.PlaybackPositionTicks ?? 0, active.Contains(i.Id));
        }).ToArray();
    }
}
