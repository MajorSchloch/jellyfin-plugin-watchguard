using System.Text.Json;

namespace Jellyfin.Plugin.WatchGuard;

public sealed record Entry(Guid UserId, Guid ItemId);
public sealed record StoreDocument(int Version, HashSet<Entry> Entries);

// One process owns the store. Never reset an unreadable/unknown-version file.
public sealed class WatchlistStore(string directory)
{
    private readonly object _gate = new();
    private readonly string _path = Path.Combine(directory, "watchlists.json");
    private HashSet<Entry>? _entries;

    public HashSet<Entry> Snapshot()
    {
        lock (_gate) return new HashSet<Entry>(Read());
    }

    public void Set(Guid userId, Guid itemId, bool present)
    {
        if (userId == Guid.Empty || itemId == Guid.Empty) throw new ArgumentException("IDs must be nonempty.");
        lock (_gate)
        {
            var next = new HashSet<Entry>(Read());
            if (!(present ? next.Add(new Entry(userId, itemId)) : next.Remove(new Entry(userId, itemId)))) return;
            Directory.CreateDirectory(directory);
            var temporary = _path + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try
            {
                using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                {
                    JsonSerializer.Serialize(stream, new StoreDocument(1, next));
                    stream.Flush(flushToDisk: true);
                }
                File.Move(temporary, _path, overwrite: true);
                _entries = next; // Publish only after a successful atomic replacement.
            }
            finally
            {
                if (File.Exists(temporary)) File.Delete(temporary);
            }
        }
    }

    private HashSet<Entry> Read()
    {
        if (_entries is not null) return _entries;
        if (!File.Exists(_path)) return _entries = [];
        var document = JsonSerializer.Deserialize<StoreDocument>(File.ReadAllText(_path));
        if (document is null || document.Version != 1 || document.Entries is null ||
            document.Entries.Any(e => e is null || e.UserId == Guid.Empty || e.ItemId == Guid.Empty))
            throw new InvalidDataException("Unsupported or invalid WatchGuard store. Restore a backup; the file has not been overwritten.");
        return _entries = document.Entries;
    }
}
