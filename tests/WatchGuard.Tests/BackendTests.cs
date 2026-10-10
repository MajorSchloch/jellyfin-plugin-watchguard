using Jellyfin.Data;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Database.Implementations.Enums;
using Jellyfin.Plugin.WatchGuard;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Movies;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Net;
using MediaBrowser.Controller.Session;
using MediaBrowser.Model.Dto;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Xunit;

namespace WatchGuard.Tests;

public sealed class BackendTests : IDisposable
{
    private readonly string directory = Path.Combine(Path.GetTempPath(), "watchguard-test-" + Guid.NewGuid());
    private readonly Mock<ILibraryManager> library = new();
    private readonly Mock<IUserManager> users = new();
    private readonly Mock<IUserDataManager> data = new();
    private readonly Mock<ISessionManager> sessions = new();
    private readonly Mock<IAuthorizationContext> auth = new();
    private readonly User alice = new("Alice", "test", "test") { Id = Guid.NewGuid() };
    private readonly User bob = new("Bob", "test", "test") { Id = Guid.NewGuid() };
    private readonly Movie movie = new() { Id = Guid.NewGuid(), Name = "Movie" };
    private readonly WatchlistStore store;
    private readonly InterestService service;
    private readonly Dictionary<(Guid User, Guid Item), UserItemData> states = new();

    public BackendTests()
    {
        store = new(directory);
        service = new(store, library.Object, users.Object, data.Object, sessions.Object);
        users.Setup(u => u.GetUsers()).Returns([alice, bob]);
        users.Setup(u => u.GetUserById(alice.Id)).Returns(alice);
        users.Setup(u => u.GetUserById(bob.Id)).Returns(bob);
        library.Setup(l => l.GetItemById<BaseItem>(movie.Id, It.IsAny<User>())).Returns(movie);
        data.Setup(d => d.GetUserDataBatch(It.IsAny<IReadOnlyList<BaseItem>>(), It.IsAny<User>()))
            .Returns((IReadOnlyList<BaseItem> items, User user) => items.ToDictionary(i => i.Id,
                i => states.GetValueOrDefault((user.Id, i.Id)) ?? new UserItemData { Key = "test" }));
        data.Setup(d => d.GetResumeUserDataBatch(It.IsAny<IReadOnlyList<BaseItem>>(), It.IsAny<User>()))
            .Returns(new Dictionary<Guid, VersionResumeData>());
        sessions.Setup(s => s.Sessions).Returns(Array.Empty<SessionInfo>());
        SignIn(alice);
    }

    private void SignIn(User? user, bool apiKey = false) => auth.Setup(a => a.GetAuthorizationInfo(It.IsAny<HttpContext>()))
        .ReturnsAsync(new AuthorizationInfo { User = user, IsAuthenticated = user is not null, IsApiKey = apiKey });
    private WatchGuardController Controller() => new(auth.Object, users.Object, library.Object, store, service,
        NullLogger<WatchGuardController>.Instance) { ControllerContext = new() { HttpContext = new DefaultHttpContext() } };
    private ProtectionStatus Status(BaseItem? item = null) => service.Get(item ?? movie, alice.Id);
    public void Dispose() { if (Directory.Exists(directory)) Directory.Delete(directory, true); }

    [Fact]
    public async Task CrudIsIdempotentAndIsolated()
    {
        var controller = Controller();
        Assert.IsType<NoContentResult>(await controller.Add(movie.Id));
        await controller.Add(movie.Id);
        Assert.Single(store.Read());
        SignIn(bob);
        Assert.Empty(Assert.IsAssignableFrom<IEnumerable<object>>(Assert.IsType<OkObjectResult>(await controller.List()).Value));
        await controller.Remove(movie.Id);
        Assert.Single(store.Read());
        SignIn(alice);
        Assert.Single(Assert.IsAssignableFrom<IEnumerable<object>>(Assert.IsType<OkObjectResult>(await controller.List()).Value));
        await controller.Remove(movie.Id);
        await controller.Remove(movie.Id);
        Assert.Empty(store.Read());
    }

    [Fact]
    public async Task ConcurrentWritesSurviveReload()
    {
        var ids = Enumerable.Range(0, 100).Select(_ => Guid.NewGuid()).ToArray();
        await Task.WhenAll(ids.Select(id => Task.Run(() => store.Set(alice.Id, id, true))));
        Assert.Equal(100, new WatchlistStore(directory).Read().Length);
        await Task.WhenAll(ids.Select(id => Task.Run(() => store.Set(alice.Id, id, false))));
        Assert.Empty(store.Read());
    }

    [Theory]
    [InlineData("{broken")]
    [InlineData("{\"Version\":2,\"Entries\":[]}")]
    [InlineData("{\"Version\":1,\"Entries\":[{}]}")]
    [InlineData("{\"Version\":1,\"Entries\":null}")]
    public async Task CorruptionFailsClosedUntilExplicitRestoration(string corrupt)
    {
        store.Set(alice.Id, movie.Id, true);
        var path = Path.Combine(directory, "watchlists.json");
        var good = await File.ReadAllTextAsync(path);
        await File.WriteAllTextAsync(path, corrupt);
        Assert.ThrowsAny<Exception>(() => store.Read());
        Assert.ThrowsAny<Exception>(() => store.Set(bob.Id, movie.Id, true));
        Assert.Equal(corrupt, await File.ReadAllTextAsync(path));
        Assert.Equal(503, Assert.IsType<ObjectResult>(await Controller().List()).StatusCode);
        await File.WriteAllTextAsync(path, good);
        Assert.Single(store.Read());
    }

