/* Native disposable fixture: actual queries, background updates and browser work. */
const {chromium}=require('./browser/node_modules/playwright');
const readiness=require('./browser-readiness.cjs');
const fs=require('node:fs'),assert=require('node:assert/strict');
const fixture=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
assert.match(fixture.base,/^http:\/\/127\.0\.0\.1:\d+$/);
(async()=>{
 const browser=await chromium.launch({headless:true});
 let page;
 const report={result:'RUNNING',phase:'login',responses:[],views:[]};
 try {
  const context=await browser.newContext({viewport:{width:1280,height:900},locale:'en-US'});
  page=await context.newPage();page.setDefaultTimeout(20000);
  const requests=new WeakMap();
  page.on('request',request=>requests.set(request,{phase:report.phase,started:Date.now()}));
  page.on('response',async response=>{
   const url=new URL(response.url());if(!url.pathname.endsWith('/WatchGuard/ActivityBrowser'))return;
   const request=requests.get(response.request());
   const record={phase:request?.phase,durationMs:Date.now()-(request?.started||Date.now()),status:response.status(),search:url.searchParams.get('search'),statuses:url.searchParams.get('statuses'),check:url.searchParams.get('check')==='true',continuation:url.searchParams.has('continuation')};
   report.responses.push(record);
   try {const data=await response.json();Object.assign(record,{preparing:data.Preparing,items:data.Items?.length,more:!!data.Continuation,changed:data.Changed,populationPending:data.Freshness?.PopulationPending,code:data.Code,work:data.ReadDiagnostics,causes:data.Coverage?.Causes});} catch {}
  });
  await readiness.capture(page);await readiness.login(page,fixture);
  const native=(route,type='GET',data)=>page.evaluate(async({route,type,data})=>ApiClient.ajax({url:ApiClient.getUrl(route),type,...(type==='GET'?{dataType:'json'}:{}),...(data===undefined?{}:{contentType:'application/json',data:JSON.stringify(data)})}),{route,type,data});
  async function until(predicate,label,timeout=90000) {
   const deadline=Date.now()+timeout;
   while(!await predicate()) {assert.ok(Date.now()<deadline,label);await new Promise(resolve=>setTimeout(resolve,250));}
  }
  async function verified() {
   await until(async()=>{
    const state=(await native('WatchGuard/ActivityIndex/Status?owner=all')).Freshness;
    return state.DiscoveryFinished && state.Pending===0 && state.Stored===state.Validated;
   },'Native fixture verification did not settle',600000);
  }
  const region=page.getByRole('region',{name:'Watchlists',exact:true});
  const cards=()=>region.locator('.watchguard-card');
  async function settled() {
   await page.waitForFunction(()=>document.querySelector('.watchguard-page')?.getAttribute('aria-busy')==='false');
   assert.equal(await region.getByRole('button',{name:'Continue loading',exact:true}).isVisible(),false,'Ordinary preparation finishes without a click');
   if(report.phase!=='initial background population') assert.equal(await region.getByRole('button',{name:'Refresh this view',exact:true}).isVisible(),false,'Ordinary query does not expire');
  }
  async function open(owner='all',interest='watchlisted,watching,playing,watched',search='') {
   const start=Date.now(),offset=report.responses.length;
   await page.goto(fixture.base+'/web/#/home?'+new URLSearchParams({watchguard:'watchlists',owner,interest,sort:'title',search}));
   await settled();
   report.views.push({phase:report.phase,readyMs:Date.now()-start,queryResponses:report.responses.slice(offset).filter(r=>!r.check).length,preparationResponses:report.responses.slice(offset).filter(r=>r.preparing).length,titles:await cards().count()});
  }
  // An advisory Refresh preserves valid rows. Change an unrelated native
  // policy field in these disposable viewing accounts so their old projection
  // really awaits fresh authorization/classification. Media visibility stays
  // the same. The open browser must pick up population without a UI click.
  report.phase='initial background population';
  const viewingAccounts=(await native('Users')).filter(u=>/^IndexUser[0-5]$/.test(u.Name));
  assert.equal(viewingAccounts.length,6);
  for(const account of viewingAccounts) {
   const policy=(await native('Users/'+account.Id)).Policy;
   await native('Users/'+account.Id+'/Policy','POST',{...policy,EnableContentDownloading:!policy.EnableContentDownloading});
  }
  await native('WatchGuard/ActivityBrowser?owner=all&statuses=none&refresh=true');
  const initialState=(await native('WatchGuard/ActivityIndex/Status?owner=all')).Freshness;
  assert.ok(initialState.Pending>0,'Fixture starts with known activity awaiting verification');
  await open();const initialCount=await cards().count(),initialResponses=report.responses.length,startPopulation=Date.now();
  await verified();
  await until(async()=>report.responses.length>initialResponses && await cards().count()>initialCount && await region.getAttribute('aria-busy')==='false','Population must appear through automatic polling',90000);
  report.initialPopulation={result:'PASS',initialTitles:initialCount,loadedTitles:await cards().count(),elapsedMs:Date.now()-startPopulation};
  assert.ok(report.responses.some(r=>r.phase==='initial background population' && r.populationPending));

  const items=(await native('Items?Recursive=true&IncludeItemTypes=Movie&Limit=1000')).Items;
  const target=items.find(i=>i.Name==='Index Movie 120');assert.ok(target);
  const owner=(await native('Users')).find(u=>u.Name==='IndexUser0');assert.ok(owner);
  report.phase='search';const startSearch=Date.now(),searchOffset=report.responses.length;
  const search=region.getByRole('searchbox',{name:'Search titles',exact:true});
  await search.fill(target.Name);await page.waitForURL(/search=Index%20Movie%20120/);await settled();
  assert.equal(await cards().count(),1);assert.match(await region.innerText(),/Index Movie 120/);
  assert.equal(await search.evaluate(e=>e===document.activeElement),true);
  report.views.push({phase:report.phase,readyMs:Date.now()-startSearch,queryResponses:report.responses.length-searchOffset,titles:1});
  fs.mkdirSync('artifacts/activity-browser',{recursive:true});await page.screenshot({path:'artifacts/activity-browser/search-1280.png'});

  report.phase='automatic multi-request preparation';const startClear=Date.now(),clearOffset=report.responses.length;
  await search.fill('');await page.waitForURL(/search=$/);await settled();
  const clearResponses=report.responses.slice(clearOffset);
  assert.ok(clearResponses.some(r=>r.preparing),'Mixed multi-user fixture exercises real preparation');
  assert.ok(clearResponses.length<=4);assert.ok(await cards().count()>0 && await cards().count()<=25);
  report.views.push({phase:report.phase,readyMs:Date.now()-startClear,queryResponses:clearResponses.length,preparationResponses:clearResponses.filter(r=>r.preparing).length,titles:await cards().count()});

  report.phase='native watched and unwatched polling';await open(owner.Id,'watched',target.Name);
  assert.equal(await cards().count(),1);
  await native('UserItems/'+target.Id+'/UserData?userId='+owner.Id,'POST',{Played:false,PlaybackPositionTicks:0});
  await until(async()=>await cards().count()===0 && await region.getAttribute('aria-busy')==='false','Unwatched change must remove the card without Refresh');
  await native('UserPlayedItems/'+target.Id+'?userId='+owner.Id,'POST');
  await until(async()=>await cards().count()===1 && await region.getAttribute('aria-busy')==='false','Watched change must restore the card without Refresh');
  report.watchedPolling='PASS';

  report.phase='native playback start and stop';await open('all','playing',target.Name);assert.equal(await cards().count(),0);
  await page.screenshot({path:'artifacts/activity-browser/empty-1280.png'});
  await native('Sessions/Playing','POST',{ItemId:target.Id,PlayMethod:'DirectPlay',PositionTicks:10000});
  await until(async()=>await cards().count()===1 && await region.getAttribute('aria-busy')==='false','Playback start must appear without Refresh');
  await native('Sessions/Playing/Stopped','POST',{ItemId:target.Id,PositionTicks:10000});
  await until(async()=>await cards().count()===0 && await region.getAttribute('aria-busy')==='false','Stopped playback must disappear without Refresh');
  report.playbackPolling='PASS';

  report.phase='deeper view authorized changes';
  await native('Sessions/Playing','POST',{ItemId:target.Id,PlayMethod:'DirectPlay',PositionTicks:10000});await verified();await open();
  const firstCard=await cards().first().elementHandle(),beforeMore=await cards().count();
  await region.getByRole('button',{name:'Load more results',exact:true}).click();await settled();
  assert.ok(await cards().count()>beforeMore);assert.equal(await firstCard.evaluate(e=>e===document.querySelector('.watchguard-card')),true);
  const retainedPeople=cards().filter({has:page.locator('.watchguard-state-CurrentlyPlaying')}).locator('.watchguard-more-owners');
  if(await retainedPeople.count() && await retainedPeople.isVisible()) await retainedPeople.locator(':scope > summary').click();
  const names=await cards().locator('.cardText').allTextContents();
  await region.evaluate(e=>{e.scrollTop=400;});const scroll=await region.evaluate(e=>e.scrollTop);
  await native('Sessions/Playing/Stopped','POST',{ItemId:target.Id,PositionTicks:10000});
  await until(()=>region.getByRole('button',{name:'Updates available',exact:true}).isVisible(),'Deeper view must detect relevant live changes');
  await page.waitForFunction(()=>document.querySelector('.watchguard-page')?.getAttribute('aria-busy')==='false');
  assert.deepEqual(await cards().locator('.cardText').allTextContents(),names);
  assert.equal(await firstCard.evaluate(e=>e===document.querySelector('.watchguard-card')),true);
  assert.equal(await region.evaluate(e=>e.scrollTop),scroll);
  assert.match(await region.innerText(),/Playing when loaded · may have stopped/);
  assert.ok(report.responses.some(r=>r.phase===report.phase && r.check && r.changed===true));
  await region.evaluate(e=>{e.scrollTop=0;}); // Capture status after verifying retained scroll.
  await page.screenshot({path:'artifacts/activity-browser/updates-1280.png'});
  report.deeperView={result:'PASS',titles:names.length,scroll,orderAndPosterPreserved:true,retainedLiveLabel:true};
  await region.getByRole('button',{name:'Updates available',exact:true}).click();await settled();
  assert.equal(await region.getByRole('button',{name:'Updates available',exact:true}).isVisible(),false);

  report.phase='added ordering';await region.evaluate(e=>{e.scrollTop=0;});
  await region.getByRole('combobox',{name:'Sort by'}).selectOption('added');await page.waitForURL(/sort=added/);await settled();
  await page.setViewportSize({width:390,height:900});assert.equal(await region.evaluate(e=>e.scrollWidth<=e.clientWidth),true);
  await page.screenshot({path:'artifacts/activity-browser/added-390.png'});

  report.phase='usability presentation';
  await page.setViewportSize({width:1280,height:900});
  const renamed=await native('Users/'+owner.Id);
  await native('Users/'+owner.Id,'POST',{...renamed,Name:'Alexandria_Household_Member_With_A_Long_Display_Name'});
  await native('WatchGuard/Watchlist/'+target.Id,'PUT');
  await verified();await open('all','watchlisted,watching,playing,watched',target.Name);
  const card=cards().first(),people=card.locator('.watchguard-more-owners');
  assert.equal(await card.locator('.watchguard-user-line').count(),7);
  const beforeExpansion=report.responses.length;
  // The same title was expanded in the deeper-view check; SPA filters retain
  // its disclosure. Exercise keyboard close/open from either retained state.
  const peopleSummary=people.locator(':scope > summary');
  if(await people.evaluate(e=>e.open)) await peopleSummary.press('Enter');
  assert.equal(await people.evaluate(e=>e.open),false);
  await peopleSummary.press('Enter');
  assert.equal(await people.evaluate(e=>e.open),true);
  assert.equal(await card.getByText('Alexandria_Household_Member_With_A_Long_Display_Name',{exact:true}).isVisible(),true);
  const dates=card.locator('.watchguard-dates').first();await dates.locator('summary').press('Enter');
  assert.ok(await dates.locator('time').count()>0);
  assert.equal(report.responses.length,beforeExpansion,'Presentation controls add no query requests');
  const poster=await card.locator('.watchguard-poster').elementHandle();
  const focused=dates.locator('summary');await focused.focus();
  const offset=report.responses.length;
  await until(()=>Promise.resolve(report.responses.length>offset),'Routine poll must complete');await settled();
  assert.notEqual(await people.getAttribute('open'),null);assert.notEqual(await dates.getAttribute('open'),null);
  assert.equal(await focused.evaluate(e=>e===document.activeElement),true);assert.equal(await poster.evaluate(e=>e.isConnected),true);
  for(const width of [1280,390]) {
   await page.setViewportSize({width,height:900});await region.evaluate(e=>{e.scrollTop=0;});
   assert.equal(await region.evaluate(e=>e.scrollWidth<=e.clientWidth),true);
   const top=(await card.boundingBox()).y;
   if(width===390)assert.ok(top<450,'First cards should start above 450px, versus 618px in the v0.7.0 baseline: '+top);
   assert.equal(await card.locator('.watchguard-status').evaluate(e=>getComputedStyle(e).overflowY),'visible');
   await page.screenshot({path:'artifacts/activity-browser/people-'+width+'.png'});
   report.views.push({phase:report.phase,width,firstCardTop:top,users:7,expansionAndFocusPreserved:true});
  }
  await page.setViewportSize({width:390,height:900});
  await native('Sessions/Playing','POST',{ItemId:target.Id,PlayMethod:'DirectPlay',PositionTicks:10000});
  await open('all','playing',target.Name);assert.equal(await cards().count(),1);
  const retained=await cards().first().elementHandle();
  await page.route('**/WatchGuard/ActivityBrowser?**',route=>route.abort('failed'));
  await region.getByRole('button',{name:'Refresh',exact:true}).click();
  await until(async()=>await region.getAttribute('data-view-state')==='failed' && await region.getAttribute('aria-busy')==='false','Failed update must retain results');
  assert.equal(await retained.evaluate(e=>e.isConnected),true);
  assert.match(await region.innerText(),/may have stopped/);
  await page.screenshot({path:'artifacts/activity-browser/failed-390.png'});
  await page.unroute('**/WatchGuard/ActivityBrowser?**');
  await native('Sessions/Playing/Stopped','POST',{ItemId:target.Id,PositionTicks:10000});
  report.presentation={result:'PASS',users:7,longName:true,datesKeyboard:true,retainedError:true,additionalPresentationRequests:0};
  report.result='PASS';
 } catch(error) {
  report.result='FAIL';
  if(page){report.view=await page.locator('.watchguard-page').innerText().catch(()=>'(unavailable)');await readiness.failure(page,fixture,'activity-query',error);}
  throw error;
 } finally {
  fs.mkdirSync('artifacts/activity-browser/ui',{recursive:true});fs.writeFileSync('artifacts/activity-browser/ui/results.json',JSON.stringify(report,null,2)+'\n');await browser.close();
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
