using System.Security.Claims;
using Jellyfin.Plugin.WatchGuard;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Xunit;

namespace WatchGuard.Tests;

public sealed class ProtectionTests : IDisposable
{
    private readonly string _directory = Path.Combine(Path.GetTempPath(), "watchguard-test-" + Guid.NewGuid());
    private readonly FakeCatalog _catalog = new();
    private readonly WatchlistStore _store;
    private readonly ProtectionService _service;
    public ProtectionTests()
    {
        _store = new WatchlistStore(_directory);
        _service = new ProtectionService(_catalog, _store);
    }

    [Fact]
    public void TwoUsersAreDeduplicatedWhenWatchlistedAndPartiallyWatching()
    {
        foreach (var user in _catalog.Viewers)
        {
            _store.Set(user.Id, _catalog.Movie.Id, true);
            _catalog.States[user.Id] = [new(false, 50)];
        }
        var result = _service.Get(_catalog.Movie, _catalog.Admin);
        Assert.Equal(2, result.Users.Length);
        Assert.All(result.Users, user => Assert.Equal(new[] { "Watchlisted", "Partially watched" }, user.Reasons));
    }

    [Fact]
    public void PartialMovieIsProtected()
    {
        _catalog.States[_catalog.Member.Id] = [new(false, 1)];
        Assert.Equal("Partially watched", Assert.Single(Assert.Single(_service.Get(_catalog.Movie, _catalog.Admin).Users).Reasons));
    }

    [Fact]
    public void PartialSeriesIncludesCompletedAndUnstartedEpisodes()
    {
        _catalog.States[_catalog.Member.Id] = [new(true, 0), new(false, 0)];
        Assert.Single(_service.Get(_catalog.Series, _catalog.Admin).Users);
        _catalog.States[_catalog.Member.Id] = [new(false, 1), new(false, 0)];
        Assert.Single(_service.Get(_catalog.Series, _catalog.Admin).Users);
    }

    [Fact]
    public void FullyWatchedWithoutManualEntryIsNotProtected()
    {
        _catalog.States[_catalog.Member.Id] = [new(true, 100), new(true, 0)];
        Assert.Empty(_service.Get(_catalog.Series, _catalog.Admin).Users);
        _catalog.States[_catalog.Member.Id] = [new(true, 100)];
        Assert.Empty(_service.Get(_catalog.Movie, _catalog.Admin).Users);
    }

    [Fact]
    public void ManualEntryRemainsAfterPlaybackCompletionAndRestart()
    {
        _store.Set(_catalog.Member.Id, _catalog.Movie.Id, true);
        _catalog.States[_catalog.Member.Id] = [new(true, 0)];
        Assert.Equal("Watchlisted", Assert.Single(Assert.Single(_service.Get(_catalog.Movie, _catalog.Admin).Users).Reasons));
        Assert.Contains(new Entry(_catalog.Member.Id, _catalog.Movie.Id), new WatchlistStore(_directory).Snapshot());
    }

    [Fact]
    public void ActiveSessionProtectsEvenCompletedContent()
    {
        _catalog.States[_catalog.Member.Id] = [new(true, 0, true)];
        Assert.Equal("Currently watching", Assert.Single(Assert.Single(_service.Get(_catalog.Movie, _catalog.Admin).Users).Reasons));
    }

    [Fact]
    public void NoEpisodesOrUnstartedEpisodesHaveNoImplicitInterest()
    {
        Assert.Empty(_service.Get(_catalog.Series, _catalog.Admin).Users);
        _catalog.States[_catalog.Member.Id] = [new(false, 0), new(false, 0)];
        Assert.Empty(_service.Get(_catalog.Series, _catalog.Admin).Users);
    }