    [Theory]
    [InlineData(false, 0, false)]
    [InlineData(false, 100, true)]
    [InlineData(true, 0, false)]
    [InlineData(true, 100, false)]
    public void MovieState(bool played, long position, bool interested)
    {
        states[(bob.Id, movie.Id)] = new() { Key = "test", Played = played, PlaybackPositionTicks = position };
        Assert.Equal(interested, Status().HasOtherInterestedUsers);
    }

    [Fact]
    public void CompletedWatchlistRemainsAndUsersAreDeduplicated()
    {
        store.Set(alice.Id, movie.Id, true);
        store.Set(bob.Id, movie.Id, true);
        states[(alice.Id, movie.Id)] = new() { Key = "test", Played = true };
        states[(bob.Id, movie.Id)] = new() { Key = "test", PlaybackPositionTicks = 123 };
        var result = Status();
        Assert.Equal(2, result.Users.Length);
        Assert.Equal(["Watchlisted", "InProgress"], result.Users.Single(u => u.UserId == bob.Id).Reasons);
        Assert.Equal("Alice", result.Users.Single(u => u.UserId == alice.Id).DisplayName);
        Assert.Equal(2, store.Read().Length);
    }

    [Theory]
    [InlineData(0, 0, false)]
    [InlineData(2, 0, false)]
    [InlineData(2, 1, true)]
    [InlineData(2, 2, false)]
    public void SeriesUsesOnlyAvailableEpisodes(int available, int completed, bool expected)
    {
        var series = new Series { Id = Guid.NewGuid() };
        var episodes = Enumerable.Range(0, available).Select(_ => (BaseItem)new Episode { Id = Guid.NewGuid() }).ToArray();
        library.Setup(l => l.GetItemById<BaseItem>(series.Id, It.IsAny<User>())).Returns(series);
        library.Setup(l => l.GetItemList(It.Is<InternalItemsQuery>(q => q.AncestorIds.Contains(series.Id)
            && q.IsVirtualItem == false && q.IsMissing == false && q.Recursive))).Returns(episodes);
        foreach (var ep in episodes.Take(completed)) states[(bob.Id, ep.Id)] = new() { Key = "test", Played = true };
        // Historical data for a removed episode must not start an empty/unstarted series.
        states[(bob.Id, Guid.NewGuid())] = new() { Key = "test", Played = true };
        Assert.Equal(expected, Status(series).HasInterest);
    }

    [Fact]
    public void StartedEpisodeAndActiveAdditionalSessionUserCount()
    {
        var series = new Series { Id = Guid.NewGuid() };
        var episode = new Episode { Id = Guid.NewGuid() };
        library.Setup(l => l.GetItemById<BaseItem>(series.Id, It.IsAny<User>())).Returns(series);
        library.Setup(l => l.GetItemList(It.IsAny<InternalItemsQuery>())).Returns([episode]);
        states[(bob.Id, episode.Id)] = new() { Key = "test", PlaybackPositionTicks = 123 };
        sessions.Setup(s => s.Sessions).Returns([new SessionInfo(sessions.Object, NullLogger.Instance)
        {
            UserId = alice.Id, AdditionalUsers = [new() { UserId = bob.Id }],
            NowPlayingItem = new BaseItemDto { Id = episode.Id }
        }]);
        var result = Status(series);
        Assert.Equal(["InProgress", "CurrentlyPlaying"], result.Users.Single(u => u.UserId == bob.Id).Reasons);
        Assert.Equal(["CurrentlyPlaying"], result.Users.Single(u => u.UserId == alice.Id).Reasons);
    }

    [Fact]
    public void InactiveSessionDoesNotCount()
    {
        var controller = new Mock<ISessionController>();
        controller.SetupGet(c => c.IsSessionActive).Returns(false);
        sessions.Setup(s => s.Sessions).Returns([new SessionInfo(sessions.Object, NullLogger.Instance)
        { UserId = bob.Id, NowPlayingItem = new BaseItemDto { Id = movie.Id }, SessionControllers = [controller.Object] }]);
        Assert.False(Status().HasInterest);
    }

    [Fact]
    public async Task AuthorizationAndMissingItems()
    {
        Assert.IsType<ForbidResult>(await Controller().Protection(movie.Id));
        alice.SetPermission(PermissionKind.IsAdministrator, true);
        Assert.IsType<OkObjectResult>(await Controller().Protection(movie.Id));
        Assert.IsType<NotFoundResult>(await Controller().Protection(Guid.NewGuid()));
        Assert.IsType<NotFoundResult>(await Controller().Add(Guid.NewGuid()));
        SignIn(alice, apiKey: true);
        Assert.IsType<UnauthorizedResult>(await Controller().List());
        SignIn(null);
        Assert.IsType<UnauthorizedResult>(await Controller().Add(movie.Id));
        Assert.IsType<UnauthorizedResult>(await Controller().Remove(movie.Id));
        Assert.IsType<UnauthorizedResult>(await Controller().Protection(movie.Id));
    }

