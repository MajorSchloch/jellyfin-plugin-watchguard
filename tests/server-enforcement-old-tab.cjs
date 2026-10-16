const {chromium}=require('./browser/node_modules/playwright');
const assert=require('node:assert/strict');
const f=JSON.parse(require('node:fs').readFileSync(process.argv[2],'utf8'));
assert.match(f.base,/^http:\/\/127\.0\.0\.1:\d+(\/jellyfin)?$/);
(async()=>{
 const browser=await chromium.launch({headless:true});let page;
 try {
  page=await browser.newPage();let deletes=0,checks=0;
  // Disposable old-tab fixture only: serve the recorded v0.4.8 script to this browser.
  await page.route('**/WatchGuard/Standalone/script.js*',route=>route.fulfill({contentType:'application/javascript',body:require('node:fs').readFileSync(f.legacyScript,'utf8')}));
  page.on('request',r=>{if(r.method()==='DELETE' && r.url().includes('/Items/'))deletes++;if(r.url().includes('/WatchGuard/Protection/'))checks++;});
  await page.goto(f.base+'/web/');await page.locator('#txtManualName').fill(f.username);await page.locator('#txtManualPassword').fill(f.password);await page.getByRole('button',{name:'Sign In',exact:true}).click();
  await page.waitForFunction(()=>window.WatchGuardPoc?.isInstalled());
  // The old-tab compatibility contract is the retained v0.4.8 ApiClient
  // adapter, not Jellyfin's current detail-toolbar visibility. Other suites
  // exercise actual native More -> Delete menus. Invoke the same ApiClient
  // method here so we can verify the real Web dialog and server veto even
  // when the modern Jellyfin shell hides legacy detail action buttons.
  async function begin(){
   await page.goto(f.base+'/web/#/details?id='+f.id+'&serverId='+f.serverId);
   await page.waitForFunction(()=>window.WatchGuardPoc?.isInstalled());
   await page.evaluate(id=>{
    window.wgOldTabPending=ApiClient.deleteItem(id).then(()=>true,()=>false);
   },f.id);
   await page.locator('dialog.watchguard-deletion-dialog').waitFor();
  }
  await begin();assert.ok(checks>0);
  await page.locator('dialog.watchguard-deletion-dialog').getByRole('button',{name:'Cancel',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.wgOldTabPending),false);
  assert.equal(deletes,0);
  const prior=checks;await begin();assert.ok(checks>prior);
  const response=page.waitForResponse(r=>r.request().method()==='DELETE'&&r.url().includes('/Items/'));
  await page.locator('dialog.watchguard-deletion-dialog').getByRole('button',{name:'Delete Anyway',exact:true}).click();
  assert.equal((await response).status(),409);assert.equal(deletes,1);
  assert.equal(await page.evaluate(()=>window.wgOldTabPending),false);
 }catch(error){
  if(page && f.output){await page.screenshot({path:require('node:path').join(f.output,'old-tab-failure.png')});console.error('Old-tab phase:',new URL(page.url()).hash,(await page.locator('body').innerText()).slice(0,1200));}
  throw error;
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
