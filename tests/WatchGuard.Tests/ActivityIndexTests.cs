using Jellyfin.Data;
using Jellyfin.Data.Enums;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Database.Implementations.Enums;
using Jellyfin.Plugin.WatchGuard;
using Jellyfin.Plugin.WatchGuard.ActivityIndex;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Movies;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Session;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Xunit;

namespace WatchGuard.Tests;

public sealed class ActivityIndexTests : IDisposable
{
    private readonly string path = Path.Combine(Path.GetTempPath(), "watchguard-index-" + Guid.NewGuid());
    private readonly Mock<ILibraryManager> library = new();
    private readonly Mock<IUserManager> users = new();
    private readonly Mock<IUserDataManager> data = new();
    private readonly Mock<ISessionManager> sessions = new();
    private readonly User alice = new("Alice", "test", "test") { Id = Guid.NewGuid() };
    private readonly User bob = new("Bob", "test", "test") { Id = Guid.NewGuid() };
    private readonly Dictionary<Guid, BaseItem> items = new();
    private readonly Dictionary<(Guid, Guid), UserItemData> playback = new();
    private readonly HashSet<(Guid, Guid)> hidden = new();
    private readonly IndexStore store;
    private readonly InterestService interest;
    private readonly IndexWorker worker;
    private readonly IndexQuery query;
    private int playbackReads;
    private readonly TestClock clock = new();
    public ActivityIndexTests()
    {
        store = new(path);
        users.Setup(u => u.GetUsers()).Returns([alice, bob]);
        users.Setup(u => u.GetUserDto(It.IsAny<User>(), It.IsAny<string?>())).Returns(new MediaBrowser.Model.Dto.UserDto { Policy = new(), Configuration = new() });
        users.Setup(u => u.GetUserById(It.IsAny<Guid>())).Returns((Guid id) => id == alice.Id ? alice : id == bob.Id ? bob : null);
        library.Setup(l => l.GetItemById<BaseItem>(It.IsAny<Guid>(), It.IsAny<User>()))
            .Returns((Guid id, User user) => hidden.Contains((user.Id, id)) ? null : items.GetValueOrDefault(id));
        library.Setup(l => l.GetItemList(It.IsAny<InternalItemsQuery>())).Returns((InternalItemsQuery q) =>
        {
            var source = items.Values.Where(i => !hidden.Contains((q.User!.Id, i.Id)));
            if (q.AncestorIds.Length > 0) return source.OfType<Episode>().Where(e => q.AncestorIds.Contains(e.SeriesId)).Take(q.Limit ?? 10000).Cast<BaseItem>().ToArray();
            return source.Where(i => i is Movie or Episode).Where(i => q.IsResumable == true ? playback.GetValueOrDefault((q.User!.Id, i.Id))?.PlaybackPositionTicks > 0 : playback.GetValueOrDefault((q.User!.Id, i.Id))?.Played == true)
                .OrderByDescending(i => playback.GetValueOrDefault((q.User!.Id, i.Id))?.LastPlayedDate).ThenBy(i => i.Id).Skip(q.StartIndex ?? 0).Take(q.Limit ?? 10000).ToArray();
        });
        library.Setup(l => l.GetItemIds(It.IsAny<InternalItemsQuery>())).Returns((InternalItemsQuery q) => library.Object.GetItemList(q).Select(i => i.Id).ToArray());
        data.Setup(d => d.GetUserDataBatch(It.IsAny<IReadOnlyList<BaseItem>>(), It.IsAny<User>())).Returns((IReadOnlyList<BaseItem> list, User u) =>
        {
            playbackReads++; return list.ToDictionary(i => i.Id, i => playback.GetValueOrDefault((u.Id, i.Id)) ?? new UserItemData { Key = "test" });
        });
        data.Setup(d => d.GetResumeUserDataBatch(It.IsAny<IReadOnlyList<BaseItem>>(), It.IsAny<User>())).Returns(new Dictionary<Guid, VersionResumeData>());
        sessions.Setup(s => s.Sessions).Returns(Array.Empty<SessionInfo>());
        interest = new(new WatchlistStore(path), library.Object, users.Object, data.Object, sessions.Object);
        worker = Worker(); query = new(worker, library.Object, users.Object, sessions.Object, clock);
    }
    private IndexWorker Worker() => new(store, library.Object, users.Object, data.Object, interest, NullLogger<IndexWorker>.Instance, clock);
    private Movie AddMovie(int age = 1)
    {
        var item = new Movie { Id = Guid.NewGuid(), Name = "Disposable " + items.Count };
        items.Add(item.Id, item); playback[(alice.Id, item.Id)] = new() { Key = "test", Played = true, LastPlayedDate = DateTime.UtcNow.AddDays(-age) }; return item;
    }
    private Series AddSeries(int count = 3)
    {
        var series = new Series { Id = Guid.NewGuid(), Name = "Series", Status = MediaBrowser.Model.Entities.SeriesStatus.Continuing }; items.Add(series.Id, series);
        for (var n = 0; n < count; n++)
        {
            var e = new AvailableEpisode { Id = Guid.NewGuid(), SeriesId = series.Id, PremiereDate = DateTime.UtcNow.AddDays(-20), Name = "Episode", IndexNumber = n + 1 };
            items.Add(e.Id, e); playback[(alice.Id, e.Id)] = new() { Key = "test", Played = true, LastPlayedDate = DateTime.UtcNow.AddDays(-2) };
        }
        return series;
    }
    private async Task Populate(IndexWorker? target = null, int slices = 40)
    {
        for (var n = 0; n < slices; n++) await (target ?? worker).RunSlice(CancellationToken.None);
    }
    private IndexPage Read(int days = 30, bool older = true, string? cursor = null) => query.Read(alice, alice.Id, days, older, cursor, CancellationToken.None);

