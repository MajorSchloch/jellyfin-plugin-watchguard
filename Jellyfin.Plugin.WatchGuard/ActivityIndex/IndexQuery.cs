using System.Security.Cryptography;
using Jellyfin.Data;
using Jellyfin.Data.Enums;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Database.Implementations.Enums;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Session;

namespace Jellyfin.Plugin.WatchGuard.ActivityIndex;

public sealed record IndexPage(OverviewItem[] Items, bool IsComplete, bool LimitReached, string Notice,
    OverviewCoverage Coverage, IndexStatus Freshness, string? Continuation)
{
    public IndexReadDiagnostics? ReadDiagnostics { get; init; }
}
public sealed record IndexReadDiagnostics(double DurationMs, int EpisodeVisibilityQueries, int EpisodeRows);

internal sealed class IndexVisibilityLimitException : Exception;

public sealed class IndexQuery(IndexWorker worker, ILibraryManager library, IUserManager users, ISessionManager sessions, TimeProvider? clock = null)
{
    private readonly TimeProvider time = clock ?? TimeProvider.System;
    private sealed record PageSnapshot(Guid Caller, Guid? Owner, int Days, bool Older, Guid[] Items, DateTimeOffset Expires, int Offset);
    private readonly object gate = new();
    private readonly Dictionary<string, PageSnapshot> snapshots = new(StringComparer.Ordinal);

    public IndexStatus Status(User caller, Guid? owner)
    {
        if (!caller.HasPermission(PermissionKind.IsAdministrator) && owner != caller.Id) throw new UnauthorizedAccessException();
        var state = worker.Status();
        var snapshot = worker.Snapshot();
        var rows = snapshot.Rows.Where(r => !owner.HasValue || r.Key.UserId == owner).ToArray();
        var verified = rows.Where(r => snapshot.Valid.Contains(r.Key)).ToArray();
        return state with { Stored = rows.Length, Validated = verified.Length,
            Pending = caller.HasPermission(PermissionKind.IsAdministrator) ? state.Pending : rows.Length - verified.Length,
            LastUpdate = verified.Select(r => (DateTimeOffset?)r.CheckedAt).DefaultIfEmpty().Max(),
            DiscoveryPages = caller.HasPermission(PermissionKind.IsAdministrator) ? state.DiscoveryPages : 0,
            EpisodeQueries = caller.HasPermission(PermissionKind.IsAdministrator) ? state.EpisodeQueries : 0,
            EpisodeRows = caller.HasPermission(PermissionKind.IsAdministrator) ? state.EpisodeRows : 0,
            PlaybackBatches = caller.HasPermission(PermissionKind.IsAdministrator) ? state.PlaybackBatches : 0,
            TitlesVerified = caller.HasPermission(PermissionKind.IsAdministrator) ? state.TitlesVerified : 0,
            StaleResultsDiscarded = caller.HasPermission(PermissionKind.IsAdministrator) ? state.StaleResultsDiscarded : 0,
            VerificationMs = caller.HasPermission(PermissionKind.IsAdministrator) ? state.VerificationMs : 0,
            RetainedSerializedBytes = caller.HasPermission(PermissionKind.IsAdministrator) ? state.RetainedSerializedBytes : 0 };
    }

    public static bool InRange(OverviewUser activity, int days, bool older, DateTimeOffset now) =>
        (activity.LastPlayedDate is { } date && date.ToUniversalTime() <= now.UtcDateTime && date.ToUniversalTime() >= now.AddDays(-days).UtcDateTime) ||
        (older && activity.Reasons.Any(r => r is "InProgress" or "CaughtUp"));

