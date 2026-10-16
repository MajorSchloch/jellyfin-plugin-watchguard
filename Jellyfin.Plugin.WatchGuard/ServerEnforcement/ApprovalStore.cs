using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Jellyfin.Plugin.WatchGuard.ServerEnforcement;

public sealed class GuardFailure(int status, string code) : Exception(code)
{
    public int Status { get; } = status;
    public string Code { get; } = code;
}
public enum ApprovalState { Created, Presented, Approved, Consumed, Expired, Revoked }
public sealed record Owner(Guid UserId, string Session);
public sealed record Operation(string Action, Guid[] Targets)
{
    public string Key => JsonSerializer.Serialize(new { Action, Targets });
    public static Operation Create(string action, Guid[]? targets)
    {
        if (action is not ("DeleteItem" or "DeleteItems") || targets is null || targets.Length is 0 or > 100 ||
            (action == "DeleteItem" && targets.Length != 1) || targets.Any(i => i == Guid.Empty) || targets.Distinct().Count() != targets.Length)
            throw new GuardFailure(400, "ApprovalInvalid");
        return new(action, targets.ToArray()); // Ordered: native bulk failure semantics are order-sensitive.
    }
}
public sealed record Ticket(string Id, Operation Operation, string Fingerprint, Guid[] Scopes, ApprovalState State, DateTimeOffset ExpiresAt);
public sealed class Release(Action release) : IDisposable
{
    private int released;
    public void Dispose() { if (Interlocked.Exchange(ref released, 1) == 0) release(); }
}

