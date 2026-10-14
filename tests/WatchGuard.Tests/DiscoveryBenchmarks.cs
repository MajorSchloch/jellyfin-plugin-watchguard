using System.Diagnostics;
using Jellyfin.Data.Enums;
using System.Text.Json;
using Jellyfin.Database.Implementations.Entities;
using Jellyfin.Plugin.WatchGuard;
using MediaBrowser.Controller.Entities;
using MediaBrowser.Controller.Entities.Movies;
using MediaBrowser.Controller.Entities.TV;
using MediaBrowser.Controller.Library;
using MediaBrowser.Controller.Session;
using MediaBrowser.Model.Entities;
using Moq;
using Xunit;

namespace WatchGuard.Tests;

// Deterministic native-interface workload model, not a database latency benchmark.
public sealed class DiscoveryBenchmarks
{
    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented=true };
    [Fact]
    public void RepresentativeWorkloads()
    {
        var output = new List<object>();
        foreach (var episodeCount in new[] { 300, 1000, 1501 })
        {
            var root = Path.Combine(Path.GetTempPath(), "wg-bench-" + Guid.NewGuid());
            try
            {
                var accounts = Enumerable.Range(1, 4).Select(i => new User("User"+i,"test","test") {Id=Id(i)}).ToArray();
                var series = new Series {Id=Id(100), Name="Series", Status=SeriesStatus.Continuing};
                var episodes = Enumerable.Range(0, episodeCount).Select(i => (BaseItem)new AvailableEpisode {Id=Id(1000+i), SeriesId=series.Id, PremiereDate=i==2 ? null : new DateTime(2020,1,1,0,0,0,DateTimeKind.Utc), SeriesPresentationUniqueKey="series"}).ToArray();
                var movies = Enumerable.Range(0,140).Select(i=>(BaseItem)new Movie {Id=Id(10000+i),Name="Movie"+i}).ToArray();
                var untouched = Enumerable.Range(0,10000).Select(i=>(BaseItem)new Movie {Id=Id(20000+i),Name="Untouched"+i}).ToArray();
                var all=episodes.Concat(movies).Concat(untouched).Append(series).ToDictionary(i=>i.Id);
                var lib=new Mock<ILibraryManager>();var users=new Mock<IUserManager>();var data=new Mock<IUserDataManager>();var sessions=new Mock<ISessionManager>();
                long rows=0,batches=0,queries=0,lookups=0;
                users.Setup(u=>u.GetUsers()).Returns(accounts);
                users.Setup(u=>u.GetUserById(It.IsAny<Guid>())).Returns((Guid id)=>accounts.FirstOrDefault(u=>u.Id==id));
                lib.Setup(l=>l.GetItemById<BaseItem>(It.IsAny<Guid>(),It.IsAny<User>())).Returns((Guid id,User u)=>{lookups++;return all.GetValueOrDefault(id);});
                lib.Setup(l=>l.GetItemList(It.IsAny<InternalItemsQuery>())).Returns((InternalItemsQuery q)=>{
                    queries++;
                    IEnumerable<BaseItem> result=q.AncestorIds.Contains(series.Id) ? episodes : q.IsResumable==true ? [] : q.IncludeItemTypes.Contains(BaseItemKind.Movie) ? movies : episodes;
                    if(q.GroupBySeriesPresentationUniqueKey) result=result.GroupBy(i=>((Episode)i).SeriesPresentationUniqueKey).Select(g=>g.First());
                    var found=result.Skip(q.StartIndex??0).Take(q.Limit??int.MaxValue).ToArray();
                    if(q.AncestorIds.Length>0) rows+=found.Length;
                    return found;
                });
                data.Setup(d=>d.GetUserDataBatch(It.IsAny<IReadOnlyList<BaseItem>>(),It.IsAny<User>())).Returns((IReadOnlyList<BaseItem> items,User u)=>{batches++;return items.ToDictionary(i=>i.Id,i=>new UserItemData {Key="test",Played=i is Movie || u==accounts[0] || Array.IndexOf(episodes,i)<episodeCount-1,LastPlayedDate=DateTime.UtcNow.AddDays(-1)});});
                data.Setup(d=>d.GetResumeUserDataBatch(It.IsAny<IReadOnlyList<BaseItem>>(),It.IsAny<User>())).Returns(()=>{batches++;return new Dictionary<Guid,VersionResumeData>();});
                sessions.Setup(s=>s.Sessions).Returns(Array.Empty<SessionInfo>());
                var store=new WatchlistStore(root);foreach(var u in accounts)store.Set(u.Id,series.Id,true);
                var interest=new InterestService(store,lib.Object,users.Object,data.Object,sessions.Object);
                var service=new InterestOverviewService(store,lib.Object,users.Object,sessions.Object,interest);
                service.GetActivity(accounts[0]); // Warm JIT and mock dispatch, equivalent workload follows.
                rows=batches=queries=lookups=0;
                var before=GC.GetAllocatedBytesForCurrentThread();var timer=Stopwatch.StartNew();
                var result=service.GetActivity(accounts[0]);timer.Stop();
                output.Add(new {episodeCount,users=4,untouched=10000,completedMovies=140,returned=result.Items.Length,result.LimitReached,episodeRows=rows,nativePlaybackBatches=batches,nativeQueries=queries,nativeLookups=lookups,elapsedMs=timer.Elapsed.TotalMilliseconds,allocatedBytes=GC.GetAllocatedBytesForCurrentThread()-before});
                Assert.False(result.IsComplete);
                var baseline = Environment.GetEnvironmentVariable("WATCHGUARD_BENCHMARK_BASELINE") == "1";
                Assert.Equal(baseline && episodeCount == 1501 ? 0 : 100, result.Items.Length);
                Assert.InRange(batches, 0, baseline ? 800 : 32);
            }
            finally {if(Directory.Exists(root))Directory.Delete(root,true);}
        }
        var path=Environment.GetEnvironmentVariable("WATCHGUARD_BENCHMARK_OUTPUT");
        if(path is not null)File.WriteAllText(path,JsonSerializer.Serialize(output,JsonOptions));
    }
    private static Guid Id(int value)=>new(value,0,0,new byte[8]);
    private sealed class AvailableEpisode:Episode {public override LocationType LocationType=>LocationType.FileSystem;}
}
