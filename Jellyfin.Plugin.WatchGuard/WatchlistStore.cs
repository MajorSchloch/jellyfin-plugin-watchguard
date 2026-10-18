using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Jellyfin.Plugin.WatchGuard;

public sealed record WatchlistEntry(Guid UserId, Guid ItemId);
public sealed record WatchlistDocument(int Version, WatchlistEntry[] Entries);

// v0.4.10 must continue to be able to read and write watchlists.json unchanged.
public sealed record WatchlistDateEntry(Guid UserId, Guid ItemId, DateTimeOffset AddedAtUtc);
public sealed record WatchlistDateDocument(int Version, string MembershipFingerprint, WatchlistDateEntry[] Entries);
public sealed record DatedWatchlistEntry(Guid UserId, Guid ItemId, DateTimeOffset? AddedAtUtc);

// All primary membership accesses are serialized by the existing singleton.
// No cached copy can overwrite damaged data. The versioned metadata file is
// advisory; server deletion enforcement uses Read() and never consults it.
public sealed class WatchlistStore(string directory, TimeProvider? clock = null)
{
    private readonly object gate = new();
    private readonly string path = Path.Combine(directory, "watchlists.json");
    private readonly string datesPath = Path.Combine(directory, "watchlist-dates.json");
    private readonly TimeProvider time = clock ?? TimeProvider.System;
    private static readonly JsonSerializerOptions Options = new()
    {
        WriteIndented = true,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow
    };

    public WatchlistEntry[] Read()
    {
        lock (gate) { return ReadCore(); }
    }

    // Only explicit-watchlist API responses may receive a timestamp. A prior
    // v0.4.10 membership is always unknown until a fresh add in this version.
    public DatedWatchlistEntry[] ReadDated()
    {
        lock (gate)
        {
            var memberships = ReadCore();
            var stamps = ReadDatesCore(memberships);
            return memberships.Select(e => new DatedWatchlistEntry(e.UserId, e.ItemId,
                stamps.TryGetValue(e, out var date) ? date : null)).ToArray();
        }
    }

    private WatchlistEntry[] ReadCore()
    {
        if (!File.Exists(path)) return [];
        var document = JsonSerializer.Deserialize<WatchlistDocument>(File.ReadAllText(path), Options);
        if (document is null || document.Version != 1 || document.Entries is null ||
            document.Entries.Any(e => e is null || e.UserId == Guid.Empty || e.ItemId == Guid.Empty) ||
            document.Entries.Distinct().Count() != document.Entries.Length)
            throw new InvalidDataException("Invalid or unsupported watchlist document; original preserved.");
        return document.Entries;
    }

    // The digest alone would incorrectly restore a stale add date if an older
    // plugin removed and re-added the same (UserId,ItemId) pair. Older builds
    // atomically replace this file, so also bind to its filesystem timestamps.
    // If the legacy file is replaced or restored, dates become unknown rather
    // than guessing; dates never influence membership or deletion protection.
    private string Fingerprint()
    {
        if (!File.Exists(path)) return "absent";
        var info = new FileInfo(path);
        var bytes = File.ReadAllBytes(path);
        return Convert.ToHexString(SHA256.HashData(bytes)) + ":" +
            info.LastWriteTimeUtc.Ticks.ToString(CultureInfo.InvariantCulture) + ":" +
            info.CreationTimeUtc.Ticks.ToString(CultureInfo.InvariantCulture);
    }

    private Dictionary<WatchlistEntry, DateTimeOffset> ReadDatesCore(WatchlistEntry[] memberships)
    {
        var dates = new Dictionary<WatchlistEntry, DateTimeOffset>();
        if (!File.Exists(datesPath)) return dates;
        var document = JsonSerializer.Deserialize<WatchlistDateDocument>(File.ReadAllText(datesPath), Options);
        if (document is null || document.Version != 1 || document.MembershipFingerprint is null ||
            document.Entries is null || document.Entries.Any(e =>
                e is null || e.UserId == Guid.Empty || e.ItemId == Guid.Empty ||
                e.AddedAtUtc.Offset != TimeSpan.Zero || e.AddedAtUtc == default))
            throw new InvalidDataException("Invalid watchlist timestamp document; original preserved.");
        foreach (var entry in document.Entries)
            if (!dates.TryAdd(new(entry.UserId, entry.ItemId), entry.AddedAtUtc))
                throw new InvalidDataException("Duplicate watchlist timestamps; original preserved.");

        if (document.MembershipFingerprint != Fingerprint()) return new(); // Older build modified memberships.
        if (dates.Keys.Except(memberships).Any())
            throw new InvalidDataException("Orphan watchlist timestamp; original preserved.");
        return dates;
    }

    private static void WriteAtomic<T>(string destination, T value)
    {
        var temporary = destination + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                JsonSerializer.Serialize(stream, value, Options);
                stream.Flush(flushToDisk: true);
            }
            File.Move(temporary, destination, overwrite: true);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }

    public void Set(Guid userId, Guid itemId, bool present)
    {
        if (userId == Guid.Empty || itemId == Guid.Empty) throw new ArgumentException("IDs must be nonempty.");
        lock (gate)
        {
            var memberships = ReadCore();
            var entries = memberships.ToHashSet();
            var entry = new WatchlistEntry(userId, itemId);
            if (!(present ? entries.Add(entry) : entries.Remove(entry))) return; // Idempotent; preserve original date.

            // Parse/validate before changing either file; corruption must not be
            // silently erased. Failure of an ancillary timestamp after the
            // membership commit leaves the primary membership authoritative and
            // any mismatched dates unknown on the next read.
            var dates = ReadDatesCore(memberships);
            if (present) dates[entry] = time.GetUtcNow().ToUniversalTime();
            else dates.Remove(entry);
            Directory.CreateDirectory(directory);
            WriteAtomic(path, new WatchlistDocument(1, entries.OrderBy(e => e.UserId).ThenBy(e => e.ItemId).ToArray()));
            WriteAtomic(datesPath, new WatchlistDateDocument(1, Fingerprint(),
                dates.OrderBy(e => e.Key.UserId).ThenBy(e => e.Key.ItemId)
                    .Select(e => new WatchlistDateEntry(e.Key.UserId, e.Key.ItemId, e.Value)).ToArray()));
        }
    }
}
