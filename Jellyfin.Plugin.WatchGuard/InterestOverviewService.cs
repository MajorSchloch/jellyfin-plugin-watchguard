using System.Diagnostics;
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

public sealed record OverviewUser(Guid UserId, string DisplayName, string[] Reasons, DateTime? LastPlayedDate, int? AvailableEpisodes = null, int? WatchedEpisodes = null)
{
    [System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)]
    public DateTimeOffset? AddedAtUtc { get; init; }
    [System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)]
    public EpisodeProgress? EpisodeProgress { get; init; }
}
public sealed record OverviewItem(Guid ItemId, string Name, OverviewUser[] Users);
public sealed record InterestOverview(OverviewItem[] Items, bool IsComplete, bool LimitReached, string Notice)
{
    public OverviewCoverage? Coverage { get; init; }
    public OverviewDiagnostics? Diagnostics { get; init; }
}
public sealed record OverviewCoverage(int Version, int? ActivityWindowDays, bool DiscoveryLimited,
    bool EpisodeMetadataIncomplete, bool VerificationLimited, bool ResultLimitReached,
    bool AdditionalPagesAvailable, string[] Causes, string[] Warnings);
public sealed class OverviewDiagnostics
{
    public int CandidatesDiscovered { get; set; }
    public int UniqueCandidates { get; set; }
    public int CandidatesVerified { get; set; }
    public int UsersEvaluated { get; set; }
    public int EpisodeRowsProcessed { get; set; }
    public int NativePlaybackBatches { get; set; }
    public int NativeDiscoveryQueries { get; set; }
    public double QueryDurationMs { get; set; }
    public double DiscoveryDurationMs { get; set; }
    public double EpisodeQueryDurationMs { get; set; }
    public double VisibilityDurationMs { get; set; }
    public double PlaybackBatchDurationMs { get; set; }
    public double UserDataBatchDurationMs { get; set; }
    public double ResumeBatchDurationMs { get; set; }
    public double ClassificationDurationMs { get; set; }
    public double TotalVerificationDurationMs { get; set; }
    public int EpisodeQueryCount { get; set; }
    public int EpisodeIdQueryCount { get; set; }
    public int EpisodeHydrationQueryCount { get; set; }
    public int EpisodeHydratedRows { get; set; }
    public int EpisodeMetadataReusedRows { get; set; }
    public int PlaybackBatchCount { get; set; }
    public int PlaybackCacheHits { get; set; }
    public int PlaybackCacheMisses { get; set; }
    public int PreparedVisibilityHits { get; set; }
    public int PreparedVisibilityMisses { get; set; }
    public int AccountCacheHits { get; set; }
    public int AccountCacheMisses { get; set; }

    internal static double Elapsed(long started) => Stopwatch.GetElapsedTime(started).TotalMilliseconds;
}

internal sealed record OverviewPlayback(string DisplayName, DateTime? LastPlayedDate, bool Completed, int? AvailableEpisodes, int? WatchedEpisodes)
{
    public EpisodeProgress? EpisodeProgress { get; init; }
    public bool CaughtUp { get; init; }
    public bool CoverageComplete { get; init; }
    public bool Started { get; init; }
    public bool ProtectionInProgress { get; init; }
}