    [Fact]
    public async Task DiscoveryAdvancesBeyondOldCapsAndWarmPagesDoNotReadPlayback()
    {
        for (var n = 0; n < 137; n++) AddMovie();
        await Populate();
        Assert.True(worker.Status().DiscoveryFinished);
        var reads = playbackReads;
        var ids = new HashSet<Guid>(); var page = Read();
        do { Assert.All(page.Items, i => Assert.True(ids.Add(i.ItemId))); page = page.Continuation is null ? null : Read(cursor: page.Continuation); } while (page != null);
        Assert.Equal(137, ids.Count); Assert.Equal(reads, playbackReads);
        Assert.True(worker.Status().PlaybackBatches < 2 * 137, "Background slices must retain native per-account batching.");
        Assert.False(Read().IsComplete); // A completed pass is not an exhaustive audit.
    }
    [Theory]
    [InlineData(3, 7)]
    [InlineData(1, 25)]
    public async Task VisibilityBudgetResumesEveryOwnerIncludingTitlesLargerThanOnePage(int titleCount, int ownerCount)
    {
        var owners = Enumerable.Range(0, ownerCount).Select(n => new User("Owner" + n, "test", "test") { Id = Guid.NewGuid() }).ToArray();
        bob.SetPermission(PermissionKind.IsAdministrator, true);
        var accounts = owners.Append(bob).ToArray();
        users.Setup(u => u.GetUsers()).Returns(accounts);
        users.Setup(u => u.GetUserById(It.IsAny<Guid>())).Returns((Guid id) => accounts.SingleOrDefault(u => u.Id == id));
        var titles = Enumerable.Range(0, titleCount).Select(_ => AddSeries(1000)).ToArray();
        playback.Clear();
        foreach (var title in titles)
        foreach (var owner in owners)
        {
            var episode = items.Values.OfType<Episode>().First(e => e.SeriesId == title.Id);
            playback[(owner.Id, episode.Id)] = new() { Key = "test", Played = true, LastPlayedDate = DateTime.UtcNow.AddDays(-1) };
        }
        await Populate(slices: 100);
        Assert.Equal(titleCount * ownerCount, worker.Snapshot().Rows.Length);
        var seen = new HashSet<IndexKey>();
        string? cursor = null;
        var pages = 0;
        do
        {
            var page = query.Read(bob, null, 30, true, cursor, CancellationToken.None);
            Assert.InRange(page.ReadDiagnostics!.EpisodeRows, 0, 20000);
            Assert.NotEmpty(page.Items); // Even one oversized title must make progress.
            foreach (var title in page.Items)
            foreach (var owner in title.Users) Assert.True(seen.Add(new(owner.UserId, title.ItemId)));
            cursor = page.Continuation;
            Assert.True(++pages <= 4, "Continuation must finish, not repeat an unaffordable title forever.");
        } while (cursor != null);
        Assert.True(pages > 1);
        Assert.Equal(titleCount * ownerCount, seen.Count);
        foreach (var title in titles)
        foreach (var owner in owners) Assert.Contains(new IndexKey(owner.Id, title.Id), seen);
    }

    [Fact]
    public async Task SettledIdleSlicesNeverRewriteCheckpoint()
    {
        AddMovie(); await Populate();
        var file = Path.Combine(path, "activity-index.json");
        var before = await File.ReadAllBytesAsync(file);
        var modified = File.GetLastWriteTimeUtc(file);
        for (var n = 0; n < 5; n++) { clock.Advance(TimeSpan.FromSeconds(31)); await worker.RunSlice(CancellationToken.None); }
        Assert.Equal(modified, File.GetLastWriteTimeUtc(file));
        Assert.Equal(before, await File.ReadAllBytesAsync(file));
        Assert.Empty(Directory.GetFiles(path, "*.replaced-*"));
    }

    [Fact]
    public async Task CursorOnlyProgressFlushesWithinThirtySecondsAndAtEndOfPass()
    {
        users.Setup(u => u.GetUsers()).Returns([alice]);
        AddSeries(300);
        for (var n = 0; n < 4 && store.Read().Rows.Length == 0; n++) await worker.RunSlice(CancellationToken.None);
        var file = Path.Combine(path, "activity-index.json");
        var before = store.Read(); var modified = File.GetLastWriteTimeUtc(file);
        var verified = worker.Status().TitlesVerified;
        await worker.RunSlice(CancellationToken.None);
        Assert.Equal(verified, worker.Status().TitlesVerified); // Discovery revisits an already deduplicated title.
        Assert.Equal(modified, File.GetLastWriteTimeUtc(file));
        clock.Advance(TimeSpan.FromSeconds(30)); await worker.RunSlice(CancellationToken.None);
        Assert.True(store.Read().Positions.Sum(p => p.Offset) > before.Positions.Sum(p => p.Offset));
        await Populate();
        Assert.All(store.Read().Positions, p => Assert.True(p.Finished)); // Flush final cursor even before next deadline.
    }

    [Fact]
    public async Task ChangedRowsAndRemainingQueueAreCheckpointedTogetherAndResumeAfterRestart()
    {
        for (var n = 0; n < 40; n++) AddMovie();
        for (var n = 0; n < 4 && store.Read().Rows.Length == 0; n++) await worker.RunSlice(CancellationToken.None);
        var first = store.Read();
        Assert.Equal(8, first.Rows.Length); Assert.Equal(32, first.Pending.Length);
        await worker.RunSlice(CancellationToken.None);
        var second = store.Read();
        Assert.Equal(16, second.Rows.Length); Assert.Equal(24, second.Pending.Length);
        Assert.Equal(40, second.Rows.Select(r => r.Key).Concat(second.Pending).Distinct().Count());
        using var restored = Worker(); await Populate(restored);
        Assert.Equal(40, store.Read().Rows.Length); Assert.Empty(store.Read().Pending);
    }

    [Fact]
    public async Task DebouncedQueueOnlyChangeIsPersistedAndRecovered()
    {
        await Populate(); clock.Advance(TimeSpan.FromSeconds(31));
        var movie = AddMovie(); var key = new IndexKey(alice.Id, movie.Id);
        worker.Invalidate(key); // Due in two seconds; this slice cannot evaluate it yet.
        await worker.RunSlice(CancellationToken.None);
        Assert.Contains(key, store.Read().Pending); Assert.Empty(store.Read().Rows);
        using var restored = Worker(); await Populate(restored);
        Assert.Single(store.Read().Rows); Assert.Empty(store.Read().Pending);
    }

