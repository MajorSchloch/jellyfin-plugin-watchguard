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
   const record={status:response.status(),search:url.searchParams.get('search'),continuation:url.searchParams.has('continuation')};
   report.responses.push(record);
   try {const data=await response.json();Object.assign(record,{preparing:data.Preparing,items:data.Items?.length,more:!!data.Continuation,code:data.Code});} catch {}
  });
  await readiness.capture(page);await readiness.login(page,fixture);
  async function verified() {
   // Native login/metadata changes can invalidate the fixture's projection.
   // Synchronize fixture setup before asserting the complete seeded dataset;
   // this admin-only wait is not browser product polling.
   await page.waitForFunction(async()=>{
    const data=await ApiClient.ajax({url:ApiClient.getUrl('WatchGuard/ActivityIndex/Status?owner=all'),type:'GET',dataType:'json'});
    const state=data.Freshness;
    return state.DiscoveryFinished && state.Pending===0 && state.Stored===state.Validated;
   },null,{timeout:300000,polling:500});
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