    [Fact]
    public async Task MissingAndHiddenEntriesAreOmittedButCanBeRemoved()
    {
        store.Set(alice.Id, movie.Id, true);
        library.Setup(l => l.GetItemById<BaseItem>(movie.Id, alice)).Returns((BaseItem?)null);
        Assert.Empty(Assert.IsAssignableFrom<IEnumerable<object>>(Assert.IsType<OkObjectResult>(await Controller().List()).Value));
        Assert.False(Status().HasInterest);
        Assert.IsType<NotFoundResult>(await Controller().Add(movie.Id));
        await Controller().Remove(movie.Id);
        Assert.Empty(store.Read());
    }

    [Fact]
    public void DeletedAndDisabledUsersDoNotContribute()
    {
        store.Set(alice.Id, movie.Id, true);
        store.Set(bob.Id, movie.Id, true);
        users.Setup(u => u.GetUserById(bob.Id)).Returns((User?)null);
        alice.SetPermission(PermissionKind.IsDisabled, true);
        Assert.False(Status().HasInterest);
    }

    [Fact]
    public async Task LookupErrorsNeverBecomeZeroInterest()
    {
        alice.SetPermission(PermissionKind.IsAdministrator, true);
        data.Setup(d => d.GetUserDataBatch(It.IsAny<IReadOnlyList<BaseItem>>(), It.IsAny<User>()))
            .Returns(new Dictionary<Guid, UserItemData>());
        Assert.Equal(503, Assert.IsType<ObjectResult>(await Controller().Protection(movie.Id)).StatusCode);
        library.Setup(l => l.GetItemById<BaseItem>(movie.Id, alice)).Throws(new IOException("private information"));
        var error = Assert.IsType<ObjectResult>(await Controller().Protection(movie.Id));
        Assert.Equal(503, error.StatusCode);
        Assert.DoesNotContain("private information", Assert.IsType<ProblemDetails>(error.Value).Detail!, StringComparison.Ordinal);
    }

    [Fact]
    public void AlternateResumeAndCompletionAreNative()
    {
        var resume = new UserItemData { Key = "test", PlaybackPositionTicks = 123 };
        data.Setup(d => d.GetResumeUserDataBatch(It.IsAny<IReadOnlyList<BaseItem>>(), bob))
            .Returns(new Dictionary<Guid, VersionResumeData> { [movie.Id] = new(Guid.NewGuid(), resume) });
        Assert.True(Status().HasOtherInterestedUsers);
        resume.Played = true;
        Assert.False(Status().HasOtherInterestedUsers);
    }
    [Fact]
    public void MovieSessionAddsAThirdReasonAndAlternateMapsToPrimary()
    {
        store.Set(bob.Id, movie.Id, true);
        states[(bob.Id, movie.Id)] = new() { Key = "test", PlaybackPositionTicks = 123 };
        var alternate = new Movie { Id = Guid.NewGuid(), PrimaryVersionId = movie.Id };
        library.Setup(l => l.GetItemById<BaseItem>(alternate.Id, bob)).Returns(alternate);
        sessions.Setup(s => s.Sessions).Returns([new SessionInfo(sessions.Object, NullLogger.Instance)
        { UserId = bob.Id, NowPlayingItem = new BaseItemDto { Id = alternate.Id } }]);
        Assert.Equal(["Watchlisted", "InProgress", "CurrentlyPlaying"], Assert.Single(Status().Users).Reasons);
    }

    [Fact]
    public async Task DisabledAndDeletedCallersAreRejected()
    {
        alice.SetPermission(PermissionKind.IsDisabled, true);
        Assert.IsType<UnauthorizedResult>(await Controller().List());
        users.Setup(u => u.GetUserById(alice.Id)).Returns((User?)null);
        Assert.IsType<UnauthorizedResult>(await Controller().Add(movie.Id));
    }

    [Fact]
    public void FailedAtomicReplacementPreservesStoreAndCleansTemporaryFile()
    {
        // A directory at the destination makes replacement fail on every supported OS.
        Directory.CreateDirectory(Path.Combine(directory, "watchlists.json"));
        Assert.ThrowsAny<IOException>(() => store.Set(alice.Id, movie.Id, true));
        Assert.True(Directory.Exists(Path.Combine(directory, "watchlists.json")));
        Assert.Empty(Directory.GetFiles(directory, "*.tmp"));
    }

    [Fact]
    public void ReleaseMetadataAndDiagnosticDefault()
    {
        Assert.Equal(new Version(0, 1, 0, 0), typeof(Plugin).Assembly.GetName().Version);
        Assert.False(new Configuration().DiagnosticMode);
        Assert.Contains("Jellyfin.Plugin.WatchGuard.Web.watchguard.js", typeof(Plugin).Assembly.GetManifestResourceNames());
    }

}
