using System.Text.Json;
using System.Text.Json.Serialization;

namespace Jellyfin.Plugin.WatchGuard;

public sealed record ViewPreferences(string Owner, string[] Statuses, string Sort)
{
    public static ViewPreferences Defaults => new("mine", ["watchlisted", "watching", "playing"], "title");
    public static bool Valid(ViewPreferences? value) => value is not null &&
        (value.Owner is "mine" or "all" || (Guid.TryParse(value.Owner, out var id) && id != Guid.Empty)) &&
        value.Sort is "title" or "recent" && value.Statuses is not null && value.Statuses.Length <= 4 &&
        value.Statuses.All(s => s is "watchlisted" or "watching" or "playing" or "watched") &&
        value.Statuses.Distinct().Count() == value.Statuses.Length;
}
public sealed record PreferenceEntry(Guid UserId, ViewPreferences Preferences);
public sealed record PreferenceDocument(int Version, PreferenceEntry[] Entries);

// One authoritative file, no writable cache; corruption blocks reads and writes without resetting data.
public sealed class PreferenceStore(string directory)
{
    private readonly object gate = new();
    private readonly string path = Path.Combine(directory, "preferences.json");
    private static readonly JsonSerializerOptions Options = new() { WriteIndented = true, UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow };
    private PreferenceEntry[] ReadCore()
    {
        if (!File.Exists(path)) return [];
        var document = JsonSerializer.Deserialize<PreferenceDocument>(File.ReadAllText(path), Options);
        if (document is null || document.Version != 1 || document.Entries is null ||
            document.Entries.Any(e => e is null || e.UserId == Guid.Empty || !ViewPreferences.Valid(e.Preferences)) ||
            document.Entries.Select(e => e.UserId).Distinct().Count() != document.Entries.Length)
            throw new InvalidDataException("Invalid preference document; original preserved.");
        return document.Entries;
    }
    public ViewPreferences Read(Guid userId)
    {
        lock (gate) return ReadCore().FirstOrDefault(e => e.UserId == userId)?.Preferences ?? ViewPreferences.Defaults;
    }
    public void Set(Guid userId, ViewPreferences? value)
    {
        if (userId == Guid.Empty || (value is not null && !ViewPreferences.Valid(value))) throw new ArgumentException("Invalid preferences.");
        lock (gate)
        {
            var entries = ReadCore().Where(e => e.UserId != userId).ToList();
            if (value is not null) entries.Add(new(userId, value));
            Directory.CreateDirectory(directory);
            var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try
            {
                using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                {
                    JsonSerializer.Serialize(stream, new PreferenceDocument(1, entries.OrderBy(e => e.UserId).ToArray()), Options);
                    stream.Flush(true);
                }
                File.Move(temporary, path, true);
            }
            finally { if (File.Exists(temporary)) File.Delete(temporary); }
        }
    }
}
