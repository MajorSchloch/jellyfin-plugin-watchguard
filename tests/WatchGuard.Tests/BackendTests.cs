using Jellyfin.Data.Enums;
using Jellyfin.Data;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Database.Implementations.Enums;
using Jellyfin.Extensions.Json;
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
        library.Setup(l => l.GetItemIds(It.IsAny<InternalItemsQuery>()))
            .Returns((InternalItemsQuery q) => library.Object.GetItemList(q).Select(i => i.Id).ToArray());
        SignIn(alice);
    }

    private void SignIn(User? user, bool apiKey = false) => auth.Setup(a => a.GetAuthorizationInfo(It.IsAny<HttpContext>()))
        .ReturnsAsync(new AuthorizationInfo { User = user, IsAuthenticated = user is not null, IsApiKey = apiKey });
    private WatchGuardController Controller() => new(auth.Object, users.Object, library.Object, store, service,
        NullLogger<WatchGuardController>.Instance, new(store, library.Object, users.Object, sessions.Object, service)) { ControllerContext = new() { HttpContext = new DefaultHttpContext() } };
    private PreferencesController Preferences(PreferenceStore? preferences = null, MediaBrowser.Controller.IServerApplicationHost? host = null) => new(auth.Object, users.Object,
        preferences ?? new PreferenceStore(directory), new Jellyfin.Plugin.WatchGuard.Standalone.StandaloneMode(), host ?? Mock.Of<MediaBrowser.Controller.IServerApplicationHost>(),
        NullLogger<PreferencesController>.Instance) { ControllerContext = new() { HttpContext = new DefaultHttpContext() } };

    [Theory]
    [InlineData("12.2.0", true)]
    [InlineData("12.3.0", true)]
    [InlineData("12.2.0.0", true)]
    [InlineData("12.3.0.0", true)]
    [InlineData("12.1.0", false)]
    [InlineData("12.4.0", true)]
    [InlineData("12.4.0.0", true)]
    [InlineData("12.4.1", false)]
    [InlineData("12.4.0.1", false)]
    [InlineData("12.5.0", false)]
    [InlineData("13.0.0", false)]
    [InlineData("12.2.1", false)]
    [InlineData("12.3.1", false)]
    [InlineData("12.2.0.1", false)]
    [InlineData("12.3.0.1", false)]
    [InlineData("12.3", false)]
    public async Task IntegrationStatusReportsOnlyExactTestedHosts(string version, bool expected)
    {
        var host = new Mock<MediaBrowser.Controller.IServerApplicationHost>();
        host.SetupGet(h => h.ApplicationVersion).Returns(Version.Parse(version));
        host.SetupGet(h => h.ApplicationVersionString).Returns(version);
        var controller = Preferences(host: host.Object);
        Assert.IsType<ForbidResult>(await controller.Status());
        alice.SetPermission(PermissionKind.IsAdministrator, true);
        var result = Assert.IsType<OkObjectResult>(await controller.Status());
        var json = System.Text.Json.JsonSerializer.SerializeToElement(result.Value);
        Assert.Equal(expected, json.GetProperty("ServerMatchesTestedVersion").GetBoolean());
        Assert.Equal(version, json.GetProperty("JellyfinVersion").GetString());
        Assert.False(json.GetProperty("BrowserExecutionVerified").GetBoolean());
        SignIn(alice, true);
        Assert.IsType<UnauthorizedResult>(await controller.Status());
    }

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
    public async Task AddedPreferencesPersistWithAuthorizationAndVisibleSidecarFailures()
    {
        var c = Preferences();
        Assert.IsType<OkObjectResult>(await c.Put(new("mine", ["watchlisted"], "added")));
        c = Preferences(); // New controller/store after restart.
        Assert.Equal("added", Assert.IsType<ViewPreferences>(Assert.IsType<OkObjectResult>(await c.Get()).Value).Sort);
        SignIn(bob);
        Assert.Equal("title", Assert.IsType<ViewPreferences>(Assert.IsType<OkObjectResult>(await c.Get()).Value).Sort);
        Assert.IsType<ForbidResult>(await c.Put(new("all", [], "added")));
        bob.SetPermission(PermissionKind.IsDisabled, true);
        Assert.IsType<UnauthorizedResult>(await c.Put(new("mine", [], "added")));
        Assert.IsType<UnauthorizedResult>(await c.Reset());
        SignIn(alice, true); Assert.IsType<UnauthorizedResult>(await c.Put(new("mine", [], "added")));
        SignIn(null); Assert.IsType<UnauthorizedResult>(await c.Put(new("mine", [], "added")));
        SignIn(alice);
        var primary = await File.ReadAllBytesAsync(Path.Combine(directory, "preferences.json"));
        var sidecar = Path.Combine(directory, "preference-sorts.json");
        await File.WriteAllTextAsync(sidecar, "corrupt");
        Assert.Equal(503, Assert.IsType<ObjectResult>(await c.Get()).StatusCode);
        Assert.Equal(503, Assert.IsType<ObjectResult>(await c.Put(ViewPreferences.Defaults)).StatusCode);
        Assert.Equal(503, Assert.IsType<ObjectResult>(await c.Reset()).StatusCode);
        Assert.Equal("corrupt", await File.ReadAllTextAsync(sidecar));
        Assert.Equal(primary, await File.ReadAllBytesAsync(Path.Combine(directory, "preferences.json")));
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
        Assert.Equal(30, old.ActivityWindowDays); Assert.Equal(100, old.ActivityLimit); Assert.True(old.ProtectCaughtUpSeries);
        using var disabled = new StringReader("<Configuration><ProtectCaughtUpSeries>false</ProtectCaughtUpSeries></Configuration>");
        Assert.False(Assert.IsType<Configuration>(serializer.Deserialize(disabled)).ProtectCaughtUpSeries);
    }
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
    public async Task AddedDatesAreExposedOnlyThroughAuthorizedExplicitMemberships()
    {
        store.Set(alice.Id, movie.Id, true);
        var ownResponse = Assert.IsType<OkObjectResult>(await Controller().List());
        var own = System.Text.Json.JsonSerializer.SerializeToElement(ownResponse.Value, JsonDefaults.PascalCaseOptions);
        var first = Assert.Single(own.EnumerateArray());
        Assert.Equal(movie.Id, Guid.Parse(first.GetProperty("ItemId").GetString()!));
        Assert.Equal(System.Text.Json.JsonValueKind.String, first.GetProperty("AddedAtUtc").ValueKind);

        SignIn(bob);
        var otherResponse = Assert.IsType<OkObjectResult>(await Controller().List());
        Assert.Empty(System.Text.Json.JsonSerializer.SerializeToElement(otherResponse.Value, JsonDefaults.PascalCaseOptions).EnumerateArray());
        Assert.IsType<ForbidResult>(await Controller().AllWatchlists());

        store.Set(bob.Id, movie.Id, true);
        SignIn(alice);
        alice.SetPermission(PermissionKind.IsAdministrator, true);
        var all = Assert.Single(Assert.IsType<SharedWatchlistItem[]>(
            Assert.IsType<OkObjectResult>(await Controller().AllWatchlists()).Value));
        Assert.All(all.Users, owner => Assert.NotNull(owner.AddedAtUtc));
        Assert.Equal(new[] {alice.Id, bob.Id}.Order(), all.Users.Select(o => o.UserId).Order());

        // Supplemental dates never affect authoritative watchlist interest.
        Assert.True(Status().HasInterest);
        Assert.Equal(2, store.Read().Length);
    }

    [Theory]
    [InlineData(false, false)]
    [InlineData(false, true)]
    [InlineData(true, false)]
    [InlineData(true, true)]
    public async Task UnknownAddedDatesRemainExplicitWithNativeJsonOptions(bool camelCase, bool invalidatedDates)
    {
        if (invalidatedDates)
        {
            store.Set(alice.Id, movie.Id, true);
            store.Set(bob.Id, movie.Id, true);
            var path = Path.Combine(directory, "watchlists.json");
            File.SetLastWriteTimeUtc(path, File.GetLastWriteTimeUtc(path).AddSeconds(3));
        }
        else
        {
            Directory.CreateDirectory(directory);
            // A real schema-1 membership without any v0.5.0 metadata.
            await File.WriteAllTextAsync(Path.Combine(directory, "watchlists.json"),
                System.Text.Json.JsonSerializer.Serialize(new WatchlistDocument(1,
                    [new(alice.Id, movie.Id), new(bob.Id, movie.Id)])));
        }

        var options = camelCase ? JsonDefaults.CamelCaseOptions : JsonDefaults.PascalCaseOptions;
        Assert.Equal(System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull, options.DefaultIgnoreCondition);
        var addedProperty = camelCase ? "addedAtUtc" : "AddedAtUtc";
        var usersProperty = camelCase ? "users" : "Users";
        var own = Assert.IsType<OkObjectResult>(await Controller().List());
        var ownItem = Assert.Single(System.Text.Json.JsonSerializer.SerializeToElement(own.Value, options).EnumerateArray());
        Assert.Equal(System.Text.Json.JsonValueKind.Null, ownItem.GetProperty(addedProperty).ValueKind);

        alice.SetPermission(PermissionKind.IsAdministrator, true);
        foreach (var response in new[] { await Controller().AllWatchlists(), await Controller().UserWatchlist(bob.Id) })
        {
            var result = Assert.IsType<OkObjectResult>(response);
            var item = Assert.Single(System.Text.Json.JsonSerializer.SerializeToElement(result.Value, options).EnumerateArray());
            var owners = item.GetProperty(usersProperty).EnumerateArray().ToArray();
            Assert.NotEmpty(owners);
            Assert.All(owners, owner => Assert.Equal(System.Text.Json.JsonValueKind.Null, owner.GetProperty(addedProperty).ValueKind));
        }

        // The user directory describes accounts, not watchlist memberships.
        var directoryResponse = Assert.IsType<OkObjectResult>(await Controller().OverviewUsers());
        Assert.All(System.Text.Json.JsonSerializer.SerializeToElement(directoryResponse.Value, options).EnumerateArray(),
            owner => Assert.False(owner.TryGetProperty(addedProperty, out _)));
        Assert.True(Status().HasInterest);
    }

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
        var episodes = Enumerable.Range(0, available).Select(_ => (BaseItem)new AvailableEpisode { Id = Guid.NewGuid() }).ToArray();
        library.Setup(l => l.GetItemById<BaseItem>(series.Id, It.IsAny<User>())).Returns(series);
        library.Setup(l => l.GetItemList(It.Is<InternalItemsQuery>(q => q.AncestorIds.Contains(series.Id)
            && q.IsVirtualItem == null && q.IsMissing == null && q.Recursive))).Returns(episodes);
        foreach (var ep in episodes.Take(completed)) states[(bob.Id, ep.Id)] = new() { Key = "test", Played = true };
        // Historical data for a removed episode must not start an empty/unstarted series.
        states[(bob.Id, Guid.NewGuid())] = new() { Key = "test", Played = true };
        Assert.Equal(expected, Status(series).HasInterest);
    }

    [Fact]
    public void StartedEpisodeAndActiveAdditionalSessionUserCount()
    {
        var series = new Series { Id = Guid.NewGuid() };
        var episode = new AvailableEpisode { Id = Guid.NewGuid() };
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
        Assert.Equal(new Version(0, 7, 12, 0), typeof(Plugin).Assembly.GetName().Version);
        Assert.False(new Configuration().DiagnosticMode);
        Assert.True(new Configuration().ProtectCaughtUpSeries);
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
        var first = new AvailableEpisode { Id = Guid.NewGuid(), SeriesId = series.Id };
        var next = new AvailableEpisode { Id = Guid.NewGuid(), SeriesId = series.Id };
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
    public async Task TargetedEpisodeBudgetFailsClosedForDeletionProtection()
    {
        alice.SetPermission(PermissionKind.IsAdministrator, true);
        var series = new Series { Id = Guid.NewGuid() };
        store.Set(bob.Id, series.Id, true);
        library.Setup(l => l.GetItemById<BaseItem>(series.Id, It.IsAny<User>())).Returns(series);
        var episodes = Enumerable.Range(0, InterestOverviewService.EpisodeLimit + 1)
            .Select(_ => (BaseItem)new AvailableEpisode { Id = Guid.NewGuid() }).ToArray();
        library.Setup(l => l.GetItemList(It.IsAny<InternalItemsQuery>())).Returns((InternalItemsQuery q) => q.AncestorIds.Contains(series.Id) ? episodes : []);
        var result = await Overview();
        Assert.True(result.LimitReached); Assert.Empty(result.Items);
        Assert.Throws<InvalidDataException>(() => Status(series));
        Assert.Equal(503, Assert.IsType<ObjectResult>(await Controller().Protection(series.Id)).StatusCode);
        var targeted = service.GetSeriesActivity(series, alice.Id);
        Assert.False(targeted.IsComplete); Assert.True(targeted.LimitReached);
        library.Verify(l => l.GetItemList(It.Is<InternalItemsQuery>(q => q.AncestorIds.Contains(series.Id) && q.Limit == InterestOverviewService.EpisodeLimit + 1)), Times.AtLeastOnce);
    }

    [Fact]
    public void OversizedOverviewSeriesMustNotStarveLaterMovieOrWeakenProtection()
    {
        var series = new Series { Id = Guid.NewGuid(), Name = "Oversized" };
        var episodes = Enumerable.Range(0, 1501).Select(_ => (BaseItem)new AvailableEpisode { Id = Guid.NewGuid(), SeriesId = series.Id }).ToArray();
        library.Setup(l => l.GetItemById<BaseItem>(series.Id, It.IsAny<User>())).Returns(series);
        library.Setup(l => l.GetItemById<BaseItem>(episodes[0].Id, It.IsAny<User>())).Returns(episodes[0]);
        library.Setup(l => l.GetItemList(It.IsAny<InternalItemsQuery>())).Returns((InternalItemsQuery q) =>
            q.AncestorIds.Contains(series.Id) ? episodes.Take(q.Limit ?? episodes.Length).ToArray() :
            q.IsResumable == true ? [episodes[0]] : q.IncludeItemTypes.SequenceEqual(new[] { BaseItemKind.Movie }) ? [movie] : []);
        states[(bob.Id, movie.Id)] = new() { Key = "test", Played = true, LastPlayedDate = DateTime.UtcNow.AddDays(-1) };
        var overview = new InterestOverviewService(store, library.Object, users.Object, sessions.Object, service).GetActivity(alice);
        Assert.True(overview.LimitReached); Assert.False(overview.IsComplete);
        Assert.Equal(movie.Id, Assert.Single(overview.Items).ItemId);
        Assert.Throws<InvalidDataException>(() => service.Get(series, alice.Id));
    }

    [Fact]
    public void OverviewMovieBatchesAreAccountIsolatedAndNeverReusedByProtection()
    {
        var second = new Movie { Id = Guid.NewGuid(), Name = "Second" };
        library.Setup(l => l.GetItemById<BaseItem>(second.Id, It.IsAny<User>())).Returns(second);
        library.Setup(l => l.GetItemList(It.IsAny<InternalItemsQuery>())).Returns([movie, second]);
        states[(bob.Id, movie.Id)] = new() { Key = "test", PlaybackPositionTicks = 100 };
        states[(alice.Id, second.Id)] = new() { Key = "test", PlaybackPositionTicks = 100 };
        var result = new InterestOverviewService(store, library.Object, users.Object, sessions.Object, service).GetActivity(alice);
        Assert.Equal(bob.Id, Assert.Single(result.Items.Single(i => i.ItemId == movie.Id).Users).UserId);
        Assert.Equal(alice.Id, Assert.Single(result.Items.Single(i => i.ItemId == second.Id).Users).UserId);
        data.Verify(d => d.GetUserDataBatch(It.IsAny<IReadOnlyList<BaseItem>>(), It.IsAny<User>()), Times.Exactly(2));
        data.Verify(d => d.GetResumeUserDataBatch(It.IsAny<IReadOnlyList<BaseItem>>(), It.IsAny<User>()), Times.Exactly(2));
        data.Invocations.Clear(); states.Clear();
        Assert.False(service.Get(movie, alice.Id).HasInterest);
        data.Verify(d => d.GetUserDataBatch(It.IsAny<IReadOnlyList<BaseItem>>(), It.IsAny<User>()), Times.Exactly(2));
    }

    [Theory]
    [InlineData(105, 12)]
    [InlineData(4, 300)]
    [InlineData(4, 1000)]
    [InlineData(12, 1000)]
    public void SeriesBatchesPreservePerUserProgressDatesAndTargetedResults(int titleCount, int episodeCount)
    {
        var date = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);
        var titles = Enumerable.Range(0, titleCount).Select(i => new Series
            { Id = Guid.NewGuid(), Name = $"Series {i:D3}", Status = MediaBrowser.Model.Entities.SeriesStatus.Continuing }).ToArray();
        var rows = titles.ToDictionary(s => s.Id, s => Enumerable.Range(0, episodeCount).Select(i =>
            (BaseItem)new AvailableEpisode { Id = Guid.NewGuid(), SeriesId = s.Id, PremiereDate = date.AddYears(-1) }).ToArray());
        foreach (var title in titles)
        {
            library.Setup(l => l.GetItemById<BaseItem>(title.Id, It.IsAny<User>())).Returns(title);
            library.Setup(l => l.GetItemById<BaseItem>(rows[title.Id][0].Id, It.IsAny<User>())).Returns(rows[title.Id][0]);
            foreach (var row in rows[title.Id])
            {
                states[(alice.Id,row.Id)] = new() { Key = "test", Played = true, LastPlayedDate = date };
                states[(bob.Id,row.Id)] = new() { Key = "test", Played = false };
            }
            states[(bob.Id, rows[title.Id][0].Id)] = new() { Key = "test", PlaybackPositionTicks = 123, LastPlayedDate = date.AddDays(1) };
        }
        library.Setup(l => l.GetItemList(It.IsAny<InternalItemsQuery>())).Returns((InternalItemsQuery q) =>
            q.AncestorIds.Length > 0 ? rows[q.AncestorIds[0]].Take(q.Limit ?? int.MaxValue).ToArray() :
            q.IsResumable == true ? rows.Values.Select(r => r[0]).Take(100).ToArray() :
            q.GroupBySeriesPresentationUniqueKey ? rows.Values.Select(r => r[0]).Skip(5).Take(100).ToArray() : []);
        var result = new InterestOverviewService(store,library.Object,users.Object,sessions.Object,service).GetActivity(alice);
        var exhausted = titleCount == 12;
        Assert.Equal(exhausted ? 9 : Math.Min(100,titleCount),result.Items.Length);
        Assert.Equal(result.Diagnostics!.NativePlaybackBatches,result.Diagnostics.PlaybackBatchCount);
        Assert.Equal(exhausted ? 38 : 4 * (int)Math.Ceiling(result.Items.Length * episodeCount / 1000.0),result.Diagnostics.NativePlaybackBatches);
        Assert.Equal(exhausted ? 20 : result.Items.Length * 2,result.Diagnostics.EpisodeQueryCount);
        if (exhausted)
        {
            Assert.Contains("VerificationBudget",result.Coverage!.Causes);
            Assert.True(result.Coverage.VerificationLimited);
            Assert.False(result.Coverage.ResultLimitReached);
            Assert.Equal(20000,result.Diagnostics.EpisodeRowsProcessed);
        }
        foreach (var call in data.Invocations.Where(i => i.Method.Name is "GetUserDataBatch" or "GetResumeUserDataBatch"))
            Assert.InRange(((IReadOnlyList<BaseItem>)call.Arguments[0]).Count,1,1000);
        foreach (var item in result.Items)
        {
            var caught = Assert.Single(item.Users,u => u.UserId == alice.Id);
            Assert.Contains("CaughtUp",caught.Reasons); Assert.Equal(episodeCount,caught.WatchedEpisodes);
            Assert.Equal(date,caught.LastPlayedDate);
            var watching = Assert.Single(item.Users,u => u.UserId == bob.Id);
            Assert.Contains("InProgress",watching.Reasons); Assert.Equal(0,watching.WatchedEpisodes);
            Assert.Equal(episodeCount,watching.AvailableEpisodes); Assert.Equal(date.AddDays(1),watching.LastPlayedDate);
            var targeted = service.GetSeriesActivity(titles.Single(t => t.Id == item.ItemId),alice.Id);
            Assert.All(item.Users,u => Assert.Equal(targeted.Users.Single(t => t.UserId == u.UserId).WatchedEpisodes,u.WatchedEpisodes));
        }
    }

    [Fact]
    public void PreparedSeriesReadsKeepVisibilityAndAlternateDatesIsolated()
    {
        var titles = new[] { new Series { Id=Guid.NewGuid(),Status=MediaBrowser.Model.Entities.SeriesStatus.Continuing },
            new Series { Id=Guid.NewGuid(),Status=MediaBrowser.Model.Entities.SeriesStatus.Continuing } };
        var date = DateTime.UtcNow.AddDays(-3);
        var rows = titles.ToDictionary(t=>t.Id,t=>Enumerable.Range(0,3).Select(_=>(BaseItem)new AvailableEpisode
            { Id=Guid.NewGuid(),SeriesId=t.Id,PremiereDate=date.AddYears(-1) }).ToArray());
        foreach(var t in titles)
        {
            library.Setup(l=>l.GetItemById<BaseItem>(t.Id,It.IsAny<User>())).Returns(t);
            library.Setup(l=>l.GetItemById<BaseItem>(rows[t.Id][0].Id,It.IsAny<User>())).Returns(rows[t.Id][0]);
            foreach(var e in rows[t.Id]) states[(alice.Id,e.Id)]=new(){Key="test",Played=true,LastPlayedDate=date};
        }
        library.Setup(l=>l.GetItemList(It.IsAny<InternalItemsQuery>())).Returns((InternalItemsQuery q)=>
            q.AncestorIds.Length>0 ? (q.User!.Id==bob.Id ? rows[q.AncestorIds[0]].Take(1).ToArray() : rows[q.AncestorIds[0]]) :
            q.IsResumable==true ? rows.Values.Select(r=>r[0]).ToArray() : []);
        data.Setup(d=>d.GetResumeUserDataBatch(It.IsAny<IReadOnlyList<BaseItem>>(),It.IsAny<User>()))
            .Returns((IReadOnlyList<BaseItem> items,User user)=>items.Where(i=>user.Id==bob.Id && i.Id==rows[titles[0].Id][0].Id)
                .ToDictionary(i=>i.Id,i=>new VersionResumeData(Guid.NewGuid(),new(){Key="alternate",Played=true,LastPlayedDate=date.AddDays(1)})));
        var result=new InterestOverviewService(store,library.Object,users.Object,sessions.Object,service).GetActivity(alice);
        var first=result.Items.Single(i=>i.ItemId==titles[0].Id);
        Assert.Equal(1,first.Users.Single(u=>u.UserId==bob.Id).AvailableEpisodes);
        Assert.Equal(date.AddDays(1),first.Users.Single(u=>u.UserId==bob.Id).LastPlayedDate);
        Assert.Equal(3,first.Users.Single(u=>u.UserId==alice.Id).AvailableEpisodes);
        Assert.DoesNotContain(result.Items.Single(i=>i.ItemId==titles[1].Id).Users,u=>u.UserId==bob.Id);
    }

    [Fact]
    public void EpisodeMetadataReuseRequiresFreshNativeUserIdsAndExpiresAfterRequest()
    {
        var series = new Series { Id=Guid.NewGuid(), Status=MediaBrowser.Model.Entities.SeriesStatus.Continuing };
        var date = new DateTime(2020,1,1,0,0,0,DateTimeKind.Utc);
        var rows = Enumerable.Range(0,3).Select(_ => (BaseItem)new AvailableEpisode
            {Id=Guid.NewGuid(),SeriesId=series.Id,PremiereDate=date}).ToArray();
        var bobRows = rows.Take(1).ToArray();
        library.Setup(l=>l.GetItemById<BaseItem>(series.Id,It.IsAny<User>())).Returns(series);
        library.Setup(l=>l.GetItemById<BaseItem>(rows[0].Id,It.IsAny<User>())).Returns(rows[0]);
        library.Setup(l=>l.GetItemList(It.IsAny<InternalItemsQuery>())).Returns((InternalItemsQuery q)=>
            q.AncestorIds.Length>0 ? (q.User==bob ? bobRows : rows) : q.IsResumable==true ? [rows[0]] : []);
        library.Setup(l=>l.GetItemIds(It.IsAny<InternalItemsQuery>())).Returns((InternalItemsQuery q)=>
        {
            Assert.Same(bob,q.User); Assert.Equal(new[]{series.Id},q.AncestorIds);
            Assert.Equal(1001,q.Limit); Assert.False(q.DtoOptions.EnableUserData);
            return bobRows.Select(i=>i.Id).ToArray();
        });
        foreach(var row in rows)
        {
            states[(alice.Id,row.Id)]=new(){Key="test",Played=true,LastPlayedDate=date};
            states[(bob.Id,row.Id)]=new(){Key="test",PlaybackPositionTicks=100,LastPlayedDate=date.AddDays(1)};
        }
        var overview=new InterestOverviewService(store,library.Object,users.Object,sessions.Object,service);
        var first=overview.GetActivity(alice);
        Assert.Equal(1,first.Diagnostics!.EpisodeHydrationQueryCount);
        Assert.Equal(1,first.Diagnostics.EpisodeIdQueryCount);
        Assert.Equal(1,first.Diagnostics.EpisodeMetadataReusedRows);
        Assert.Equal(4,first.Diagnostics.EpisodeRowsProcessed);
        Assert.Equal(1,Assert.Single(first.Items).Users.Single(u=>u.UserId==bob.Id).AvailableEpisodes);
        library.Verify(l=>l.GetItemList(It.Is<InternalItemsQuery>(q=>q.AncestorIds.Length>0 && q.User==bob)),Times.Never);
        data.Verify(d=>d.GetUserDataBatch(It.Is<IReadOnlyList<BaseItem>>(r=>r.Count==1 && r[0].Id==rows[0].Id),bob),Times.Once);
        // A new request must re-evaluate changed permissions and metadata.
        bobRows=rows.Take(2).ToArray(); rows[2].PremiereDate=null;
        var second=overview.GetActivity(alice);
        Assert.Equal(2,Assert.Single(second.Items).Users.Single(u=>u.UserId==bob.Id).AvailableEpisodes);
        Assert.Contains("EpisodeMetadataIncomplete",second.Coverage!.Causes);
        Assert.Equal(1,second.Diagnostics!.EpisodeHydrationQueryCount);
        library.Setup(l=>l.GetItemIds(It.IsAny<InternalItemsQuery>())).Throws(new IOException("native failure"));
        Assert.Throws<IOException>(()=>overview.GetActivity(alice));
        // Targeted activity/protection never call the overview ID projection.
        service.GetSeriesActivity(series,alice.Id);
        Assert.Throws<InvalidDataException>(()=>service.Get(series,alice.Id));
    }

    [Fact]
    public void DifferentEpisodeSetsHydrateNativelyAndChangingResultsFailClosed()
    {
        var series = new Series {Id=Guid.NewGuid()};
        var rows = Enumerable.Range(0,2).Select(_=>(BaseItem)new AvailableEpisode {Id=Guid.NewGuid(),SeriesId=series.Id}).ToArray();
        library.Setup(l=>l.GetItemById<BaseItem>(series.Id,It.IsAny<User>())).Returns(series);
        library.Setup(l=>l.GetItemById<BaseItem>(rows[0].Id,It.IsAny<User>())).Returns(rows[0]);
        library.Setup(l=>l.GetItemList(It.IsAny<InternalItemsQuery>())).Returns((InternalItemsQuery q)=>
            q.AncestorIds.Length>0 ? (q.User==alice ? [rows[0]] : rows) : q.IsResumable==true ? [rows[0]] : []);
        library.Setup(l=>l.GetItemIds(It.IsAny<InternalItemsQuery>())).Returns(rows.Select(r=>r.Id).ToArray());
        foreach(var row in rows) states[(bob.Id,row.Id)]=new(){Key="test",PlaybackPositionTicks=100};
        var overview=new InterestOverviewService(store,library.Object,users.Object,sessions.Object,service);
        var result=overview.GetActivity(alice);
        Assert.Equal(2,Assert.Single(result.Items).Users.Single(u=>u.UserId==bob.Id).AvailableEpisodes);
        Assert.Equal(3,result.Diagnostics!.EpisodeQueryCount); // Includes the fallback, no hidden work.
        Assert.Equal(2,result.Diagnostics.EpisodeHydrationQueryCount);
        library.Setup(l=>l.GetItemIds(It.IsAny<InternalItemsQuery>())).Returns([Guid.NewGuid()]);
        Assert.Throws<InvalidDataException>(()=>overview.GetActivity(alice));
        using var cancellation=new CancellationTokenSource();
        library.Setup(l=>l.GetItemIds(It.IsAny<InternalItemsQuery>())).Returns(()=>{cancellation.Cancel();return rows.Select(r=>r.Id).ToArray();});
        data.Invocations.Clear();
        Assert.Throws<OperationCanceledException>(()=>overview.GetActivity(alice,cancellation:cancellation.Token));
        data.Verify(d=>d.GetUserDataBatch(It.IsAny<IReadOnlyList<BaseItem>>(),It.IsAny<User>()),Times.Never);
    }

    [Fact]
    public void OversizedAuthorizedIdProbeDoesNotHydrateOrBypassTheLimit()
    {
        var series=new Series {Id=Guid.NewGuid()};
        var episode=new AvailableEpisode {Id=Guid.NewGuid(),SeriesId=series.Id};
        library.Setup(l=>l.GetItemById<BaseItem>(series.Id,It.IsAny<User>())).Returns(series);
        library.Setup(l=>l.GetItemById<BaseItem>(episode.Id,It.IsAny<User>())).Returns(episode);
        library.Setup(l=>l.GetItemList(It.IsAny<InternalItemsQuery>())).Returns((InternalItemsQuery q)=>
            q.AncestorIds.Length>0 || q.IsResumable==true ? [episode] : []);
        library.Setup(l=>l.GetItemIds(It.IsAny<InternalItemsQuery>())).Returns(Enumerable.Range(0,1001).Select(_=>Guid.NewGuid()).ToArray());
        var result=new InterestOverviewService(store,library.Object,users.Object,sessions.Object,service).GetActivity(alice);
        Assert.Empty(result.Items); Assert.Contains("EpisodeLimit",result.Coverage!.Causes);
        Assert.Equal(1002,result.Diagnostics!.EpisodeRowsProcessed);
        Assert.Equal(1,result.Diagnostics.EpisodeHydratedRows);
        Assert.Equal(2,result.Diagnostics.EpisodeQueryCount);
        library.Verify(l=>l.GetItemList(It.Is<InternalItemsQuery>(q=>q.AncestorIds.Length>0 && q.User==bob)),Times.Never);
        data.Verify(d=>d.GetUserDataBatch(It.IsAny<IReadOnlyList<BaseItem>>(),bob),Times.Never);
    }

    [Fact]
    public void PreparedPlaybackCancellationStopsBeforeResumeBatch()
    {
        using var cancellation=new CancellationTokenSource();
        library.Setup(l=>l.GetItemList(It.IsAny<InternalItemsQuery>())).Returns([movie]);
        data.Setup(d=>d.GetUserDataBatch(It.IsAny<IReadOnlyList<BaseItem>>(),It.IsAny<User>()))
            .Returns((IReadOnlyList<BaseItem> items,User user)=>{cancellation.Cancel();return items.ToDictionary(i=>i.Id,i=>new UserItemData{Key="test"});});
        Assert.Throws<OperationCanceledException>(()=>new InterestOverviewService(store,library.Object,users.Object,sessions.Object,service)
            .GetActivity(alice,cancellation:cancellation.Token));
        data.Verify(d=>d.GetResumeUserDataBatch(It.IsAny<IReadOnlyList<BaseItem>>(),It.IsAny<User>()),Times.Never);
    }

    [Fact]
    public void GroupedEpisodeDiscoveryReachesSeriesBeyondTheRawEpisodeCap()
    {
        var series = new[] { new Series { Id = Guid.NewGuid() }, new Series { Id = Guid.NewGuid() } };
        var episodes = series.Select(s => new[] { new AvailableEpisode { Id = Guid.NewGuid(), SeriesId = s.Id }, new AvailableEpisode { Id = Guid.NewGuid(), SeriesId = s.Id } }).ToArray();
        foreach (var item in series.Cast<BaseItem>().Concat(episodes.SelectMany(e => e)))
            library.Setup(l => l.GetItemById<BaseItem>(item.Id, It.IsAny<User>())).Returns(item);
        foreach (var pair in episodes) states[(bob.Id, pair[0].Id)] = new() { Key = "test", Played = true };
        library.Setup(l => l.GetItemList(It.IsAny<InternalItemsQuery>())).Returns((InternalItemsQuery q) =>
            q.AncestorIds.Contains(series[0].Id) ? episodes[0] : q.AncestorIds.Contains(series[1].Id) ? episodes[1] :
            q.GroupBySeriesPresentationUniqueKey ? [episodes[0][0], episodes[1][0]] :
            q.IsPlayed == true && q.IncludeItemTypes.SequenceEqual(new[] { BaseItemKind.Episode }) ? Enumerable.Repeat<BaseItem>(episodes[0][0],101).ToArray() : []);
        var result = new InterestOverviewService(store, library.Object, users.Object, sessions.Object, service).GetActivity(alice);
        Assert.Equal(2, result.Items.Length); Assert.All(result.Items, i => Assert.Equal("InProgress", Assert.Single(Assert.Single(i.Users).Reasons)));
        Assert.Contains("RawEpisodeDiscoveryLimit", result.Coverage!.Causes);
        Assert.False(result.Coverage.AdditionalPagesAvailable); Assert.False(result.IsComplete);
        Assert.Equal(2, result.Diagnostics!.CandidatesVerified);
    }

    [Fact]
    public void ResultAllowanceIsNotConsumedByTheFirstHundredIrrelevantCandidates()
    {
        var old = Enumerable.Range(0,100).Select(_ => new Movie {Id=Guid.NewGuid()}).ToArray();
        foreach (var item in old) library.Setup(l=>l.GetItemById<BaseItem>(item.Id,It.IsAny<User>())).Returns(item);
        library.Setup(l=>l.GetItemList(It.IsAny<InternalItemsQuery>())).Returns((InternalItemsQuery q)=>q.IsResumable==true?old:q.IncludeItemTypes.SequenceEqual(new[]{BaseItemKind.Movie})?[movie]:[]);
        states[(bob.Id,movie.Id)]=new(){Key="test",Played=true,LastPlayedDate=DateTime.UtcNow.AddDays(-1)};
        var result=new InterestOverviewService(store,library.Object,users.Object,sessions.Object,service).GetActivity(alice);
        Assert.Equal(movie.Id,Assert.Single(result.Items).ItemId);
        Assert.Equal(101,result.Diagnostics!.UniqueCandidates);Assert.Equal(101,result.Diagnostics.CandidatesVerified);
    }

    [Fact]
    public void OverviewCancellationStopsBeforeNativeQueries()
    {
        using var cancelled=new CancellationTokenSource();cancelled.Cancel();
        Assert.Throws<OperationCanceledException>(()=>new InterestOverviewService(store,library.Object,users.Object,sessions.Object,service).GetActivity(alice,cancellation:cancelled.Token));
        library.Verify(l=>l.GetItemList(It.IsAny<InternalItemsQuery>()),Times.Never);
    }

    [Fact]
    public void ResumeDiscoveryInterleavesUsersBeforeApplyingResultLimit()
    {
        var second=new Movie{Id=Guid.NewGuid()}; var third=new Movie{Id=Guid.NewGuid()};
        foreach(var item in new[]{second,third})library.Setup(l=>l.GetItemById<BaseItem>(item.Id,It.IsAny<User>())).Returns(item);
        states[(alice.Id,movie.Id)]=new(){Key="test",PlaybackPositionTicks=10};
        states[(alice.Id,second.Id)]=new(){Key="test",PlaybackPositionTicks=10};
        states[(bob.Id,third.Id)]=new(){Key="test",PlaybackPositionTicks=10};
        library.Setup(l=>l.GetItemList(It.IsAny<InternalItemsQuery>())).Returns((InternalItemsQuery q)=>q.IsResumable==true?(q.User==alice?[movie,second]:[third]):[]);
        var result=new InterestOverviewService(store,library.Object,users.Object,sessions.Object,service).GetActivity(alice,limit:2);
        Assert.Equal(2,result.Items.Length);Assert.Contains(result.Items,i=>i.ItemId==third.Id);
        Assert.True(result.Coverage!.ResultLimitReached);Assert.Contains("ResultLimit",result.Coverage.Causes);
    }

    [Fact]
    public void MovieBatchDatesVersionsVisibilityAndFailuresRemainNative()
    {
        var second=new Movie{Id=Guid.NewGuid()};
        library.Setup(l=>l.GetItemById<BaseItem>(second.Id,alice)).Returns(second);
        library.Setup(l=>l.GetItemList(It.IsAny<InternalItemsQuery>())).Returns([movie,second]);
        var date=DateTime.UtcNow.AddDays(-2);
        data.Setup(d=>d.GetResumeUserDataBatch(It.IsAny<IReadOnlyList<BaseItem>>(),bob)).Returns(new Dictionary<Guid,VersionResumeData>{[movie.Id]=new(Guid.NewGuid(),new UserItemData{Key="test",Played=true,LastPlayedDate=date})});
        states[(alice.Id,second.Id)]=new(){Key="test",Played=true,LastPlayedDate=DateTime.UtcNow};
        var overview=new InterestOverviewService(store,library.Object,users.Object,sessions.Object,service);
        var result=overview.GetActivity(alice);
        Assert.Equal(date,Assert.Single(result.Items.Single(i=>i.ItemId==movie.Id).Users).LastPlayedDate);
        Assert.Equal(alice.Id,Assert.Single(result.Items.Single(i=>i.ItemId==second.Id).Users).UserId);
        data.Verify(d=>d.GetUserDataBatch(It.Is<IReadOnlyList<BaseItem>>(items=>items.Any(i=>i.Id==second.Id)),bob),Times.Never);
        data.Setup(d=>d.GetUserDataBatch(It.IsAny<IReadOnlyList<BaseItem>>(),bob)).Returns(new Dictionary<Guid,UserItemData>());
        Assert.Throws<InvalidDataException>(()=>overview.GetActivity(alice));
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
        var episodes = new[] { new AvailableEpisode { Id = Guid.NewGuid(), SeriesId = series.Id }, new AvailableEpisode { Id = Guid.NewGuid(), SeriesId = series.Id } };
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
        available = [.. episodes, new AvailableEpisode { Id = Guid.NewGuid(), SeriesId = series.Id }];
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
        Assert.True(new Configuration().ProtectCaughtUpSeries);
        var second = new Movie { Id = Guid.NewGuid(), Name = "Second" };
        library.Setup(l => l.GetItemById<BaseItem>(second.Id, It.IsAny<User>())).Returns(second);
        library.Setup(l => l.GetItemList(It.IsAny<InternalItemsQuery>())).Returns((InternalItemsQuery q) =>
            q.IncludeItemTypes.SequenceEqual(new[] { BaseItemKind.Movie }) && q.IsPlayed == true ? [movie, second] : []);
        foreach (var item in new[] { movie, second }) states[(bob.Id, item.Id)] = new() { Key = "test", Played = true, LastPlayedDate = DateTime.UtcNow.AddDays(-1) };
        var result = new InterestOverviewService(store, library.Object, users.Object, sessions.Object, service).GetActivity(alice, limit: 1);
        Assert.True(result.LimitReached); Assert.False(result.IsComplete); Assert.Single(result.Items);
        library.Verify(l => l.GetItemList(It.Is<InternalItemsQuery>(q => q.IncludeItemTypes.SequenceEqual(new[] { BaseItemKind.Movie }) && q.Limit == 2)), Times.Exactly(2));
    }

    [Theory]
    [InlineData("Continuing", "CaughtUp")]
    [InlineData("Ended", "Watched")]
    [InlineData(null, "Watched")]
    [InlineData("Unreleased", "Watched")]
    public async Task NativeSeriesStatusClassifiesOnlyActivity(string? nativeStatus, string expected)
    {
        alice.SetPermission(PermissionKind.IsAdministrator, true);
        var series = new Series { Id = Guid.NewGuid(), Name = "Series", Status = nativeStatus is null ? null : Enum.Parse<MediaBrowser.Model.Entities.SeriesStatus>(nativeStatus) };
        var date = DateTime.UtcNow.AddDays(-2);
        var episode = new AvailableEpisode { Id = Guid.NewGuid(), SeriesId = series.Id, PremiereDate = date };
        foreach (var item in new BaseItem[] { series, episode }) library.Setup(l => l.GetItemById<BaseItem>(item.Id, It.IsAny<User>())).Returns(item);
        IReadOnlyList<BaseItem> available = [episode];
        library.Setup(l => l.GetItemList(It.IsAny<InternalItemsQuery>())).Returns((InternalItemsQuery q) => q.AncestorIds.Contains(series.Id) ? available : [episode]);
        states[(bob.Id, episode.Id)] = new() { Key = "test", Played = true, LastPlayedDate = date };
        states[(alice.Id, episode.Id)] = new() { Key = "test", PlaybackPositionTicks = 42, LastPlayedDate = date };
        var activity = Assert.Single((await Activity()).Items);
        Assert.Equal(new[] { expected }, activity.Users.Single(u => u.UserId == bob.Id).Reasons);
        Assert.Equal(new[] { "InProgress" }, activity.Users.Single(u => u.UserId == alice.Id).Reasons);
        if (nativeStatus == "Continuing") Assert.Contains("CaughtUp", Status(series).Users.Single(u => u.UserId == bob.Id).Reasons);
        else Assert.DoesNotContain(Status(series).Users, u => u.UserId == bob.Id);
        Assert.Equal(new[] { "InProgress" }, Status(series).Users.Single(u => u.UserId == alice.Id).Reasons);
        store.Set(bob.Id, series.Id, true);
        Assert.Contains("Watchlisted", Status(series).Users.Single(u => u.UserId == bob.Id).Reasons);
        Assert.Single(store.Read());
        available = [episode, new AvailableEpisode { Id = Guid.NewGuid(), SeriesId = series.Id, PremiereDate = date }];
        Assert.Equal(new[] { "InProgress" }, Assert.Single((await Activity()).Items).Users.Single(u => u.UserId == bob.Id).Reasons);
        Assert.Contains("Watchlisted", Status(series).Users.Single(u => u.UserId == bob.Id).Reasons);
    }

    [Theory]
    [InlineData("future", true)]
    [InlineData("futureAvailable", true)]
    [InlineData("missing", false)]
    [InlineData("undated", false)]
    [InlineData("unknownDateAvailable", false)]
    public async Task CaughtUpRequiresAiredEpisodeCoverage(string kind, bool expected)
    {
        alice.SetPermission(PermissionKind.IsAdministrator, true);
        var series = new Series { Id = Guid.NewGuid(), Status = MediaBrowser.Model.Entities.SeriesStatus.Continuing };
        var aired = new AvailableEpisode { Id = Guid.NewGuid(), SeriesId = series.Id, PremiereDate = DateTime.UtcNow.AddDays(-5) };
        Episode extra = kind.EndsWith("Available", StringComparison.Ordinal) ? new AvailableEpisode() : new AvailableEpisode();
        extra.Id = Guid.NewGuid(); extra.SeriesId = series.Id; extra.IsVirtualItem = !kind.EndsWith("Available", StringComparison.Ordinal);
        extra.PremiereDate = kind.StartsWith("future", StringComparison.Ordinal) ? DateTime.UtcNow.AddDays(5) : kind == "missing" ? DateTime.UtcNow.AddDays(-1) : null;
        foreach (var item in new BaseItem[] { series, aired, extra }) library.Setup(l => l.GetItemById<BaseItem>(item.Id, It.IsAny<User>())).Returns(item);
        library.Setup(l => l.GetItemList(It.IsAny<InternalItemsQuery>())).Returns((InternalItemsQuery q) => q.AncestorIds.Contains(series.Id) ? [aired, extra] : [aired]);
        states[(bob.Id, aired.Id)] = new() { Key = "test", Played = true, LastPlayedDate = DateTime.UtcNow.AddDays(-1) };
        states[(bob.Id, extra.Id)] = new() { Key = "test", Played = true };
        if (kind == "futureAvailable") sessions.Setup(s => s.Sessions).Returns([new SessionInfo(sessions.Object, NullLogger.Instance)
            { UserId = bob.Id, NowPlayingItem = new BaseItemDto { Id = extra.Id } }]);
        var result = await Activity();
        Assert.Equal(expected, result.Items.SelectMany(i => i.Users).Any(u => u.Reasons.Contains("CaughtUp")));
        if (expected) { var owner = Assert.Single(Assert.Single(result.Items).Users); Assert.Equal(1, owner.AvailableEpisodes); Assert.Equal(1, owner.WatchedEpisodes); }
        else Assert.Contains("coverage", result.Notice, StringComparison.Ordinal);
        if (kind == "futureAvailable") Assert.Contains("CurrentlyPlaying", Assert.Single(Assert.Single(result.Items).Users).Reasons);
        var targeted = service.GetSeriesActivity(series, alice.Id);
        Assert.Equal(expected, targeted.Users.Any(u => u.Reasons.Contains("CaughtUp")));
        if (expected) Assert.Contains("CaughtUp", Status(series).Users.Single(u => u.UserId == bob.Id).Reasons);
        else Assert.Throws<InvalidDataException>(() => Status(series));
        library.Verify(l => l.GetItemList(It.Is<InternalItemsQuery>(q => q.AncestorIds.Contains(series.Id))), Times.Exactly(6));
    }


    [Fact]
    public async Task TargetedSeriesActivityIsPrivateFreshAndIndependentOfWatchlists()
    {
        var series = new Series { Id = Guid.NewGuid(), Name = "Series", Status = MediaBrowser.Model.Entities.SeriesStatus.Continuing };
        var first = new AvailableEpisode { Id = Guid.NewGuid(), PremiereDate = DateTime.UtcNow.AddDays(-5) };
        var second = new AvailableEpisode { Id = Guid.NewGuid(), PremiereDate = DateTime.UtcNow.AddDays(-4) };
        library.Setup(l => l.GetItemById<BaseItem>(series.Id, It.IsAny<User>())).Returns(series);
        library.Setup(l => l.GetItemList(It.IsAny<InternalItemsQuery>())).Returns([first, second]);
        states[(bob.Id, first.Id)] = new() { Key = "first", Played = true, LastPlayedDate = DateTime.UtcNow.AddDays(-1) };
        Assert.IsType<ForbidResult>(await Controller().SeriesActivity(series.Id));
        alice.SetPermission(PermissionKind.IsAdministrator, true);
        var result = Assert.IsType<SeriesActivity>(Assert.IsType<OkObjectResult>(await Controller().SeriesActivity(series.Id)).Value);
        var viewer = Assert.Single(result.Users);
        Assert.Equal(bob.Id, viewer.UserId); Assert.Equal(1, viewer.WatchedEpisodes); Assert.Equal(2, viewer.AvailableEpisodes);
        Assert.True(viewer.CoverageComplete); Assert.Equal(new[] { "InProgress" }, viewer.Reasons);
        Assert.NotNull(viewer.LastPlayedDate); Assert.False(viewer.Watchlisted); Assert.Empty(store.Read());
        states[(bob.Id, second.Id)] = new() { Key = "second", Played = true };
        Assert.Contains("CaughtUp", Assert.Single(service.GetSeriesActivity(series, alice.Id).Users).Reasons);
        Assert.Contains("CaughtUp", Assert.Single(Status(series).Users).Reasons);
        second.PremiereDate = null;
        viewer = Assert.Single(service.GetSeriesActivity(series, alice.Id).Users);
        Assert.False(viewer.CoverageComplete); Assert.Contains("Unknown", viewer.Reasons); Assert.Throws<InvalidDataException>(() => Status(series));
        bob.SetPermission(PermissionKind.IsDisabled, true);
        Assert.Empty(service.GetSeriesActivity(series, alice.Id).Users);
        SignIn(null); Assert.IsType<UnauthorizedResult>(await Controller().SeriesActivity(series.Id));
        library.Verify(l => l.GetItemList(It.Is<InternalItemsQuery>(q => q.AncestorIds.Length == 0)), Times.Never);
    }

    [Fact]
    public async Task TargetedActivityRejectsMissingAndHiddenSeriesAndPlaybackFailures()
    {
        alice.SetPermission(PermissionKind.IsAdministrator, true);
        Assert.IsType<NotFoundResult>(await Controller().SeriesActivity(movie.Id));
        Assert.IsType<NotFoundResult>(await Controller().SeriesActivity(Guid.NewGuid()));
        var series = new Series { Id = Guid.NewGuid() };
        library.Setup(l => l.GetItemById<BaseItem>(series.Id, It.IsAny<User>())).Returns(series);
        library.Setup(l => l.GetItemList(It.IsAny<InternalItemsQuery>())).Throws(new IOException("private"));
        Assert.Equal(503, Assert.IsType<ObjectResult>(await Controller().SeriesActivity(series.Id)).StatusCode);
        Assert.Equal(503, Assert.IsType<ObjectResult>(await Controller().Protection(series.Id)).StatusCode);
    }

    [Fact]
    public void TargetedSeriesUsesAlternateResumeAndSessionWithoutWritingMembership()
    {
        var series = new Series { Id = Guid.NewGuid(), Status = MediaBrowser.Model.Entities.SeriesStatus.Continuing };
        var episode = new AvailableEpisode { Id = Guid.NewGuid(), PremiereDate = DateTime.UtcNow.AddDays(-5) };
        var alternate = new AvailableEpisode { Id = Guid.NewGuid(), PrimaryVersionId = episode.Id };
        library.Setup(l => l.GetItemById<BaseItem>(series.Id, It.IsAny<User>())).Returns(series);
        library.Setup(l => l.GetItemById<BaseItem>(alternate.Id, bob)).Returns(alternate);
        library.Setup(l => l.GetItemList(It.IsAny<InternalItemsQuery>())).Returns([episode]);
        var last = DateTime.UtcNow.AddDays(-1);
        data.Setup(d => d.GetResumeUserDataBatch(It.IsAny<IReadOnlyList<BaseItem>>(), bob))
            .Returns(new Dictionary<Guid, VersionResumeData> { [episode.Id] = new(alternate.Id, new() { Key = "alternate", Played = true, LastPlayedDate = last }) });
        sessions.Setup(s => s.Sessions).Returns([new SessionInfo(sessions.Object, NullLogger.Instance)
            { UserId = bob.Id, NowPlayingItem = new BaseItemDto { Id = alternate.Id } }]);
        var owner = Assert.Single(service.GetSeriesActivity(series, alice.Id).Users);
        Assert.Equal(new[] { "CurrentlyPlaying", "CaughtUp" }, owner.Reasons);
        Assert.Equal(last, owner.LastPlayedDate); Assert.Equal(1, owner.WatchedEpisodes); Assert.True(owner.CurrentlyPlaying);
        Assert.Empty(store.Read()); Assert.Equal(owner.Reasons, Assert.Single(Status(series).Users).Reasons);
        library.Setup(l => l.GetItemById<BaseItem>(series.Id, bob)).Returns((BaseItem?)null);
        Assert.Empty(service.GetSeriesActivity(series, alice.Id).Users);
    }

    [Fact]
    public void TargetedUserBudgetIsExplicitAndDeletionCannotUsePartialResults()
    {
        var accounts = Enumerable.Range(0, InterestOverviewService.UserLimit + 1)
            .Select(i => new User("User" + i, "test", "test") { Id = Guid.NewGuid() }).ToArray();
        users.Setup(u => u.GetUsers()).Returns(accounts);
        foreach (var user in accounts) users.Setup(u => u.GetUserById(user.Id)).Returns(user);
        var series = new Series { Id = Guid.NewGuid() };
        library.Setup(l => l.GetItemById<BaseItem>(series.Id, It.IsAny<User>())).Returns(series);
        var result = service.GetSeriesActivity(series, alice.Id);
        Assert.False(result.IsComplete); Assert.True(result.LimitReached);
        Assert.Throws<InvalidDataException>(() => Status(series));
        library.Verify(l => l.GetItemList(It.IsAny<InternalItemsQuery>()), Times.Exactly(100));
    }

    [Theory]
    [InlineData(-1, 4, 0, null)]
    [InlineData(0, 3, 1, "ReleaseDay")]
    [InlineData(1, 3, 1, "Future")]
    [InlineData(null, 3, 1, "UnknownDate")]
    public async Task ExtraProgressUsesNativeReleaseDayBoundaryWithoutChangingProtection(int? days, int airedCount, int extraCount, string? releaseStatus)
    {
        alice.SetPermission(PermissionKind.IsAdministrator, true);
        var series = new Series { Id = Guid.NewGuid(), Name = "Series", Status = MediaBrowser.Model.Entities.SeriesStatus.Continuing };
        var episodes = Enumerable.Range(1, 4).Select(n => new AvailableEpisode { Id = Guid.NewGuid(), Name = "Episode " + n,
            SeriesId = series.Id, ParentIndexNumber = 1, IndexNumber = n, PremiereDate = DateTime.Now.Date.AddDays(-5).ToUniversalTime() }).ToArray();
        episodes[3].PremiereDate = days.HasValue ? DateTime.Now.Date.AddDays(days.Value).ToUniversalTime() : null;
        Assert.Equal(days.HasValue && days >= 0, episodes[3].IsUnaired);
        library.Setup(l => l.GetItemById<BaseItem>(series.Id, It.IsAny<User>())).Returns(series);
        library.Setup(l => l.GetItemList(It.IsAny<InternalItemsQuery>())).Returns((InternalItemsQuery q) => q.AncestorIds.Contains(series.Id) ? episodes : [episodes[0]]);
        foreach (var e in episodes.Take(3)) states[(bob.Id, e.Id)] = new() { Key = "test", Played = true, LastPlayedDate = DateTime.UtcNow.AddDays(-1) };
        foreach (var e in episodes) library.Setup(l => l.GetItemById<BaseItem>(e.Id, It.IsAny<User>())).Returns(e);
        var before = days.HasValue ? System.Text.Json.JsonSerializer.Serialize(Status(series)) : null;
        var targeted = service.GetSeriesActivity(series, alice.Id);
        var row = targeted.Users.Single(u => u.UserId == bob.Id);
        Assert.True(row.ProtectionInProgress);
        Assert.Equal(days.HasValue, row.CoverageComplete);
        var progress = Assert.IsType<EpisodeProgress>(row.EpisodeProgress);
        Assert.Equal(airedCount, progress.AiredAvailable); Assert.Equal(3, progress.AiredWatched); Assert.Equal(extraCount, progress.ExtraEpisodes.Length);
        if (extraCount > 0)
        {
            var e = Assert.Single(progress.ExtraEpisodes); Assert.Equal(releaseStatus, e.ReleaseStatus);
            Assert.False(e.Watched); Assert.Equal(episodes[3].Id, e.ItemId); Assert.Equal(1, e.SeasonNumber); Assert.Equal(4, e.EpisodeNumber);
        }
        var overview = (await Activity()).Items.Single().Users.Single(u => u.UserId == bob.Id);
        Assert.Equal(progress.AiredAvailable, overview.EpisodeProgress!.AiredAvailable);
        Assert.Equal(progress.ExtraEpisodes, overview.EpisodeProgress.ExtraEpisodes);
        if (days is null) { Assert.False(row.CoverageComplete); Assert.DoesNotContain("CaughtUp", row.Reasons); Assert.Throws<InvalidDataException>(() => Status(series)); }
        else { Assert.True(Status(series).HasInterest); Assert.Equal(before, System.Text.Json.JsonSerializer.Serialize(Status(series))); }
        Assert.Empty(store.Read());
    }

    [Fact]
    public async Task ExtrasUseVisibleNativeRowsAndAlternatePlaybackWithoutLeakingBetweenAccounts()
    {
        alice.SetPermission(PermissionKind.IsAdministrator, true);
        var series = new Series { Id = Guid.NewGuid(), Name = "Series", Status = MediaBrowser.Model.Entities.SeriesStatus.Continuing };
        var aired = new AvailableEpisode { Id = Guid.NewGuid(), SeriesId = series.Id, PremiereDate = DateTime.UtcNow.AddDays(-5) };
        var future = new AvailableEpisode { Id = Guid.NewGuid(), SeriesId = series.Id, Name = "<unsafe>", PremiereDate = DateTime.UtcNow.AddDays(5) };
        var releaseDay = new AvailableEpisode { Id = Guid.NewGuid(), SeriesId = series.Id, PremiereDate = DateTime.Now.Date.ToUniversalTime() };
        var placeholder = new AvailableEpisode { Id = Guid.NewGuid(), IsVirtualItem = true, SeriesId = series.Id, PremiereDate = future.PremiereDate };
        var missing = new MissingEpisode { Id = Guid.NewGuid(), SeriesId = series.Id, PremiereDate = future.PremiereDate };
        library.Setup(l => l.GetItemById<BaseItem>(series.Id, It.IsAny<User>())).Returns(series);
        library.Setup(l => l.GetItemList(It.IsAny<InternalItemsQuery>())).Returns((InternalItemsQuery q) =>
            q.AncestorIds.Contains(series.Id) ? q.User.Id == alice.Id ? [aired, future, releaseDay, placeholder, missing] : [aired, releaseDay] : [aired]);
        states[(alice.Id, aired.Id)] = new() { Key = "test", Played = true };
        states[(bob.Id, aired.Id)] = new() { Key = "test", Played = true };
        states[(bob.Id, releaseDay.Id)] = new() { Key = "test", Played = true };
        data.Setup(d => d.GetResumeUserDataBatch(It.IsAny<IReadOnlyList<BaseItem>>(), It.IsAny<User>()))
            .Returns((IReadOnlyList<BaseItem> rows, User u) => rows.Where(e => e.Id == future.Id && u.Id == alice.Id)
                .ToDictionary(e => e.Id, e => new VersionResumeData(Guid.NewGuid(), new UserItemData { Key = "alternate", Played = true })));
        library.Setup(l => l.GetItemById<BaseItem>(aired.Id, It.IsAny<User>())).Returns(aired);
        var panel = service.GetSeriesActivity(series, alice.Id);
        var a = panel.Users.Single(u => u.UserId == alice.Id).EpisodeProgress!;
        var b = panel.Users.Single(u => u.UserId == bob.Id).EpisodeProgress!;
        Assert.Equal(2, a.ExtraEpisodes.Length); Assert.True(a.ExtraEpisodes.Single(e => e.ItemId == future.Id).Watched);
        Assert.False(a.ExtraEpisodes.Single(e => e.ItemId == releaseDay.Id).Watched);
        Assert.True(Assert.Single(b.ExtraEpisodes).Watched);
        var activity = await Activity();
        foreach (var owner in activity.Items.Single().Users)
            Assert.Equal(panel.Users.Single(u => u.UserId == owner.UserId).EpisodeProgress!.ExtraEpisodes, owner.EpisodeProgress!.ExtraEpisodes);
        // Informational reads do not add per-episode calls; authorization still runs per account.
        data.Verify(d => d.GetUserDataBatch(It.IsAny<IReadOnlyList<BaseItem>>(), It.IsAny<User>()), Times.Exactly(4));
        SignIn(bob);
        Assert.IsType<ForbidResult>(await Controller().SeriesActivity(series.Id));
        Assert.IsType<ForbidResult>(await Controller().Activity());
        var personal = Assert.IsType<InterestOverview>(Assert.IsType<OkObjectResult>(await Controller().OwnActivity()).Value);
        var personalUser = Assert.Single(Assert.Single(personal.Items).Users);
        Assert.Equal(bob.Id, personalUser.UserId); Assert.Equal(b.ExtraEpisodes, personalUser.EpisodeProgress!.ExtraEpisodes);
        // A changed visibility set must be re-queried on the next request, not cached across accounts/requests.
        library.Setup(l => l.GetItemList(It.IsAny<InternalItemsQuery>())).Returns((InternalItemsQuery q) => q.AncestorIds.Contains(series.Id) ? [aired] : [aired]);
        Assert.Empty(service.GetSeriesActivity(series, alice.Id).Users.Single(u => u.UserId == bob.Id).EpisodeProgress!.ExtraEpisodes);
        Assert.Empty(store.Read());
    }

    private sealed class MissingEpisode : Episode
    {
        public override MediaBrowser.Model.Entities.LocationType LocationType => MediaBrowser.Model.Entities.LocationType.Virtual;
    }

    private sealed class AvailableEpisode : Episode
    {
        public override MediaBrowser.Model.Entities.LocationType LocationType => MediaBrowser.Model.Entities.LocationType.FileSystem;
    }

}
