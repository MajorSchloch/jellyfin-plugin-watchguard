/* Native disposable fixture screenshots and query interaction checks. */
const {chromium}=require('./browser/node_modules/playwright');
const readiness=require('./browser-readiness.cjs');
const fs=require('node:fs'),assert=require('node:assert/strict');
const fixture=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
assert.match(fixture.base,/^http:\/\/127\.0\.0\.1:\d+$/);
(async()=>{
 const browser=await chromium.launch({headless:true});
 let page;
 const report={result:'RUNNING',phase:'login',expiredViewRecoveries:0,responses:[]};
 try {
  const context=await browser.newContext({viewport:{width:1280,height:900},locale:'en-US'});
  page=await context.newPage();page.setDefaultTimeout(20000);
  page.on('response',async response=>{
   const url=new URL(response.url());if(!url.pathname.endsWith('/WatchGuard/ActivityBrowser'))return;
   const record={status:response.status(),search:url.searchParams.get('search'),statuses:url.searchParams.get('statuses'),days:url.searchParams.get('days'),older:url.searchParams.get('older'),continuation:url.searchParams.has('continuation')};
   report.responses.push(record);
   try {const data=await response.json();Object.assign(record,{preparing:data.Preparing,items:data.Items?.length,more:!!data.Continuation,code:data.Code,work:data.ReadDiagnostics,causes:data.Coverage?.Causes});} catch {}
  });
  await readiness.capture(page);await readiness.login(page,fixture);
  async function verified() {
   // Native login/metadata changes can invalidate the fixture's projection.
   // Synchronize fixture setup before asserting the complete seeded dataset;
   // this admin-only wait is not browser product polling.
   // Playwright 1.56's waitForFunction tests the Promise itself for truthiness;
   // an async predicate therefore returns early even when it resolves false.
   const deadline=Date.now()+300000;
   while(true) {
    const state=await page.evaluate(async()=>
     (await ApiClient.ajax({url:ApiClient.getUrl('WatchGuard/ActivityIndex/Status?owner=all'),type:'GET',dataType:'json'})).Freshness);
    if(state.DiscoveryFinished && state.Pending===0 && state.Stored===state.Validated) {
     (report.verifications??=[]).push({phase:report.phase,state});return;
    }
    assert.ok(Date.now()<deadline,'Native fixture verification did not settle: '+JSON.stringify(state));
    await new Promise(resolve=>setTimeout(resolve,500));
   }
  }
  await verified();report.phase='initial query';
  await page.goto(fixture.base+'/web/#/home?watchguard=watchlists&owner=all&interest=watchlisted,watching,playing,watched&sort=title');
  const region=page.getByRole('region',{name:'Watchlists',exact:true});
  async function settled() {
   for(let n=0;n<30;n++) {
    await page.waitForFunction(()=>document.querySelector('.watchguard-page')?.getAttribute('aria-busy')==='false');
    const expired=region.getByRole('button',{name:'Refresh this view',exact:true});
    if(await expired.isVisible()) {
     assert.match(await region.innerText(),/Could not continue this view/);
     assert.ok(++report.expiredViewRecoveries<=3,'Bounded recovery must converge');
     const selected=page.url();await verified();await expired.click();
     assert.equal(page.url(),selected,'Expiry recovery retains every query control');
     continue;
    }
    const prepare=region.getByRole('button',{name:'Continue preparing results',exact:true});
    if(!await prepare.isVisible())return;
    await prepare.click();
   }
   assert.fail('Bounded preparation must progress');
  }
  await settled();
  const initialCount=await region.locator('.watchguard-card').count();
  assert.ok(initialCount>0 && initialCount<=25,'Ordered pages respect the title ceiling and remaining authorization budget');
  const search=region.getByRole('searchbox',{name:'Search titles',exact:true});
  report.phase='search';await verified();
  await search.fill('Index Movie 120');await page.waitForURL(/search=Index%20Movie%20120/);await settled();
  assert.equal(await region.locator('.watchguard-card').count(),1);assert.match(await region.innerText(),/Index Movie 120/);
  assert.equal(await search.evaluate(e=>e===document.activeElement),true);
  fs.mkdirSync('artifacts/activity-browser',{recursive:true});
  await page.screenshot({path:'artifacts/activity-browser/search-1280.png'});
  report.phase='clear search';await verified();
  await search.fill('');await page.waitForURL(/search=$/);await settled();
  const card=await region.locator('.watchguard-card').first().elementHandle();
  const beforeMore=await region.locator('.watchguard-card').count();
  await region.getByRole('button',{name:'Load more results',exact:true}).click();await settled();
  assert.ok(await region.locator('.watchguard-card').count()>beforeMore);
  assert.equal(await card.evaluate(e=>e===document.querySelector('.watchguard-card')),true);
  report.phase='added ordering';
  await region.getByRole('combobox',{name:'Sort by'}).selectOption('added');await page.waitForURL(/sort=added/);await settled();
  await page.setViewportSize({width:390,height:900});
  assert.equal(await region.evaluate(e=>e.scrollWidth<=e.clientWidth),true);
  await page.screenshot({path:'artifacts/activity-browser/added-390.png'});
  report.result='PASS';
 } catch(error) {
  report.result='FAIL';
  if(page) {
   report.view=await page.locator('.watchguard-page').innerText().catch(()=>'(unavailable)');
   await readiness.failure(page,fixture,'activity-query',error);
  }
  throw error;
 } finally {
  fs.mkdirSync('artifacts/activity-browser/ui',{recursive:true});
  fs.writeFileSync('artifacts/activity-browser/ui/results.json',JSON.stringify(report,null,2)+'\n');
  await browser.close();
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
