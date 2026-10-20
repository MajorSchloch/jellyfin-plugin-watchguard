using System.Diagnostics;
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

public sealed record BrowserOptions(Guid? Owner, int Days, bool Older, string Statuses, string Sort, string Search)
{
    public static BrowserOptions Create(Guid? owner, int days, bool older, string statuses, string sort, string search)
    {
        var allowed = new[] { "watchlisted", "watching", "playing", "watched" };
        var selected = statuses == "none" ? [] : statuses.Split(',', StringSplitOptions.RemoveEmptyEntries);
        if (days is not (7 or 30 or 90) || !new[] { "title", "recent", "added" }.Contains(sort) ||
            selected.Any(s => !allowed.Contains(s)) || search.Length > 120) throw new ArgumentException("Invalid query controls.");
        return new(owner, days, older, string.Join(',', allowed.Where(selected.Contains)), sort, search.Trim());
    }
    public bool Matches(OverviewUser person) => Statuses.Split(',').Any(s => s switch
    {
        "watchlisted" => person.Reasons.Contains("Watchlisted"),
        "watching" => person.Reasons.Any(r => r is "InProgress" or "CaughtUp"),
        "playing" => person.Reasons.Contains("CurrentlyPlaying"),
        "watched" => person.Reasons.Contains("Watched"),
        _ => false
    });
}

public sealed record BrowserPage(OverviewItem[] Items, bool Preparing, string? Continuation, bool LimitReached,
    string Notice, OverviewCoverage Coverage, BrowserFreshness Freshness, BrowserWork ReadDiagnostics)
{
    public bool IsComplete => false;
}
public sealed record BrowserFreshness(long Revision, bool PopulationPending);
public sealed record BrowserWork(double DurationMs, int CandidatesExamined, int EpisodeVisibilityQueries, int EpisodeRows);
public sealed class BrowserViewExpiredException : Exception;