    [Fact]
    public async Task FailedCheckpointStaysDirtyUntilSavedEvenAfterWorkHasSettled()
    {
        var movie = AddMovie(); await Populate();
        playback[(alice.Id, movie.Id)].Played = false;
        worker.Invalidate(new(alice.Id, movie.Id)); clock.Advance(TimeSpan.FromSeconds(3));
        var temporary = Path.Combine(path, "activity-index.json.tmp");
        Directory.CreateDirectory(temporary); // Fail the real atomic write, not a mocked dirty check.
        Assert.NotNull(await Record.ExceptionAsync(() => worker.RunSlice(CancellationToken.None)));
        Assert.Single(store.Read().Rows); Assert.Contains("CheckpointFailure", worker.Status().Causes);
        Directory.Delete(temporary);
        await worker.RunSlice(CancellationToken.None);
        Assert.Empty(store.Read().Rows); Assert.Empty(store.Read().Pending);
        Assert.DoesNotContain("CheckpointFailure", worker.Status().Causes);
    }

    [Fact]
    public async Task FinishedBoundedPassStillReportsDiscoveryCoverageLimits()
    {
        users.Setup(u => u.GetUsers()).Returns(new[] { alice, bob }.Concat(
            Enumerable.Range(0, 49).Select(n => new User("Fixture" + n, "test", "test") { Id = Guid.NewGuid() })).ToArray());
        await Populate(slices: 120);
        Assert.True(worker.Status().DiscoveryFinished);
        var page = Read();
        Assert.True(page.Coverage.DiscoveryLimited);
        Assert.Contains("UserLimit", page.Coverage.Causes);
        Assert.True(page.LimitReached); Assert.False(page.IsComplete);
    }

    [Fact]
    public async Task CurrentInterestIsNotBuriedBehindCompletedHistoryPages()
    {
        for (var n = 0; n < 30; n++) AddMovie();
        var live = new Movie { Id = Guid.Parse("ffffffff-ffff-ffff-ffff-ffffffffffff"), Name = "Live fixture" };
        var older = new Movie { Id = Guid.Parse("ffffffff-ffff-ffff-ffff-fffffffffffe"), Name = "Older unfinished" };
        items.Add(live.Id, live); items.Add(older.Id, older);
        playback[(alice.Id, older.Id)] = new() { Key = "test", PlaybackPositionTicks = 100, LastPlayedDate = DateTime.UtcNow.AddDays(-150) };
        await Populate();
        sessions.Setup(s => s.Sessions).Returns([new SessionInfo(sessions.Object, NullLogger.Instance)
            { UserId = alice.Id, NowPlayingItem = new MediaBrowser.Model.Dto.BaseItemDto { Id = live.Id } }]);
        var page = Read(7, true);
        Assert.Equal(live.Id, page.Items[0].ItemId);
        Assert.Equal(older.Id, page.Items[1].ItemId);
        Assert.NotNull(page.Continuation);
    }

    [Fact]
    public async Task NativeCountsDatesAndExtrasMatchFreshClassifier()
    {
        var series = AddSeries(); var extra = new AvailableEpisode { Id = Guid.NewGuid(), Name = "<unsafe>", SeriesId = series.Id, PremiereDate = DateTime.Now.Date.AddDays(1) };
        items.Add(extra.Id, extra);
        await Populate(); var row = Assert.Single(Read().Items).Users.Single();
        var fresh = interest.GetSeriesActivity(series, alice.Id).Users.Single();
        Assert.Equal(fresh.LastPlayedDate, row.LastPlayedDate);
        Assert.Equal(fresh.WatchedEpisodes, row.WatchedEpisodes); Assert.Equal(3, row.AvailableEpisodes);
        Assert.Contains("CaughtUp", row.Reasons); Assert.Equal(extra.Id, row.EpisodeProgress!.ExtraEpisodes.Single().ItemId);
        Assert.DoesNotContain("CurrentlyPlaying", store.Read().Rows.Single().Activity.Reasons);
    }
    [Fact]
    public async Task LiveAlternateVersionsUseTheSamePrimaryTitleAsNativeOverview()
    {
        var primary = AddMovie(); var alternate = AddMovie(); alternate.PrimaryVersionId = primary.Id;
        playback.Remove((alice.Id, alternate.Id)); await Populate();
        sessions.Setup(s => s.Sessions).Returns([new SessionInfo(sessions.Object, NullLogger.Instance)
            { UserId = alice.Id, NowPlayingItem = new MediaBrowser.Model.Dto.BaseItemDto { Id = alternate.Id } }]);
        var shown = Assert.Single(Read().Items);
        Assert.Equal(primary.Id, shown.ItemId);
        Assert.Contains("CurrentlyPlaying", shown.Users.Single().Reasons);
        hidden.Add((alice.Id, primary.Id)); Assert.Empty(Read().Items);
    }

    [Fact]
    public async Task DiscoveryResolvesAlternateEpisodesThroughPrimaryAncestry()
    {
        var primary = AddSeries(); var other = AddSeries();
        playback.Clear();
        var episode = items.Values.OfType<Episode>().First(e => e.SeriesId == primary.Id);
        var alternate = items.Values.OfType<Episode>().First(e => e.SeriesId == other.Id);
        alternate.PrimaryVersionId = episode.Id;
        playback[(alice.Id, alternate.Id)] = new() { Key = "test", Played = true, LastPlayedDate = DateTime.UtcNow };
        await Populate();
        Assert.DoesNotContain(worker.Snapshot().Rows, r => r.Key.ItemId == other.Id);
        Assert.Contains(primary.Id, data.Invocations.Where(i => i.Method.Name == nameof(IUserDataManager.GetUserDataBatch))
            .SelectMany(i => (IReadOnlyList<BaseItem>)i.Arguments[0]).OfType<Episode>().Select(e => e.SeriesId));
        sessions.Setup(s => s.Sessions).Returns([new SessionInfo(sessions.Object, NullLogger.Instance)
            { UserId = alice.Id, NowPlayingItem = new MediaBrowser.Model.Dto.BaseItemDto { Id = alternate.Id } }]);
        Assert.Equal(primary.Id, Assert.Single(Read().Items).ItemId);
    }

