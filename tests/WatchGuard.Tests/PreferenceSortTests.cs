using System.Text.Json;
using System.Text.Json.Serialization;
using Jellyfin.Plugin.WatchGuard;
using Xunit;

namespace WatchGuard.Tests;

public sealed class PreferenceSortTests : IDisposable
{
    private static readonly JsonSerializerOptions LegacyOptions = new() { UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow };
    private readonly string directory = Path.Combine(Path.GetTempPath(), "watchguard-preference-sorts-" + Guid.NewGuid());
    private readonly Guid alice = Guid.NewGuid();
    private readonly Guid bob = Guid.NewGuid();
    private string Primary => Path.Combine(directory, "preferences.json");
    private string Sorts => Path.Combine(directory, "preference-sorts.json");
    private PreferenceStore Store() => new(directory);
    public void Dispose() { if (Directory.Exists(directory)) Directory.Delete(directory, true); }

    [Fact]
    public void AddedSurvivesNewInstanceAndLegacyFileStaysStrictlyCompatible()
    {
        Store().Set(alice, new("all", ["watched"], "added"));
        var actual = Store().Read(alice);
        Assert.Equal("added", actual.Sort);
        Assert.Equal("all", actual.Owner);
        Assert.Equal(["watched"], actual.Statuses);
        Assert.Equal("title", Store().Read(bob).Sort);
        var legacy = JsonSerializer.Deserialize<PreferenceDocument>(File.ReadAllText(Primary), LegacyOptions)!;
        Assert.Equal(1, legacy.Version);
        Assert.Equal("title", Assert.Single(legacy.Entries).Preferences.Sort);
        Assert.DoesNotContain("added", File.ReadAllText(Primary), StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("title")]
    [InlineData("recent")]
    [InlineData(null)]
    public void ReplacementAndResetRemoveOnlyTheCallersOverride(string? sort)
    {
        Store().Set(alice, new("all", ["watched"], "added"));
        Store().Set(bob, new("mine", [], "added"));
        Store().Set(alice, sort is null ? null : new("mine", ["watching"], sort));
        Assert.Equal(sort ?? "title", Store().Read(alice).Sort);
        Assert.Equal("added", Store().Read(bob).Sort);
        if (sort is null)
        {
            Assert.Equal("mine", Store().Read(alice).Owner);
            Assert.Equal(ViewPreferences.Defaults.Statuses, Store().Read(alice).Statuses);
            Assert.DoesNotContain(alice.ToString(), File.ReadAllText(Primary), StringComparison.Ordinal);
            Assert.DoesNotContain(alice.ToString(), File.ReadAllText(Sorts), StringComparison.Ordinal);
        }
    }

    [Theory]
    [InlineData("identical")]
    [InlineData("recent")]
    [InlineData("reset")]
    [InlineData("other-account")]
    public void LegacyAtomicSaveOrResetInvalidatesOverridesEvenIfBytesAreIdentical(string operation)
    {
        Store().Set(alice, new("mine", ["watchlisted"], "added"));
        var originalTime = File.GetLastWriteTimeUtc(Primary);
        var doc = JsonSerializer.Deserialize<PreferenceDocument>(File.ReadAllText(Primary))!;
        var replacement = operation switch
        {
            "reset" => new PreferenceDocument(1, []),
            "recent" => new PreferenceDocument(1, [new(alice, new("mine", ["watched"], "recent"))]),
            "other-account" => new PreferenceDocument(1, [.. doc.Entries, new(bob, ViewPreferences.Defaults)]),
            _ => doc
        };
        // Match the published implementation's atomic replacement; choose a
        // distinct mtime explicitly to avoid dependence on test clock granularity.
        var temp = Primary + ".legacy.tmp";
        File.WriteAllText(temp, operation == "identical" ? File.ReadAllText(Primary) : JsonSerializer.Serialize(replacement));
        File.Move(temp, Primary, true);
        File.SetLastWriteTimeUtc(Primary, originalTime.AddSeconds(2));
        Assert.Equal(operation == "recent" ? "recent" : "title", Store().Read(alice).Sort);
        // A new-version save must not rebind obsolete overrides to the new revision.
        Store().Set(bob, new("mine", [], "added"));
        Assert.NotEqual("added", Store().Read(alice).Sort);
    }

    [Theory]
    [InlineData("{broken")]
    [InlineData("{\"Version\":1,\"PreferenceFingerprint\":\"garbage\",\"AddedUsers\":[]}")]
    [InlineData("{\"Version\":2,\"PreferenceFingerprint\":\"absent\",\"AddedUsers\":[]}")]
    [InlineData("{\"Version\":1,\"PreferenceFingerprint\":\"absent\",\"AddedUsers\":null}")]
    [InlineData("{\"Version\":1,\"PreferenceFingerprint\":\"absent\",\"AddedUsers\":[],\"Unknown\":true}")]
    public void CorruptionIsPreservedAndBlocksReadSaveAndReset(string invalid)
    {
        Store().Set(alice, new("mine", [], "added"));
        var before = File.ReadAllBytes(Primary);
        File.WriteAllText(Sorts, invalid);
        Assert.ThrowsAny<Exception>(() => Store().Read(alice));
        Assert.ThrowsAny<Exception>(() => Store().Set(alice, ViewPreferences.Defaults));
        Assert.ThrowsAny<Exception>(() => Store().Set(alice, null));
        Assert.Equal(before, File.ReadAllBytes(Primary));
        Assert.Equal(invalid, File.ReadAllText(Sorts));
    }

    [Fact]
    public void IllegalAddedInLegacyFileIsStillRejected()
    {
        Directory.CreateDirectory(directory);
        var invalid = JsonSerializer.Serialize(new PreferenceDocument(1, [new(alice, new("mine", [], "added"))]));
        File.WriteAllText(Primary, invalid);
        Assert.Throws<InvalidDataException>(() => Store().Read(alice));
        Assert.Throws<InvalidDataException>(() => Store().Set(alice, null));
        Assert.Equal(invalid, File.ReadAllText(Primary));
    }

    [Fact]
    public void DuplicateEmptyAndOrphanOverridesAreRejected()
    {
        Store().Set(alice, new("mine", [], "added"));
        var valid = JsonSerializer.Deserialize<PreferenceSortDocument>(File.ReadAllText(Sorts))!;
        foreach (var ids in new[] { new[] { alice, alice }, new[] { Guid.Empty }, new[] { bob } })
        {
            File.WriteAllText(Sorts, JsonSerializer.Serialize(valid with { AddedUsers = ids }));
            Assert.Throws<InvalidDataException>(() => Store().Read(alice));
        }
    }

    [Fact]
    public void InterruptedWriteBoundariesUseFallbackAndNeverResurrectOldOverride()
    {
        Store().Set(alice, new("all", ["watched"], "added"));
        // State after durable invalidation but before legacy replacement.
        File.WriteAllText(Sorts, JsonSerializer.Serialize(new PreferenceSortDocument(1, "invalidated", [])));
        Assert.Equal("title", Store().Read(alice).Sort);
        Assert.Equal("all", Store().Read(alice).Owner);
        // State after legacy commit but before final sidecar commit.
        File.WriteAllText(Primary, JsonSerializer.Serialize(new PreferenceDocument(1, [new(alice, new("mine", [], "recent"))])));
        Assert.Equal("recent", Store().Read(alice).Sort);
        Store().Set(bob, new("mine", [], "added"));
        Assert.Equal("recent", Store().Read(alice).Sort);
        Assert.Equal("added", Store().Read(bob).Sort);
    }

    [Fact]
    public void FailedSidecarWriteReportsFailureWithoutChangingLegacyPreferences()
    {
        Store().Set(alice, new("mine", [], "recent"));
        var before = File.ReadAllBytes(Primary);
        Directory.CreateDirectory(Sorts); // File replacement must fail; no permissions assumptions.
        Assert.ThrowsAny<IOException>(() => Store().Set(alice, new("mine", [], "added")));
        Assert.Equal(before, File.ReadAllBytes(Primary));
        Assert.Empty(Directory.GetFiles(directory, "*.tmp"));
    }

    [Fact]
    public void ConcurrentAccountsRetainIndependentDefaultsAndReset()
    {
        var store = Store();
        var ids = Enumerable.Range(0, 40).Select(_ => Guid.NewGuid()).ToArray();
        Parallel.ForEach(ids, id => store.Set(id, new("mine", ["watchlisted"], "added")));
        Assert.All(ids, id => Assert.Equal("added", Store().Read(id).Sort));
        Parallel.For(0, ids.Length, i => store.Set(ids[i], i % 2 == 0 ? null : new("mine", [], "recent")));
        for (var i = 0; i < ids.Length; i++) Assert.Equal(i % 2 == 0 ? "title" : "recent", Store().Read(ids[i]).Sort);
        Assert.Empty(Directory.GetFiles(directory, "*.tmp"));
    }
}
