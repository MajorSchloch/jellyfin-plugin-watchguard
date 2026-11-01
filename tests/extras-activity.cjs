// Fixture-only contracts. Refresh requests background work, not its completion.
const assert=require('node:assert/strict');
const key=value=>String(value||'').replaceAll('-','').toLowerCase();
const pick=(value,names)=>Object.fromEntries(names.filter(name=>value?.[name]!==undefined).map(name=>[name,value[name]]));
function person(value) {
    const result=pick(value,['UserId','DisplayName','Reasons','LastPlayedDate','AvailableEpisodes','WatchedEpisodes','CoverageComplete']);
    if(value?.EpisodeProgress)result.EpisodeProgress={...pick(value.EpisodeProgress,['AiredAvailable','AiredWatched']),
        ExtraEpisodes:value.EpisodeProgress.ExtraEpisodes?.map(e=>pick(e,['ItemId','Name','SeasonNumber','EpisodeNumber','PremiereDate','ReleaseStatus','Watched']))};
    return result;
}
function target(value,itemId) {
    return (value?.Items||[]).filter(i=>key(i.ItemId)===key(itemId)).map(i=>({...pick(i,['ItemId','Name']),Users:(i.Users||[]).map(person)}));
}
function sample(response,value,itemId) {
    const url=new URL(response.url());
    return {source:response.headers?.()['x-watchguard-test-response']==='extras-pending'?'test-controlled':'native',
        query:Object.fromEntries(['owner','days','older','statuses','sort','search','refresh','check'].map(k=>[k,url.searchParams.get(k)])),
        status:response.status(),target:target(value,itemId),Preparing:value?.Preparing,hasContinuation:!!value?.Continuation,
        Coverage:pick(value?.Coverage,['Causes','VerificationLimited','EpisodeMetadataIncomplete','AdditionalPagesAvailable','ResultLimitReached']),
        Freshness:{PopulationPending:value?.Freshness?.PopulationPending,hasRevision:!!value?.Freshness?.Revision}};
}
// Only the separate controlled scenario calls this. It neither fetches a native
// response nor writes playback data, so worker scheduling cannot decide its path.
async function fulfillPending(route) {
    await route.fulfill({status:200,headers:{'content-type':'application/json','x-watchguard-test-response':'extras-pending'},json:{
        Items:[],Preparing:false,Continuation:null,IsComplete:false,LimitReached:false,
        Notice:'Test-controlled pending verification response.',
        Coverage:{Version:1,ActivityWindowDays:30,Causes:['PendingVerification'],Warnings:[]},
        Freshness:{Revision:null,PopulationPending:true}
    }});
}
function assertExtras(value,itemId,userId) {
    assert.equal(value.Preparing,false,'Small fixture query must finish preparation');
    assert.ok(!value.Continuation,'Small fixture query must fit on one page');
    const owner=value.Items?.find(i=>key(i.ItemId)===key(itemId))?.Users.find(u=>key(u.UserId)===key(userId));
    assert.ok(owner,'Authorized indexed result must contain the target title and member');
    assert.deepEqual(owner.Reasons,['CaughtUp']);
    assert.equal(owner.AvailableEpisodes,3);assert.equal(owner.WatchedEpisodes,3);
    assert.equal(owner.EpisodeProgress.AiredAvailable,3);assert.equal(owner.EpisodeProgress.AiredWatched,3);
    assert.equal(owner.EpisodeProgress.ExtraEpisodes.length,1);
    assert.equal(owner.EpisodeProgress.ExtraEpisodes[0].ReleaseStatus,'Future');
    assert.equal(owner.EpisodeProgress.ExtraEpisodes[0].Watched,false);
}
function refreshReady() {
    const page=document.querySelector('.watchguard-page'),button=page?.querySelector('.watchguard-refresh');
    return page?.getAttribute('aria-busy')==='false' && button && !button.disabled && button.getAttribute('aria-disabled')==='false';
}
function matches(response,refresh) {
    const url=new URL(response.url()),p=url.searchParams;
    return url.pathname.endsWith('/WatchGuard/ActivityBrowser') && p.get('owner')==='all' && p.get('statuses')==='watching' &&
        p.get('days')==='30' && p.get('older')==='true' && p.get('sort')==='title' && p.get('search')==='' &&
        !p.has('continuation') && !p.has('check') && (p.get('refresh')==='true')===refresh;
}
async function refreshExtras(page,region,{itemId,userId,record,inspect}) {
    await page.waitForFunction(refreshReady);
    record({event:'refresh-enabled'});
    const [response]=await Promise.all([
        page.waitForResponse(r=>matches(r,true)),
        region.getByRole('button',{name:'Refresh',exact:true}).click()
    ]);
    let result=await response.json();
    record({event:'accepted-refresh',...sample(response,result,itemId)});
    await inspect('accepted-refresh'); // Persist fresh classification before any assertion.
    assert.equal(response.status(),200,'Refresh response status');
    if(result.Freshness?.PopulationPending===true && result.Coverage?.Causes?.includes('PendingVerification')) {
        // One real, unmodified 30-second UI poll. Inspect its first response, not
        // "retry until the expected title appears". Errors and omissions still fail.
        await page.waitForFunction(refreshReady);
        await inspect('pending-presented');
        record({event:'await-background-poll'});
        const poll=await page.waitForResponse(r=>matches(r,false),{timeout:45000});
        result=await poll.json();
        record({event:'background-poll',...sample(poll,result,itemId)});
        await inspect('background-poll');
        assert.equal(poll.status(),200,'Background poll response status');
    }
    assertExtras(result,itemId,userId);
    await page.waitForFunction(refreshReady);
}
module.exports={person,target,sample,fulfillPending,assertExtras,refreshReady,matches,refreshExtras};
