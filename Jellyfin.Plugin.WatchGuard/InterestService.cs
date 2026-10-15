using System.Diagnostics;
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

    public ProtectionStatus Get(BaseItem item, Guid requester)
    {
        if (item is not Series series) return GetCore(item, requester, null);
        var activity = GetSeriesActivity(series, requester);
        if (!activity.IsComplete) throw new InvalidDataException("Series safety budget exceeded.");
        var protectCaughtUp = Plugin.Instance?.Configuration.ProtectCaughtUpSeries ?? true;
        if (protectCaughtUp && series.Status == SeriesStatus.Continuing && activity.Users.Any(u =>
                !u.CoverageComplete && (u.ProtectionInProgress || u.Reasons.Contains("Unknown"))))
            throw new InvalidDataException("Caught Up coverage could not be verified.");
        var owners = activity.Users.Select(u => new InterestedUser(u.UserId, u.DisplayName,
            u.Reasons.Where(r => r is "Watchlisted" or "InProgress" or "CurrentlyPlaying" ||
                (protectCaughtUp && r == "CaughtUp")).Concat(u.ProtectionInProgress ? ["InProgress"] : []).Distinct().ToArray())).Where(u => u.Reasons.Length > 0).ToArray();
        return new(item.Id, owners.Length > 0, owners.Any(u => u.UserId != requester), owners);
    }

    public SeriesActivity GetSeriesActivity(Series series, Guid requester)
    {
        var accounts = users.GetUsers().Where(u => !u.HasPermission(PermissionKind.IsDisabled))
            .Take(InterestOverviewService.UserLimit + 1).ToArray();
        var budget = new OverviewBudget(store.Read(), accounts.Take(InterestOverviewService.UserLimit).ToArray())
            { IncludeActivity = true, TargetedSeries = true };
        ProtectionStatus? status = null;
        var limited = accounts.Length > InterestOverviewService.UserLimit;
        try { status = GetCore(series, requester, budget); }
        catch (OverviewLimitException) { limited = true; }
        var owners = status?.Users.ToDictionary(u => u.UserId) ?? new Dictionary<Guid, InterestedUser>();
        // Capture only fully evaluated users if a safety budget stopped this request.
        var rows = budget.Playback.Select(pair =>
        {
            var playback = pair.Value;
            var reasons = budget.TargetedReasons.GetValueOrDefault(pair.Key) ?? owners.GetValueOrDefault(pair.Key)?.Reasons ?? [];
            if (playback.CaughtUp) reasons = [.. reasons, "CaughtUp"];
            else if (playback.Completed && series.Status == SeriesStatus.Ended && playback.CoverageComplete) reasons = [.. reasons, "Watched"];
            else if (playback.Started && !reasons.Contains("InProgress")) reasons = [.. reasons, "Unknown"];
            else if ((playback.Started || playback.ProtectionInProgress) && reasons.Length == 0) reasons = ["Unknown"];
            return new SeriesViewer(pair.Key, playback.DisplayName, reasons, playback.AvailableEpisodes ?? 0,
                playback.WatchedEpisodes ?? 0, playback.LastPlayedDate, playback.CoverageComplete) { ProtectionInProgress = playback.ProtectionInProgress };
        }).Where(u => u.Reasons.Length > 0 || u.ProtectionInProgress).ToArray();
        return new(series.Id, series.Name, series.Status is SeriesStatus.Continuing or SeriesStatus.Ended ? series.Status.ToString()! : "Unknown",
            !limited, limited, rows, limited ? "Safety limit reached; some users or episodes were not evaluated." :
                budget.IncompleteCoverage ? "Some episode metadata is missing or incomplete; counts are observations, not complete coverage." :
                "Coverage describes the episodes known and visible to Jellyfin, not an external episode catalog.");
    }

    internal ProtectionStatus GetForOverview(BaseItem item, Guid requester, OverviewBudget budget) => GetCore(item, requester, budget);

    internal void PrepareOverviewVerification(BaseItem[] candidates, OverviewBudget budget) =>
        budget.VerificationReads = new(candidates, library, users, data, budget);

    private ProtectionStatus GetCore(BaseItem item, Guid requester, OverviewBudget? budget)
    {
        var entries = budget?.Entries ?? store.Read().ToHashSet();
        var playing = (budget?.SessionSnapshot ?? sessions.Sessions).Where(s => s.IsActive && s.NowPlayingItem is not null)
            .Select(s => (ItemId: s.NowPlayingItem.Id,
                Users: s.AdditionalUsers.Select(u => u.UserId).Append(s.UserId).ToHashSet())).ToArray();
        var result = new List<InterestedUser>();
        foreach (var candidate in budget?.Accounts ?? users.GetUsers())
        {
            budget?.Consume(1);
            if (budget is not null) budget.Diagnostics.UsersEvaluated++;
            var visibilityStarted = Stopwatch.GetTimestamp();
            var user = budget?.VerificationReads is { } preparedAccount
                ? preparedAccount.Account(candidate.Id, budget) : users.GetUserById(candidate.Id);
            if (user is null || user.HasPermission(PermissionKind.IsDisabled)) continue;
            var visible = budget?.VerificationReads is { } prepared
                ? prepared.Visible(item.Id, user.Id, budget) : library.GetItemById<BaseItem>(item.Id, user);
            if (budget is not null) budget.Diagnostics.VisibilityDurationMs += OverviewDiagnostics.Elapsed(visibilityStarted);
            if (!Supported(visible)) continue;
            var reasons = new List<string>();
            if (entries.Contains(new(user.Id, item.Id))) reasons.Add("Watchlisted");
            // Targeted series reads include missing rows to verify completion coverage.
            var continuingActivity = budget?.IncludeActivity == true && visible is Series { Status: SeriesStatus.Continuing };
            var inspectCoverage = continuingActivity || budget?.TargetedSeries == true;
            var episodeStarted = Stopwatch.GetTimestamp();
            IReadOnlyList<BaseItem> items = budget?.VerificationReads is { } preparedRows
                ? preparedRows.Episodes(item.Id, user.Id)
                : item is Series
                ? library.GetItemList(new InternalItemsQuery(user)
                {
                    AncestorIds = [item.Id], Recursive = true, IncludeItemTypes = [BaseItemKind.Episode],
                    IsVirtualItem = inspectCoverage ? null : false, IsMissing = inspectCoverage ? null : false, Limit = budget is null ? null : InterestOverviewService.EpisodeLimit + 1
                })
                : [visible!];
            if (budget is not null && item is Series && budget.VerificationReads is null)
            {
                budget.Diagnostics.EpisodeRowsProcessed += items.Count;
                budget.Diagnostics.EpisodeQueryCount++;
                budget.Diagnostics.EpisodeQueryDurationMs += OverviewDiagnostics.Elapsed(episodeStarted);
            }
            if (budget is not null && items.Count > InterestOverviewService.EpisodeLimit) throw new OverviewLimitException();
            budget?.Consume(items.Count);
            // Active playback still covers available future episodes; only completion/progress
            // classification is restricted to aired episodes in the activity overview.
            var ids = items.Where(i => !inspectCoverage || (!i.IsVirtualItem && i is Episode { IsMissingEpisode: false }))
                .Select(i => i.Id).ToHashSet();
            var coverageComplete = true;
            if (inspectCoverage)
            {
                // A future virtual episode is not a gap. An aired/undated missing row is.
                coverageComplete = items.All(i => i.IsUnaired ||
                    (!i.IsVirtualItem && i is Episode { IsMissingEpisode: false } && i.PremiereDate.HasValue));
                if (!coverageComplete) budget!.IncompleteCoverage = true;
                items = items.Where(i => (budget?.TargetedSeries == true || !i.IsUnaired) && !i.IsVirtualItem && i is Episode { IsMissingEpisode: false }).ToArray();
            }
            // Only the overview populates prepared reads. Targeted checks keep
            // their original native read sequence and authorization checks.
            var playbackStarted = Stopwatch.GetTimestamp();
            var (states, resumes) = budget?.VerificationReads is { } preparedPlayback
                ? preparedPlayback.Read(items, user.Id, budget)
                : (data.GetUserDataBatch(items, user), data.GetResumeUserDataBatch(items, user));
            if (budget is not null && budget.VerificationReads is null)
            {
                budget.Diagnostics.NativePlaybackBatches += 2;
                budget.Diagnostics.PlaybackBatchCount += 2;
                budget.Diagnostics.PlaybackBatchDurationMs += OverviewDiagnostics.Elapsed(playbackStarted);
            }
            var classificationStarted = Stopwatch.GetTimestamp();
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
            var protectionInProgress = item is Series && effective.Any(s => s.Played || s.PlaybackPositionTicks > 0) && effective.Any(s => !s.Played);
            if (budget?.TargetedSeries == true)
                effective = effective.Where((_, index) => !items[index].IsUnaired).ToArray();
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
                    CaughtUp = continuingActivity && coverageComplete && effective.Length > 0 && effective.All(s => s.Played),
                    CoverageComplete = coverageComplete && effective.Length > 0,
                    Started = effective.Any(s => s.Played || s.PlaybackPositionTicks > 0),
                    ProtectionInProgress = protectionInProgress
                };
            }
            if (playing.Any(s => s.Users.Contains(user.Id) &&
                (ids.Contains(s.ItemId) || library.GetItemById<BaseItem>(s.ItemId, user) is Video
                    { PrimaryVersionId: { } primaryId } && ids.Contains(primaryId))))
                reasons.Add("CurrentlyPlaying");
            if (budget?.TargetedSeries == true) budget.TargetedReasons[user.Id] = reasons.ToArray();
            if (reasons.Count > 0) result.Add(new(user.Id, user.Username, reasons.ToArray()));
            if (budget is not null) budget.Diagnostics.ClassificationDurationMs += OverviewDiagnostics.Elapsed(classificationStarted);
        }
        return new(item.Id, result.Count > 0, result.Any(u => u.UserId != requester), result.ToArray());
    }
}

public sealed record SeriesViewer(Guid UserId, string DisplayName, string[] Reasons, int AvailableEpisodes,
    int WatchedEpisodes, DateTime? LastPlayedDate, bool CoverageComplete)
{
    [System.Text.Json.Serialization.JsonIgnore]
    public bool ProtectionInProgress { get; init; }
    public bool Watchlisted => Reasons.Contains("Watchlisted");
    public bool CurrentlyPlaying => Reasons.Contains("CurrentlyPlaying");
}
public sealed record SeriesActivity(Guid ItemId, string Name, string SeriesStatus, bool IsComplete,
    bool LimitReached, SeriesViewer[] Users, string Notice);
