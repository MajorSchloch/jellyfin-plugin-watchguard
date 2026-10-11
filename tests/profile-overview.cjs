/* Run only against docker-smoke.py --serve: synthetic media, disposable configuration. */
const fs = require('node:fs');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {chromium} = require('./browser/node_modules/playwright');
const fixture = JSON.parse(fs.readFileSync(process.argv[2]));
const label = process.argv[3]; assert.ok(['before', 'after'].includes(label));
assert.match(fixture.base, /^http:\/\/127\.0\.0\.1:\d+$/); assert.equal(fixture.username, 'WatchGuardPoCTest');
const container = execFileSync('docker', ['ps','--format','{{.Names}}'],{encoding:'utf8'}).trim().split('\n').filter(n=>n.startsWith('watchguard-poc-'));
assert.equal(container.length,1, 'Only one disposable fixture may be running');
async function call(route, method='GET', body, token=fixture.token) {
 const r=await fetch(fixture.base+route,{method,headers:{Authorization:'MediaBrowser Client="Performance", Device="Disposable", DeviceId="performance", Version="1", Token="'+token+'"','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 assert.ok(r.ok, 'fixture API failed: '+r.status); return r.status===204?null:r.json();
}
(async()=>{
 const accounts=[];
 for(let i=0;i<3;i++) {
  const name='TimingUser'+i, password='DisposableTiming123!';
  let u=(await call('/Users')).find(u=>u.Name===name);
  if(!u) u=await call('/Users/New','POST',{Name:name,Password:password});
  const auth=await call('/Users/AuthenticateByName','POST',{Username:name,Pw:password}); accounts.push(auth);
  for(const id of Object.values(fixture.items)) await call('/WatchGuard/Watchlist/'+id,'PUT',undefined,auth.AccessToken);
  const episodes=(await call('/Items?Recursive=true&IncludeItemTypes=Episode')).Items;
  for(const series of ['PoC Series Detail','PoC Parent Interested','PoC Parent Clear']) {
   const episode=episodes.find(e=>e.SeriesId===fixture.items[series]); assert.ok(episode);
   await call('/UserItems/'+episode.Id+'/UserData','POST',{Played:true,PlaybackPositionTicks:0,LastPlayedDate:'2026-10-11T10:00:00Z'},auth.AccessToken);
  }
  await call('/UserItems/'+fixture.items['PoC Movie Detail']+'/UserData','POST',{Played:false,PlaybackPositionTicks:10000000,LastPlayedDate:'2026-10-11T09:00:00Z'},auth.AccessToken);
 }
 const routes=['Watchlists','InterestOverview'+(label==='after'?'?automaticOnly=true':'')];
 const results={label, fixture:{users:4,movies:10,series:3,episodes:10,memberships:39}, http:{}, client:[]};
 for(const route of routes) {
  await call('/WatchGuard/'+route); // warm-up
  const start=new Date().toISOString(); const times=[];
  for(let i=0;i<7;i++) {const t=performance.now();await call('/WatchGuard/'+route);times.push(performance.now()-t);}
  const log=execFileSync('docker',['logs','--since',start,container[0]],{encoding:'utf8',stdio:['ignore','pipe','ignore']});
  const stages={}; for(const match of log.matchAll(/WatchGuard timing (\w+): ([\d.]+) ms/g)) (stages[match[1]]??=[]).push(Number(match[2]));
  results.http[route]={roundTripMs:times, stagesMeanPerRequestMs:Object.fromEntries(Object.entries(stages).map(([k,v])=>[k,v.reduce((a,b)=>a+b,0)/7]))};
 }
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  await page.goto(fixture.base+'/web/#/login');
  await page.locator('#txtManualName').fill(fixture.username); await page.locator('#txtManualPassword').fill(fixture.password);
  await page.getByRole('button',{name:'Sign In',exact:true}).click();
  await page.waitForFunction(()=>window.WatchGuardPoc?.isInstalled());
  for(let i=0;i<5;i++) {
   await page.goto(fixture.base+'/web/#/home'); await page.locator('.watchguard-page').waitFor({state:'detached'});
   // Observer is test-only; measures first card insertion after network completion, not production lifecycle.
   await page.evaluate(()=>{
    window.wgTiming={start:performance.now(), responses:[]};
    const observer=new PerformanceObserver(list=>{for(const e of list.getEntries())if(e.name.includes('/WatchGuard/'))window.wgTiming.responses.push({route:new URL(e.name).pathname,responseEnd:e.responseEnd});}); observer.observe({type:'resource',buffered:false}); window.wgTimingObserver=observer;
    window.wgCardsObserver=new MutationObserver(()=>{if(document.querySelector('.watchguard-card')&&!window.wgTiming.firstCard)window.wgTiming.firstCard=performance.now();});window.wgCardsObserver.observe(document.body,{subtree:true,childList:true});
    location.hash='/home?watchguard=watchlists&owner=all';
   });
   await page.locator('.watchguard-card').first().waitFor();
   await page.waitForFunction(()=>document.querySelector('.watchguard-refresh')?.disabled===false);
   results.client.push(await page.evaluate(()=>{window.wgTimingObserver.disconnect();window.wgCardsObserver.disconnect();const t=window.wgTiming;return {completeMs:performance.now()-t.start,firstCardMs:t.firstCard-t.start,clientInsertionAfterResponseMs:t.firstCard-Math.min(...t.responses.map(r=>r.responseEnd)),responses:t.responses.map(r=>r.route)};}));
  }
 } finally {await browser.close();}
 fs.mkdirSync('artifacts/performance',{recursive:true});fs.writeFileSync('artifacts/performance/'+label+'.json',JSON.stringify(results,null,2));
 console.log(JSON.stringify(results,null,2));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
