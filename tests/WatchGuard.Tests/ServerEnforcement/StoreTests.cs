using System.Collections.Concurrent;
using Jellyfin.Plugin.WatchGuard.ServerEnforcement;
using Xunit;

public sealed class Clock : TimeProvider
{
    private long ticks;
    public override long TimestampFrequency => TimeSpan.TicksPerSecond;
    public override long GetTimestamp() => ticks;
    public override DateTimeOffset GetUtcNow() => new DateTimeOffset(2026, 10, 16, 0, 0, 0, TimeSpan.Zero).AddTicks(ticks);
    public void Advance(int seconds) => ticks += TimeSpan.FromSeconds(seconds).Ticks;
}
[Collection("ApprovalMemory")]
public class StoreTests
{
    private static readonly Owner Alice = new(Guid.NewGuid(), "alice-session");
    private static readonly Owner Bob = new(Guid.NewGuid(), "bob-session");
    private static readonly Guid Item = Guid.NewGuid();
    private static readonly Operation Operation = Operation.Create("DeleteItem", [Item]);
    private static Ticket Create(ApprovalStore store, Owner? owner = null) => store.Create(owner ?? Alice, Operation, "state", [Item]);
    private static void Approve(ApprovalStore store, Ticket t)
    {
        store.Transition(t.Id, Alice, Operation, "state", ApprovalState.Presented);
        store.Transition(t.Id, Alice, Operation, "state", ApprovalState.Approved);
    }
    private static void Failure(string code, Action action) => Assert.Equal(code, Assert.Throws<GuardFailure>(action).Code);

