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
public sealed class VerificationBenchmarks
{
    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented=true };
    [Fact]
    public void MultiUserVerificationWorkloads()
    {
        var output = new List<object>();
        foreach (var userCount in new[] { 1, 7 })
        {
            var root = Path.Combine(Path.GetTempPath(), "wg-bench-" + Guid.NewGuid());
            try
            {
                var accounts = Enumerable.Range(1, userCount).Select(i => new User("User"+i,"test","test") {Id=Id(i)}).ToArray();
                const int episodeCount=24;
                var titles=Enumerable.Range(0,110).Select(i=>new Series{Id=Id(100+i),Name="Series"+i,Status=SeriesStatus.Continuing}).ToArray();
                var rows=titles.Select((t,index)=>Enumerable.Range(0,episodeCount).Select(i=>(BaseItem)new AvailableEpisode
                    {Id=Id(1000+index*episodeCount+i),SeriesId=t.Id,PremiereDate=new DateTime(2020,1,1,0,0,0,DateTimeKind.Utc),SeriesPresentationUniqueKey=t.Id.ToString()}).ToArray()).ToArray();
                var episodes=rows.SelectMany(r=>r).ToArray();
                var all=episodes.Concat(titles).ToDictionary(i=>i.Id);
                var lib=new Mock<ILibraryManager>();var users=new Mock<IUserManager>();var data=new Mock<IUserDataManager>();var sessions=new Mock<ISessionManager>();
                long rowsProcessed=0,batches=0,queries=0,lookups=0;
                users.Setup(u=>u.GetUsers()).Returns(accounts);
                users.Setup(u=>u.GetUserById(It.IsAny<Guid>())).Returns((Guid id)=>accounts.FirstOrDefault(u=>u.Id==id));
                lib.Setup(l=>l.GetItemById<BaseItem>(It.IsAny<Guid>(),It.IsAny<User>())).Returns((Guid id,User u)=>{lookups++;return all.GetValueOrDefault(id);});
                lib.Setup(l=>l.GetItemList(It.IsAny<InternalItemsQuery>())).Returns((InternalItemsQuery q)=>{
                    queries++;
                    IEnumerable<BaseItem> result=q.AncestorIds.Length>0 ? rows[Array.FindIndex(titles,t=>t.Id==q.AncestorIds[0])] : q.IsResumable==true ? rows.Select(r=>r[0]) : q.IncludeItemTypes.Contains(BaseItemKind.Movie) ? [] : episodes;
                    if(q.GroupBySeriesPresentationUniqueKey) result=result.GroupBy(i=>((Episode)i).SeriesPresentationUniqueKey).Select(g=>g.First());
                    var found=result.Skip(q.StartIndex??0).Take(q.Limit??int.MaxValue).ToArray();
                    if(q.AncestorIds.Length>0) rowsProcessed+=found.Length;
                    return found;
                });
                data.Setup(d=>d.GetUserDataBatch(It.IsAny<IReadOnlyList<BaseItem>>(),It.IsAny<User>())).Returns((IReadOnlyList<BaseItem> items,User u)=>{batches++;return items.ToDictionary(i=>i.Id,i=>new UserItemData {Key="test",Played=u==accounts[0] || Array.IndexOf(episodes,i)%episodeCount<episodeCount-1,LastPlayedDate=DateTime.UtcNow.Date.AddDays(-1)});});
                data.Setup(d=>d.GetResumeUserDataBatch(It.IsAny<IReadOnlyList<BaseItem>>(),It.IsAny<User>())).Returns(()=>{batches++;return new Dictionary<Guid,VersionResumeData>();});
                lib.Setup(l=>l.GetItemIds(It.IsAny<InternalItemsQuery>())).Returns((InternalItemsQuery q)=>lib.Object.GetItemList(q).Select(i=>i.Id).ToArray());
                sessions.Setup(s=>s.Sessions).Returns(Array.Empty<SessionInfo>());
                var store=new WatchlistStore(root);
                var interest=new InterestService(store,lib.Object,users.Object,data.Object,sessions.Object);
                var service=new InterestOverviewService(store,lib.Object,users.Object,sessions.Object,interest);
                service.GetActivity(accounts[0]); // Warm JIT and mock dispatch, equivalent workload follows.
                rowsProcessed=batches=queries=lookups=0;
                var before=GC.GetAllocatedBytesForCurrentThread();var timer=Stopwatch.StartNew();
                var result=service.GetActivity(accounts[0]);timer.Stop();
                output.Add(new {result.Items,result.Coverage,result.Diagnostics,episodeCount,users=userCount,titles=110,returned=result.Items.Length,result.LimitReached,episodeRows=rowsProcessed,nativePlaybackBatches=batches,nativeQueries=queries,nativeLookups=lookups,elapsedMs=timer.Elapsed.TotalMilliseconds,allocatedBytes=GC.GetAllocatedBytesForCurrentThread()-before});
                Assert.False(result.IsComplete);
                Assert.Equal(100,result.Items.Length);
                Assert.Equal(userCount*100*episodeCount,rowsProcessed);

            }
            finally {if(Directory.Exists(root))Directory.Delete(root,true);}
        }
        var path=Environment.GetEnvironmentVariable("WATCHGUARD_VERIFICATION_MODEL_OUTPUT");
        if(path is not null)File.WriteAllText(path,JsonSerializer.Serialize(output,JsonOptions));
    }
    private static Guid Id(int value)=>new(value,0,0,new byte[8]);
    private sealed class AvailableEpisode:Episode {public override LocationType LocationType=>LocationType.FileSystem;}
}
