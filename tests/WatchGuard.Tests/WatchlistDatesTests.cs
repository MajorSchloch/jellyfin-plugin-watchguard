using System.Text.Json;
using System.Text.Json.Serialization;
using Jellyfin.Plugin.WatchGuard;
using Xunit;

namespace WatchGuard.Tests;

public sealed class WatchlistDatesTests : IDisposable
{
    private sealed class ManualClock : TimeProvider
    {
        public DateTimeOffset Current { get; set; } = new(2026, 10, 18, 12, 0, 0, TimeSpan.Zero);
        public override DateTimeOffset GetUtcNow() => Current;
    }

    private readonly string directory = Path.Combine(Path.GetTempPath(), "watchguard-dates-" + Guid.NewGuid().ToString("N"));
    private readonly Guid alice = Guid.NewGuid();
    private readonly Guid bob = Guid.NewGuid();
    private readonly Guid movie = Guid.NewGuid();
    private readonly ManualClock clock = new();
    private string Primary => Path.Combine(directory, "watchlists.json");
    private string Dates => Path.Combine(directory, "watchlist-dates.json");
    private WatchlistStore NewStore() => new(directory, clock);

    public void Dispose() { if (Directory.Exists(directory)) Directory.Delete(directory, true); }

    [Fact]
    public void FreshAddIsUtcIdempotentAndReaddingCreatesANewDate()
    {
        var store = NewStore();
        Assert.Empty(store.ReadDated());
        store.Set(alice, movie, true);
        var initial = Assert.Single(store.ReadDated());
        Assert.Equal(clock.Current, initial.AddedAtUtc);
        var primary = File.ReadAllBytes(Primary);
        var sidecar = File.ReadAllBytes(Dates);
        clock.Current = clock.Current.AddDays(3);
        store.Set(alice, movie, true);
        Assert.Equal(primary, File.ReadAllBytes(Primary)); // Must not renew filesystem stamp.
        Assert.Equal(sidecar, File.ReadAllBytes(Dates));
        Assert.Equal(initial.AddedAtUtc, Assert.Single(store.ReadDated()).AddedAtUtc);
        store.Set(alice, movie, false);
        Assert.Empty(store.ReadDated());
        store.Set(alice, movie, true);
        Assert.Equal(clock.Current, Assert.Single(NewStore().ReadDated()).AddedAtUtc);
        Assert.Empty(Directory.GetFiles(directory, "*.tmp"));
    }

    [Fact]
    public void LegacySchemaRemainsReadableAndNoHistoricalDatesAreFabricated()
    {
        Directory.CreateDirectory(directory);
        var old = new WatchlistDocument(1, [new(alice, movie)]);
        File.WriteAllText(Primary, JsonSerializer.Serialize(old));
        var store = NewStore();
        Assert.Null(Assert.Single(store.ReadDated()).AddedAtUtc);
        Assert.False(File.Exists(Dates)); // Reading does not migrate or rewrite anything.
        clock.Current = clock.Current.AddHours(1);
        store.Set(bob, movie, true);
        var entries = store.ReadDated().OrderBy(x => x.UserId).ToArray();
        Assert.Null(entries.Single(x => x.UserId == alice).AddedAtUtc);
        Assert.Equal(clock.Current, entries.Single(x => x.UserId == bob).AddedAtUtc);
        var strictLegacy = new JsonSerializerOptions { UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow };
        var document = JsonSerializer.Deserialize<WatchlistDocument>(File.ReadAllText(Primary), strictLegacy);
        Assert.Equal(1, document!.Version);
        Assert.Equal(2, document.Entries.Length);
    }

    [Fact]
    public void LegacyRewriteOfIdenticalMembershipInvalidatesStaleDate()
    {
        var store = NewStore();
        store.Set(alice, movie, true);
        Assert.NotNull(Assert.Single(store.ReadDated()).AddedAtUtc);
        // Simulate the old v0.4.10 atomic replacement, including an unchanged
        // identity set after a legacy remove/re-add. Explicitly change mtime so
        // this regression is not dependent on OS timestamp resolution.
        var oldFile = File.ReadAllBytes(Primary);
        var originalWrite = File.GetLastWriteTimeUtc(Primary);
        var temp = Primary + ".legacy.tmp";
        File.WriteAllBytes(temp, oldFile);
        File.Move(temp, Primary, overwrite: true);
        File.SetLastWriteTimeUtc(Primary, originalWrite.AddSeconds(3));
        Assert.Null(Assert.Single(store.ReadDated()).AddedAtUtc);
        Assert.Single(store.Read()); // Protection's authoritative membership remains.
        Assert.True(File.Exists(Dates)); // Older JSON metadata is preserved for recovery.
    }

    [Fact]
    public void MismatchedSidecarNeverReassignsStaleDateToLaterMembership()
    {
        var store = NewStore();
        store.Set(alice, movie, true);
        var first = File.ReadAllBytes(Dates);
        store.Set(bob, movie, true);
        File.WriteAllBytes(Dates, first); // Crash/restore with previous metadata.
        Assert.All(store.ReadDated(), x => Assert.Null(x.AddedAtUtc));
        clock.Current = clock.Current.AddDays(1);
        var another = Guid.NewGuid();
        store.Set(bob, another, true);
        Assert.Equal(clock.Current, store.ReadDated().Single(x => x.ItemId == another).AddedAtUtc);
        Assert.All(store.ReadDated().Where(x => x.ItemId == movie), x => Assert.Null(x.AddedAtUtc));
    }

    [Theory]
    [InlineData("{broken")]
    [InlineData("{\"Version\":2,\"MembershipFingerprint\":\"abc\",\"Entries\":[]}")]
    [InlineData("{\"Version\":1,\"MembershipFingerprint\":\"abc\",\"Entries\":null}")]
    public void DamagedTimestampMetadataCannotBeOverwrittenOrWeakenDeletionProtection(string invalid)
    {
        var store = NewStore();
        store.Set(alice, movie, true);
        var primary = File.ReadAllBytes(Primary);
        File.WriteAllText(Dates, invalid);
        Assert.Single(store.Read()); // Server enforcement ignores date storage.
        Assert.ThrowsAny<Exception>(() => store.ReadDated());
        Assert.ThrowsAny<Exception>(() => store.Set(bob, movie, true));
        Assert.Equal(primary, File.ReadAllBytes(Primary));
        Assert.Equal(invalid, File.ReadAllText(Dates));
        Assert.Empty(Directory.GetFiles(directory, "*.tmp"));
    }

    [Fact]
    public void ConcurrentAddsAndRemovalsMaintainMembershipAndDatesWithoutTemporaryFiles()
    {
        var store = NewStore();
        var ids = Enumerable.Range(0, 40).Select(_ => Guid.NewGuid()).ToArray();
        Parallel.ForEach(ids, id => store.Set(alice, id, true));
        Assert.Equal(40, NewStore().ReadDated().Length);
        Assert.All(store.ReadDated(), x => Assert.Equal(clock.Current, x.AddedAtUtc));
        Parallel.ForEach(ids.Where((_, index) => index % 2 == 0), id => store.Set(alice, id, false));
        var remaining = NewStore().ReadDated();
        Assert.Equal(20, remaining.Length);
        Assert.All(remaining, x => Assert.Equal(clock.Current, x.AddedAtUtc));
        Assert.Empty(Directory.GetFiles(directory, "*.tmp"));
    }
}
