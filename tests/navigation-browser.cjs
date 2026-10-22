/* Real Jellyfin routing boundary; no replacement router or WatchGuard API responses. */
const {chromium} = require('./browser/node_modules/playwright');
const readiness = require('./browser-readiness.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fixture = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
assert.match(fixture.base, /^https?:\/\/(?:127\.0\.0\.1|localhost):\d+(?:\/jellyfin)?$/);
const output = process.argv[3] || 'artifacts/navigation-browser';
fs.mkdirSync(output, {recursive: true});
const report = {result: 'RUNNING', cases: [], travel: []};
(async () => {
 const browser = await chromium.launch({headless: true});
 let page;
 try {
  const context = await browser.newContext({ignoreHTTPSErrors: fixture.tls === true, viewport: {width:1280,height:900}, locale:'en-US'});
  page = await context.newPage(); page.setDefaultTimeout(20000);
  await readiness.capture(page); await readiness.login(page, fixture);
  const native = (route, type='GET', data) => page.evaluate(async ({route,type,data}) => ApiClient.ajax({url:ApiClient.getUrl(route),type,...(type==='GET'?{dataType:'json'}:{}),...(data===undefined?{}:{contentType:'application/json',data:JSON.stringify(data)})}), {route,type,data});
  const item = (await native('Items?Recursive=true&IncludeItemTypes=Movie&Limit=1')).Items[0];
  assert.ok(item); await native('WatchGuard/Watchlist/'+item.Id, 'PUT');
  const region = page.getByRole('region', {name:'Watchlists',exact:true});
  const owner = region.getByRole('combobox',{name:'Watchlist owner'}), sort = region.getByRole('combobox',{name:'Sort by'});
  const search = region.getByRole('searchbox',{name:'Search titles',exact:true});
  const settled = async () => {
   await region.waitFor();
   await page.waitForFunction(()=>document.querySelector('.watchguard-page')?.getAttribute('aria-busy')==='false');
   assert.equal(await region.getByRole('button',{name:'Continue loading',exact:true}).isVisible(),false);
  };
  let phase, requests = [], active = 0, maxActive = 0, nativeRoutes = 0;
  const inFlight = new Set();
  page.on('console', message => {if(phase && message.text().startsWith('[RouterHistory] history update')) nativeRoutes++;});
  page.on('request', request => {
   if(!new URL(request.url()).pathname.endsWith('/WatchGuard/ActivityBrowser')) return;
   inFlight.add(request); active++; maxActive=Math.max(maxActive,active);
   if(phase) {const params=new URL(request.url()).searchParams; requests.push({search:params.get('search'),continuation:params.has('continuation'),check:params.get('check')==='true'});}
  });
  const finish = request => {if(inFlight.delete(request)) active--;};
  page.on('requestfinished',finish); page.on('requestfailed',finish);
  const delay = async route => {await new Promise(resolve=>setTimeout(resolve,350)); await route.continue();};
  await page.route('**/WatchGuard/ActivityBrowser?**', delay);
  async function measure(name, control, action, expected) {
   await control.focus();
   await page.evaluate(() => {
    const panel=document.querySelector('.watchguard-page'), focus=document.activeElement;
    // Clicking outside Status intentionally dismisses that popover; other open
    // disclosures, and Status while using its own controls, must stay open.
    const open=[...panel.querySelectorAll('details[open]')].filter(e=>!e.classList.contains('watchguard-filter') || e.contains(focus));
    const data={frames:0,homeExposures:0,overlays:0,panelReplacements:0,focusLosses:0,closedDisclosures:0,hashEvents:0,popEvents:0,loadingFrames:0,historyBefore:history.length,stateBefore:JSON.stringify(history.state)};
    let running=true;
    const sample=()=>{
     data.frames++;
     if(!panel.isConnected || document.querySelector('.watchguard-page')!==panel) data.panelReplacements++;
     if(document.activeElement!==focus) data.focusLosses++;
     if(open.some(e=>e.isConnected&&!e.open)) data.closedDisclosures++;
     if(panel.getAttribute('aria-busy')==='true') data.loadingFrames++;
     const rect=panel.getBoundingClientRect();
     for(const [x,y] of [[innerWidth/2,rect.top+20],[innerWidth/2,innerHeight/2],[20,innerHeight-30]]) {
      const hit=document.elementFromPoint(x,y);
      if(hit && !panel.contains(hit)) {
       if(hit.closest('.homePage, #homePage, .skinBody, main')) data.homeExposures++;
       else data.overlays++;
      }
     }
    };
    const observer=new MutationObserver(sample); observer.observe(document.body,{subtree:true,childList:true,attributes:true});
    const hash=()=>{data.hashEvents++;sample();},pop=()=>{data.popEvents++;sample();};
    addEventListener('hashchange',hash);addEventListener('popstate',pop);
    const frame=()=>{if(running){sample();requestAnimationFrame(frame);}};frame();
    window.wgNavigationObservation={stop:()=>{running=false;observer.disconnect();removeEventListener('hashchange',hash);removeEventListener('popstate',pop);sample();return {...data,historyAfter:history.length,stateAfter:JSON.stringify(history.state)};}};
   });
   phase=name; requests=[]; maxActive=active; nativeRoutes=0;
   await action();
   await page.waitForFunction(expected => Object.entries(expected).every(([k,v])=>new URLSearchParams(location.hash.split('?')[1]).get(k)===v), expected);
   if(name.endsWith('-owner')) await page.screenshot({path:path.join(output,name+'-loading.png')});
   await settled();
   // Include delayed native route work and two 500ms adapter checks, not just settlement.
   await page.waitForTimeout(1100);
   const observation=await page.evaluate(()=>window.wgNavigationObservation.stop());
   report.cases.push({name,...observation,nativeRoutes,requests:[...requests],maxConcurrentQueries:maxActive});phase=null;
  }
  for(const layout of ['desktop-legacy','modern']) {
   await page.setViewportSize({width:1280,height:900});
   await page.evaluate(layout=>localStorage.setItem('layout',layout),layout);
   await page.goto(fixture.base+'/web/#/home');await page.reload();
   await page.getByText('My Media',{exact:true}).waitFor();
   assert.equal(await page.locator('.skinHeader').isVisible(),layout==='desktop-legacy');
   await page.locator('.watchguard-nav').click();await settled();
   await page.reload();await settled(); // Router initializes its own history state.
   assert.ok(await page.evaluate(()=>history.state && Number.isInteger(history.state.idx)));
   for(const width of [1280,390]) {
    await page.setViewportSize({width,height:900});
    const prefix=layout+'-'+width+'-';
    await measure(prefix+'owner',owner,()=>owner.selectOption('all'),{owner:'all'});
    await measure(prefix+'sort',sort,()=>sort.selectOption('added'),{sort:'added'});
    if(!await region.locator('.watchguard-secondary').evaluate(e=>e.open)) await region.locator('.watchguard-secondary > summary').click();
    const range=region.getByRole('combobox',{name:'Activity range'});
    await measure(prefix+'range',range,()=>range.selectOption('7'),{days:'7'});
    const older=region.getByRole('checkbox',{name:'Include older current interest'});
    await measure(prefix+'older',older,()=>older.uncheck(),{older:'false'});
    if(!await region.locator('.watchguard-filter').evaluate(e=>e.open)) await region.locator('.watchguard-filter > summary').click();
    const watched=region.getByRole('checkbox',{name:'Watched',exact:true});
    await measure(prefix+'status',watched,()=>watched.check(),{interest:'watchlisted,watching,playing,watched'});
    // Search input does not close disclosures via pointerdown; retain their nodes/state.
    await measure(prefix+'search',search,()=>search.fill(item.Name),{search:item.Name});
    await measure(prefix+'rapid-search',search,async()=>{await search.fill('miss');await page.waitForTimeout(300);await search.fill('missing title');await page.waitForTimeout(40);await search.fill(item.Name);},{search:item.Name});
    assert.equal(await region.locator('.watchguard-card .cardText').first().textContent(),item.Name);
    await measure(prefix+'rapid-controls',sort,async()=>{await sort.selectOption('title');await page.waitForTimeout(300);await sort.selectOption('recent');await owner.selectOption('mine');},{sort:'recent',owner:'mine'});
    await page.screenshot({path:path.join(output,prefix+'retained.png')});
    await region.locator('.watchguard-filter').evaluate(e=>{e.open=true;});
    const reset=region.getByRole('button',{name:'Reset to Defaults',exact:true});
    await measure(prefix+'reset',reset,()=>reset.click(),{owner:'mine',sort:'title',days:'30',older:'true',search:'',interest:'watchlisted,watching,playing'});
   }
  }
  fs.writeFileSync(path.join(output,'transitions.json'),JSON.stringify(report,null,2)+'\n');
  for(const result of report.cases) {
   for(const field of ['homeExposures','overlays','panelReplacements','focusLosses','closedDisclosures','hashEvents','popEvents','nativeRoutes']) assert.equal(result[field],0,result.name+': '+field);
   assert.equal(result.historyAfter,result.historyBefore,result.name+': controls replace the current entry');
   assert.equal(result.stateAfter,result.stateBefore,result.name+': router state preserved');
   assert.ok(result.frames>10 && result.loadingFrames>0,result.name+': monitored loading frames');
   assert.ok(result.maxConcurrentQueries<=1,result.name+': query serialization');
   assert.ok(result.requests.length>=1 && result.requests.length<=4,result.name+': bounded query requests');
   if(!result.name.includes('rapid-')) assert.equal(result.requests.filter(r=>!r.continuation&&!r.check).length,1,result.name+': exactly one initial query');
  }
  // Filters replace the current Watchlists entry: Back leaves it, Forward restores the latest view.
  await page.setViewportSize({width:1280,height:900});
  await sort.selectOption('recent'); await settled(); await page.waitForURL(/sort=recent/);
  const url=page.url();
  await page.goBack();await region.waitFor({state:'detached'});assert.ok(!page.url().includes('watchguard=watchlists'));
  await page.goForward();await settled();assert.equal(page.url(),url);assert.equal(await sort.inputValue(),'recent');
  report.travel.push('Back to Home / Forward to latest filters');
  await page.reload();await settled();assert.equal(await sort.inputValue(),'recent');
  report.travel.push('reload');
  const shared=await context.newPage();await shared.goto(url);await shared.waitForFunction(()=>document.querySelector('.watchguard-page')?.getAttribute('aria-busy')==='false');assert.equal(await shared.getByRole('combobox',{name:'Sort by'}).inputValue(),'recent');await shared.close();
  report.travel.push('direct shared URL');
  await search.fill(item.Name);await page.waitForURL(/search=.+/);await settled();const returnUrl=page.url();
  await region.locator('.watchguard-card a.button-link').first().click();
  await page.locator('#itemDetailPage:visible').waitFor();await region.waitFor({state:'detached'});
  await page.goBack();await settled();assert.equal(page.url(),returnUrl);assert.equal(await search.inputValue(),item.Name);
  await page.goForward();await page.locator('#itemDetailPage:visible').waitFor();await region.waitFor({state:'detached'});
  await page.goBack();await settled();report.travel.push('item details / Back / Forward / Back');
  for(const [hash,destination] of [['#/home?tab=1','#/home?tab=1'],['#/','#/home']]) {
   // Use the actual native anchor; ordinary navigation remains owned by Jellyfin.
   const link=page.locator('a[href="'+hash+'"]').filter({visible:true}).first();
   await link.click();await region.waitFor({state:'detached'});await page.waitForURL(url=>url.hash===destination);
   await page.goBack();await settled();assert.equal(page.url(),returnUrl);
   report.travel.push(hash+' / Back');
  }
  await page.unroute('**/WatchGuard/ActivityBrowser?**',delay);
  report.result='PASS';
 } catch(error) {
  report.result='FAIL';report.error=String(error.message);
  if(page) {await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});}
  throw error;
 } finally {
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(report,null,2)+'\n');await browser.close();
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
