using System.Diagnostics;
using Jellyfin.Data;
using Jellyfin.Data.Enums;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Database.Implementations.Enums;
using MediaBrowser.Controller.Dto;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;
using MediaBrowser.Model.Entities;
using MediaBrowser.Model.Querying;

namespace Jellyfin.Plugin.WatchGuard;

// One request-local candidate window. No DI registration and no protection consumer.
// Preparation follows the same title/account work ledger as classification; it does
// not spend the ledger twice or prefetch past its first exhausted title/account.
internal sealed class OverviewVerificationReads
{
    internal const int PlaybackBatchSize = 1000;
    private sealed record Prepared(BaseItem? Visible, IReadOnlyList<BaseItem> Episodes, bool Oversized = false);
    private readonly Dictionary<(Guid User, Guid Title), Prepared> prepared = new();
    private readonly Dictionary<Guid, Dictionary<Guid, UserItemData>> states = new();
    private readonly Dictionary<Guid, Dictionary<Guid, VersionResumeData>> resumes = new();
    private readonly Dictionary<Guid, User?> accounts = new();

    public OverviewVerificationReads(BaseItem[] candidates, ILibraryManager library, IUserManager users,
        IUserDataManager data, OverviewBudget budget)
    {
        var remaining = budget.Remaining;
        var playback = new Dictionary<Guid, (User User, Dictionary<Guid, BaseItem> Items)>();
        var exhausted = false;
        foreach (var title in candidates)
        {
            // Metadata only; never reuse another account's authorized episode set.
            var metadata = new Dictionary<Guid, BaseItem>();
            foreach (var account in budget.Accounts)
            {
                budget.Cancellation.ThrowIfCancellationRequested();
                if (--remaining < 0) { exhausted = true; break; }
                var started = Stopwatch.GetTimestamp();
                if (!accounts.TryGetValue(account.Id, out var user))
                {
                    accounts.Add(account.Id, user = users.GetUserById(account.Id));
                    budget.Diagnostics.AccountCacheMisses++;
                }
                else budget.Diagnostics.AccountCacheHits++;
                if (user is null || user.HasPermission(PermissionKind.IsDisabled)) continue;
                var visible = library.GetItemById<BaseItem>(title.Id, user);
                budget.Diagnostics.VisibilityDurationMs += OverviewDiagnostics.Elapsed(started);
                budget.Diagnostics.PreparedVisibilityMisses++;
                if (!InterestService.Supported(visible))
                {
                    prepared.Add((user.Id, title.Id), new(visible, []));
                    continue;
                }
                var inspectCoverage = visible is Series { Status: SeriesStatus.Continuing };
                IReadOnlyList<BaseItem> rows = [visible!];
                if (title is Series)
                {
                    started = Stopwatch.GetTimestamp();
                    InternalItemsQuery Query() => new(user)
                    {
                        AncestorIds = [title.Id], Recursive = true, IncludeItemTypes = [BaseItemKind.Episode],
                        IsVirtualItem = inspectCoverage ? null : false, IsMissing = inspectCoverage ? null : false,
                        Limit = InterestOverviewService.EpisodeLimit + 1,
                        DtoOptions = new DtoOptions(false) { Fields = [ItemFields.ProviderIds], EnableImages = false, EnableUserData = false }
                    };
                    IReadOnlyList<Guid>? authorized = null;
                    if (metadata.Count > 0)
                    {
                        // Same native query translation/grouping/permissions as GetItemList,
                        // projected to IDs. A cache hit is not an authorization decision.
                        authorized = library.GetItemIds(Query());
                        budget.Diagnostics.EpisodeIdQueryCount++;
                        budget.Diagnostics.EpisodeQueryCount++;
                        budget.Cancellation.ThrowIfCancellationRequested();
                        if (authorized.Count > InterestOverviewService.EpisodeLimit)
                        {
                            budget.Diagnostics.EpisodeRowsProcessed += authorized.Count;
                            budget.Diagnostics.EpisodeQueryDurationMs += OverviewDiagnostics.Elapsed(started);
                            prepared.Add((user.Id, title.Id), new(visible, [], true));
                            break;
                        }
                    }
                    if (authorized is not null && authorized.All(metadata.ContainsKey))
                    {
                        rows = authorized.Select(id => metadata[id]).ToArray();
                        budget.Diagnostics.EpisodeMetadataReusedRows += rows.Count;
                    }
                    else
                    {
                        // First account or a different visible set. Keep native hydration,
                        // including linked versions/provider IDs, and never save these objects.
                        budget.Cancellation.ThrowIfCancellationRequested();
                        rows = library.GetItemList(Query());
                        budget.Diagnostics.EpisodeHydrationQueryCount++;
                        budget.Diagnostics.EpisodeQueryCount++;
                        budget.Diagnostics.EpisodeHydratedRows += rows.Count;
                        if (authorized is not null && !authorized.ToHashSet().SetEquals(rows.Select(r => r.Id)))
                            throw new InvalidDataException("Native episode visibility changed during verification.");
                        if (rows.Count <= InterestOverviewService.EpisodeLimit)
                            foreach (var row in rows) metadata.TryAdd(row.Id, row);
                    }
                    budget.Diagnostics.EpisodeQueryDurationMs += OverviewDiagnostics.Elapsed(started);
                    budget.Diagnostics.EpisodeRowsProcessed += rows.Count;
                }
                var oversized = rows.Count > InterestOverviewService.EpisodeLimit;
                prepared.Add((user.Id, title.Id), new(visible, oversized ? [] : rows, oversized));
                // Same stop/skip points as GetCore. Probe rows are never playback candidates.
                if (oversized) break;
                remaining -= rows.Count;
                if (remaining < 0) { exhausted = true; break; }
                if (!playback.TryGetValue(user.Id, out var owner))
                    playback.Add(user.Id, owner = (user, new()));
                foreach (var row in rows.Where(i => !inspectCoverage ||
                    ((budget.IncludeEpisodeProgress || !i.IsUnaired) && !i.IsVirtualItem && i is Episode { IsMissingEpisode: false })))
                    owner.Items.TryAdd(row.Id, row);
            }
            if (exhausted) break;
        }
        foreach (var (id, owner) in playback)
        {
            states.Add(id, new()); resumes.Add(id, new());
            foreach (var batch in owner.Items.Values.Chunk(PlaybackBatchSize))
            {
                budget.Cancellation.ThrowIfCancellationRequested();
                var started = Stopwatch.GetTimestamp();
                var values = data.GetUserDataBatch(batch, owner.User);
                budget.Diagnostics.UserDataBatchDurationMs += OverviewDiagnostics.Elapsed(started);
                budget.Cancellation.ThrowIfCancellationRequested();
                var resumeStarted = Stopwatch.GetTimestamp();
                var versions = data.GetResumeUserDataBatch(batch, owner.User);
                budget.Diagnostics.ResumeBatchDurationMs += OverviewDiagnostics.Elapsed(resumeStarted);
                budget.Diagnostics.PlaybackBatchDurationMs += OverviewDiagnostics.Elapsed(started);
                budget.Diagnostics.NativePlaybackBatches += 2;
                budget.Diagnostics.PlaybackBatchCount += 2;
                budget.Diagnostics.PlaybackCacheMisses++;
                foreach (var item in batch)
                {
                    if (!values.TryGetValue(item.Id, out var state)) throw new InvalidDataException("Native playback lookup was incomplete.");
                    states[id].Add(item.Id, state);
                    if (versions.TryGetValue(item.Id, out var version)) resumes[id].Add(item.Id, version);
                }
            }
        }
    }