    [Fact] public void MustPresentThenExplicitlyApproveAndConsumeOnce()
    {
        var store = new ApprovalStore(new Clock()); var t = Create(store);
        Failure("ApprovalInvalid", () => store.Consume(t.Id, Alice, Operation, "state"));
        Failure("ApprovalInvalid", () => store.Transition(t.Id, Alice, Operation, "state", ApprovalState.Approved));
        Approve(store, t); using var lease = store.Consume(t.Id, Alice, Operation, "state");
        Failure("ApprovalAlreadyUsed", () => store.Consume(t.Id, Alice, Operation, "state"));
        Failure("ApprovalAlreadyUsed", () => store.Read(t.Id, Alice));
    }
    [Fact] public void ConsumedLookupIsReadOnlyAndBindsOwnerSessionAndOrderedOperation()
    {
        var store = new ApprovalStore(new Clock());
        var operation = Operation.Create("DeleteItems", [Item, Guid.NewGuid()]);
        var ticket = store.Create(Alice, operation, "state", operation.Targets);
        foreach (var state in new[] { ApprovalState.Presented, ApprovalState.Approved })
        {
            Assert.False(store.WasConsumed(ticket.Id, Alice, operation));
            store.Transition(ticket.Id, Alice, operation, "state", state);
        }
        Assert.False(store.WasConsumed(ticket.Id, Alice, operation));
        using var lease = store.Consume(ticket.Id, Alice, operation, "state");
        Assert.True(store.WasConsumed(ticket.Id, Alice, operation));
        foreach (var owner in new[] { Bob, new Owner(Alice.UserId, "other-session") })
            Assert.False(store.WasConsumed(ticket.Id, owner, operation));
        Assert.False(store.WasConsumed(ticket.Id, Alice, Operation.Create("DeleteItems", operation.Targets.Reverse().ToArray())));
        Assert.False(store.WasConsumed(ticket.Id, Alice, Operation.Create("DeleteItem", [Item])));
        Assert.False(store.WasConsumed("unknown", Alice, operation));
        Failure("ApprovalAlreadyUsed", () => store.Read(ticket.Id, Alice));
    }
    [Fact] public void OwnershipAndSessionAreCheckedBeforeStateDisclosure()
    {
        var store = new ApprovalStore(new Clock()); var t = Create(store); Approve(store, t);
        foreach (var owner in new[] { Bob, new Owner(Alice.UserId, "another-token") })
        {
            Failure("ApprovalInvalid", () => store.Read(t.Id, owner));
            store.Revoke(t.Id, owner);
        }
        Assert.Equal(ApprovalState.Approved, store.Read(t.Id, Alice).State);
        using var lease = store.Consume(t.Id, Alice, Operation, "state");
        Failure("ApprovalInvalid", () => store.Read(t.Id, Bob));
    }
    [Fact] public void ChangesRevokeAndCannotBeRestoredByRestoringFingerprint()
    {
        var store = new ApprovalStore(new Clock()); var t = Create(store); Approve(store, t);
        Failure("ApprovalStateChanged", () => store.Consume(t.Id, Alice, Operation, "changed"));
        Failure("ApprovalRevoked", () => store.Consume(t.Id, Alice, Operation, "state"));
    }
    [Fact] public void NativeActionAndBulkOrderAndSetAreBound()
    {
        var store = new ApprovalStore(new Clock()); var t = Create(store); Approve(store, t);
        Failure("ApprovalInvalid", () => store.Consume(t.Id, Alice, Operation.Create("DeleteItems", [Item]), "state"));
        Failure("ApprovalInvalid", () => store.Consume(t.Id, Alice, Operation.Create("DeleteItem", [Guid.NewGuid()]), "state"));
        var ids = new[] { Item, Guid.NewGuid() }; var bulk = Operation.Create("DeleteItems", ids);
        Assert.NotEqual(bulk.Key, Operation.Create("DeleteItems", ids.Reverse().ToArray()).Key);
        Failure("ApprovalInvalid", () => Operation.Create("DeleteItems", [Item, Item]));
        Failure("ApprovalInvalid", () => Operation.Create("DeleteItems", []));
        Failure("ApprovalInvalid", () => Operation.Create("DeleteItems", Enumerable.Range(0, 101).Select(_ => Guid.NewGuid()).ToArray()));
    }
    [Fact] public void ExpiryIsShortAndRestartDoesNotAcceptOldIds()
    {
        var clock = new Clock(); var store = new ApprovalStore(clock, 8, 8, TimeSpan.FromSeconds(2));
        var t = Create(store); Approve(store, t); clock.Advance(2);
        Failure("ApprovalExpired", () => store.Consume(t.Id, Alice, Operation, "state"));
        Failure("ApprovalInvalid", () => new ApprovalStore(clock).Read(t.Id, Alice));
        Assert.NotEqual(store.SessionDigest("token"), new ApprovalStore(clock).SessionDigest("token"));
    }
    [Fact] public void QuotasTombstonesAndCleanupAreBounded()
    {
        var clock = new Clock(); var store = new ApprovalStore(clock, 2, 1, TimeSpan.FromSeconds(2));
        var t = Create(store); store.Revoke(t.Id, Alice);
        Failure("ApprovalCapacityExceeded", () => Create(store));
        Create(store, Bob); Failure("ApprovalCapacityExceeded", () => Create(store, new Owner(Guid.NewGuid(), "third")));
        clock.Advance(62); Create(store); Failure("ApprovalInvalid", () => store.Read(t.Id, Alice));
    }
    [Fact] public void ConcurrentRedemptionsHaveOneWinnerAndNoRefund()
    {
        var store = new ApprovalStore(new Clock()); var t = Create(store); Approve(store, t);
        var winners = 0; var failures = new ConcurrentBag<string>();
        Parallel.For(0, 32, _ => { try { using var lease = store.Consume(t.Id, Alice, Operation, "state"); Interlocked.Increment(ref winners); } catch (GuardFailure e) { failures.Add(e.Code); } });
        Assert.Equal(1, winners); Assert.Equal(31, failures.Count); Assert.All(failures, code => Assert.Equal("ApprovalAlreadyUsed", code));
    }
    [Fact] public void DifferentChallengesAndClearOperationsRevokeOverlap()
    {
        var store = new ApprovalStore(new Clock()); var a = Create(store); var b = Create(store); Approve(store, a); Approve(store, b);
        using (store.Consume(a.Id, Alice, Operation, "state"))
        {
            Failure("ApprovalRevoked", () => store.Read(b.Id, Alice));
            Failure("ApprovalRevoked", () => store.ReserveClear([Item]));
        }
        Failure("ApprovalRevoked", () => store.Consume(b.Id, Alice, Operation, "state"));
        var c = Create(store); using var clear = store.ReserveClear([Item]); Failure("ApprovalRevoked", () => store.Read(c.Id, Alice));
    }
    [Fact] public void WorstBoundedStoreMemorySample()
    {
        var output = Environment.GetEnvironmentVariable("WG_APPROVAL_MEMORY_REPORT");
        var before = GC.GetTotalMemory(true);
        var store = new ApprovalStore(new Clock());
        var resources = Enumerable.Range(0, 4000).Select(_ => Guid.NewGuid()).ToArray();
        var op = Operation.Create("DeleteItems", resources.Take(100).ToArray());
        for (var user = 0; user < 8; user++)
        {
            var owner = new Owner(Guid.NewGuid(), new string('a', 64));
            for (var entry = 0; entry < 32; entry++) store.Create(owner, op, new string('b', 64), resources);
        }
        var bytes = GC.GetTotalMemory(true) - before;
        GC.KeepAlive(store);
        if (output is not null) File.WriteAllText(output, System.Text.Json.JsonSerializer.Serialize(new { Entries = 256, TargetsPerEntry = 100, ResourceIdsPerEntry = 4000, RetainedManagedBytes = bytes }));
        Assert.True(bytes < 40L * 1024 * 1024); // Actual heap sample, not a native process RSS claim.
    }
    [Fact] public void AdmissionHasBoundedConcurrencyAndRate()
    {
        var clock = new Clock(); using var admission = new WorkAdmission(clock);
        var leases = Enumerable.Range(0, 4).Select(_ => admission.Enter(Alice.UserId)).ToArray();
        Failure("GuardBusy", () => admission.Enter(Bob.UserId)); foreach (var lease in leases) lease.Dispose();
        for (var i = 4; i < 120; i++) using (admission.Enter(Alice.UserId)) { }
        Failure("GuardBusy", () => admission.Enter(Alice.UserId)); clock.Advance(60); using var allowed = admission.Enter(Alice.UserId);
    }
}

[CollectionDefinition("ApprovalMemory", DisableParallelization = true)]
public sealed class ApprovalMemoryCollection { }
