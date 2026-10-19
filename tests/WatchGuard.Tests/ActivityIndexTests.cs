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
    private sealed class TestClock : TimeProvider {
        private DateTimeOffset now=DateTimeOffset.UtcNow;
        public override DateTimeOffset GetUtcNow()=>now;
        public override TimeZoneInfo LocalTimeZone=>TimeZoneInfo.Local;
        public void Advance(TimeSpan delta)=>now+=delta;
    }
    private sealed class AvailableEpisode : Episode { public override MediaBrowser.Model.Entities.LocationType LocationType => MediaBrowser.Model.Entities.LocationType.FileSystem; }
    public void Dispose() { worker.Dispose(); if (Directory.Exists(path)) Directory.Delete(path, true); }
}