    public BaseItem? Visible(Guid title, Guid user, OverviewBudget budget)
    {
        budget.Diagnostics.PreparedVisibilityHits++;
        return prepared.TryGetValue((user, title), out var entry) ? entry.Visible
            : throw new InvalidDataException("Overview visibility changed during verification.");
    }

    public User? Account(Guid id, OverviewBudget budget)
    {
        budget.Diagnostics.AccountCacheHits++;
        return accounts.GetValueOrDefault(id);
    }

    public IReadOnlyList<BaseItem> Episodes(Guid title, Guid user)
    {
        var entry = prepared[(user, title)];
        if (entry.Oversized) throw new OverviewLimitException();
        return entry.Episodes;
    }

    public (Dictionary<Guid, UserItemData>, IReadOnlyDictionary<Guid, VersionResumeData>) Read(
        IReadOnlyList<BaseItem> items, Guid user, OverviewBudget budget)
    {
        budget.Cancellation.ThrowIfCancellationRequested();
        budget.Diagnostics.PlaybackCacheHits++;
        var result = new Dictionary<Guid, UserItemData>();
        var versions = new Dictionary<Guid, VersionResumeData>();
        foreach (var item in items)
        {
            if (!states.TryGetValue(user, out var values) || !values.TryGetValue(item.Id, out var state))
                throw new InvalidDataException("Native playback lookup was incomplete.");
            result.Add(item.Id, state);
            if (resumes[user].TryGetValue(item.Id, out var version)) versions.Add(item.Id, version);
        }
        return (result, versions); // Per-title projection is essential for LastPlayedDate.
    }
}