    [Fact]
    public void NonAdminCannotReadCrossUserStatusOrMutateAnotherWatchlist()
    {
        _store.Set(_catalog.Admin.Id, _catalog.Movie.Id, true);
        var controller = Controller(_catalog.Member.Id);
        Assert.IsType<ForbidResult>(controller.Status(_catalog.Movie.Id).Result);
        Assert.Empty(controller.List().Value!);
        Assert.IsType<NoContentResult>(controller.Remove(_catalog.Movie.Id));
        Assert.Contains(new Entry(_catalog.Admin.Id, _catalog.Movie.Id), _store.Snapshot());
        Assert.IsType<NoContentResult>(controller.Add(_catalog.Movie.Id));
        Assert.Contains(new Entry(_catalog.Member.Id, _catalog.Movie.Id), _store.Snapshot());
        Assert.Throws<UnauthorizedAccessException>(() => _service.Get(_catalog.Movie, _catalog.Member));
    }

    [Fact]
    public void MissingDeletedOrInaccessibleTitlesReturn404AndStaleEntriesCanBeRemoved()
    {
        var controller = Controller(_catalog.Member.Id);
        _store.Set(_catalog.Member.Id, _catalog.Movie.Id, true);
        _catalog.Hidden = true;
        Assert.IsType<NotFoundResult>(controller.Add(_catalog.Movie.Id));
        Assert.IsType<NotFoundResult>(controller.Contains(_catalog.Movie.Id));
        Assert.IsType<NotFoundResult>(Controller(_catalog.Admin.Id).Status(_catalog.Movie.Id).Result);
        Assert.Empty(controller.List().Value!);
        Assert.IsType<NoContentResult>(controller.Remove(_catalog.Movie.Id));
        Assert.Empty(_store.Snapshot());
    }

    [Fact]
    public void RemovedUsersAndApiKeysCannotReadOrWrite()
    {
        _store.Set(Guid.NewGuid(), _catalog.Movie.Id, true);
        Assert.Empty(_service.Get(_catalog.Movie, _catalog.Admin).Users);
        Assert.IsType<UnauthorizedResult>(Controller(Guid.NewGuid()).Add(_catalog.Movie.Id));
        Assert.IsType<UnauthorizedResult>(Controller(null).List().Result);
        Assert.IsType<UnauthorizedResult>(Controller(null).Status(_catalog.Movie.Id).Result);
    }

    [Fact]
    public void StoreRejectsUnknownVersionWithoutOverwriting()
    {
        Directory.CreateDirectory(_directory);
        var path = Path.Combine(_directory, "watchlists.json");
        const string text = "{\"Version\":2,\"Entries\":[]}";
        File.WriteAllText(path, text);
        Assert.Throws<InvalidDataException>(() => _store.Set(_catalog.Member.Id, _catalog.Movie.Id, true));
        Assert.Equal(text, File.ReadAllText(path));
    }

    [Fact]
    public void ConcurrentUpdatesPersistWithoutLostEntries()
    {
        Parallel.For(0, 32, _ => _store.Set(Guid.NewGuid(), _catalog.Movie.Id, true));
        Assert.Equal(32, new WatchlistStore(_directory).Snapshot().Count);
    }

    private WatchGuardController Controller(Guid? id)
    {
        var claims = id.HasValue ? new[] { new Claim("Jellyfin-UserId", id.ToString()!) } : [];
        return new(_catalog, _store, _service)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity(claims, "test")) }
            }
        };
    }

    public void Dispose() { if (Directory.Exists(_directory)) Directory.Delete(_directory, true); }

    private sealed class FakeCatalog : ICatalog
    {
        public Viewer Admin { get; } = new(Guid.NewGuid(), "Admin", true);
        public Viewer Member { get; } = new(Guid.NewGuid(), "Member", false);
        public Title Movie { get; } = new(Guid.NewGuid(), "Movie", false);
        public Title Series { get; } = new(Guid.NewGuid(), "Series", true);
        public bool Hidden { get; set; }
        public Viewer[] Viewers => [Admin, Member];
        public Dictionary<Guid, IReadOnlyList<Playback>> States { get; } = [];
        public Viewer? FindUser(Guid id) => Viewers.SingleOrDefault(u => u.Id == id);
        public IEnumerable<Viewer> Users() => Viewers;
        public Title? FindTitle(Guid itemId, Guid userId) => Hidden ? null : new[] { Movie, Series }.SingleOrDefault(t => t.Id == itemId);
        public IReadOnlyList<Playback> PlaybackFor(Title title, Guid userId) => States.GetValueOrDefault(userId, []);
    }
}