    public IndexPage Read(User caller, Guid? owner, int days, bool older, string? continuation, CancellationToken cancellation)
    {
        var started = System.Diagnostics.Stopwatch.GetTimestamp();
        if (days is not (7 or 30 or 90)) throw new ArgumentException("Activity range must be 7, 30 or 90 days.");
        if (!caller.HasPermission(PermissionKind.IsAdministrator) && owner != caller.Id) throw new UnauthorizedAccessException();
        var now = time.GetUtcNow();
        var snapshot = worker.Snapshot();
        var candidates = snapshot.Rows.Where(r => !owner.HasValue || r.Key.UserId == owner).ToArray();
        var accounts = new Dictionary<Guid, User?> { [caller.Id] = caller };
        User? Account(Guid id)
        {
            if (!accounts.TryGetValue(id, out var value)) accounts[id] = value = users.GetUserById(id);
            return value;
        }
        var live = Live(caller, owner, cancellation, Account, out var sessionLimited);
        PageSnapshot page;
        lock (gate)
        {
            foreach (var id in snapshots.Where(p => p.Value.Expires <= now).Select(p => p.Key).ToArray()) snapshots.Remove(id);
            if (continuation is not null)
            {
                if (!snapshots.TryGetValue(continuation, out page!) || page.Caller != caller.Id || page.Owner != owner || page.Days != days || page.Older != older)
                    throw new ArgumentException("Continuation expired or does not match this view; reload the index.");
            }
            else
            {
                var eligible = candidates.Where(r => r.Failure == null && r.Activity.Reasons.Length > 0 && InRange(r.Activity, days, older, now)).ToArray();
                var playing = live.Keys.Select(k => k.ItemId).ToHashSet();
                var current = eligible.Where(r => r.Activity.Reasons.Any(reason => reason is "InProgress" or "CaughtUp")).Select(r => r.Key.ItemId).ToHashSet();
                // Preserve active-interest discovery priority before freezing the
                // snapshot. Completed history cannot bury live/unfinished titles
                // behind arbitrary ID pages; Web sorting remains local to loaded cards.
                page = new(caller.Id, owner, days, older,
                    eligible.Select(r => r.Key.ItemId).Concat(playing).Distinct()
                        .OrderBy(id => playing.Contains(id) ? 0 : current.Contains(id) ? 1 : 2).ThenBy(id => id).ToArray(), now.AddMinutes(2), 0);
            }
        }
        var result = new List<OverviewItem>();
        var causes = new HashSet<string>(worker.Status().Causes);
        if (sessionLimited) causes.Add("LiveSessionLimit");
        var requesterEpisodes = new Dictionary<Guid, HashSet<Guid>>();
        var visibilityRows = 0;
        var visibilityQueries = 0;
        var ownerEpisodes = new Dictionary<IndexKey, HashSet<Guid>>();
        var policies = new Dictionary<Guid, string>();
        var consumedTitles = 0;
        foreach (var id in page.Items.Skip(page.Offset).Take(25))
        {
            if (visibilityRows > 20000 - (InterestOverviewService.EpisodeLimit + 1)) { causes.Add("VisibilityBudget"); break; }
            consumedTitles++;
            cancellation.ThrowIfCancellationRequested();
            var item = library.GetItemById<BaseItem>(id, caller);
            if (!InterestService.Supported(item)) continue;
            var people = new Dictionary<Guid, OverviewUser>();
            foreach (var row in candidates.Where(r => r.Key.ItemId == id))
            {
                cancellation.ThrowIfCancellationRequested();
                var account = Account(row.Key.UserId);
                if (account is null || account.HasPermission(PermissionKind.IsDisabled)) continue;
                if (!worker.StillValid(row, snapshot.Generation)) { causes.Add("PendingVerification"); continue; }
                if (row.Failure != null) { causes.Add(row.Failure); continue; }
                if (!policies.TryGetValue(account.Id, out var policy)) policies[account.Id] = policy = IndexAuthorization.Fingerprint(users, account);
                if (!string.Equals(row.AuthorizationFingerprint, policy, StringComparison.Ordinal))
                { worker.Invalidate(row.Key); causes.Add("PolicyChanged"); continue; }
                if (!InterestService.Supported(library.GetItemById<BaseItem>(id, account))) { worker.Invalidate(row.Key); causes.Add("VisibilityChanged"); continue; }
                try
                {
                if (item is Series)
                {
                    HashSet<Guid> Visible(User user)
                    {
                        if (visibilityRows > 20000 - (InterestOverviewService.EpisodeLimit + 1)) throw new IndexVisibilityLimitException();
                        visibilityQueries++;
                        var ids = library.GetItemIds(new InternalItemsQuery(user)
                    {
                        Recursive = true, AncestorIds = [id], IncludeItemTypes = [BaseItemKind.Episode],
                        IsVirtualItem = row.Continuing ? null : false, IsMissing = row.Continuing ? null : false,
                        Limit = InterestOverviewService.EpisodeLimit + 1
                    }).ToHashSet();
                        visibilityRows += ids.Count; return ids;
                    }
                    if (!ownerEpisodes.TryGetValue(row.Key, out var authorized)) ownerEpisodes[row.Key] = authorized = Visible(account);
                    if (!authorized.SetEquals(row.Episodes)) { worker.Invalidate(row.Key); causes.Add("VisibilityChanged"); continue; }
                    if (!requesterEpisodes.TryGetValue(id, out var visible)) requesterEpisodes[id] = visible = caller.Id == account.Id ? authorized : Visible(caller);
                    if (!authorized.IsSubsetOf(visible)) { causes.Add("RequesterEpisodeVisibility"); continue; }
                }
                } catch (IndexVisibilityLimitException) { causes.Add("VisibilityBudget"); continue; }
                if (!worker.StillValid(row, snapshot.Generation)) { causes.Add("PendingVerification"); continue; }
                if (!row.MetadataComplete) causes.Add("EpisodeMetadataIncomplete");
                if (row.Activity.Reasons.Length > 0 && InRange(row.Activity, days, older, now)) people[account.Id] = row.Activity with { DisplayName = account.Username };
            }
            foreach (var (key, value) in live.Where(p => p.Key.ItemId == id))
                people[key.UserId] = people.TryGetValue(key.UserId, out var existing) ? existing with { Reasons = [.. existing.Reasons, "CurrentlyPlaying"] } : value;
            if (people.Count > 0) result.Add(new(id, item!.Name, people.Values.ToArray()));
        }
        string? next = null;
        if (page.Offset + consumedTitles < page.Items.Length)
        {
            lock (gate)
            {
                if (snapshots.Count >= 128 || snapshots.Values.Count(p => p.Caller == caller.Id) >= 8) causes.Add("PaginationCapacity");
                else
                {
                    next = Convert.ToHexString(RandomNumberGenerator.GetBytes(24));
                    snapshots.Add(next, page with { Offset = page.Offset + consumedTitles });
                }
                if (continuation is not null) snapshots.Remove(continuation);
            }
        }
        if (continuation is not null) { lock (gate) snapshots.Remove(continuation); }
        var state = worker.Status();
        var scoped = candidates.Where(r => snapshot.Valid.Contains(r.Key)).ToArray();
        if (!state.DiscoveryFinished) causes.Add("PopulationInProgress");
        if (scoped.Length < candidates.Length) causes.Add("PendingVerification");
        var warnings = causes.Order().Select(c => c switch
        {
            "EpisodeMetadataIncomplete" => "Some episode or air-date metadata is incomplete; Caught Up is not inferred for those titles.",
            "PopulationInProgress" => "Background discovery is still advancing; additional titles may appear.",
            "PendingVerification" => "Changed or restored activity is waiting for verification and is temporarily omitted.",
            _ => "Activity coverage is incomplete: " + c + "."
        }).ToArray();
        var freshness = state with { Stored = candidates.Length, Validated = scoped.Length,
            Pending = caller.HasPermission(PermissionKind.IsAdministrator) ? state.Pending : Math.Max(0, candidates.Length - scoped.Length),
            DiscoveryPages = caller.HasPermission(PermissionKind.IsAdministrator) ? state.DiscoveryPages : 0,
            LastUpdate = scoped.Select(r => (DateTimeOffset?)r.CheckedAt).DefaultIfEmpty().Max(), Causes = causes.Order().ToArray(),
            EpisodeQueries = caller.HasPermission(PermissionKind.IsAdministrator) ? state.EpisodeQueries : 0,
            EpisodeRows = caller.HasPermission(PermissionKind.IsAdministrator) ? state.EpisodeRows : 0,
            PlaybackBatches = caller.HasPermission(PermissionKind.IsAdministrator) ? state.PlaybackBatches : 0,
            TitlesVerified = caller.HasPermission(PermissionKind.IsAdministrator) ? state.TitlesVerified : 0,
            StaleResultsDiscarded = caller.HasPermission(PermissionKind.IsAdministrator) ? state.StaleResultsDiscarded : 0,
            VerificationMs = caller.HasPermission(PermissionKind.IsAdministrator) ? state.VerificationMs : 0,
            RetainedSerializedBytes = caller.HasPermission(PermissionKind.IsAdministrator) ? state.RetainedSerializedBytes : 0 };
        return new(result.ToArray(), false, causes.Any(c => c.EndsWith("Limit", StringComparison.Ordinal) || c.EndsWith("Failure", StringComparison.Ordinal) || c.EndsWith("Budget", StringComparison.Ordinal) || c.EndsWith("Capacity", StringComparison.Ordinal)),
            $"Native activity in the last {days} days" + (older ? ", plus older current interest" : "") +
            ". Explicit watchlists and current sessions are independent. Background discovery is not an exhaustive library audit.",
            new(1, days, !state.DiscoveryFinished || causes.Overlaps(["DiscoveryWorkLimit", "UserLimit", "DeduplicationLimit", "QueueLimit", "StorageLimit", "WorkerFailure"]), causes.Contains("EpisodeMetadataIncomplete"), causes.Contains("EpisodeLimit") || causes.Contains("VisibilityBudget"), false, next != null, causes.Order().ToArray(), warnings), freshness, next) { ReadDiagnostics = new(System.Diagnostics.Stopwatch.GetElapsedTime(started).TotalMilliseconds, visibilityQueries, visibilityRows) };
    }

