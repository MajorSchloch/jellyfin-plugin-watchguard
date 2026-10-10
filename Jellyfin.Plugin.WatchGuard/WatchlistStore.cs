using System.Text.Json;
using System.Text.Json.Serialization;

namespace Jellyfin.Plugin.WatchGuard;

public sealed record WatchlistEntry(Guid UserId, Guid ItemId);
public sealed record WatchlistDocument(int Version, WatchlistEntry[] Entries);

// A single instance owns all access. No cached copy can overwrite a damaged file.
public sealed class WatchlistStore(string directory)
{
    private readonly object gate = new();
    private readonly string path = Path.Combine(directory, "watchlists.json");
    private static readonly JsonSerializerOptions Options = new()
    {
        WriteIndented = true,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow
    };

    public WatchlistEntry[] Read()
    {
        lock (gate) { return ReadCore(); }
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

    public void Set(Guid userId, Guid itemId, bool present)
    {
        if (userId == Guid.Empty || itemId == Guid.Empty) throw new ArgumentException("IDs must be nonempty.");
        lock (gate)
        {
            var entries = ReadCore().ToHashSet();
            var entry = new WatchlistEntry(userId, itemId);
            if (!(present ? entries.Add(entry) : entries.Remove(entry))) return;
            Directory.CreateDirectory(directory);
            var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try
            {
                using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                {
                    JsonSerializer.Serialize(stream, new WatchlistDocument(1, entries.OrderBy(e => e.UserId).ThenBy(e => e.ItemId).ToArray()), Options);
                    stream.Flush(flushToDisk: true);
                }
                File.Move(temporary, path, overwrite: true);
            }
            finally { if (File.Exists(temporary)) File.Delete(temporary); }
        }
    }
}