    [Fact]
    public async Task LiveSessionsAreFreshAndRespectBothAccountsWithoutDurablePlayingState()
    {
        var series = AddSeries(); var episode = items.Values.OfType<Episode>().First();
        playback.Clear(); await Populate();
        sessions.Setup(s => s.Sessions).Returns([new SessionInfo(sessions.Object, NullLogger.Instance)
            { UserId = alice.Id, NowPlayingItem = new MediaBrowser.Model.Dto.BaseItemDto { Id = episode.Id } }]);
        Assert.Equal(new[] { "CurrentlyPlaying" }, Assert.Single(Read(7, false).Items).Users.Single().Reasons);
        Assert.Empty(store.Read().Rows);
        bob.SetPermission(PermissionKind.IsAdministrator, true);
        hidden.Add((bob.Id, episode.Id));
        Assert.Empty(query.Read(bob, null, 7, false, null, CancellationToken.None).Items);
        hidden.Clear(); hidden.Add((alice.Id, episode.Id)); Assert.Empty(Read().Items);
        hidden.Clear(); alice.SetPermission(PermissionKind.IsDisabled, true);
        Assert.Empty(query.Read(bob, null, 7, false, null, CancellationToken.None).Items);
        alice.SetPermission(PermissionKind.IsDisabled, false);
        sessions.Setup(s => s.Sessions).Returns(Array.Empty<SessionInfo>());
        Assert.Empty(Read().Items); Assert.Empty(store.Read().Rows);
    }

    [Fact]
    public async Task HistoryExpiresAtReadTimeWithoutPlaybackEventOrBackgroundSlice()
    {
        AddMovie(6); await Populate(); Assert.Single(Read(7, false).Items);
        clock.Advance(TimeSpan.FromDays(2));
        Assert.Empty(Read(7, false).Items);
    }

