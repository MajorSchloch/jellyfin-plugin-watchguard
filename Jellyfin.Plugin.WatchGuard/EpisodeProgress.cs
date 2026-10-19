using Jellyfin.Data;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.TV;

namespace Jellyfin.Plugin.WatchGuard;

// Informational only. Native queries have already applied visibility/version grouping.
// Neither these counts nor the extra list may authorize deletion or change classification.
public sealed record ExtraEpisode(Guid ItemId, int? SeasonNumber, int? EpisodeNumber, int? EpisodeNumberEnd,
    string Name, DateTime? PremiereDate, string ReleaseStatus, bool Watched);
public sealed record EpisodeProgress(int AiredAvailable, int AiredWatched, ExtraEpisode[] ExtraEpisodes)
{
    internal static EpisodeProgress From(IReadOnlyList<BaseItem> items,
        IReadOnlyDictionary<Guid, UserItemData> states, IReadOnlyDictionary<Guid, VersionResumeData> resumes,
        DateTime localToday)
    {
        var aired = 0;
        var watched = 0;
        var extras = new List<ExtraEpisode>();
        foreach (var episode in items.OfType<Episode>().Where(e => !e.IsVirtualItem && !e.IsMissingEpisode).DistinctBy(e => e.Id))
        {
            if (!states.TryGetValue(episode.Id, out var state))
                throw new InvalidDataException("Native playback lookup was incomplete.");
            var played = state.Played || (resumes.TryGetValue(episode.Id, out var resume) && resume.UserData.Played);
            // Match Jellyfin BaseItem.IsUnaired: server-local calendar date, including release day.
            var day = episode.PremiereDate?.ToLocalTime().Date;
            if (day.HasValue && day < localToday.Date)
            {
                aired++;
                if (played) watched++;
            }
            else extras.Add(new(episode.Id, episode.ParentIndexNumber, episode.IndexNumber, episode.IndexNumberEnd,
                episode.Name, episode.PremiereDate, !day.HasValue ? "UnknownDate" : day == localToday.Date ? "ReleaseDay" : "Future", played));
        }
        return new(aired, watched, extras.OrderBy(e => e.SeasonNumber).ThenBy(e => e.EpisodeNumber).ThenBy(e => e.ItemId).ToArray());
    }
}