    private Dictionary<IndexKey, OverviewUser> Live(User caller, Guid? owner, CancellationToken cancellation, Func<Guid, User?> account, out bool limited)
    {
        var result = new Dictionary<IndexKey, OverviewUser>();
        var liveOwners = new HashSet<Guid>();
        var playing = sessions.Sessions.Where(s => s.IsActive && s.NowPlayingItem != null).Take(101).ToArray();
        limited = playing.Length > 100;
        foreach (var session in playing.Take(100))
        {
            var identities = new[] { session.UserId }.Concat(session.AdditionalUsers.Select(u => u.UserId)).Distinct().Take(51).ToArray();
            if (identities.Length > 50) limited = true;
            foreach (var id in identities.Take(50))
            {
                cancellation.ThrowIfCancellationRequested();
                if (owner.HasValue && id != owner) continue;
                if (!liveOwners.Contains(id) && liveOwners.Count == 50) { limited = true; continue; }
                liveOwners.Add(id);
                var user = account(id);
                if (user is null || user.HasPermission(PermissionKind.IsDisabled)) continue;
                var media = library.GetItemById<BaseItem>(session.NowPlayingItem!.Id, user);
                if (media is null || library.GetItemById<BaseItem>(media.Id, caller) is null) continue;
                var primary = IndexTargets.Primary(library, user, media);
                if (primary is null || (primary.Id != media.Id && library.GetItemById<BaseItem>(primary.Id, caller) is null)) continue;
                var title = primary is Episode episode ? library.GetItemById<BaseItem>(episode.SeriesId, user) : primary;
                if (!InterestService.Supported(title) || !InterestService.Supported(library.GetItemById<BaseItem>(title!.Id, caller))) continue;
                result[new(user.Id, title.Id)] = new(user.Id, user.Username, ["CurrentlyPlaying"], null);
            }
        }
        return result;
    }
}