    [Fact]
    public async Task OwnerAndRequesterEpisodeVisibilityChangesSuppressCountsEvenWithoutEvents()
    {
        var series = AddSeries(); await Populate();
        var episode = items.Values.OfType<Episode>().First();
        hidden.Add((alice.Id, episode.Id));
        var denied = Read(); Assert.Empty(denied.Items); Assert.Contains("VisibilityChanged", denied.Coverage.Causes);
        hidden.Clear(); clock.Advance(TimeSpan.FromSeconds(3)); await Populate();
        bob.SetPermission(PermissionKind.IsAdministrator, true);
        hidden.Add((bob.Id, episode.Id));
        var result = query.Read(bob, null, 30, true, null, CancellationToken.None);
        Assert.Empty(result.Items); Assert.Contains("RequesterEpisodeVisibility", result.Coverage.Causes);
    }
    [Theory]
    [InlineData(7, 1)] [InlineData(30, 2)] [InlineData(90, 3)]
    public async Task DateFiltersAndUnknownDates(int days, int count)
    {
        AddMovie(3); AddMovie(20); AddMovie(60); AddMovie(120);
        var unknown = AddMovie(); playback[(alice.Id, unknown.Id)].LastPlayedDate = null;
        await Populate(); Assert.Equal(count, Read(days).Items.Length);
    }
    [Fact]
    public async Task OlderCurrentInterestIndependentOfDateWindow()
    {
        var item = AddMovie(150); playback[(alice.Id, item.Id)].Played = false; playback[(alice.Id, item.Id)].PlaybackPositionTicks = 100;
        await Populate(); Assert.Single(Read(7, true).Items); Assert.Empty(Read(7, false).Items);
    }
    [Fact]
    public async Task RestartResumesDiscoveryButNeverTrustsOldRowsBeforeVerification()
    {
        for (var n = 0; n < 137; n++) AddMovie();
        await worker.RunSlice(CancellationToken.None);
        var restored = Worker(); var restoredQuery = new IndexQuery(restored, library.Object, users.Object, sessions.Object);
        Assert.Empty(restoredQuery.Read(alice, alice.Id, 30, true, null, CancellationToken.None).Items);
        await Populate(restored); Assert.Equal(137, restored.Snapshot().Rows.Length);
    }
    [Fact]
    public async Task DisabledAndRemovedAccountsCannotReadOthersAndContinuationIsBound()
    {
        for (var n = 0; n < 30; n++) AddMovie(); await Populate(); var first = Read();
        Assert.NotNull(first.Continuation);
        Assert.Throws<UnauthorizedAccessException>(() => query.Read(bob, alice.Id, 30, true, null, CancellationToken.None));
        Assert.Throws<ArgumentException>(() => query.Read(bob, bob.Id, 30, true, first.Continuation, CancellationToken.None));
        Assert.Throws<ArgumentException>(() => Read(7, cursor: first.Continuation));
        bob.SetPermission(PermissionKind.IsAdministrator, true); alice.SetPermission(PermissionKind.IsDisabled, true);
        Assert.Empty(query.Read(bob, null, 30, true, null, CancellationToken.None).Items);
    }
    [Fact]
    public async Task OversizedSeriesIsOmittedWithoutStarvingOtherCandidates()
    {
        AddSeries(1001); var movie = AddMovie(); await Populate(slices: 70);
        Assert.Contains(Read().Items, i => i.ItemId == movie.Id); Assert.Contains("EpisodeLimit", Read().Coverage.Causes);
    }
    [Fact]
    public async Task CancellationLeavesResumableWork()
    {
        AddMovie(); using var cancelled = new CancellationTokenSource(); await cancelled.CancelAsync();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => worker.RunSlice(cancelled.Token));
        await Populate(); Assert.Single(Read().Items);
    }
    [Fact]
    public void CorruptionIsPreservedAndTemporaryFilesAreNotAdopted()
    {
        Directory.CreateDirectory(path); File.WriteAllText(Path.Combine(path, "activity-index.json"), "broken");
        File.WriteAllText(Path.Combine(path, "activity-index.json.tmp-dead"), "unfinished");
        Assert.Empty(store.Read().Rows); Assert.True(store.RecoveredCorruption);
        Assert.Equal("broken", File.ReadAllText(Directory.GetFiles(path, "*.corrupt-*").Single()));
        store.Write(new(1, [], [], [])); Assert.Empty(store.Read().Rows);
        Assert.Equal("unfinished", File.ReadAllText(Path.Combine(path, "activity-index.json.tmp-dead")));
    }
    [Fact]
    public async Task RepeatedManualPlaybackEventsAreDebouncedAndDoNotPersistPlaying()
    {
        var movie=AddMovie(); await worker.StartAsync(CancellationToken.None);
        try {
            await Populate();
            playback[(alice.Id,movie.Id)].Played=false; playback[(alice.Id,movie.Id)].PlaybackPositionTicks=0;
            for(var n=0;n<30;n++) data.Raise(d=>d.UserDataSaved+=null,new UserDataSaveEventArgs {UserId=alice.Id,Item=movie});
            Assert.Empty(Read().Items); Assert.Equal(1,worker.Status().Pending);
            clock.Advance(TimeSpan.FromSeconds(3)); await Populate(); Assert.Empty(Read().Items);
            Assert.DoesNotContain(store.Read().Rows.SelectMany(r=>r.Activity.Reasons),r=>r=="CurrentlyPlaying");
        } finally { await worker.StopAsync(CancellationToken.None); }
    }
    [Fact]
    public async Task ChangeDuringCalculationDiscardsOlderResult()
    {
        var movie=AddMovie(); await worker.StartAsync(CancellationToken.None);
        var once=false;
        data.Setup(d=>d.GetUserDataBatch(It.IsAny<IReadOnlyList<BaseItem>>(),It.IsAny<User>())).Returns((IReadOnlyList<BaseItem> list,User u)=> {
            if(!once) {once=true;data.Raise(d=>d.UserDataSaved+=null,new UserDataSaveEventArgs {UserId=alice.Id,Item=movie});}
            return list.ToDictionary(i=>i.Id,i=>new UserItemData {Key="test",Played=true,LastPlayedDate=DateTime.UtcNow});
        });
        try { for(var n=0;n<4 && !once;n++) await worker.RunSlice(CancellationToken.None);
            Assert.True(once); Assert.Empty(Read().Items);
            Assert.True(worker.Status().StaleResultsDiscarded>0);
            Assert.Equal(0, Read().Freshness.StaleResultsDiscarded); // Aggregate worker counters are administrator-only.
            clock.Advance(TimeSpan.FromSeconds(3)); await Populate(); Assert.Single(Read().Items);
        } finally { await worker.StopAsync(CancellationToken.None); }
    }
    [Fact]
    public async Task LibraryAndLocalMidnightInvalidateBeforeDisclosure()
    {
        AddSeries(); await Populate(); Assert.Single(Read().Items);
        worker.InvalidateLibrary(); Assert.Empty(Read().Items); await Populate(); Assert.Single(Read().Items);
        clock.Advance(TimeSpan.FromDays(1)); Assert.Empty(Read().Items);
        await Populate(); Assert.Single(Read().Items);
    }
    [Fact]
    public async Task MissingNativePlaybackIsNotPublishedAsVerifiedZeroInterest()
    {
        AddMovie(); data.Setup(d=>d.GetUserDataBatch(It.IsAny<IReadOnlyList<BaseItem>>(),It.IsAny<User>())).Returns(new Dictionary<Guid,UserItemData>());
        await Populate(); Assert.Empty(Read().Items); Assert.Contains("NativeLookupFailure",Read().Coverage.Causes);
    }
    [Fact]
    public async Task IndexApiRejectsAnonymousApiKeysDisabledAndCrossUserCallers()
    {
        var auth=new Mock<MediaBrowser.Controller.Net.IAuthorizationContext>();
        var controller=new IndexController(auth.Object,users.Object,query,worker) {ControllerContext=new(){HttpContext=new Microsoft.AspNetCore.Http.DefaultHttpContext()}};
        auth.Setup(a=>a.GetAuthorizationInfo(It.IsAny<Microsoft.AspNetCore.Http.HttpContext>())).ReturnsAsync(new MediaBrowser.Controller.Net.AuthorizationInfo());
        Assert.IsType<Microsoft.AspNetCore.Mvc.UnauthorizedResult>(await controller.Get());
        auth.Setup(a=>a.GetAuthorizationInfo(It.IsAny<Microsoft.AspNetCore.Http.HttpContext>())).ReturnsAsync(new MediaBrowser.Controller.Net.AuthorizationInfo {User=alice,IsAuthenticated=true,IsApiKey=true});
        Assert.IsType<Microsoft.AspNetCore.Mvc.UnauthorizedResult>(await controller.Get());
        auth.Setup(a=>a.GetAuthorizationInfo(It.IsAny<Microsoft.AspNetCore.Http.HttpContext>())).ReturnsAsync(new MediaBrowser.Controller.Net.AuthorizationInfo {User=alice,IsAuthenticated=true});
        Assert.IsType<Microsoft.AspNetCore.Mvc.ForbidResult>(await controller.Get("all"));
        Assert.IsType<Microsoft.AspNetCore.Mvc.ForbidResult>(await controller.Get(bob.Id.ToString()));
        Assert.IsType<Microsoft.AspNetCore.Mvc.OkObjectResult>(await controller.Get());
        Assert.IsType<Microsoft.AspNetCore.Mvc.BadRequestObjectResult>(await controller.Get(days:8));
        alice.SetPermission(PermissionKind.IsDisabled,true);
        Assert.IsType<Microsoft.AspNetCore.Mvc.UnauthorizedResult>(await controller.Get());
    }
    [Fact]
    public async Task ReconciliationRepairsMissedUnplayedEventAndRemovedItem()
    {
        var movie=AddMovie(); await Populate(); Assert.Single(Read().Items);
        playback[(alice.Id,movie.Id)].Played=false; // Simulate missed event, not a new history entry.
        clock.Advance(TimeSpan.FromHours(7)); await Populate(); Assert.Empty(Read().Items);
        items.Remove(movie.Id);worker.RequestRefresh(alice.Id);await Populate();
        Assert.Empty(worker.Snapshot().Rows);
    }
    [Fact]
    public void FailedAtomicCheckpointRetainsPreviousDocument()
    {
        store.Write(new(1,[],[],[]));var before=File.ReadAllBytes(Path.Combine(path,"activity-index.json"));
        Assert.Throws<InvalidDataException>(()=>store.Write(new(2,[],[],[])));
        Assert.Equal(before,File.ReadAllBytes(Path.Combine(path,"activity-index.json")));
        File.WriteAllText(Path.Combine(path,"activity-index.json"),"{\"Version\":1,\"Rows\":null,\"Positions\":[],\"Pending\":[]}");
        Assert.Empty(store.Read().Rows);Assert.True(store.RecoveredCorruption);
    }
    [Fact]
    public async Task AlternateMoviePlaybackInvalidatesPrimaryTitle()
    {
        var primary=AddMovie();var alternate=new Movie {Id=Guid.NewGuid(),Name="Alternate",PrimaryVersionId=primary.Id};items.Add(alternate.Id,alternate);
        await worker.StartAsync(CancellationToken.None);
        try {await Populate();Assert.Single(Read().Items);
            playback[(alice.Id,primary.Id)].Played=false;playback[(alice.Id,primary.Id)].PlaybackPositionTicks=1000;
            data.Raise(d=>d.UserDataSaved+=null,new UserDataSaveEventArgs {UserId=alice.Id,Item=alternate});
            Assert.Empty(Read().Items);clock.Advance(TimeSpan.FromSeconds(3));await Populate();
            Assert.Equal(["InProgress"],Read().Items.Single().Users.Single().Reasons);
        } finally {await worker.StopAsync(CancellationToken.None);}
    }
    [Fact]
    public void CorruptionBetweenCheckpointsIsPreservedAndRecoveryFilesAreBounded()
    {
        store.Write(new(1,[],[],[]));
        for(var n=0;n<5;n++) { File.WriteAllText(Path.Combine(path,"activity-index.json"),"damaged-"+n); store.Write(new(1,[],[],[])); }
        Assert.Equal(5,Directory.GetFiles(path,"*.replaced-*").Length);
        File.WriteAllText(Path.Combine(path,"activity-index.json"),"sixth");
        Assert.Throws<IOException>(()=>store.Write(new(1,[],[],[])));
        Assert.Equal("sixth",File.ReadAllText(Path.Combine(path,"activity-index.json")));
    }
    [Fact]
    public async Task PaginationExpiryAndPermissionRevocationRejectSavedCursor()
    {
        for(var n=0;n<30;n++)AddMovie();await Populate();
        var first=Read();Assert.NotNull(first.Continuation);clock.Advance(TimeSpan.FromMinutes(3));
        Assert.Throws<ArgumentException>(()=>Read(cursor:first.Continuation));
        alice.SetPermission(PermissionKind.IsAdministrator,true);
        first=query.Read(alice,null,30,true,null,CancellationToken.None);
        alice.SetPermission(PermissionKind.IsAdministrator,false);
        Assert.Throws<UnauthorizedAccessException>(()=>query.Read(alice,null,30,true,first.Continuation,CancellationToken.None));
    }
    [Fact]
    public void OversizeInterruptedSerializationPreservesPriorCheckpoint()
    {
        store.Write(new(1,[],[],[]));var before=File.ReadAllBytes(Path.Combine(path,"activity-index.json"));
        var longName=new string('x',1024*1024);
        var records=Enumerable.Range(0,35).Select(_=>{
            var key=new IndexKey(alice.Id,Guid.NewGuid());var episode=Guid.NewGuid();
            var activity=new OverviewUser(alice.Id,"",["CaughtUp"],DateTime.UtcNow) {EpisodeProgress=new(0,0,[new(episode,1,1,null,longName,null,"UnknownDate",false)])};
            return new IndexRow(key,activity,[episode],true,false,null,DateTimeOffset.UtcNow);
        }).ToArray();
        Assert.Throws<InvalidDataException>(()=>store.Write(new(1,records,[],[])));
        Assert.Equal(before,File.ReadAllBytes(Path.Combine(path,"activity-index.json")));
        Assert.False(File.Exists(Path.Combine(path,"activity-index.json.tmp")));
    }
    [Fact]
    public async Task PolicyChangeSuppressesCountsEvenWhenPrimaryEpisodeIdsAreIdentical()
    {
        AddSeries();await Populate();Assert.Single(Read().Items);
        users.Setup(u=>u.GetUserDto(It.IsAny<User>(),It.IsAny<string?>())).Returns(new MediaBrowser.Model.Dto.UserDto {Policy=new(){BlockedTags=["alternate-version-only"]},Configuration=new()});
        var result=Read();Assert.Empty(result.Items);Assert.Contains("PolicyChanged",result.Coverage.Causes);
        clock.Advance(TimeSpan.FromSeconds(3));await Populate();Assert.Single(Read().Items);
    }
    [Fact]
    public async Task ConcurrentSlicesUseOneNativeWorker()
    {
        for(var n=0;n<24;n++)AddMovie();var active=0;var maximum=0;
        data.Setup(d=>d.GetUserDataBatch(It.IsAny<IReadOnlyList<BaseItem>>(),It.IsAny<User>())).Returns((IReadOnlyList<BaseItem> list,User u)=>{
            var count=Interlocked.Increment(ref active);maximum=Math.Max(maximum,count);
            try{return list.ToDictionary(i=>i.Id,i=>playback.GetValueOrDefault((u.Id,i.Id))??new UserItemData{Key="test"});}
            finally{Interlocked.Decrement(ref active);}
        });
        await Task.WhenAll(Enumerable.Range(0,20).Select(_=>worker.RunSlice(CancellationToken.None)));
        Assert.Equal(1,maximum);Assert.Equal(24,worker.Snapshot().Rows.Length);
    }
    private BrowserQuery Browser() => new(worker, new WatchlistStore(path, clock), library.Object, users.Object, sessions.Object, clock);
    private BrowserOptions Options(string statuses = "watchlisted,watching,playing,watched", string sort = "title", string search = "", Guid? owner = null) =>
        BrowserOptions.Create(owner ?? alice.Id, 30, true, statuses, sort, search);
    private static List<OverviewItem> All(BrowserQuery browser, User caller, BrowserOptions options, out int pages)
    {
        var result = new Dictionary<Guid, OverviewItem>(); string? cursor = null; pages = 0;
        do
        {
            var page = browser.Read(caller, options, cursor, CancellationToken.None);
            Assert.InRange(page.ReadDiagnostics.EpisodeRows, 0, 20000);
            Assert.InRange(page.ReadDiagnostics.CandidatesExamined, 0, 501);
            if (page.Preparing) Assert.Empty(page.Items);
            foreach (var item in page.Items)
            {
                if (result.TryGetValue(item.ItemId, out var prior))
                {
                    Assert.Empty(prior.Users.Select(u => u.UserId).Intersect(item.Users.Select(u => u.UserId)));
                    result[item.ItemId] = prior with { Users = prior.Users.Concat(item.Users).ToArray() };
                }
                else result[item.ItemId] = item;
            }
            cursor = page.Continuation; Assert.True(++pages < 100);
        } while (cursor != null);
        return result.Values.ToList();
    }
    [Fact]
    public async Task BrowserFiltersBeforePagesAndSearchesLaterTitleWithoutPlaybackReads()
    {
        for (var n = 0; n < 70; n++) AddMovie();
        var target = AddMovie(); target.Name = "Zebra unique";
        playback[(alice.Id, target.Id)].Played = false; playback[(alice.Id, target.Id)].PlaybackPositionTicks = 10000;
        await Populate(); var browser = Browser(); var reads = playbackReads;
        var page = browser.Read(alice, Options("watching"), null, CancellationToken.None);
        Assert.Equal(target.Id, Assert.Single(page.Items).ItemId); Assert.Null(page.Continuation);
        page = browser.Read(alice, Options(search: " UNIQUE "), null, CancellationToken.None);
        Assert.Equal(target.Id, Assert.Single(page.Items).ItemId); Assert.Equal(reads, playbackReads);
        Assert.Empty(browser.Read(alice, Options("none"), null, CancellationToken.None).Items);
    }
    [Theory]
    [InlineData("title")]
    [InlineData("recent")]
    [InlineData("added")]
    public async Task BrowserOrdersEntireQueryAndKeepsUnknownDatesLast(string sort)
    {
        var membership = new WatchlistStore(path, clock);
        for (var n = 0; n < 60; n++)
        {
            var movie = AddMovie(n % 20 + 1); movie.Name = (n % 2 == 0 ? "alpha " : "Beta ") + (60 - n);
            if (n % 3 == 0) { membership.Set(alice.Id, movie.Id, true); clock.Advance(TimeSpan.FromSeconds(1)); }
        }
        await Populate(); var browser = Browser();
        var all = All(browser, alice, Options(sort: sort), out var pages);
        Assert.True(pages >= 3); Assert.Equal(60, all.Count);
        Assert.Equal(BrowserQuery.Sort(all, sort).Select(i => i.ItemId), all.Select(i => i.ItemId));
        if (sort == "added") { Assert.NotNull(all[0].Users[0].AddedAtUtc); Assert.Null(all[^1].Users[0].AddedAtUtc); }
    }
    [Fact]
    public async Task BrowserMembershipIsIndependentAndMergesProgressWithoutInventingMembership()
    {
        var series = AddSeries(); var old = AddMovie(70); var member = new WatchlistStore(path, clock);
        member.Set(alice.Id, old.Id, true); member.Set(alice.Id, series.Id, true);
        await Populate(); var browser = Browser();
        var result = All(browser, alice, Options(), out _);
        var merged = Assert.Single(result, i => i.ItemId == series.Id).Users.Single();
        Assert.Contains("Watchlisted", merged.Reasons); Assert.Contains("CaughtUp", merged.Reasons); Assert.NotNull(merged.EpisodeProgress);
        var explicitOnly = result.Single(i => i.ItemId == old.Id).Users.Single();
        Assert.Equal(["Watchlisted"], explicitOnly.Reasons); Assert.Equal(playback[(alice.Id, old.Id)].LastPlayedDate, explicitOnly.LastPlayedDate);
        Assert.Equal(2, member.Read().Length);
    }
    [Fact]
    public async Task BrowserAggregatesOnlySelectedAuthorizedOwnersAndStatuses()
    {
        alice.SetPermission(PermissionKind.IsAdministrator, true);
        var a = AddMovie(10); a.Name = "A"; var b = AddMovie(5); b.Name = "B";
        playback[(bob.Id, a.Id)] = new() { Key = "test", Played = false, PlaybackPositionTicks = 1000, LastPlayedDate = DateTime.UtcNow };
        await Populate(); var browser = Browser();
        var all = BrowserOptions.Create(null, 30, true, "watched", "recent", "");
        Assert.Equal(b.Id, browser.Read(alice, all, null, CancellationToken.None).Items[0].ItemId);
        all = all with { Statuses = "watched,watching" };
        Assert.Equal(a.Id, browser.Read(alice, all, null, CancellationToken.None).Items[0].ItemId);
        hidden.Add((bob.Id, a.Id));
        var page = browser.Read(alice, all, null, CancellationToken.None);
        Assert.Equal(b.Id, page.Items[0].ItemId); Assert.All(page.Items.SelectMany(i => i.Users), u => Assert.Equal(alice.Id, u.UserId));
    }
    [Fact]
    public async Task BrowserCursorBindsEveryControlCallerAndExpires()
    {
        for (var n = 0; n < 35; n++) AddMovie(); await Populate(); var browser = Browser(); var options = Options();
        var first = browser.Read(alice, options, null, CancellationToken.None);
        foreach (var changed in new[] { options with { Sort = "recent" }, options with { Search = "a" }, options with { Statuses = "watched" }, options with { Older = false }, options with { Days = 7 } })
            Assert.Throws<BrowserViewExpiredException>(() => browser.Read(alice, changed, first.Continuation, CancellationToken.None));
        Assert.Throws<BrowserViewExpiredException>(() => browser.Read(bob, options with { Owner = bob.Id }, first.Continuation, CancellationToken.None));
        clock.Advance(TimeSpan.FromMinutes(6));
        Assert.Throws<BrowserViewExpiredException>(() => browser.Read(alice, options, first.Continuation, CancellationToken.None));
    }
    [Fact]
    public async Task BrowserReauthorizesItemsEpisodesAndPoliciesBeforeDisclosure()
    {
        for (var n = 0; n < 30; n++) AddMovie(); var series = AddSeries(); series.Name = "ZZZ";
        await Populate(); var browser = Browser(); var options = Options();
        var page = browser.Read(alice, options, null, CancellationToken.None);
        var episode = items.Values.OfType<Episode>().First(); hidden.Add((alice.Id, episode.Id));
        Assert.Throws<BrowserViewExpiredException>(() => browser.Read(alice, options, page.Continuation, CancellationToken.None));
        hidden.Clear(); await Populate(); page = browser.Read(alice, options, null, CancellationToken.None);
        users.Setup(u => u.GetUserDto(It.IsAny<User>(), It.IsAny<string?>())).Returns(new MediaBrowser.Model.Dto.UserDto { Policy = new() { BlockedTags = ["new restriction"] }, Configuration = new() });
        Assert.Throws<BrowserViewExpiredException>(() => browser.Read(alice, options, page.Continuation, CancellationToken.None));
    }
    [Fact]
    public async Task BrowserPreparationAndOwnerContinuationProgressUnderEpisodeBudget()
    {
        var owners = Enumerable.Range(0, 25).Select(n => new User("Owner" + n, "test", "test") { Id = Guid.NewGuid() }).ToArray();
        bob.SetPermission(PermissionKind.IsAdministrator, true); var accounts = owners.Append(bob).ToArray();
        users.Setup(u => u.GetUsers()).Returns(accounts);
        users.Setup(u => u.GetUserById(It.IsAny<Guid>())).Returns((Guid id) => accounts.SingleOrDefault(u => u.Id == id));
        var title = AddSeries(1000); playback.Clear(); var episode = items.Values.OfType<Episode>().First();
        foreach (var owner in owners) playback[(owner.Id, episode.Id)] = new() { Key = "test", Played = true, LastPlayedDate = DateTime.UtcNow.AddDays(-1) };
        await Populate(slices: 100);
        var result = All(Browser(), bob, BrowserOptions.Create(null, 30, true, "watching", "recent", ""), out var pages);
        Assert.True(pages > 1); Assert.Equal(25, Assert.Single(result).Users.Length);
    }

    [Fact]
    public async Task BrowserCombinesLiveMembershipAndThreeOfThreeExtrasByStableOwner()
    {
        var series = AddSeries(); var episode = items.Values.OfType<Episode>().First();
        var extra = new AvailableEpisode { Id = Guid.NewGuid(), SeriesId = series.Id, Name = "Extra", PremiereDate = DateTime.Now.Date.AddDays(1) };
        items.Add(extra.Id, extra); new WatchlistStore(path, clock).Set(alice.Id, series.Id, true); await Populate();
        sessions.Setup(s => s.Sessions).Returns([new SessionInfo(sessions.Object, NullLogger.Instance)
            { UserId = alice.Id, NowPlayingItem = new MediaBrowser.Model.Dto.BaseItemDto { Id = episode.Id } }]);
        var browser = Browser(); var page = browser.Read(alice, Options(), null, CancellationToken.None);
        var person = Assert.Single(Assert.Single(page.Items).Users);
        Assert.Equal(new[] { "CaughtUp", "CurrentlyPlaying", "Watchlisted" }, person.Reasons.Order());
        Assert.Equal(3, person.EpisodeProgress!.AiredAvailable); Assert.Equal(3, person.EpisodeProgress.AiredWatched);
        Assert.Equal(extra.Id, Assert.Single(person.EpisodeProgress.ExtraEpisodes).ItemId);
        hidden.Add((alice.Id, episode.Id));
        page = browser.Read(alice, Options(), null, CancellationToken.None);
        Assert.Equal(["Watchlisted"], Assert.Single(Assert.Single(page.Items).Users).Reasons);
        Assert.Equal(0, page.ReadDiagnostics.EpisodeRows); // Hidden episode counts never reach diagnostics.
    }
    [Fact]
    public async Task BrowserLegacyMembershipDateStaysUnknownAndHiddenTitlesDoNotEnterWorkCounts()
    {
        var legacy = AddMovie(); var known = AddMovie(); await Populate();
        Directory.CreateDirectory(path);
        await File.WriteAllTextAsync(Path.Combine(path, "watchlists.json"), System.Text.Json.JsonSerializer.Serialize(new WatchlistDocument(1, [new(alice.Id, legacy.Id)])));
        new WatchlistStore(path, clock).Set(alice.Id, known.Id, true);
        var browser = Browser(); var page = browser.Read(alice, Options("watchlisted", "added"), null, CancellationToken.None);
        Assert.Equal(known.Id, page.Items[0].ItemId); Assert.Null(page.Items[1].Users[0].AddedAtUtc);
        hidden.Add((alice.Id, legacy.Id)); hidden.Add((alice.Id, known.Id));
        page = browser.Read(alice, Options(), null, CancellationToken.None);
        Assert.Empty(page.Items); Assert.Equal(0, page.ReadDiagnostics.CandidatesExamined); Assert.Empty(page.Coverage.Causes);
    }

    [Fact]
    public async Task SelectiveBrowserQuerySkipsUnmatchedOwnerWorkBeforeItsBudget()
    {
        var owners = Enumerable.Range(0, 6).Select(n => new User("Owner" + n, "test", "test") { Id = Guid.NewGuid() }).ToArray();
        bob.SetPermission(PermissionKind.IsAdministrator, true); var accounts = owners.Append(bob).ToArray();
        users.Setup(u => u.GetUsers()).Returns(accounts);
        users.Setup(u => u.GetUserById(It.IsAny<Guid>())).Returns((Guid id) => accounts.SingleOrDefault(u => u.Id == id));
        Movie? target = null;
        for (var n = 0; n < 120; n++)
        {
            var movie = AddMovie(); target = movie;
            foreach (var owner in owners) playback[(owner.Id, movie.Id)] = new() { Key = "test", Played = true, LastPlayedDate = DateTime.UtcNow.AddDays(-1) };
        }
        target!.Name = "Zebra needle";
        new WatchlistStore(path, clock).Set(owners[0].Id, target.Id, true);
        await Populate(slices: 200); var browser = Browser();
        foreach (var options in new[] { BrowserOptions.Create(null, 30, true, "watchlisted", "title", ""), BrowserOptions.Create(null, 30, true, "watched", "title", "needle") })
        {
            var page = browser.Read(bob, options, null, CancellationToken.None);
            Assert.False(page.Preparing); Assert.Null(page.Continuation); Assert.Equal(target.Id, Assert.Single(page.Items).ItemId);
        }
    }

    private sealed class TestClock : TimeProvider {
        private DateTimeOffset now=DateTimeOffset.UtcNow;
        public override DateTimeOffset GetUtcNow()=>now;
        public override TimeZoneInfo LocalTimeZone=>TimeZoneInfo.Local;
        public void Advance(TimeSpan delta)=>now+=delta;
    }
    private sealed class AvailableEpisode : Episode { public override MediaBrowser.Model.Entities.LocationType LocationType => MediaBrowser.Model.Entities.LocationType.FileSystem; }
    public void Dispose() { worker.Dispose(); if (Directory.Exists(path)) Directory.Delete(path, true); }
}
