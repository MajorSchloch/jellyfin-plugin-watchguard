using Jellyfin.Data.Enums;
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
        library.Setup(l => l.GetItemList(It.IsAny<InternalItemsQuery>())).Returns(Array.Empty<BaseItem>());
        SignIn(alice);
    }

    private void SignIn(User? user, bool apiKey = false) => auth.Setup(a => a.GetAuthorizationInfo(It.IsAny<HttpContext>()))
        .ReturnsAsync(new AuthorizationInfo { User = user, IsAuthenticated = user is not null, IsApiKey = apiKey });
    private WatchGuardController Controller() => new(auth.Object, users.Object, library.Object, store, service,
        NullLogger<WatchGuardController>.Instance, new(store, library.Object, users.Object, sessions.Object, service)) { ControllerContext = new() { HttpContext = new DefaultHttpContext() } };
    private PreferencesController Preferences(PreferenceStore? preferences = null) => new(auth.Object, users.Object,
        preferences ?? new PreferenceStore(directory), new IntegrationStatus(), Mock.Of<MediaBrowser.Controller.IServerApplicationHost>(),
        NullLogger<PreferencesController>.Instance) { ControllerContext = new() { HttpContext = new DefaultHttpContext() } };

    [Fact]
    public async Task PreferencesArePersonalAndScopeIsAuthorized()
    {
        var c = Preferences();
        Assert.Equal("mine", Assert.IsType<ViewPreferences>(Assert.IsType<OkObjectResult>(await c.Get()).Value).Owner);
        Assert.IsType<ForbidResult>(await c.Put(new("all", ["watched"], "recent")));
        Assert.IsType<OkObjectResult>(await c.Put(new("mine", ["watched"], "recent")));
        SignIn(bob);
        Assert.Equal("title", Assert.IsType<ViewPreferences>(Assert.IsType<OkObjectResult>(await c.Get()).Value).Sort);
        Assert.IsType<ForbidResult>(await c.Status());
        SignIn(alice);
        Assert.Equal("recent", Assert.IsType<ViewPreferences>(Assert.IsType<OkObjectResult>(await c.Get()).Value).Sort);
        Assert.IsType<OkObjectResult>(await c.Reset());
        Assert.Equal("title", Assert.IsType<ViewPreferences>(Assert.IsType<OkObjectResult>(await c.Get()).Value).Sort);
        SignIn(null); Assert.IsType<UnauthorizedResult>(await c.Get());
        SignIn(alice, true); Assert.IsType<UnauthorizedResult>(await c.Put(ViewPreferences.Defaults));
    }
    [Fact]
    public async Task PreferencesRevalidateRemovedDisabledOwnersAndRevokedAdmin()
    {
        var c = Preferences(); alice.SetPermission(PermissionKind.IsAdministrator, true);
        Assert.IsType<OkObjectResult>(await c.Put(new(bob.Id.ToString(), [], "recent")));
        bob.SetPermission(PermissionKind.IsDisabled, true);
        Assert.Equal("mine", Assert.IsType<ViewPreferences>(Assert.IsType<OkObjectResult>(await c.Get()).Value).Owner);
        bob.SetPermission(PermissionKind.IsDisabled, false);
        users.Setup(u => u.GetUserById(bob.Id)).Returns((User?)null);
        Assert.Equal("mine", Assert.IsType<ViewPreferences>(Assert.IsType<OkObjectResult>(await c.Get()).Value).Owner);
        await c.Put(new("all", [], "recent")); alice.SetPermission(PermissionKind.IsAdministrator, false);
        Assert.Equal("mine", Assert.IsType<ViewPreferences>(Assert.IsType<OkObjectResult>(await c.Get()).Value).Owner);
        Assert.IsType<BadRequestObjectResult>(await c.Put(new("mine", ["invalid"], "recent")));
        Assert.IsType<BadRequestObjectResult>(await c.Put(new("mine", ["watched", "watched"], "title")));
        Assert.IsType<BadRequestObjectResult>(await c.Put(new("wrong", [], "wrong")));
    }
    [Fact]
    public void PreferenceWritesAreAtomicAndConcurrentAndSeparateFromMembership()
    {
        var preferences = new PreferenceStore(directory);
        var ids = Enumerable.Range(0, 30).Select(_ => Guid.NewGuid()).ToArray();
        store.Set(alice.Id, movie.Id, true);
        var before = File.ReadAllBytes(Path.Combine(directory, "watchlists.json"));
        Parallel.ForEach(ids, id => preferences.Set(id, new("mine", ["watching"], "recent")));
        Assert.All(ids, id => Assert.Equal("recent", new PreferenceStore(directory).Read(id).Sort));
        Assert.Equal(before, File.ReadAllBytes(Path.Combine(directory, "watchlists.json")));
        Assert.Empty(Directory.GetFiles(directory, "*.tmp"));
    }
    [Theory]
    [InlineData("not json")]
    [InlineData("{\"Version\":2,\"Entries\":[]}")]
    [InlineData("{\"Version\":1,\"Entries\":null}")]
    public async Task CorruptPreferencesCannotBeSilentlyOverwritten(string content)
    {
        Directory.CreateDirectory(directory); var path = Path.Combine(directory, "preferences.json"); await File.WriteAllTextAsync(path, content);
        var c = Preferences();
        Assert.Equal(503, Assert.IsType<ObjectResult>(await c.Get()).StatusCode);
        Assert.Equal(503, Assert.IsType<ObjectResult>(await c.Put(ViewPreferences.Defaults)).StatusCode);
        Assert.Equal(503, Assert.IsType<ObjectResult>(await c.Reset()).StatusCode);
        Assert.Equal(content, await File.ReadAllTextAsync(path));
    }
    [Fact]
    public void ExistingConfigurationXmlDefaultsAndRangesRemainCompatible()
    {
        var serializer = new System.Xml.Serialization.XmlSerializer(typeof(Configuration));
        using var input = new StringReader("<Configuration><DiagnosticMode>true</DiagnosticMode><ActivityWindowDays>999</ActivityWindowDays><ActivityLimit>0</ActivityLimit></Configuration>");
        var config = Assert.IsType<Configuration>(serializer.Deserialize(input));
        Assert.True(config.DiagnosticMode); Assert.Equal(90, config.ActivityWindowDays); Assert.Equal(1, config.ActivityLimit);
        using var legacy = new StringReader("<Configuration><DiagnosticMode>false</DiagnosticMode></Configuration>");
        var old = Assert.IsType<Configuration>(serializer.Deserialize(legacy));
        Assert.Equal(30, old.ActivityWindowDays); Assert.Equal(100, old.ActivityLimit);
    }
    [Fact]
    public void MissingOrIncompatibleInjectorIsNotSuccessfulRegistration()
    {
        var integration = new IntegrationStatus(); Assert.False(integration.Snapshot.RegistrationSucceeded);
        Assert.Null(IntegrationStatus.RegistrationMethod(null));
        Assert.Null(IntegrationStatus.RegistrationMethod(typeof(InvalidInjector)));
    }
    private static class InvalidInjector { public static bool RegisterScript(string payload) => true; }

    private ProtectionStatus Status(BaseItem? item = null) => service.Get(item ?? movie, alice.Id);
    [Fact]
    public async Task ScopedActivityAndMembershipRequireAdminAndKeepUserIsolation()
    {
        alice.SetPermission(PermissionKind.IsAdministrator, true);
        store.Set(alice.Id, movie.Id, true); store.Set(bob.Id, movie.Id, true);
        states[(bob.Id, movie.Id)] = new UserItemData { Key = "test", PlaybackPositionTicks = 10 };
        library.Setup(l => l.GetItemList(It.IsAny<InternalItemsQuery>())).Returns(new BaseItem[] { movie });
        var result = Assert.IsType<InterestOverview>(Assert.IsType<OkObjectResult>(await Controller().UserActivity(bob.Id)).Value);
        Assert.All(result.Items.SelectMany(i => i.Users), u => Assert.Equal(bob.Id, u.UserId));
        Assert.Single(result.Items);
        var lists = Assert.IsType<SharedWatchlistItem[]>(Assert.IsType<OkObjectResult>(await Controller().UserWatchlist(bob.Id)).Value);
        Assert.Equal(bob.Id, Assert.Single(Assert.Single(lists).Users).UserId);
        var missing = Assert.IsType<InterestOverview>(Assert.IsType<OkObjectResult>(await Controller().UserActivity(Guid.NewGuid())).Value);
        Assert.Empty(missing.Items);
        SignIn(bob);
        Assert.IsType<ForbidResult>(await Controller().UserActivity(alice.Id));
        Assert.IsType<ForbidResult>(await Controller().UserWatchlist(alice.Id));
        Assert.IsType<ForbidResult>(await Controller().OverviewUsers());
        var own = Assert.IsType<InterestOverview>(Assert.IsType<OkObjectResult>(await Controller().OwnActivity()).Value);
        Assert.All(own.Items.SelectMany(i => i.Users), u => Assert.Equal(bob.Id, u.UserId));
    }

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
        Assert.Equal(new Version(0, 3, 1, 0), typeof(Plugin).Assembly.GetName().Version);
        Assert.False(new Configuration().DiagnosticMode);
        Assert.Contains("Jellyfin.Plugin.WatchGuard.Web.watchguard.js", typeof(Plugin).Assembly.GetManifestResourceNames());
    }

    [Fact]
    public async Task SharedWatchlistsRequireCurrentAdministratorAndDoNotWrite()
    {
        store.Set(alice.Id, movie.Id, true);
        store.Set(bob.Id, movie.Id, true);
        Assert.IsType<ForbidResult>(await Controller().AllWatchlists());
        alice.SetPermission(PermissionKind.IsAdministrator, true);
        var item = Assert.Single(Assert.IsType<SharedWatchlistItem[]>(Assert.IsType<OkObjectResult>(await Controller().AllWatchlists()).Value));
        Assert.Equal(movie.Id, item.ItemId);
        Assert.Equal(new[] { "Alice", "Bob" }, item.Users.Select(u => u.DisplayName));
        Assert.Equal(2, store.Read().Length);
        alice.SetPermission(PermissionKind.IsAdministrator, false);
        Assert.IsType<ForbidResult>(await Controller().AllWatchlists());
        SignIn(alice, apiKey: true);
        Assert.IsType<UnauthorizedResult>(await Controller().AllWatchlists());
        SignIn(null);
        Assert.IsType<UnauthorizedResult>(await Controller().AllWatchlists());
    }

    [Fact]
    public async Task SharedWatchlistsOmitMissingHiddenDisabledAndDeletedEntries()
    {
        alice.SetPermission(PermissionKind.IsAdministrator, true);
        store.Set(bob.Id, movie.Id, true);
        store.Set(Guid.NewGuid(), movie.Id, true);
        store.Set(alice.Id, Guid.NewGuid(), true);
        async Task<SharedWatchlistItem[]> Read() => Assert.IsType<SharedWatchlistItem[]>(Assert.IsType<OkObjectResult>(await Controller().AllWatchlists()).Value);
        Assert.Single(Assert.Single(await Read()).Users);
        library.Setup(l => l.GetItemById<BaseItem>(movie.Id, bob)).Returns((BaseItem?)null);
        Assert.Empty(await Read());
        library.Setup(l => l.GetItemById<BaseItem>(movie.Id, bob)).Returns(movie);
        bob.SetPermission(PermissionKind.IsDisabled, true);
        Assert.Empty(await Read());
        bob.SetPermission(PermissionKind.IsDisabled, false);
        library.Setup(l => l.GetItemById<BaseItem>(movie.Id, alice)).Returns((BaseItem?)null);
        Assert.Empty(await Read());
        Assert.Equal(3, store.Read().Length);
    }

    [Fact]
    public async Task SharedWatchlistFailureNeverReturnsPartialResults()
    {
        alice.SetPermission(PermissionKind.IsAdministrator, true);
        store.Set(bob.Id, movie.Id, true);
        users.Setup(u => u.GetUserById(bob.Id)).Throws(new IOException("private"));
        Assert.Equal(503, Assert.IsType<ObjectResult>(await Controller().AllWatchlists()).StatusCode);
        await File.WriteAllTextAsync(Path.Combine(directory, "watchlists.json"), "corrupt");
        Assert.Equal(503, Assert.IsType<ObjectResult>(await Controller().AllWatchlists()).StatusCode);
    }

    private async Task<InterestOverview> Overview(bool own = false) => Assert.IsType<InterestOverview>(
        Assert.IsType<OkObjectResult>(await (own ? Controller().OwnOverview() : Controller().Overview())).Value);

    [Fact]
    public async Task OverviewFindsUnlistedPartialSeriesThroughNativePlayedCandidates()
    {
        alice.SetPermission(PermissionKind.IsAdministrator, true);
        var series = new Series { Id = Guid.NewGuid(), Name = "Started series" };
        var first = new Episode { Id = Guid.NewGuid(), SeriesId = series.Id };
        var next = new Episode { Id = Guid.NewGuid(), SeriesId = series.Id };
        foreach (var item in new BaseItem[] { series, first, next })
            library.Setup(l => l.GetItemById<BaseItem>(item.Id, It.IsAny<User>())).Returns(item);
        library.Setup(l => l.GetItemList(It.IsAny<InternalItemsQuery>())).Returns((InternalItemsQuery q) =>
            q.AncestorIds.Contains(series.Id) ? new BaseItem[] {first, next} : q.IsPlayed == true ? new BaseItem[] {first} : []);
        states[(bob.Id, first.Id)] = new() { Key = "test", Played = true, LastPlayedDate = new DateTime(2026, 10, 10, 0, 0, 0, DateTimeKind.Utc) };
        var overview = await Overview();
        var found = Assert.Single(overview.Items);
        Assert.Equal(series.Id, found.ItemId);
        Assert.Equal(new[] { "InProgress" }, Assert.Single(found.Users).Reasons);
        Assert.NotNull(found.Users[0].LastPlayedDate);
        Assert.False(overview.IsComplete);
        Assert.Empty(store.Read());
        Assert.True(Status(series).HasOtherInterestedUsers);
        states[(bob.Id, next.Id)] = new() { Key = "test", Played = true };
        Assert.Empty((await Overview()).Items);
    }

    [Fact]
    public async Task OverviewMergesExplicitResumeAndSessionCandidatesWithoutWriting()
    {
        alice.SetPermission(PermissionKind.IsAdministrator, true);
        store.Set(bob.Id, movie.Id, true);
        states[(bob.Id, movie.Id)] = new() { Key = "test", PlaybackPositionTicks = 200 };
        library.Setup(l => l.GetItemList(It.IsAny<InternalItemsQuery>())).Returns([movie]);
        sessions.Setup(s => s.Sessions).Returns([new SessionInfo(sessions.Object, NullLogger.Instance)
            { UserId = bob.Id, NowPlayingItem = new BaseItemDto { Id = movie.Id } }]);
        var owner = Assert.Single(Assert.Single((await Overview()).Items).Users);
        Assert.Equal(new[] { "Watchlisted", "InProgress", "CurrentlyPlaying" }, owner.Reasons);
        Assert.Single(store.Read());
        store.Set(bob.Id, movie.Id, false);
        Assert.Equal(new[] { "InProgress", "CurrentlyPlaying" }, Assert.Single(Assert.Single((await Overview()).Items).Users).Reasons);
        Assert.Empty(store.Read());
    }

    [Fact]
    public async Task OverviewAuthorizationOwnScopeAndDeletedUsers()
    {
        store.Set(alice.Id, movie.Id, true);
        store.Set(bob.Id, movie.Id, true);
        Assert.IsType<ForbidResult>(await Controller().Overview());
        Assert.Equal(alice.Id, Assert.Single(Assert.Single((await Overview(own: true)).Items).Users).UserId);
        alice.SetPermission(PermissionKind.IsAdministrator, true);
        users.Setup(u => u.GetUserById(bob.Id)).Returns((User?)null);
        Assert.Single(Assert.Single((await Overview()).Items).Users);
        library.Setup(l => l.GetItemById<BaseItem>(movie.Id, alice)).Returns((BaseItem?)null);
        Assert.Empty((await Overview()).Items);
        SignIn(null);
        Assert.IsType<UnauthorizedResult>(await Controller().Overview());
        Assert.IsType<UnauthorizedResult>(await Controller().OwnOverview());
    }

    [Fact]
    public async Task OverviewMarksDiscoveryLimitsAndFailsOnLookupErrors()
    {
        alice.SetPermission(PermissionKind.IsAdministrator, true);
        states[(bob.Id, movie.Id)] = new() { Key = "test", PlaybackPositionTicks = 100 };
        library.Setup(l => l.GetItemList(It.Is<InternalItemsQuery>(q => q.Limit == InterestOverviewService.DiscoveryLimit + 1)))
            .Returns(Enumerable.Repeat<BaseItem>(movie, InterestOverviewService.DiscoveryLimit + 1).ToArray());
        Assert.True((await Overview()).LimitReached);
        Assert.Single((await Overview()).Items);
        library.Setup(l => l.GetItemList(It.IsAny<InternalItemsQuery>())).Throws(new IOException("private"));
        Assert.Equal(503, Assert.IsType<ObjectResult>(await Controller().Overview()).StatusCode);
    }

    [Fact]
    public async Task OverviewEpisodeBudgetDoesNotLimitDeletionProtection()
    {
        alice.SetPermission(PermissionKind.IsAdministrator, true);
        var series = new Series { Id = Guid.NewGuid() };
        store.Set(bob.Id, series.Id, true);
        library.Setup(l => l.GetItemById<BaseItem>(series.Id, It.IsAny<User>())).Returns(series);
        var episodes = Enumerable.Range(0, InterestOverviewService.EpisodeLimit + 1)
            .Select(_ => (BaseItem)new Episode { Id = Guid.NewGuid() }).ToArray();
        library.Setup(l => l.GetItemList(It.IsAny<InternalItemsQuery>())).Returns((InternalItemsQuery q) => q.AncestorIds.Contains(series.Id) ? episodes : []);
        var result = await Overview();
        Assert.True(result.LimitReached); Assert.Empty(result.Items);
        Assert.True(Status(series).HasOtherInterestedUsers);
        library.Verify(l => l.GetItemList(It.Is<InternalItemsQuery>(q => q.AncestorIds.Contains(series.Id) && q.Limit == null)), Times.AtLeastOnce);
    }

    [Fact]
    public async Task AutomaticOverviewSkipsExplicitOnlyCandidatesAndKeepsOriginalContract()
    {
        alice.SetPermission(PermissionKind.IsAdministrator, true);
        store.Set(bob.Id, movie.Id, true);
        Assert.Single((await Overview()).Items);
        var automatic = Assert.IsType<InterestOverview>(Assert.IsType<OkObjectResult>(await Controller().Overview(true)).Value);
        Assert.Empty(automatic.Items);
        Assert.Single(store.Read());
        states[(bob.Id, movie.Id)] = new() { Key = "test", PlaybackPositionTicks = 100 };
        library.Setup(l => l.GetItemList(It.IsAny<InternalItemsQuery>())).Returns([movie]);
        automatic = Assert.IsType<InterestOverview>(Assert.IsType<OkObjectResult>(await Controller().Overview(true)).Value);
        Assert.Equal(new[] { "InProgress" }, Assert.Single(Assert.Single(automatic.Items).Users).Reasons);
        Assert.Equal(new[] { "Watchlisted", "InProgress" }, Assert.Single(Status(movie).Users).Reasons);
        alice.SetPermission(PermissionKind.IsAdministrator, false);
        Assert.IsType<ForbidResult>(await Controller().Overview(true));
        var own = Assert.IsType<InterestOverview>(Assert.IsType<OkObjectResult>(await Controller().OwnOverview(true)).Value);
        Assert.Empty(own.Items);
    }

    private async Task<InterestOverview> Activity(bool own = false) => Assert.IsType<InterestOverview>(
        Assert.IsType<OkObjectResult>(await (own ? Controller().OwnActivity() : Controller().Activity())).Value);

    [Fact]
    public async Task CompletedMovieHasNativeDateButDoesNotProtectWithoutMembership()
    {
        alice.SetPermission(PermissionKind.IsAdministrator, true);
        var date = DateTime.UtcNow.AddDays(-2);
        states[(bob.Id, movie.Id)] = new() { Key = "test", Played = true, LastPlayedDate = date };
        library.Setup(l => l.GetItemList(It.IsAny<InternalItemsQuery>())).Returns([movie]);
        var owner = Assert.Single(Assert.Single((await Activity()).Items).Users);
        Assert.Equal(new[] { "Watched" }, owner.Reasons); Assert.Equal(date, owner.LastPlayedDate);
        Assert.Null(owner.AvailableEpisodes); Assert.False(Status().HasInterest); Assert.Empty(store.Read());
        Assert.Empty((await Overview()).Items); // Old endpoint retains its interest-only contract.
        store.Set(bob.Id, movie.Id, true);
        Assert.Equal(new[] { "Watchlisted" }, Assert.Single(Status().Users).Reasons);
        Assert.Equal(new[] { "Watched" }, Assert.Single(Assert.Single((await Activity()).Items).Users).Reasons);
    }

    [Theory]
    [InlineData(-31)]
    [InlineData(1)]
    [InlineData(0)] // No timestamp, not an invented completion date.
    public async Task CompletedHistoryRequiresANativeDateInsideTheWindow(int days)
    {
        alice.SetPermission(PermissionKind.IsAdministrator, true);
        states[(bob.Id, movie.Id)] = new() { Key = "test", Played = true, LastPlayedDate = days == 0 ? null : DateTime.UtcNow.AddDays(days) };
        library.Setup(l => l.GetItemList(It.IsAny<InternalItemsQuery>())).Returns([movie]);
        Assert.Empty((await Activity()).Items); Assert.False(Status().HasInterest);
    }

    [Fact]
    public async Task SeriesCompletionCountsEveryAvailableEpisodeAndNewEpisodesRestoreWatching()
    {
        alice.SetPermission(PermissionKind.IsAdministrator, true);
        var series = new Series { Id = Guid.NewGuid(), Name = "Series" };
        var episodes = new[] { new Episode { Id = Guid.NewGuid(), SeriesId = series.Id }, new Episode { Id = Guid.NewGuid(), SeriesId = series.Id } };
        foreach (var item in new BaseItem[] { series, episodes[0], episodes[1] })
            library.Setup(l => l.GetItemById<BaseItem>(item.Id, It.IsAny<User>())).Returns(item);
        IReadOnlyList<BaseItem> available = episodes;
        library.Setup(l => l.GetItemList(It.IsAny<InternalItemsQuery>())).Returns((InternalItemsQuery q) => q.AncestorIds.Contains(series.Id) ? available : [episodes[0]]);
        var earlier = DateTime.UtcNow.AddDays(-5); var latest = DateTime.UtcNow.AddDays(-1);
        states[(bob.Id, episodes[0].Id)] = new() { Key = "test", Played = true, LastPlayedDate = earlier };
        states[(bob.Id, episodes[1].Id)] = new() { Key = "test", Played = true, LastPlayedDate = latest };
        var owner = Assert.Single(Assert.Single((await Activity()).Items).Users);
        Assert.Equal(new[] { "Watched" }, owner.Reasons); Assert.Equal(latest, owner.LastPlayedDate);
        Assert.Equal(2, owner.AvailableEpisodes); Assert.Equal(2, owner.WatchedEpisodes);
        library.Verify(l => l.GetItemList(It.Is<InternalItemsQuery>(q => q.AncestorIds.Contains(series.Id) && q.IsMissing == false && q.IsVirtualItem == false)), Times.Exactly(2));
        Assert.False(Status(series).HasInterest);
        available = [.. episodes, new Episode { Id = Guid.NewGuid(), SeriesId = series.Id }];
        owner = Assert.Single(Assert.Single((await Activity()).Items).Users);
        Assert.Equal(new[] { "InProgress" }, owner.Reasons); Assert.Equal(3, owner.AvailableEpisodes); Assert.Equal(2, owner.WatchedEpisodes);
        Assert.True(Status(series).HasOtherInterestedUsers);
        available = []; Assert.Empty((await Activity()).Items); // Empty series is never complete.
    }

    [Fact]
    public async Task ActiveCompletedPlaybackAndMultipleUsersRemainDistinctAndPrivate()
    {
        alice.SetPermission(PermissionKind.IsAdministrator, true);
        var date = DateTime.UtcNow.AddDays(-1);
        states[(bob.Id, movie.Id)] = new() { Key = "test", Played = true, LastPlayedDate = date };
        states[(alice.Id, movie.Id)] = new() { Key = "test", PlaybackPositionTicks = 100, LastPlayedDate = date };
        library.Setup(l => l.GetItemList(It.IsAny<InternalItemsQuery>())).Returns([movie]);
        sessions.Setup(s => s.Sessions).Returns([new SessionInfo(sessions.Object, NullLogger.Instance) { UserId = bob.Id, NowPlayingItem = new BaseItemDto { Id = movie.Id } }]);
        var result = Assert.Single((await Activity()).Items);
        Assert.Equal(2, result.Users.Length);
        Assert.Equal(new[] { "CurrentlyPlaying", "Watched" }, result.Users.Single(u => u.UserId == bob.Id).Reasons);
        Assert.Equal(new[] { "InProgress" }, result.Users.Single(u => u.UserId == alice.Id).Reasons);
        Assert.All(Status().Users, u => Assert.DoesNotContain("Watched", u.Reasons));
        Assert.Single(Assert.Single((await Activity(own: true)).Items).Users);
        alice.SetPermission(PermissionKind.IsAdministrator, false);
        Assert.IsType<ForbidResult>(await Controller().Activity());
        Assert.Equal(alice.Id, Assert.Single(Assert.Single((await Activity(own: true)).Items).Users).UserId);
        SignIn(null); Assert.IsType<UnauthorizedResult>(await Controller().Activity()); Assert.IsType<UnauthorizedResult>(await Controller().OwnActivity());
    }

    [Fact]
    public async Task ActivityLimitsAreClampedAndLookupErrorsAreNotEmptyHistory()
    {
        alice.SetPermission(PermissionKind.IsAdministrator, true);
        states[(bob.Id, movie.Id)] = new() { Key = "test", Played = true, LastPlayedDate = DateTime.UtcNow.AddDays(-50) };
        library.Setup(l => l.GetItemList(It.IsAny<InternalItemsQuery>())).Returns([movie]);
        var overview = new InterestOverviewService(store, library.Object, users.Object, sessions.Object, service);
        Assert.Single(overview.GetActivity(alice, days: 9999, limit: 9999).Items);
        library.Verify(l => l.GetItemList(It.Is<InternalItemsQuery>(q => q.Limit > 101)), Times.Never);
        Assert.Empty(overview.GetActivity(alice, days: -1, limit: -1).Items);
        library.Setup(l => l.GetItemList(It.IsAny<InternalItemsQuery>())).Throws(new IOException("private"));
        Assert.Equal(503, Assert.IsType<ObjectResult>(await Controller().Activity()).StatusCode);
    }

    [Fact]
    public async Task ActivityOmitsDisabledRemovedAndInvisibleOwnersAndMissingItems()
    {
        alice.SetPermission(PermissionKind.IsAdministrator, true);
        states[(bob.Id, movie.Id)] = new() { Key = "test", Played = true, LastPlayedDate = DateTime.UtcNow.AddDays(-1) };
        library.Setup(l => l.GetItemList(It.IsAny<InternalItemsQuery>())).Returns([movie]);
        Assert.Single((await Activity()).Items);
        bob.SetPermission(PermissionKind.IsDisabled, true); Assert.Empty((await Activity()).Items);
        bob.SetPermission(PermissionKind.IsDisabled, false);
        users.Setup(u => u.GetUserById(bob.Id)).Returns((User?)null); Assert.Empty((await Activity()).Items);
        users.Setup(u => u.GetUserById(bob.Id)).Returns(bob);
        library.Setup(l => l.GetItemById<BaseItem>(movie.Id, bob)).Returns((BaseItem?)null); Assert.Empty((await Activity()).Items);
        library.Setup(l => l.GetItemById<BaseItem>(movie.Id, It.IsAny<User>())).Returns((BaseItem?)null); Assert.Empty((await Activity()).Items);
    }

    [Fact]
    public void ActivityConfigurationAndCandidateLimitRemainBounded()
    {
        Assert.Equal(30, new Configuration().ActivityWindowDays);
        Assert.Equal(100, new Configuration().ActivityLimit);
        Assert.False(new Configuration().DiagnosticMode);
        var second = new Movie { Id = Guid.NewGuid(), Name = "Second" };
        library.Setup(l => l.GetItemById<BaseItem>(second.Id, It.IsAny<User>())).Returns(second);
        library.Setup(l => l.GetItemList(It.IsAny<InternalItemsQuery>())).Returns((InternalItemsQuery q) =>
            q.IncludeItemTypes.SequenceEqual(new[] { BaseItemKind.Movie }) && q.IsPlayed == true ? [movie, second] : []);
        foreach (var item in new[] { movie, second }) states[(bob.Id, item.Id)] = new() { Key = "test", Played = true, LastPlayedDate = DateTime.UtcNow.AddDays(-1) };
        var result = new InterestOverviewService(store, library.Object, users.Object, sessions.Object, service).GetActivity(alice, limit: 1);
        Assert.True(result.LimitReached); Assert.False(result.IsComplete); Assert.Single(result.Items);
        library.Verify(l => l.GetItemList(It.Is<InternalItemsQuery>(q => q.IncludeItemTypes.SequenceEqual(new[] { BaseItemKind.Movie }) && q.Limit == 2)), Times.Exactly(2));
    }

}