public sealed class ApprovalStore
{
    private sealed class Entry(Owner owner, Operation operation, string fingerprint, Guid[] scopes, long created, DateTimeOffset expires)
    {
        public Owner Owner { get; } = owner;
        public Operation Operation { get; } = Operation.Create(operation.Action, operation.Targets);
        public string Fingerprint { get; } = fingerprint;
        public Guid[] Scopes { get; } = scopes.ToArray();
        public long Created { get; } = created;
        public DateTimeOffset Expires { get; } = expires;
        public ApprovalState State { get; set; } = ApprovalState.Created;
    }
    private readonly object gate = new();
    private readonly Dictionary<string, Entry> entries = new(StringComparer.Ordinal);
    private readonly HashSet<Guid> inFlight = [];
    private readonly byte[] secret = RandomNumberGenerator.GetBytes(32);
    private readonly TimeProvider time;
    private readonly int maximum, perUser;
    private readonly TimeSpan lifetime;
    public string Generation { get; } = Convert.ToHexString(RandomNumberGenerator.GetBytes(16));
    public ApprovalStore(TimeProvider time) : this(time, 256, 32, TimeSpan.FromSeconds(60)) { }
    public ApprovalStore(TimeProvider time, int maximum, int perUser, TimeSpan lifetime)
    {
        this.time = time; this.maximum = maximum; this.perUser = perUser; this.lifetime = lifetime;
    }
    public string SessionDigest(string token) => Convert.ToHexString(HMACSHA256.HashData(secret, Encoding.UTF8.GetBytes(token)));
    private void Cleanup()
    {
        // At most maximum entries, including tombstones. Expired IDs later become Invalid, never valid again.
        foreach (var pair in entries.ToArray())
            if (time.GetElapsedTime(pair.Value.Created) >= lifetime + TimeSpan.FromSeconds(60)) entries.Remove(pair.Key);
    }
    private Entry Find(string id, Owner owner)
    {
        if (id.Length != 64 || !entries.TryGetValue(id, out var entry) || entry.Owner != owner)
            throw new GuardFailure(409, "ApprovalInvalid");
        if (entry.State == ApprovalState.Consumed) throw new GuardFailure(409, "ApprovalAlreadyUsed");
        if (entry.State == ApprovalState.Revoked) throw new GuardFailure(409, "ApprovalRevoked");
        if (time.GetElapsedTime(entry.Created) >= lifetime) entry.State = ApprovalState.Expired;
        if (entry.State == ApprovalState.Expired) throw new GuardFailure(410, "ApprovalExpired");
        return entry;
    }
    private static Ticket Copy(string id, Entry e) => new(id, Operation.Create(e.Operation.Action, e.Operation.Targets),
        e.Fingerprint, e.Scopes.ToArray(), e.State, e.Expires);
    public Ticket Create(Owner owner, Operation operation, string fingerprint, Guid[] scopes)
    {
        lock (gate)
        {
            Cleanup();
            if (entries.Count >= maximum || entries.Values.Count(e => e.Owner.UserId == owner.UserId) >= perUser)
                throw new GuardFailure(429, "ApprovalCapacityExceeded");
            var id = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
            var entry = new Entry(owner, operation, fingerprint, scopes, time.GetTimestamp(), time.GetUtcNow() + lifetime);
            entries.Add(id, entry);
            return Copy(id, entry);
        }
    }
    public Ticket Read(string id, Owner owner) { lock (gate) { Cleanup(); return Copy(id, Find(id, owner)); } }
    private Entry Match(string id, Owner owner, Operation operation, string fingerprint)
    {
        var entry = Find(id, owner);
        if (entry.Operation.Key != operation.Key) throw new GuardFailure(409, "ApprovalInvalid");
        if (entry.Fingerprint != fingerprint)
        {
            entry.State = ApprovalState.Revoked;
            throw new GuardFailure(409, "ApprovalStateChanged");
        }
        return entry;
    }
    public Ticket Transition(string id, Owner owner, Operation operation, string fingerprint, ApprovalState desired)
    {
        lock (gate)
        {
            var entry = Match(id, owner, operation, fingerprint);
            if (desired == ApprovalState.Presented && entry.State is ApprovalState.Created or ApprovalState.Presented)
                entry.State = ApprovalState.Presented;
            else if (desired == ApprovalState.Approved && entry.State == ApprovalState.Presented) entry.State = ApprovalState.Approved;
            else throw new GuardFailure(409, "ApprovalInvalid");
            return Copy(id, entry);
        }
    }
    public void Revoke(string id, Owner owner)
    {
        lock (gate)
            if (entries.TryGetValue(id, out var e) && e.Owner == owner && e.State is ApprovalState.Created or ApprovalState.Presented or ApprovalState.Approved)
                e.State = ApprovalState.Revoked;
    }
    private IDisposable Reserve(Guid[] scopes, Entry? consuming)
    {
        if (scopes.Any(inFlight.Contains)) throw new GuardFailure(409, "ApprovalRevoked");
        foreach (var e in entries.Values)
            if (e != consuming && e.State is ApprovalState.Created or ApprovalState.Presented or ApprovalState.Approved && e.Scopes.Intersect(scopes).Any())
                e.State = ApprovalState.Revoked;
        foreach (var scope in scopes) inFlight.Add(scope);
        return new Release(() => { lock (gate) foreach (var scope in scopes) inFlight.Remove(scope); });
    }
    public IDisposable Consume(string id, Owner owner, Operation operation, string fingerprint)
    {
        lock (gate)
        {
            var e = Match(id, owner, operation, fingerprint);
            if (e.State != ApprovalState.Approved) throw new GuardFailure(409, "ApprovalInvalid");
            var lease = Reserve(e.Scopes, e);
            e.State = ApprovalState.Consumed; // No refunds, even native failures or disconnected clients.
            return lease;
        }
    }
    public IDisposable ReserveClear(Guid[] scopes) { lock (gate) return Reserve(scopes, null); }
}

public sealed class WorkAdmission(TimeProvider time) : IDisposable
{
    private readonly object gate = new();
    private readonly SemaphoreSlim slots = new(4);
    private readonly Dictionary<Guid, (long Start, int Count)> windows = [];
    public void Dispose() => slots.Dispose();
    public IDisposable Enter(Guid user)
    {
        lock (gate)
        {
            foreach (var pair in windows.ToArray())
                if (time.GetElapsedTime(pair.Value.Start) >= TimeSpan.FromMinutes(1)) windows.Remove(pair.Key);
            if (!windows.TryGetValue(user, out var window))
            {
                if (windows.Count >= 256) throw new GuardFailure(429, "GuardBusy");
                window = (time.GetTimestamp(), 0);
            }
            if (window.Count >= 120 || !slots.Wait(0)) throw new GuardFailure(429, "GuardBusy");
            windows[user] = (window.Start, window.Count + 1);
            return new Release(() => slots.Release());
        }
    }
}