// Separate from the v0.6 API so installed/older adapters retain their contract.
public sealed class BrowserQuery(IndexWorker worker, WatchlistStore memberships, ILibraryManager library,
    IUserManager users, ISessionManager sessions, TimeProvider? clock = null)
{
    private const int PairBudget = 500, EpisodeBudget = 20000, MaximumPairs = 10000;
    private readonly TimeProvider time = clock ?? TimeProvider.System;
    private readonly object gate = new();
    private sealed record Entry(IndexKey Key, string Name, OverviewUser Person, IndexRow? Activity);
    private sealed record View(Guid Caller, BrowserOptions Query, DateTimeOffset Expires, IndexKey[] Candidates,
        Entry[] Accepted, int ScanOffset, bool Prepared, OverviewItem[] Titles, int TitleOffset, int OwnerOffset,
        Dictionary<Guid, string> Policies, string[] Causes);
    private readonly Dictionary<string, View> views = new(StringComparer.Ordinal);

    public BrowserPage Read(User caller, BrowserOptions query, string? continuation, CancellationToken cancellation)
    {
        var started = Stopwatch.GetTimestamp();
        if (caller.HasPermission(PermissionKind.IsDisabled) || (!caller.HasPermission(PermissionKind.IsAdministrator) && query.Owner != caller.Id)) throw new UnauthorizedAccessException();
        var now = time.GetUtcNow();
        var indexed = worker.Snapshot();
        var rows = indexed.Rows.ToDictionary(r => r.Key);
        var dated = memberships.ReadDated().Where(e => query.Owner == null || e.UserId == query.Owner)
            .ToDictionary(e => new IndexKey(e.UserId, e.ItemId));
        var accounts = new Dictionary<Guid, User?>();
        User? Account(Guid id)
        {
            if (!accounts.TryGetValue(id, out var account)) accounts[id] = account = users.GetUserById(id);
            return account is null || account.HasPermission(PermissionKind.IsDisabled) ? null : account;
        }
        var causes = new HashSet<string>();
        var live = Live(caller, query.Owner, Account, cancellation, causes);
        View view;
        lock (gate)
        {
            foreach (var key in views.Where(v => v.Value.Expires <= now).Select(v => v.Key).ToArray()) views.Remove(key);
            if (continuation != null)
            {
                if (!views.TryGetValue(continuation, out view!) || view.Caller != caller.Id || view.Query != query) throw new BrowserViewExpiredException();
                views.Remove(continuation); // One request owns this position, including concurrent retries.
            }
            else
            {
                var keys = rows.Keys.Concat(dated.Keys).Concat(live.Keys)
                    .Where(k => query.Owner == null || k.UserId == query.Owner).Distinct().OrderBy(k => k.ItemId).ThenBy(k => k.UserId)
                    .Take(MaximumPairs + 1).ToArray();
                if (keys.Length > MaximumPairs) causes.Add("CandidateLimit");
                view = new(caller.Id, query, now.AddMinutes(5), keys.Take(MaximumPairs).ToArray(), [], 0, false, [], 0, 0, new(), []);
            }
        }
        causes.UnionWith(view.Causes);
        // Policy fingerprints only invalidate; native checks below still authorize every disclosed row.
        var policies = new Dictionary<Guid, string>();
        string Policy(User account)
        {
            if (!policies.TryGetValue(account.Id, out var value)) policies[account.Id] = value = IndexAuthorization.Fingerprint(users, account);
            return value;
        }
        foreach (var (id, policy) in view.Policies)
        {
            var account = Account(id);
            if (account == null || Policy(account) != policy) throw new BrowserViewExpiredException();
        }
        policies[caller.Id] = Policy(caller);
        var work = 0; var episodeRows = 0; var episodeQueries = 0; var authorizedWork = 0;
        var safeEpisodeKeys = new HashSet<(Guid, Guid, bool)>();
        var visibleEpisodes = new Dictionary<(Guid, Guid, bool), HashSet<Guid>>();
        var requesterItems = new Dictionary<Guid, BaseItem?>();
        BaseItem? Item(Guid id)
        {
            if (!requesterItems.TryGetValue(id, out var value)) requesterItems[id] = value = library.GetItemById<BaseItem>(id, caller);
            return value;
        }
        HashSet<Guid> Episodes(User account, Guid title, bool continuing)
        {
            var key = (account.Id, title, continuing);
            if (visibleEpisodes.TryGetValue(key, out var found)) return found;
            if (episodeRows > EpisodeBudget - (InterestOverviewService.EpisodeLimit + 1)) throw new IndexVisibilityLimitException();
            episodeQueries++;
            var ids = library.GetItemIds(new InternalItemsQuery(account) { Recursive = true, AncestorIds = [title],
                IncludeItemTypes = [BaseItemKind.Episode], IsVirtualItem = continuing ? null : false,
                IsMissing = continuing ? null : false, Limit = InterestOverviewService.EpisodeLimit + 1 }).ToHashSet();
            episodeRows += ids.Count; visibleEpisodes[key] = ids; return ids;
        }
        Entry? Resolve(IndexKey key)
        {
            cancellation.ThrowIfCancellationRequested();
            work++;
            var account = Account(key.UserId);
            if (account == null) return null;
            var item = Item(key.ItemId);
            if (!InterestService.Supported(item) || !item!.Name.Contains(query.Search, StringComparison.OrdinalIgnoreCase) ||
                !InterestService.Supported(library.GetItemById<BaseItem>(key.ItemId, account))) return null;
            authorizedWork++;
            var preliminaryReasons = (rows.TryGetValue(key, out var potential) && IndexQuery.InRange(potential.Activity, query.Days, query.Older, now) ? potential.Activity.Reasons : Array.Empty<string>())
                .Concat(dated.ContainsKey(key) ? ["Watchlisted"] : Array.Empty<string>()).Concat(live.ContainsKey(key) ? ["CurrentlyPlaying"] : Array.Empty<string>()).ToArray();
            if (!query.Matches(new(key.UserId, "", preliminaryReasons, null))) return null;
            var policy = Policy(account);
            OverviewUser? activity = null; IndexRow? source = null;
            if (rows.TryGetValue(key, out var row) && (IndexQuery.InRange(row.Activity, query.Days, query.Older, now) || dated.ContainsKey(key) || live.ContainsKey(key)))
            {
                // Only authorized titles contribute explanations; never expose global worker counts/causes.
                if (row.AuthorizationFingerprint != policy) { worker.Invalidate(key); causes.Add("PendingVerification"); }
                else if (!worker.StillValid(row, indexed.Generation)) causes.Add("PendingVerification");
                else if (row.Failure != null) causes.Add(row.Failure);
                else
                {
                    var authorized = true;
                    if (item is Series)
                    {
                        var ownerIds = Episodes(account, key.ItemId, row.Continuing);
                        var callerIds = Episodes(caller, key.ItemId, row.Continuing);
                        authorized = ownerIds.SetEquals(row.Episodes) && ownerIds.IsSubsetOf(callerIds);
                        if (!authorized) worker.Invalidate(key);
                        else { safeEpisodeKeys.Add((account.Id, key.ItemId, row.Continuing)); safeEpisodeKeys.Add((caller.Id, key.ItemId, row.Continuing)); }
                    }
                    if (authorized && worker.StillValid(row, indexed.Generation))
                    {
                        activity = IndexQuery.InRange(row.Activity, query.Days, query.Older, now)
                            ? row.Activity with { DisplayName = account.Username }
                            : new(key.UserId, account.Username, [], row.Activity.LastPlayedDate);
                        source = row;
                        if (!row.MetadataComplete) causes.Add("EpisodeMetadataIncomplete");
                    }
                }
            }
            var member = dated.GetValueOrDefault(key);
            var reasons = (activity?.Reasons ?? []).Concat(member != null ? ["Watchlisted"] : Array.Empty<string>())
                .Concat(live.ContainsKey(key) ? ["CurrentlyPlaying"] : Array.Empty<string>()).Distinct().ToArray();
            if (reasons.Length == 0) return null;
            var person = (activity ?? new(key.UserId, account.Username, [], null)) with { Reasons = reasons, AddedAtUtc = member?.AddedAtUtc };
            if (!query.Matches(person)) return null;
            return new(key, item.Name, person, source);
        }
        var accepted = view.Accepted.ToList();
        if (!view.Prepared)
        {
            var offset = view.ScanOffset;
            if (query.Statuses.Length == 0) offset = view.Candidates.Length;
            for (; offset < view.Candidates.Length && work < PairBudget; offset++)
            {
                try { var entry = Resolve(view.Candidates[offset]); if (entry != null) accepted.Add(entry); }
                catch (IndexVisibilityLimitException) { causes.Add("VisibilityBudget"); break; }
            }
            if (offset == view.ScanOffset && offset < view.Candidates.Length) throw new InvalidOperationException("Query made no progress.");
            var prepared = offset == view.Candidates.Length;
            var titles = prepared ? Sort(accepted.GroupBy(e => e.Key.ItemId)
                .Select(g => new OverviewItem(g.Key, g.First().Name, g.OrderBy(e => e.Key.UserId).Select(e => e.Person).ToArray())), query.Sort) : [];
            view = view with { Accepted = accepted.ToArray(), ScanOffset = offset, Prepared = prepared, Titles = titles,
                Policies = view.Policies.Concat(policies).GroupBy(p => p.Key).ToDictionary(g => g.Key, g => g.Last().Value) };
            // A bounded preparation response never pretends to be a globally ordered result page.
            if (!prepared) return Finish([], true, view);
        }
        var result = new List<OverviewItem>();
        var titleOffset = view.TitleOffset; var ownerOffset = view.OwnerOffset;
        var acceptedByKey = view.Accepted.ToDictionary(e => e.Key);
        while (titleOffset < view.Titles.Length && result.Count < 25 && work < PairBudget)
        {
            var title = view.Titles[titleOffset];
            // Reauthorize the date contributor before any fragment of this title is
            // disclosed, even when its owner lies on a later owner-continuation page.
            var contributor = query.Sort == "recent" ? title.Users.MaxBy(u => u.LastPlayedDate?.Ticks) :
                query.Sort == "added" ? title.Users.MaxBy(u => u.AddedAtUtc?.UtcTicks) : null;
            if (contributor != null)
            {
                var prior = acceptedByKey[new(contributor.UserId, title.ItemId)];
                Entry? checkedContributor;
                try { checkedContributor = Resolve(prior.Key); }
                catch (IndexVisibilityLimitException) { causes.Add("VisibilityBudget"); break; }
                if (checkedContributor == null || checkedContributor.Person.LastPlayedDate != prior.Person.LastPlayedDate ||
                    checkedContributor.Person.AddedAtUtc != prior.Person.AddedAtUtc) throw new BrowserViewExpiredException();
            }
            var people = new List<OverviewUser>();
            var exhausted = false;
            for (; ownerOffset < title.Users.Length && work < PairBudget; ownerOffset++)
            {
                var previous = acceptedByKey[new(title.Users[ownerOffset].UserId, title.ItemId)];
                Entry? fresh;
                try { fresh = Resolve(previous.Key); }
                catch (IndexVisibilityLimitException) { causes.Add("VisibilityBudget"); exhausted = true; break; }
                // Never retain a sort key contributed by a removed/unauthorized owner.
                // Changes need a new ordered snapshot, not an append with shifted keys.
                if (fresh == null || fresh.Name != previous.Name || fresh.Person.LastPlayedDate != previous.Person.LastPlayedDate ||
                    fresh.Person.AddedAtUtc != previous.Person.AddedAtUtc || !fresh.Person.Reasons.SequenceEqual(previous.Person.Reasons) ||
                    fresh.Activity != previous.Activity) throw new BrowserViewExpiredException();
                people.Add(fresh.Person);
            }
            if (people.Count > 0) result.Add(new(title.ItemId, title.Name, people.ToArray()));
            if (exhausted || ownerOffset < title.Users.Length) break;
            titleOffset++; ownerOffset = 0;
        }
        view = view with { TitleOffset = titleOffset, OwnerOffset = ownerOffset };
        return Finish(result.ToArray(), false, view);

        BrowserPage Finish(OverviewItem[] items, bool preparing, View state)
        {
            string? next = null;
            if (preparing || state.TitleOffset < state.Titles.Length)
            {
                lock (gate)
                {
                    // At most two snapshots per caller and sixteen globally, each at most 10,000 pairs.
                    while (views.Values.Count(v => v.Caller == caller.Id) >= 2)
                        views.Remove(views.Where(v => v.Value.Caller == caller.Id).MinBy(v => v.Value.Expires).Key);
                    while (views.Count >= 16) views.Remove(views.MinBy(v => v.Value.Expires).Key);
                    next = Convert.ToHexString(RandomNumberGenerator.GetBytes(24)); views[next] = state with { Causes = causes.ToArray() };
                }
            }
            var warnings = causes.Order().Select(c => c switch
            {
                "VisibilityBudget" => "Episode authorization reached this request's work budget; continue to advance the query.",
                "PendingVerification" => "Some visible activity is awaiting background verification.",
                _ => "Known activity coverage is partial: " + c + "."
            }).ToArray();
            return new(items, preparing, next, causes.Any(c => c.EndsWith("Limit", StringComparison.Ordinal) || c.EndsWith("Capacity", StringComparison.Ordinal)),
                "Known eligible titles only; background discovery is not an exhaustive library audit. Explicit watchlists and live playback are independent of the activity window.",
                new(1, query.Days, true, causes.Contains("EpisodeMetadataIncomplete"), causes.Contains("VisibilityBudget"), causes.Contains("CandidateLimit"), next != null, causes.Order().ToArray(), warnings),
                // No global stored/pending totals or worker counters are disclosed by the browser query.
                new(0, causes.Contains("PendingVerification")), new(Stopwatch.GetElapsedTime(started).TotalMilliseconds, authorizedWork, safeEpisodeKeys.Count, safeEpisodeKeys.Sum(k => visibleEpisodes[k].Count)));
        }
    }

    public static OverviewItem[] Sort(IEnumerable<OverviewItem> items, string sort)
    {
        var ordered = items.OrderByDescending(i => sort == "recent" ? i.Users.Max(u => u.LastPlayedDate?.ToUniversalTime().Ticks) :
            sort == "added" ? i.Users.Max(u => u.AddedAtUtc?.UtcTicks) : null);
        return ordered.ThenBy(i => i.Name, StringComparer.OrdinalIgnoreCase).ThenBy(i => i.Name, StringComparer.Ordinal).ThenBy(i => i.ItemId).ToArray();
    }

    private Dictionary<IndexKey, bool> Live(User caller, Guid? owner, Func<Guid, User?> account, CancellationToken cancellation, HashSet<string> causes)
    {
        var result = new Dictionary<IndexKey, bool>();
        var liveOwners = new HashSet<Guid>();
        foreach (var session in sessions.Sessions.Where(s => s.IsActive && s.NowPlayingItem != null).Take(100))
        foreach (var id in new[] { session.UserId }.Concat(session.AdditionalUsers.Select(u => u.UserId)).Distinct().Take(50))
        {
            cancellation.ThrowIfCancellationRequested();
            if (owner.HasValue && owner != id) continue;
            if (!liveOwners.Contains(id) && liveOwners.Count == 50) continue;
            liveOwners.Add(id);
            var user = account(id); if (user == null) continue;
            var media = library.GetItemById<BaseItem>(session.NowPlayingItem!.Id, user);
            if (media == null || library.GetItemById<BaseItem>(media.Id, caller) == null) continue;
            var primary = IndexTargets.Primary(library, user, media);
            if (primary == null || library.GetItemById<BaseItem>(primary.Id, caller) == null) continue;
            var title = primary is Episode episode ? library.GetItemById<BaseItem>(episode.SeriesId, user) : primary;
            if (!InterestService.Supported(title) || !InterestService.Supported(library.GetItemById<BaseItem>(title!.Id, caller))) continue;
            result[new(id, title.Id)] = true;
        }
        return result;
    }
}
