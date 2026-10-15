const {chromium}=require('../../tests/browser/node_modules/playwright');
const assert=require('node:assert/strict');
const f=JSON.parse(require('node:fs').readFileSync(process.argv[2],'utf8'));
assert.match(f.base,/^http:\/\/127\.0\.0\.1:\d+(\/jellyfin)?$/);
(async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage();let deletes=0,checks=0;
  page.on('request',r=>{if(r.method()==='DELETE' && r.url().includes('/Items/'))deletes++;if(r.url().includes('/WatchGuard/Protection/'))checks++;});
  await page.goto(f.base+'/web/');await page.locator('#txtManualName').fill(f.username);await page.locator('#txtManualPassword').fill(f.password);await page.getByRole('button',{name:'Sign In',exact:true}).click();
  await page.waitForFunction(()=>window.WatchGuardPoc?.isInstalled());
  async function begin(){
   await page.goto(f.base+'/web/#/details?id='+f.id+'&serverId='+f.serverId);
   const more=page.locator('#itemDetailPage:not(.hide) .btnMoreCommands');await more.waitFor({timeout:15000});await more.click();
   await page.getByText(/^Delete (?:media|series|episode|season)$/i).click();
   await page.getByRole('button',{name:/^Delete(?: \d+ Episodes)?$/}).click();
   await page.locator('dialog.watchguard-deletion-dialog').waitFor();
  }
  await begin();assert.ok(checks>0);await page.locator('dialog.watchguard-deletion-dialog').getByRole('button',{name:'Cancel',exact:true}).click();
  await page.getByRole('button',{name:'Got It',exact:true}).click();assert.equal(deletes,0);
  const prior=checks;await begin();assert.ok(checks>prior);
  const response=page.waitForResponse(r=>r.request().method()==='DELETE'&&r.url().includes('/Items/'));
  await page.locator('dialog.watchguard-deletion-dialog').getByRole('button',{name:'Delete Anyway',exact:true}).click();
  assert.equal((await response).status(),409);assert.equal(deletes,1);
  await page.getByRole('button',{name:'Got It',exact:true}).waitFor();
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
