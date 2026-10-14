using Jellyfin.Database.Implementations.Entities;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Movies;
using MediaBrowser.Controller.Library;

namespace Jellyfin.Plugin.WatchGuard;

// One overview candidate chunk only. Never registered in DI or used by protection.
internal sealed class OverviewMovieReads(BaseItem[] candidates, ILibraryManager library, IUserDataManager data)
{
    private readonly Dictionary<Guid, (Dictionary<Guid, UserItemData> States, IReadOnlyDictionary<Guid, VersionResumeData> Resumes)> accounts = new();
    public int BatchCalls { get; private set; }

    public (Dictionary<Guid, UserItemData> States, IReadOnlyDictionary<Guid, VersionResumeData> Resumes) Read(BaseItem item, User user)
    {
        if (!accounts.TryGetValue(user.Id, out var snapshot))
        {
            var visible = candidates.OfType<Movie>().Select(m => library.GetItemById<BaseItem>(m.Id, user)).OfType<Movie>().Cast<BaseItem>().ToArray();
            snapshot = (data.GetUserDataBatch(visible, user), data.GetResumeUserDataBatch(visible, user));
            BatchCalls += 2;
            accounts.Add(user.Id, snapshot);
        }
        if (!snapshot.States.TryGetValue(item.Id, out var state)) throw new InvalidDataException("Native playback lookup was incomplete.");
        // Return only this title: dates/progress must never include another movie's rows.
        return (new() { [item.Id] = state }, snapshot.Resumes.TryGetValue(item.Id, out var resume)
            ? new Dictionary<Guid, VersionResumeData> { [item.Id] = resume } : new Dictionary<Guid, VersionResumeData>());
    }
}
