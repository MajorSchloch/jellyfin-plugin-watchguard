using System.Text.Json;
using System.Text.Json.Serialization;

namespace Jellyfin.Plugin.WatchGuard.ActivityIndex;

public sealed record IndexKey(Guid UserId, Guid ItemId);
public sealed record IndexRow(IndexKey Key, OverviewUser Activity, Guid[] Episodes, bool Continuing,
    bool MetadataComplete, string? Failure, DateTimeOffset CheckedAt);
public sealed record DiscoveryPosition(Guid UserId, int Source, int Offset, bool Finished);
public sealed record IndexDocument(int Version, IndexRow[] Rows, DiscoveryPosition[] Positions, IndexKey[] Pending);

// Derived state only. The coordinator is the sole writer. A failed checkpoint
// never replaces the previous file; corruption is preserved rather than erased.
public sealed class IndexStore(string directory)
{
    public const int MaxRows = 10000;
    public const int MaxBytes = 32 * 1024 * 1024;
    private readonly string path = Path.Combine(directory, "activity-index.json");
    private static readonly JsonSerializerOptions Options = new() { UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow };
    public bool RecoveredCorruption { get; private set; }
    private (long Length, DateTime Changed)? checkpoint;
    private (long, DateTime)? Stamp() => File.Exists(path) ? (new FileInfo(path).Length, File.GetLastWriteTimeUtc(path)) : null;
    private void Preserve(string suffix)
    {
        if (Directory.EnumerateFiles(directory, "activity-index.json.*-*").Take(5).Count() >= 5)
            throw new IOException("Activity index recovery files require administrator cleanup.");
        File.Move(path, path + suffix + Guid.NewGuid().ToString("N"));
        RecoveredCorruption = true; checkpoint = null;
    }

    public IndexDocument Read()
    {
        if (!File.Exists(path)) return new(1, [], [], []);
        try
        {
            if (new FileInfo(path).Length > MaxBytes) throw new InvalidDataException();
            var value = JsonSerializer.Deserialize<IndexDocument>(File.ReadAllBytes(path), Options);
            Validate(value);
            checkpoint = Stamp();
            return value!;
        }
        catch (Exception e) when (e is JsonException or InvalidDataException or ArgumentException)
        {
            // Failure to preserve the file is fatal. Never overwrite an unreadable store.
            Preserve(".corrupt-");
            return new(1, [], [], []);
        }
    }

    public void Write(IndexDocument document)
    {
        Validate(document);
        Directory.CreateDirectory(directory);
        if (File.Exists(path) && checkpoint != Stamp())
        {
            // An external replacement/corruption must not disappear under a
            // later successful checkpoint. Preserve it; derived rows in memory
            // were independently verified against native Jellyfin.
            Preserve(".replaced-");
        }
        var temporary = path + ".tmp";
        try
        {
            // Bound allocation before serializing the complete document into memory.
            using (var file = new FileStream(temporary, FileMode.Create, FileAccess.Write, FileShare.None))
            {
                using var bounded = new BoundedStream(file);
                JsonSerializer.Serialize(bounded, document, Options);
                file.Flush(true);
            }
            File.Move(temporary, path, true);
            checkpoint = Stamp();
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }

    private static void Validate(IndexDocument? value)
    {
        if (value is null || value.Version != 1 || value.Rows is null || value.Positions is null || value.Pending is null || value.Pending.Length > 2048 ||
            value.Pending.Any(k => k is null || k.UserId == Guid.Empty || k.ItemId == Guid.Empty) ||
            value.Rows.Length > MaxRows || value.Positions.Length > 100 ||
            value.Rows.Any(r => r is null || r.Key is null || r.Key.UserId == Guid.Empty || r.Key.ItemId == Guid.Empty ||
                r.Activity is null || r.Activity.UserId != r.Key.UserId || r.Activity.Reasons is null ||
                r.Activity.Reasons.Any(s => s is not ("InProgress" or "CaughtUp" or "Watched")) ||
                r.Episodes is null || r.Episodes.Length > 1000 || r.Episodes.Any(id => id == Guid.Empty) ||
                r.Episodes.Distinct().Count() != r.Episodes.Length ||
                r.Failure is not (null or "EpisodeLimit" or "NativeLookupFailure") ||
                r.Activity.AvailableEpisodes < 0 || r.Activity.WatchedEpisodes < 0 || r.Activity.WatchedEpisodes > r.Activity.AvailableEpisodes ||
                (r.Activity.EpisodeProgress is { } progress && (progress.ExtraEpisodes is null || progress.ExtraEpisodes.Length > 1000 || progress.AiredAvailable < 0 || progress.AiredWatched < 0 || progress.AiredWatched > progress.AiredAvailable || progress.ExtraEpisodes.Any(e => e is null || e.ItemId == Guid.Empty || e.Name is null || e.ReleaseStatus is not ("Future" or "ReleaseDay" or "UnknownDate"))))) ||
            value.Rows.Select(r => r.Key).Distinct().Count() != value.Rows.Length ||
            value.Positions.Any(p => p is null || p.UserId == Guid.Empty || p.Source is < 0 or > 1 || p.Offset is < 0 or > 1000000) ||
            value.Positions.Select(p => (p.UserId, p.Source)).Distinct().Count() != value.Positions.Length)
            throw new InvalidDataException("Invalid derived activity index.");
    }

    private sealed class BoundedStream(Stream target) : Stream
    {
        private long written;
        public override void Write(byte[] buffer, int offset, int count) => Write(buffer.AsSpan(offset, count));
        public override void Write(ReadOnlySpan<byte> buffer)
        {
            if (written + buffer.Length > MaxBytes) throw new InvalidDataException("Activity index storage limit reached.");
            target.Write(buffer); written += buffer.Length;
        }
        public override bool CanRead => false;
        public override bool CanSeek => false;
        public override bool CanWrite => true;
        public override long Length => written;
        public override long Position { get => written; set => throw new NotSupportedException(); }
        public override void Flush() => target.Flush();
        public override int Read(byte[] b, int o, int c) => throw new NotSupportedException();
        public override long Seek(long o, SeekOrigin s) => throw new NotSupportedException();
        public override void SetLength(long v) => throw new NotSupportedException();
    }
}
