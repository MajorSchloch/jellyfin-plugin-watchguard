const {chromium}=require('../../tests/browser/node_modules/playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const f=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
assert.match(f.base,/^https?:\/\/(127\.0\.0\.1|localhost):\d+(\/jellyfin)?$/);
(async()=>{
 const browser=await chromium.launch({headless:true});
 const result={removed:[],cases:[],timings:[],requests:[]};
 try {
  const page=await browser.newPage({ignoreHTTPSErrors:!!f.proxy,viewport:{width:1280,height:900}});let deletes=0;
  const started=new WeakMap();page.on('request',r=>started.set(r,Date.now()));
  page.on('response',r=>{const u=r.url(),phase=u.includes('/WatchGuard/Protection/')?'Protection':u.includes('/ExperimentalApproval/')?u.split('/').pop():r.request().method()==='DELETE'&&u.includes('/Items/')?'NativeDelete':null;if(phase)result.requests.push({phase,status:r.status(),ms:Date.now()-started.get(r.request())});});
  page.on('request',r=>{if(r.method()==='DELETE'&&/\/Items\//.test(r.url()))deletes++;});
  await page.goto(f.base+'/web/');await page.locator('#txtManualName').fill(f.username);await page.locator('#txtManualPassword').fill(f.password);await page.getByRole('button',{name:'Sign In',exact:true}).click();
  await page.waitForFunction(()=>window.WatchGuardPoc?.isInstalled());
  const dialog=page.locator('dialog.watchguard-deletion-dialog');
  const target=name=>{const t=f.items.find(i=>i.Name===name);assert.ok(t,name);return t;};
  async function begin(item){
   await page.goto(f.base+'/web/#/details?id='+item.Id+'&serverId='+f.serverId);
   const more=page.locator('#itemDetailPage:not(.hide) .btnMoreCommands:visible');await more.waitFor({timeout:15000});await more.click();
   await page.getByText(/^Delete (?:media|series|episode|season)$/i).click();
   await page.getByRole('button',{name:/^Delete(?: \d+ Episodes)?$/}).click();
   await dialog.waitFor();
  }
  async function survives(item){assert.ok(fs.existsSync(path.join(f.mediaRoot,item.Path.replace(/^\/media\//,''))));assert.equal(await page.evaluate(async id=>(await ApiClient.getItem(ApiClient.getCurrentUserId(),id)).Id,item.Id),item.Id);}
  async function dismiss(){await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await page.getByRole('button',{name:'Got It',exact:true}).click();}
  async function snap(name){await page.screenshot({path:path.join(f.output,(f.proxy?'proxy-':'')+name+'.png')});}
  async function approve(item){
   const before=deletes;await begin(item);assert.match(await dialog.innerText(),f.legacy?/Web-only warning/:/Server approval required/);
   const response=page.waitForResponse(r=>r.request().method()==='DELETE'&&r.url().includes('/Items/'+item.Id));const t=Date.now();
   await dialog.getByRole('button',{name:'Delete Anyway',exact:true}).click();assert.equal((await response).status(),204);
   await page.waitForURL(url=>!url.href.includes(item.Id));assert.equal(deletes,before+1);result.removed.push(item.Id);result.timings.push({kind:item.Type,elapsedMs:Date.now()-t});result.cases.push('approved-'+item.Type);
  }
  if(f.legacy){await approve(target('WebLegacy'));}
  else if(f.proxy){await approve(target('CaddyWeb'));await snap('approved');}
  else {
   const movie=target('WebApproved');
   for(const mode of ['Cancel','Escape','close']) {
    const before=deletes;await begin(movie);assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Cancel');
    if(mode==='Cancel'){await snap('desktop-dialog');await dialog.getByRole('button',{name:'Cancel',exact:true}).click();}
    else if(mode==='Escape')await page.keyboard.press('Escape');else await dialog.evaluate(d=>d.close());
    await page.getByRole('button',{name:'Got It',exact:true}).click();assert.equal(deletes,before);await survives(movie);result.cases.push(mode+'-zero-delete');
   }
   await page.setViewportSize({width:390,height:844});await begin(movie);await snap('mobile-dialog');await dismiss();
   await page.setViewportSize({width:1280,height:900});await approve(movie);await snap('approved');await page.setViewportSize({width:390,height:844});await snap('mobile-approved');await page.setViewportSize({width:1280,height:900});
   const error=target('WebError');
   for(const [route,status,code] of [['Approve',410,'ApprovalExpired'],['Capabilities',503,'ServerGuardUnsupported']]) {
    await page.route('**/WatchGuard/ExperimentalApproval/'+route,r=>r.fulfill({status,contentType:'application/json',headers:{'Cache-Control':'no-store'},body:JSON.stringify({Code:code})}));
    const before=deletes;
    if(route==='Approve') {await begin(error);await dialog.getByRole('button',{name:'Delete Anyway',exact:true}).click();await dialog.getByText(/Server approval is unavailable/).waitFor();}
    else await begin(error);
    await snap(code);await page.setViewportSize({width:390,height:844});await snap(code+'-mobile');await page.setViewportSize({width:1280,height:900});await dismiss();assert.equal(deletes,before);await survives(error);result.cases.push(code+'-zero-delete');
    await page.unroute('**/WatchGuard/ExperimentalApproval/'+route);
   }
   // Native per-item queue semantics, no conversion to /Items?ids. Existing UI dialog is reused.
   const bulk=[target('WebBulkA'),target('WebBulkB')],before=deletes;
   await page.evaluate(ids=>{window.wgTestDone=Promise.allSettled(ids.map(id=>ApiClient.deleteItem(id)));},bulk.map(i=>i.Id));
   for(const item of bulk){await dialog.waitFor();const response=page.waitForResponse(r=>r.request().method()==='DELETE'&&r.url().includes(item.Id));await dialog.getByRole('button',{name:'Delete Anyway',exact:true}).click();assert.equal((await response).status(),204);result.removed.push(item.Id);}
   await page.evaluate(()=>window.wgTestDone);assert.equal(deletes,before+2);result.cases.push('individual-bulk-queue');
   // Native legacy detail menus for each inherited series target.
   for(const type of ['Episode','Season','Series']) {const item=f.items.find(i=>i.Type===type);assert.ok(item);await approve(item);if(type==='Season')for(const child of f.items.filter(i=>i.Type==='Episode'))if(!result.removed.includes(child.Id))result.removed.push(child.Id);}
   const clear=target('WebClear');const count=deletes;
   await page.evaluate(id=>ApiClient.deleteItem(id),clear.Id);assert.equal(deletes,count+1);result.removed.push(clear.Id);result.cases.push('clear-native');
  }
  result.status='PASS';result.nativeDeletes=deletes;
  fs.writeFileSync(path.join(f.output,f.legacy?'browser-legacy.json':f.proxy?'browser-proxy.json':'browser.json'),JSON.stringify(result,null,2)+'\n');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
