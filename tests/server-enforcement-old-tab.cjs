const readiness=require('./browser-readiness.cjs');
const {chromium}=require('./browser/node_modules/playwright');
const assert=require('node:assert/strict');
const f=JSON.parse(require('node:fs').readFileSync(process.argv[2],'utf8'));
assert.match(f.base,/^http:\/\/127\.0\.0\.1:\d+(\/jellyfin)?$/);
(async()=>{
 const browser=await chromium.launch({headless:true});let page;
 try {
  page=await browser.newPage();let deletes=0,checks=0;
  await readiness.capture(page);
  // Disposable old-tab fixture only: serve the recorded v0.4.8 script to this browser.
  await page.route('**/WatchGuard/Standalone/script.js*',route=>route.fulfill({contentType:'application/javascript',body:require('node:fs').readFileSync(f.legacyScript,'utf8')}));
  page.on('request',r=>{if(r.method()==='DELETE' && r.url().includes('/Items/'))deletes++;if(r.url().includes('/WatchGuard/Protection/'))checks++;});
  await readiness.login(page,f);
  // The old-tab compatibility contract is the retained v0.4.8 ApiClient
  // adapter, not Jellyfin's current detail-toolbar visibility. Other suites
  // exercise actual native More -> Delete menus. Invoke the same ApiClient
  // method here to verify the real Web dialog and server veto independently
  // of native toolbar rendering, which has its own regression suite.
  async function begin(){
   await readiness.detail(page,f,f.id);
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
  await readiness.failure(page,f,'old-tab',error).catch(()=>console.warn('Diagnostic capture failed; original error follows'));
  throw error;
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
