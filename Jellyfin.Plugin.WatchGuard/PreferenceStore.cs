using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Jellyfin.Plugin.WatchGuard;

public sealed record ViewPreferences(string Owner, string[] Statuses, string Sort)
{
    public static ViewPreferences Defaults => new("mine", ["watchlisted", "watching", "playing"], "title");
    public static bool Valid(ViewPreferences? value) => value is not null &&
        (value.Owner is "mine" or "all" || (Guid.TryParse(value.Owner, out var id) && id != Guid.Empty)) &&
        value.Sort is "title" or "recent" or "added" && value.Statuses is not null && value.Statuses.Length <= 4 &&
        value.Statuses.All(s => s is "watchlisted" or "watching" or "playing" or "watched") &&
        value.Statuses.Distinct().Count() == value.Statuses.Length;
}
public sealed record PreferenceEntry(Guid UserId, ViewPreferences Preferences);
public sealed record PreferenceDocument(int Version, PreferenceEntry[] Entries);

// Only the added override lives in the sidecar. Legacy owner/status/sort data
// remains schema 1, with title as the downgrade fallback. No writable cache.
public sealed record PreferenceSortDocument(int Version, string PreferenceFingerprint, Guid[] AddedUsers);

// One singleton writer; do not share a data directory between server processes.
public sealed class PreferenceStore(string directory)
{
    private readonly object gate = new();
    private readonly string path = Path.Combine(directory, "preferences.json");
    private readonly string sortPath = Path.Combine(directory, "preference-sorts.json");
    private static readonly JsonSerializerOptions Options = new() { WriteIndented = true, UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow };
    private PreferenceEntry[] ReadCore()
    {
        if (!File.Exists(path)) return [];
        var document = JsonSerializer.Deserialize<PreferenceDocument>(File.ReadAllText(path), Options);
        if (document is null || document.Version != 1 || document.Entries is null ||
            document.Entries.Any(e => e is null || e.UserId == Guid.Empty || !ViewPreferences.Valid(e.Preferences) || e.Preferences.Sort == "added") ||
            document.Entries.Select(e => e.UserId).Distinct().Count() != document.Entries.Length)
            throw new InvalidDataException("Invalid preference document; original preserved.");
        return document.Entries;
    }
    private string Fingerprint()
    {
        if (!File.Exists(path)) return "absent";
        var info = new FileInfo(path);
        return Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(path))) + ":" +
            info.LastWriteTimeUtc.Ticks.ToString(CultureInfo.InvariantCulture) + ":" +
            info.CreationTimeUtc.Ticks.ToString(CultureInfo.InvariantCulture);
    }

    private HashSet<Guid> ReadSorts(PreferenceEntry[] entries)
    {
        if (Directory.Exists(sortPath)) throw new IOException("Preference sort path is not a file.");
        if (!File.Exists(sortPath)) return [];
        var document = JsonSerializer.Deserialize<PreferenceSortDocument>(File.ReadAllText(sortPath), Options);
        if (document is null || document.Version != 1 || !ValidFingerprint(document.PreferenceFingerprint) ||
            document.AddedUsers is null || document.AddedUsers.Any(id => id == Guid.Empty) ||
            document.AddedUsers.Distinct().Count() != document.AddedUsers.Length ||
            (document.PreferenceFingerprint == "invalidated" && document.AddedUsers.Length != 0))
            throw new InvalidDataException("Invalid preference sort document; original preserved.");
        // Older versions atomically replace the entire legacy file even on reset
        // or an identical save. Never resurrect overrides from a prior revision.
        if (document.PreferenceFingerprint != Fingerprint()) return [];
        var ids = document.AddedUsers.ToHashSet();
        if (ids.Except(entries.Where(e => e.Preferences.Sort == "title").Select(e => e.UserId)).Any())
            throw new InvalidDataException("Orphan preference sort override; original preserved.");
        return ids;
    }

    private static bool ValidFingerprint(string? value)
    {
        if (value is "absent" or "invalidated") return true;
        var parts = value?.Split(':');
        return parts is { Length: 3 } && parts[0].Length == 64 && parts[0].All(Uri.IsHexDigit) &&
            long.TryParse(parts[1], NumberStyles.None, CultureInfo.InvariantCulture, out var modified) && modified >= 0 &&
            long.TryParse(parts[2], NumberStyles.None, CultureInfo.InvariantCulture, out var created) && created >= 0;
    }

    public ViewPreferences Read(Guid userId)
    {
        lock (gate)
        {
            var entries = ReadCore();
            var sorts = ReadSorts(entries);
            var value = entries.FirstOrDefault(e => e.UserId == userId)?.Preferences ?? ViewPreferences.Defaults;
            return sorts.Contains(userId) ? value with { Sort = "added" } : value;
        }
    }

    private static void WriteAtomic<T>(string destination, T value)
    {
        var temporary = destination + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
            {
                JsonSerializer.Serialize(stream, value, Options);
                stream.Flush(true);
            }
            File.Move(temporary, destination, true);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }

    public void Set(Guid userId, ViewPreferences? value)
    {
        if (userId == Guid.Empty || (value is not null && !ViewPreferences.Valid(value))) throw new ArgumentException("Invalid preferences.");
        lock (gate)
        {
            var original = ReadCore();
            var sorts = ReadSorts(original); // Validate both files before any write, including reset.
            var entries = original.Where(e => e.UserId != userId).ToList();
            if (value is not null) entries.Add(new(userId, value.Sort == "added" ? value with { Sort = "title" } : value));
            sorts.Remove(userId);
            if (value?.Sort == "added") sorts.Add(userId);
            Directory.CreateDirectory(directory);
            // Invalidate before changing the legacy file: a crash at any later
            // boundary cannot bring back an obsolete override, even if bytes match.
            var needsSidecar = File.Exists(sortPath) || sorts.Count != 0;
            if (needsSidecar) WriteAtomic(sortPath, new PreferenceSortDocument(1, "invalidated", []));
            WriteAtomic(path, new PreferenceDocument(1, entries.OrderBy(e => e.UserId).ToArray()));
            if (needsSidecar) WriteAtomic(sortPath, new PreferenceSortDocument(1, Fingerprint(), sorts.Order().ToArray()));
        }
    }
}