// Request-local native read budget; a targeted protection request rejects incomplete results.
internal sealed class OverviewBudget(WatchlistEntry[] entries, User[] accounts)
{
    public User[] Accounts { get; } = accounts;
    public OverviewVerificationReads? VerificationReads { get; set; }
    public OverviewDiagnostics Diagnostics { get; } = new();
    public CancellationToken Cancellation { get; init; }
    public IEnumerable<SessionInfo>? SessionSnapshot { get; init; }
    public bool IncludeActivity { get; init; }
    public bool TargetedSeries { get; init; }
    public bool IncludeEpisodeProgress { get; init; }
    public Dictionary<Guid, string[]> TargetedReasons { get; } = new();
    public bool IncompleteCoverage { get; set; }
    public HashSet<WatchlistEntry> Entries { get; } = entries.ToHashSet();
    public Dictionary<Guid, DateTime?> PlaybackDates { get; } = new();
    public Dictionary<Guid, OverviewPlayback> Playback { get; } = new();
    public int Remaining { get; private set; } = 20000;
    public void Consume(int count)
    {
        Cancellation.ThrowIfCancellationRequested();
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

    public InterestOverview GetActivity(User caller, bool ownOnly = false, int days = 30, int limit = CandidateLimit, Guid? scopeUserId = null, CancellationToken cancellation = default) =>
        Get(caller, ownOnly, automaticOnly: true, activityDays: Math.Clamp(days, 1, 90), candidateLimit: Math.Clamp(limit, 1, CandidateLimit), scopeUserId: scopeUserId, cancellation: cancellation);

    public InterestOverview Get(User caller, bool ownOnly = false, bool automaticOnly = false, int? activityDays = null, int candidateLimit = CandidateLimit, Guid? scopeUserId = null, CancellationToken cancellation = default)
    {
        var timer = Stopwatch.StartNew();
        cancellation.ThrowIfCancellationRequested();
        var now = DateTime.UtcNow;
        var cutoff = now.AddDays(-(activityDays ?? 30));
        var enabled = (scopeUserId.HasValue ? new[] { users.GetUserById(scopeUserId.Value) }.OfType<User>() : ownOnly ? new[] { caller } : users.GetUsers()).Select(u => users.GetUserById(u.Id))
            .Where(u => u is not null && !u.HasPermission(PermissionKind.IsDisabled)).Cast<User>().Take(UserLimit + 1).ToArray();
        if (enabled.Length > UserLimit) throw new InvalidOperationException("Overview user budget exceeded.");
        WatchlistEntry[] entries;
        using (OverviewTiming.Begin("StoreRead", logger)) entries = automaticOnly ? [] : store.Read().Where(e => !ownOnly || e.UserId == caller.Id).ToArray();
        var budget = new OverviewBudget(entries, enabled) { IncludeActivity = activityDays.HasValue, IncludeEpisodeProgress = activityDays.HasValue, Cancellation = cancellation,
            SessionSnapshot = sessions.Sessions.Where(s => s.IsActive && s.NowPlayingItem is not null).Take(DiscoveryLimit + 1).ToArray() };
        var diagnostics = budget.Diagnostics;
        var causes = new HashSet<string>(StringComparer.Ordinal);
        var discoveryLimited = false;
        var verificationLimited = false;
        var resultLimited = false;
        var candidates = new Dictionary<Guid, BaseItem>();
        // Bounded by native discovery rows and the existing account/work allowance,
        // rather than spending the result allowance on uninteresting candidates.
        var candidateWorkLimit = 20000 / Math.Max(1, enabled.Length);
        var resolved = new HashSet<(Guid User, Guid Item)>();
        var parents = new Dictionary<(Guid User, Guid Item), BaseItem?>();
        var limited = false;
        void Add(Guid id, User owner)
        {
            cancellation.ThrowIfCancellationRequested();
            diagnostics.CandidatesDiscovered = Math.Min(20000, diagnostics.CandidatesDiscovered + 1);
            if (resolved.Count >= 20000) { limited = discoveryLimited = true; causes.Add("ResolutionWorkLimit"); return; }
            if (!resolved.Add((owner.Id, id))) return;
            var item = library.GetItemById<BaseItem>(id, owner);
            if (item is Video { PrimaryVersionId: { } primary } && primary != Guid.Empty)
                item = library.GetItemById<BaseItem>(primary, owner);
            if (item is Episode episode)
            {
                var parentKey = (owner.Id, episode.SeriesId);
                if (!parents.TryGetValue(parentKey, out item))
                    parents[parentKey] = item = library.GetItemById<BaseItem>(episode.SeriesId, owner);
            }
            if (!InterestService.Supported(item)) return;
            if (candidates.ContainsKey(item!.Id)) return;
            var visible = library.GetItemById<BaseItem>(item!.Id, caller);
            if (!InterestService.Supported(visible)) return;
            if (candidates.Count == candidateWorkLimit) { limited = discoveryLimited = true; causes.Add("CandidateWorkLimit"); return; }
            candidates.Add(item.Id, visible!);
        }
        // Active playback gets first priority; additional session users are verified natively too.
        if (budget.SessionSnapshot.Count() > DiscoveryLimit) { limited = discoveryLimited = true; causes.Add("SessionDiscoveryLimit"); }
        foreach (var session in budget.SessionSnapshot.Take(DiscoveryLimit))
            foreach (var owner in enabled.Where(u => u.Id == session.UserId || session.AdditionalUsers.Any(a => a.UserId == u.Id)))
                Add(session.NowPlayingItem!.Id, owner);
        foreach (var resumable in new[] { true, false })
        {
            var rounds = new List<BaseItem[]>();
            foreach (var user in enabled)
            {
                using var discoveryTiming = OverviewTiming.Begin(resumable ? "ResumeDiscovery" : "PlayedDiscovery", logger);
                cancellation.ThrowIfCancellationRequested();
                diagnostics.NativeDiscoveryQueries++;
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
                if (found.Count > DiscoveryLimit) { limited = discoveryLimited = true; causes.Add(resumable ? "ResumeDiscoveryLimit" : "RawEpisodeDiscoveryLimit"); }
                rounds.Add(found.Take(DiscoveryLimit).ToArray());
            }
            for (var row = 0; row < rounds.Select(r => r.Length).DefaultIfEmpty(0).Max(); row++)
                for (var account = 0; account < enabled.Length; account++)
                    if (row < rounds[account].Length) Add(rounds[account][row].Id, enabled[account]);
        }
        if (activityDays.HasValue)
        {
            // Native SQL grouping spends the row allowance on series, not episodes.
            // Retain the raw pass above: missing/duplicate series keys can collapse groups.
            var rounds = new List<BaseItem[]>();
            foreach (var user in enabled)
            {
                cancellation.ThrowIfCancellationRequested();
                diagnostics.NativeDiscoveryQueries++;
                var found = library.GetItemList(new InternalItemsQuery(user)
                {
                    Recursive = true, IsVirtualItem = false, IsMissing = false,
                    IncludeItemTypes = [BaseItemKind.Episode], IsPlayed = true,
                    GroupBySeriesPresentationUniqueKey = true,
                    OrderBy = [(ItemSortBy.DatePlayed, SortOrder.Descending)],
                    Limit = DiscoveryLimit + 1, EnableTotalRecordCount = false
                });
                if (found.Count > DiscoveryLimit) { limited = discoveryLimited = true; causes.Add("SeriesDiscoveryLimit"); }
                rounds.Add(found.Take(DiscoveryLimit).ToArray());
            }
            for (var row = 0; row < rounds.Select(r => r.Length).DefaultIfEmpty(0).Max(); row++)
                for (var account = 0; account < enabled.Length; account++)
                    if (row < rounds[account].Length) Add(rounds[account][row].Id, enabled[account]);
        }
        // Keep resume/series candidates ahead of completed movies. No unbounded date/history scan.
        if (activityDays.HasValue)
        {
            var rounds = new List<BaseItem[]>();
            foreach (var user in enabled)
            {
                using var completedTiming = OverviewTiming.Begin("CompletedMovieDiscovery", logger);
                cancellation.ThrowIfCancellationRequested();
                diagnostics.NativeDiscoveryQueries++;
                var found = library.GetItemList(new InternalItemsQuery(user)
                {
                    Recursive = true, IsVirtualItem = false, IsMissing = false,
                    IncludeItemTypes = [BaseItemKind.Movie], IsPlayed = true,
                    OrderBy = [(ItemSortBy.DatePlayed, SortOrder.Descending)], Limit = candidateLimit + 1,
                    EnableTotalRecordCount = false
                });
                if (found.Count > candidateLimit) { limited = discoveryLimited = true; causes.Add("CompletedMovieDiscoveryLimit"); }
                rounds.Add(found.Take(candidateLimit).ToArray());
            }
            for (var row = 0; row < rounds.Select(r => r.Length).DefaultIfEmpty(0).Max(); row++)
                for (var account = 0; account < enabled.Length; account++)
                    if (row < rounds[account].Length) Add(rounds[account][row].Id, enabled[account]);
        }
        foreach (var entry in budget.Entries)
            if (enabled.FirstOrDefault(u => u.Id == entry.UserId) is { } owner) Add(entry.ItemId, owner);
        var result = new List<OverviewItem>();
        var attempted = 0;
        diagnostics.UniqueCandidates = candidates.Count;
        diagnostics.DiscoveryDurationMs = timer.Elapsed.TotalMilliseconds;
        var verificationStarted = Stopwatch.GetTimestamp();
        using var verificationTiming = OverviewTiming.Begin("Verification", logger);
        var orderedCandidates = candidates.Values.ToArray();
        for (var offset = 0; offset < orderedCandidates.Length;)
        {
            // Never prepare more titles than the remaining result slots. Earlier
            // chunks may contain uninteresting titles, so adapt the final window.
            var chunk = orderedCandidates.Skip(offset).Take(candidateLimit - result.Count).ToArray();
            offset += chunk.Length;
            if (activityDays.HasValue) interest.PrepareOverviewVerification(chunk, budget);
            foreach (var item in chunk)
            {
                cancellation.ThrowIfCancellationRequested();
                if (result.Count >= candidateLimit) { limited = resultLimited = true; causes.Add("ResultLimit"); break; }
                attempted++;
                try
                {
                    budget.PlaybackDates.Clear();
                    budget.Playback.Clear();
                    var status = interest.GetForOverview(item, caller.Id, budget);
                    diagnostics.CandidatesVerified++;
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
                            activityDays.HasValue ? playback?.AvailableEpisodes : null, activityDays.HasValue ? playback?.WatchedEpisodes : null) { EpisodeProgress = playback?.EpisodeProgress };
                    }).ToArray()));
                }
                catch (OverviewLimitException)
                {
                    limited = verificationLimited = true;
                    causes.Add(budget.Remaining < 0 ? "VerificationBudget" : "EpisodeLimit");
                    // An oversized series is omitted, not a reason to abandon unrelated titles.
                    // Exhausting the shared work budget still ends this bounded request.
                    if (budget.Remaining < 0) break;
                }
            }
            budget.VerificationReads = null;
            if (result.Count >= candidateLimit || budget.Remaining < 0) break;
        }
        if (result.Count >= candidateLimit && attempted < candidates.Count)
        { limited = resultLimited = true; causes.Add("ResultLimit"); }
        if (budget.IncompleteCoverage) causes.Add("EpisodeMetadataIncomplete");
        diagnostics.TotalVerificationDurationMs = OverviewDiagnostics.Elapsed(verificationStarted);
        diagnostics.QueryDurationMs = timer.Elapsed.TotalMilliseconds;
        if (Plugin.Instance?.Configuration.DiagnosticMode == true)
            logger?.LogInformation("WatchGuard overview: discovered {Discovered}, unique {Unique}, verified {Verified}, users {Users}, episode rows {Rows}, playback batches {Batches}, discovery queries {Queries}, duration {Duration:F3} ms, causes {Causes}",
                diagnostics.CandidatesDiscovered, diagnostics.UniqueCandidates, diagnostics.CandidatesVerified, diagnostics.UsersEvaluated,
                diagnostics.EpisodeRowsProcessed, diagnostics.NativePlaybackBatches, diagnostics.NativeDiscoveryQueries, diagnostics.QueryDurationMs, string.Join(",", causes.Order()));
        var warnings = new List<string>();
        if (budget.IncompleteCoverage) warnings.Add("Some continuing series lack episode or air-date coverage; Caught Up is not inferred for them.");
        if (discoveryLimited) warnings.Add("Candidate discovery was bounded; older titles or titles with incomplete series keys may be omitted.");
        if (verificationLimited) warnings.Add("A verification safety limit was reached; some titles could not be evaluated.");
        if (resultLimited) warnings.Add("The configured activity result limit was reached; some titles are omitted.");
        // Candidate discovery is deliberately bounded. Even below the caps it is not an exhaustive audit.
        return new(result.OrderBy(i => i.Name, StringComparer.OrdinalIgnoreCase).ThenBy(i => i.ItemId).ToArray(), false, limited,
            (activityDays.HasValue ? $"Recent viewing activity: completed titles with a native playback date in the last {activityDays} days, plus current viewing interest; not an exhaustive library audit." : automaticOnly ? "Recent viewing interest; not an exhaustive library audit." : "Recent viewing interest and explicit watchlists; not an exhaustive library audit.")
            + (warnings.Count > 0 ? " " + string.Join(" ", warnings) : string.Empty))
        {
            Coverage = new(1, activityDays, discoveryLimited, budget.IncompleteCoverage, verificationLimited, resultLimited, false, causes.Order().ToArray(), warnings.ToArray()),
            Diagnostics = diagnostics
        };
    }
}
