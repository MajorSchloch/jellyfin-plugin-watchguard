/* Native disposable fixture screenshots and query interaction checks. */
const {chromium}=require('./browser/node_modules/playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
const fixture=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
assert.match(fixture.base,/^http:\/\/127\.0\.0\.1:\d+$/);
(async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const context=await browser.newContext({viewport:{width:1280,height:900},locale:'en-US'});
  const page=await context.newPage();page.setDefaultTimeout(20000);
  await page.goto(fixture.base+'/web/');
  await page.locator('#txtManualName').fill(fixture.username);await page.locator('#txtManualPassword').fill(fixture.password);
  await page.getByRole('button',{name:'Sign In',exact:true}).click();
  await page.waitForFunction(()=>window.WatchGuardPoc?.isInstalled());
  await page.goto(fixture.base+'/web/#/home?watchguard=watchlists&owner=all&interest=watchlisted,watching,playing,watched&sort=title');
  const region=page.getByRole('region',{name:'Watchlists',exact:true});
  async function settled() {
   await page.waitForFunction(()=>document.querySelector('.watchguard-page')?.getAttribute('aria-busy')==='false');
   for(let n=0;n<30 && await region.getByRole('button',{name:'Continue preparing results',exact:true}).isVisible();n++) {
    await region.getByRole('button',{name:'Continue preparing results',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.watchguard-page')?.getAttribute('aria-busy')==='false');
   }
   assert.equal(await region.getByRole('button',{name:'Continue preparing results',exact:true}).isVisible(),false);
  }
  await settled();assert.equal(await region.locator('.watchguard-card').count(),25);
  const search=region.getByRole('searchbox',{name:'Search titles',exact:true});
  await search.fill('Index Movie 120');await page.waitForURL(/search=Index%20Movie%20120/);await settled();
  assert.equal(await region.locator('.watchguard-card').count(),1);assert.match(await region.innerText(),/Index Movie 120/);
  assert.equal(await search.evaluate(e=>e===document.activeElement),true);
  fs.mkdirSync('artifacts/activity-browser',{recursive:true});
  await page.screenshot({path:'artifacts/activity-browser/search-1280.png'});
  await search.fill('');await page.waitForURL(/search=$/);await settled();
  const card=await region.locator('.watchguard-card').first().elementHandle();
  await region.getByRole('button',{name:'Load more results',exact:true}).click();await settled();
  assert.ok(await region.locator('.watchguard-card').count()>25);
  assert.equal(await card.evaluate(e=>e===document.querySelector('.watchguard-card')),true);
  await region.getByRole('combobox',{name:'Sort by'}).selectOption('added');await page.waitForURL(/sort=added/);await settled();
  await page.setViewportSize({width:390,height:900});
  assert.equal(await region.evaluate(e=>e.scrollWidth<=e.clientWidth),true);
  await page.screenshot({path:'artifacts/activity-browser/added-390.png'});
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
