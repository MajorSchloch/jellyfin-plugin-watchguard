using Jellyfin.Data;
using Jellyfin.Data.Enums;
using Jellyfin.Data.Events;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Database.Implementations.Enums;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Session;
using MediaBrowser.Model.Entities;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Jellyfin.Plugin.WatchGuard.ActivityIndex;

public sealed record IndexStatus(long Revision, int Stored, int Validated, int Pending, int DiscoveryPages,
    bool DiscoveryFinished, DateTimeOffset? LastUpdate, string[] Causes)
{
    public long EpisodeQueries { get; init; }
    public long EpisodeRows { get; init; }
    public long PlaybackBatches { get; init; }
    public long TitlesVerified { get; init; }
    public long StaleResultsDiscarded { get; init; }
    public double VerificationMs { get; init; }
    public int RetainedSerializedBytes { get; init; }
}

// All verification is serialized here, including native scheduled/manual runs.
// Event callbacks never query native services, serialize, or perform I/O.
public sealed class IndexWorker(IndexStore store, ILibraryManager library, IUserManager users,
    IUserDataManager data, InterestService interest, ILogger<IndexWorker> logger, TimeProvider? clock = null) : BackgroundService
{
    private readonly TimeProvider time = clock ?? TimeProvider.System;
    public const int PageSize = 50;
    public const int QueueLimit = 2048;
    private readonly object gate = new();
    private readonly SemaphoreSlim worker = new(1, 1);
    private readonly Dictionary<IndexKey, IndexRow> rows = new();
    private readonly Dictionary<IndexKey, int> sizes = new();
    private int retainedBytes;
    private readonly HashSet<IndexKey> valid = new();
    private readonly HashSet<IndexKey> visited = new();
    private readonly HashSet<IndexKey> refreshRemaining = new();
    private readonly HashSet<IndexKey> urgent = new();
    private readonly Dictionary<IndexKey, DateTimeOffset> pending = new();
    private readonly Dictionary<Guid, long> ownerChanges = new();
    private readonly Dictionary<(Guid User, int Source), DiscoveryPosition> positions = new();
    private readonly HashSet<string> causes = new();
    private bool initialized, resetDiscovery;
    private long generation, revision;
    private int pages, turn;
    private long episodeQueries, episodeRows, playbackBatches, titlesVerified, staleResults;
    private double verificationMs;
    private DateTime localDay;
    private DateTimeOffset nextReconcile, lastCheckpoint;
    private DateTimeOffset? lastUpdate;

    public override Task StartAsync(CancellationToken cancellationToken)
    {
        data.UserDataSaved += PlaybackChanged;
        library.ItemAdded += LibraryChanged; library.ItemUpdated += LibraryChanged; library.ItemRemoved += LibraryChanged;
        users.OnUserUpdated += UserChanged;
        return base.StartAsync(cancellationToken);
    }
    public override async Task StopAsync(CancellationToken cancellationToken)
    {
        data.UserDataSaved -= PlaybackChanged;
        library.ItemAdded -= LibraryChanged; library.ItemUpdated -= LibraryChanged; library.ItemRemoved -= LibraryChanged;
        users.OnUserUpdated -= UserChanged;
        await base.StopAsync(cancellationToken);
    }
    private void PlaybackChanged(object? sender, UserDataSaveEventArgs e)
    {
        lock (gate)
        {
            ownerChanges[e.UserId] = ownerChanges.GetValueOrDefault(e.UserId) + 1;
            var title = e.Item is Episode episode ? episode.SeriesId : e.Item?.Id ?? Guid.Empty;
            if (title != Guid.Empty) Enqueue(new(e.UserId, title), true);
            else { valid.RemoveWhere(k => k.UserId == e.UserId); resetDiscovery = true; }
            revision++;
        }
    }
    private void LibraryChanged(object? sender, ItemChangeEventArgs e) => InvalidateLibrary();
    public void InvalidateLibrary()
    {
        lock (gate) { generation++; revision++; valid.Clear(); visited.Clear(); resetDiscovery = true; }
    }
    private void UserChanged(object? sender, GenericEventArgs<User> e)
    {
        lock (gate)
        {
            ownerChanges[e.Argument.Id] = ownerChanges.GetValueOrDefault(e.Argument.Id) + 1;
            valid.RemoveWhere(k => k.UserId == e.Argument.Id);
            visited.RemoveWhere(k => k.UserId == e.Argument.Id);
            resetDiscovery = true; revision++;
        }
    }
    private void Enqueue(IndexKey key, bool changed)
    {
        if (changed) { valid.Remove(key); visited.Remove(key); }
        if (pending.Count >= QueueLimit && !pending.ContainsKey(key)) { causes.Add("QueueLimit"); resetDiscovery = true; return; }
        pending[key] = time.GetUtcNow().AddSeconds(changed ? 2 : 0);
        if (changed) urgent.Add(key);
    }
    public void RequestRefresh(Guid? owner)
    {
        lock (gate)
        {
            // A refresh is advisory and preserves usable rows; native permissions
            // are still checked when they are read. No synchronous verification.
            refreshRemaining.UnionWith(rows.Keys.Where(k => !owner.HasValue || k.UserId == owner));
            revision++;
        }
    }
    public IndexStatus Status()
    {
        lock (gate) return new(revision, rows.Count, valid.Count, pending.Count + refreshRemaining.Count, pages,
            initialized && !resetDiscovery && positions.Count > 0 && positions.Values.All(p => p.Finished), lastUpdate,
            causes.Concat(rows.Values.Where(r => valid.Contains(r.Key) && r.Failure != null).Select(r => r.Failure!))
                .Concat(rows.Values.Any(r => valid.Contains(r.Key) && !r.MetadataComplete && r.Failure == null) ? ["EpisodeMetadataIncomplete"] : [])
                .Distinct().Order().ToArray()) { EpisodeQueries = episodeQueries, EpisodeRows = episodeRows, PlaybackBatches = playbackBatches, TitlesVerified = titlesVerified, StaleResultsDiscarded = staleResults, VerificationMs = verificationMs, RetainedSerializedBytes = retainedBytes };
    }
    public (IndexRow[] Rows, HashSet<IndexKey> Valid, long Generation) Snapshot()
    {
        lock (gate) return (rows.Values.ToArray(), new(valid), generation);
    }
    public bool StillValid(IndexRow row, long epoch)
    {
        lock (gate) return generation == epoch && valid.Contains(row.Key) && rows.GetValueOrDefault(row.Key) == row && localDay == time.GetLocalNow().Date;
    }
    public void Invalidate(IndexKey key) { lock (gate) { Enqueue(key, true); revision++; } }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Do not compete with native startup/setup. Cancellation ends this wait.
        await Task.Delay(TimeSpan.FromSeconds(10), stoppingToken);
        while (!stoppingToken.IsCancellationRequested)
        {
            try { await RunSlice(stoppingToken); }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception e)
            {
                lock (gate) causes.Add("WorkerFailure");
                logger.LogWarning("WatchGuard activity worker unavailable ({Type}); existing index retained", e.GetType().Name);
            }
            await Task.Delay(TimeSpan.FromSeconds(2), stoppingToken);
        }
    }

    public async Task RunSlice(CancellationToken cancellation)
    {
        await worker.WaitAsync(cancellation);
        try { await Task.Run(() => Slice(cancellation), cancellation); }
        finally { worker.Release(); }
    }
    private void Slice(CancellationToken cancellation)
    {
        cancellation.ThrowIfCancellationRequested();
        if (!initialized)
        {
            var document = store.Read();
            lock (gate)
            {
                foreach (var row in document.Rows) { rows.Add(row.Key, row); var size = System.Text.Json.JsonSerializer.SerializeToUtf8Bytes(row).Length; sizes[row.Key] = size; retainedBytes += size; refreshRemaining.Add(row.Key); }
                foreach (var key in document.Pending) Enqueue(key, false);
                foreach (var p in document.Positions) positions.Add((p.UserId, p.Source), p);
                if (store.RecoveredCorruption) causes.Add("CorruptIndexRebuilt");
                initialized = true; localDay = time.GetLocalNow().Date; nextReconcile = time.GetUtcNow().AddHours(6);
                // Persisted facts are not trusted after downtime; cursor is resumable.
                revision++;
            }
        }
        var accounts = users.GetUsers().Where(u => !u.HasPermission(PermissionKind.IsDisabled)).Take(51).ToArray();
        var enabled = accounts.Take(50).ToDictionary(u => u.Id);
        lock (gate)
        {
            if (accounts.Length > 50) causes.Add("UserLimit"); else causes.Remove("UserLimit");
            foreach (var key in rows.Keys.Where(k => !enabled.ContainsKey(k.UserId)).ToArray()) { rows.Remove(key); retainedBytes -= sizes.GetValueOrDefault(key); sizes.Remove(key); valid.Remove(key); visited.Remove(key); pending.Remove(key); refreshRemaining.Remove(key); urgent.Remove(key); }
            foreach (var key in positions.Keys.Where(k => !enabled.ContainsKey(k.User)).ToArray()) positions.Remove(key);
            foreach (var key in pending.Keys.Where(k => !enabled.ContainsKey(k.UserId)).ToArray()) pending.Remove(key);
            if (localDay != time.GetLocalNow().Date) { generation++; valid.Clear(); visited.Clear(); localDay = time.GetLocalNow().Date; }
            if (time.GetUtcNow() >= nextReconcile) { visited.Clear(); refreshRemaining.UnionWith(rows.Keys); resetDiscovery = true; nextReconcile = time.GetUtcNow().AddHours(6); }
            if (resetDiscovery) { positions.Clear(); resetDiscovery = false; causes.ExceptWith(["QueueLimit", "DiscoveryWorkLimit", "DeduplicationLimit"]); }
            foreach (var id in enabled.Keys) for (var source = 0; source < 2; source++) positions.TryAdd((id, source), new(id, source, 0, false));
            foreach (var key in refreshRemaining.OrderByDescending(k => rows.GetValueOrDefault(k)?.Activity.LastPlayedDate).Take(8).ToArray()) { Enqueue(key, false); refreshRemaining.Remove(key); }
            foreach (var key in rows.Keys.Where(k => !valid.Contains(k) && !pending.ContainsKey(k)).Take(8)) Enqueue(key, false);
        }
        // Always advance discovery even under a busy event queue. Native offset
        // pages can move during writes, so coverage never claims exhaustiveness.
        Discover(enabled, cancellation);
        var work = new List<(IndexKey Key, long Epoch, long Owner)>();
        lock (gate)
        {
            foreach (var pair in pending.Where(p => p.Value <= time.GetUtcNow()).OrderByDescending(p => urgent.Contains(p.Key)).ThenBy(p => p.Value).Take(8).ToArray())
            {
                pending.Remove(pair.Key); urgent.Remove(pair.Key);
                work.Add((pair.Key, generation, ownerChanges.GetValueOrDefault(pair.Key.UserId)));
            }
        }
        var changed = false;
        foreach (var (key, epoch, ownerGeneration) in work)
        {
            if (cancellation.IsCancellationRequested)
            {
                lock (gate) foreach (var queued in work) if (!visited.Contains(queued.Key)) Enqueue(queued.Key, false);
                cancellation.ThrowIfCancellationRequested();
            }
            IndexRow? calculated;
            try { calculated = Evaluate(key, cancellation); }
            catch (OperationCanceledException) { lock (gate) foreach (var queued in work) if (!visited.Contains(queued.Key)) Enqueue(queued.Key, false); throw; }
            catch (Exception e)
            {
                calculated = new(key, new(key.UserId, "", [], null), [], false, false,
                    e is OverviewLimitException ? "EpisodeLimit" : "NativeLookupFailure", time.GetUtcNow());
            }
            lock (gate)
            {
                if (epoch != generation || ownerGeneration != ownerChanges.GetValueOrDefault(key.UserId)) { staleResults++; Enqueue(key, false); continue; }
                var size = calculated is null ? 0 : System.Text.Json.JsonSerializer.SerializeToUtf8Bytes(calculated).Length;
                if (calculated is null) { rows.Remove(key); retainedBytes -= sizes.GetValueOrDefault(key); sizes.Remove(key); valid.Remove(key); }
                else if ((rows.Count < IndexStore.MaxRows || rows.ContainsKey(key)) && retainedBytes - sizes.GetValueOrDefault(key) + size < IndexStore.MaxBytes - 1024 * 1024)
                { retainedBytes += size - sizes.GetValueOrDefault(key); sizes[key] = size; rows[key] = calculated; valid.Add(key); }
                else { causes.Add("StorageLimit"); continue; }
                if (visited.Count < IndexStore.MaxRows) visited.Add(key); else causes.Add("DeduplicationLimit"); changed = true; lastUpdate = time.GetUtcNow(); revision++;
            }
        }
        if (changed || time.GetUtcNow() - lastCheckpoint > TimeSpan.FromSeconds(30))
        {
            IndexDocument document;
            lock (gate) document = new(1, rows.Values.ToArray(), positions.Values.ToArray(), pending.Keys.ToArray());
            try { store.Write(document); lastCheckpoint = time.GetUtcNow(); lock (gate) causes.Remove("CheckpointFailure"); }
            catch { lock (gate) causes.Add("CheckpointFailure"); throw; }
        }
    }

    private void Discover(Dictionary<Guid, User> enabled, CancellationToken cancellation)
    {
        DiscoveryPosition? cursor;
        lock (gate)
        {
            var remaining = positions.Values.Where(p => !p.Finished).OrderBy(p => p.UserId).ThenBy(p => p.Source).ToArray();
            cursor = remaining.Length == 0 ? null : remaining[turn++ % remaining.Length];
            if (pending.Count > QueueLimit - PageSize) return;
        }
        if (cursor is null || !enabled.TryGetValue(cursor.UserId, out var user)) return;
        cancellation.ThrowIfCancellationRequested();
        var found = library.GetItemList(new InternalItemsQuery(user)
        {
            Recursive = true, IsVirtualItem = false, IsMissing = false,
            IncludeItemTypes = [BaseItemKind.Movie, BaseItemKind.Episode],
            IsResumable = cursor.Source == 0 ? true : null, IsPlayed = cursor.Source == 1 ? true : null,
            OrderBy = [(ItemSortBy.DatePlayed, SortOrder.Descending), (ItemSortBy.SortName, SortOrder.Ascending)],
            StartIndex = cursor.Offset, Limit = PageSize, EnableTotalRecordCount = false
        });
        var keys = found.Select(item => new IndexKey(user.Id, item is Episode e ? e.SeriesId : item.Id)).Where(k => k.ItemId != Guid.Empty).Distinct().ToArray();
        lock (gate)
        {
            pages++;
            foreach (var key in keys) if (!visited.Contains(key) && !pending.ContainsKey(key)) Enqueue(key, false);
            if (cursor.Offset >= 1000000 - PageSize) causes.Add("DiscoveryWorkLimit");
            positions[(user.Id, cursor.Source)] = cursor with { Offset = Math.Min(1000000, cursor.Offset + found.Count), Finished = found.Count < PageSize || cursor.Offset >= 1000000 - PageSize };
            revision++;
        }
    }

    private IndexRow? Evaluate(IndexKey key, CancellationToken cancellation)
    {
        var owner = users.GetUserById(key.UserId);
        if (owner is null || owner.HasPermission(PermissionKind.IsDisabled)) return null;
        var item = library.GetItemById<BaseItem>(key.ItemId, owner);
        if (!InterestService.Supported(item)) return null;
        // Empty membership/session snapshots keep these independent live sources
        // out of durable storage. The same bounded native classifier is reused.
        var budget = new OverviewBudget([], [owner]) { IncludeActivity = true, IncludeEpisodeProgress = true, SessionSnapshot = [], Cancellation = cancellation };
        var started = System.Diagnostics.Stopwatch.GetTimestamp();
        ProtectionStatus status;
        try
        {
            interest.PrepareOverviewVerification([item!], budget);
            status = interest.GetForOverview(item!, owner.Id, budget);
            lock (gate) titlesVerified++;
        }
        finally
        {
            lock (gate)
            {
                episodeQueries += budget.Diagnostics.EpisodeQueryCount;
                episodeRows += budget.Diagnostics.EpisodeRowsProcessed;
                playbackBatches += budget.Diagnostics.NativePlaybackBatches;
                verificationMs += System.Diagnostics.Stopwatch.GetElapsedTime(started).TotalMilliseconds;
            }
        }
        var playback = budget.Playback.GetValueOrDefault(owner.Id) ?? throw new InvalidDataException();
        var reasons = status.Users.SingleOrDefault()?.Reasons.Where(r => r == "InProgress").ToList() ?? [];
        if (playback.CaughtUp) reasons.Add("CaughtUp"); else if (playback.Completed) reasons.Add("Watched");
        // Do not let expired completed movies fill the store and displace older
        // unfinished series. Native dates are never invented for manual marking.
        var current = reasons.Any(r => r is "InProgress" or "CaughtUp");
        var datedHistory = playback.LastPlayedDate is { } date && date.ToUniversalTime() >= time.GetUtcNow().AddDays(-90).UtcDateTime && date.ToUniversalTime() <= time.GetUtcNow().UtcDateTime;
        if (!current && !datedHistory && !budget.IncompleteCoverage) return null;
        if (reasons.Count == 0 && !budget.IncompleteCoverage) return null;
        var episodes = item is Series ? budget.VerificationReads!.Episodes(item.Id, owner.Id).Select(e => e.Id).Distinct().Order().ToArray() : [];
        return new(key, new(owner.Id, "", reasons.ToArray(), playback.LastPlayedDate, playback.AvailableEpisodes, playback.WatchedEpisodes)
            { EpisodeProgress = playback.EpisodeProgress }, episodes, item is Series { Status: SeriesStatus.Continuing }, !budget.IncompleteCoverage,
            null, time.GetUtcNow());
    }

    public async Task Reconcile(IProgress<double> progress, CancellationToken cancellation)
    {
        lock (gate)
        {
            visited.Clear(); resetDiscovery = true;
            refreshRemaining.UnionWith(rows.Keys);
        }
        // Native task is bounded to 15 minutes; the hosted coordinator resumes
        // remaining pages afterward instead of restarting the first page.
        var until = time.GetUtcNow().AddMinutes(15);
        do
        {
            cancellation.ThrowIfCancellationRequested();
            await RunSlice(cancellation);
            var status = Status();
            progress.Report(status.DiscoveryFinished && status.Pending == 0 ? 100 : Math.Min(95, status.Validated * 100.0 / Math.Max(1, status.Stored + status.Pending)));
            if (status.DiscoveryFinished && status.Pending == 0) return;
            await Task.Delay(TimeSpan.FromSeconds(2), cancellation);
        } while (time.GetUtcNow() < until);
    }
}
