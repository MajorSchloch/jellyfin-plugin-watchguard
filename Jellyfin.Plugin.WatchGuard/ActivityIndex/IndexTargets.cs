using Jellyfin.Database.Implementations.Entities;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Library;

namespace Jellyfin.Plugin.WatchGuard.ActivityIndex;

internal static class IndexTargets
{
    // Same native primary-version selection as InterestOverviewService.Add.
    // Resolve through the owner's native visibility, never an unscoped lookup.
    internal static BaseItem? Primary(ILibraryManager library, User owner, BaseItem item) =>
        item is Video { PrimaryVersionId: { } primary } && primary != Guid.Empty
            ? library.GetItemById<BaseItem>(primary, owner) : item;
}
