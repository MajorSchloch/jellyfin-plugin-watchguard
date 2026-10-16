using System.Diagnostics;
using System.Security.Cryptography;
using System.Text.Json;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Plugin.WatchGuard;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;
using Microsoft.Extensions.Logging;

namespace WatchGuard.ServerApproval;

public sealed record Evaluation(string Fingerprint, Guid[] Scopes, Guid[] Resources, ProtectionStatus[] Protection)
{
    public bool Protected => Protection.Any(p => p.HasInterest);
}
public sealed class Evaluator(ILibraryManager library, InterestService interest, ApprovalStore store, ILogger<Evaluator> logger)
{
    public BaseItem[] CheckPermissions(Operation operation, User user, CancellationToken cancellation) => operation.Targets.Select(id =>
    {
        cancellation.ThrowIfCancellationRequested();
        var item = library.GetItemById<BaseItem>(id, user) ?? throw new GuardFailure(404, "TargetUnavailable");
        if (!item.CanDelete(user)) throw new GuardFailure(403, "NativePermissionDenied");
        return item;
    }).ToArray();

    public Evaluation Read(Operation operation, User user, CancellationToken cancellation)
    {
        var started = Stopwatch.GetTimestamp();
        var calls = 0;
        try
        {
            var caughtUp = Plugin.Instance?.Configuration.ProtectCaughtUpSeries ?? true;
            var targets = CheckPermissions(operation, user, cancellation);
            var scopes = new Dictionary<Guid, BaseItem>();
            var metadata = new Dictionary<Guid, BaseItem>();
            foreach (var item in targets)
            {
                var seriesId = item switch { Episode e => e.SeriesId, Season s => s.SeriesId, _ => Guid.Empty };
                var scope = item;
                if (item is Episode or Season)
                {
                    if (seriesId == Guid.Empty || library.GetItemById<BaseItem>(seriesId, user) is not Series series)
                        throw new GuardFailure(409, "TargetUnavailable");
                    if (operation.Targets.Contains(seriesId) || item is Episode ep && operation.Targets.Contains(ep.SeasonId))
                        throw new GuardFailure(400, "ApprovalInvalid");
                    scope = series;
                }
                else if (!InterestService.Supported(item)) throw new GuardFailure(409, "TargetUnavailable");
                metadata[item.Id] = item;
                scopes[scope.Id] = scope;
            }
            // Bind known native inventory, not just reason labels. Never infer complete mutation scope
            // from a user-filtered subset: unequal global/visible IDs fail closed, without exposing IDs.
            foreach (var scope in scopes.Values)
            {
                cancellation.ThrowIfCancellationRequested();
                metadata[scope.Id] = scope;
                if (scope is not Series) continue;
                var all = library.GetItemList(new InternalItemsQuery { AncestorIds = [scope.Id], Recursive = true, Limit = 1001 });
                var visible = library.GetItemList(new InternalItemsQuery(user) { AncestorIds = [scope.Id], Recursive = true, Limit = 1001 });
                if (all.Count > 1000 || visible.Count > 1000 || !all.Select(i => i.Id).ToHashSet().SetEquals(visible.Select(i => i.Id)))
                    throw new GuardFailure(503, "ProtectionUnavailable");
                foreach (var item in visible) metadata[item.Id] = item;
                if (metadata.Count > 4000) throw new GuardFailure(503, "ProtectionUnavailable");
            }
            var versionLinks = new Dictionary<Guid, Guid[]>();
            var pending = metadata.Values.OfType<Video>().ToDictionary(i => i.Id);
            var linkCount = 0;
            for (var depth = 0; pending.Count > 0; depth++)
            {
                if (depth >= 8) throw new GuardFailure(503, "ProtectionUnavailable");
                var alternateIds = library.GetItemIdsWithAlternateVersions(pending.Keys.ToArray());
                var next = new Dictionary<Guid, Video>();
                foreach (var video in pending.Values.Where(v => alternateIds.Contains(v.Id) || v.PrimaryVersionId.HasValue))
                {
                    cancellation.ThrowIfCancellationRequested();
                    var ids = library.GetLocalAlternateVersionIds(video).Concat(library.GetLinkedAlternateVersions(video).Select(v => v.Id)).Concat(video.PrimaryVersionId.HasValue ? [video.PrimaryVersionId.Value] : []).Distinct().Take(1001).Order().ToArray();
                    linkCount += ids.Length;
                    if (ids.Length > 1000 || linkCount > 4000) throw new GuardFailure(503, "ProtectionUnavailable");
                    versionLinks[video.Id] = ids;
                    foreach (var id in ids)
                    {
                        if (metadata.ContainsKey(id)) continue;
                        var item = library.GetItemById<BaseItem>(id, user) ?? throw new GuardFailure(503, "ProtectionUnavailable");
                        metadata[id] = item;
                        if (item is Video added) next[id] = added;
                    }
                    if (metadata.Count > 4000) throw new GuardFailure(503, "ProtectionUnavailable");
                }
                pending = next;
            }
            var states = scopes.Values.OrderBy(s => s.Id).Select(scope =>
            {
                cancellation.ThrowIfCancellationRequested(); calls++;
                return interest.Get(scope, user.Id);
            }).ToArray();
            cancellation.ThrowIfCancellationRequested();
            if (caughtUp != (Plugin.Instance?.Configuration.ProtectCaughtUpSeries ?? true)) throw new GuardFailure(409, "ApprovalStateChanged");
            var snapshot = new
            {
                store.Generation, Operation = operation.Key, CaughtUp = caughtUp,
                Versions = versionLinks.OrderBy(p => p.Key).Select(p => new { p.Key, p.Value }).ToArray(),
                Metadata = metadata.Values.OrderBy(i => i.Id).Select(i => new
                {
                    i.Id, Type = i.GetType().FullName, i.Path, i.ParentId, i.OwnerId, i.DateCreated, i.DateModified,
                    i.IsVirtualItem, i.PremiereDate, Status = (i as Series)?.Status,
                    Series = i is Episode e ? e.SeriesId : (i as Season)?.SeriesId,
                    Season = (i as Episode)?.SeasonId, PrimaryVersion = (i as Video)?.PrimaryVersionId,
                    Local = (i as Video)?.LocalAlternateVersions.Order(StringComparer.Ordinal).ToArray(),
                    Linked = (i as Video)?.LinkedAlternateVersions.Select(v => v.ItemId).Order().ToArray()
                }).ToArray(),
                Protection = states.Select(p => new { p.ItemId, Users = p.Users.OrderBy(u => u.UserId).Select(u => new { u.UserId, Reasons = u.Reasons.Order(StringComparer.Ordinal).ToArray() }).ToArray() }).ToArray()
            };
            return new(Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(snapshot))), scopes.Keys.Order().ToArray(), metadata.Keys.Order().ToArray(), states);
        }
        finally { logger.LogInformation("WG-APPROVAL evaluation scopes={Count} elapsedMs={Elapsed}", calls, Stopwatch.GetElapsedTime(started).TotalMilliseconds); }
    }
}
