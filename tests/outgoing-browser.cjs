/* Actual native card/router boundary. Gates delay requests, never replace successful item data. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const fixture=JSON.parse(fs.readFileSync(process.argv[2]));
assert.match(fixture.base,/^https?:\/\/(?:127\.0\.0\.1|localhost):\d+(?:\/jellyfin)?$/);
const output=process.argv[3]||'artifacts/outgoing-browser';fs.mkdirSync(output,{recursive:true});
const old=!!process.env.WATCHGUARD_CHROMIUM79, baseline=process.env.WATCHGUARD_HANDOFF_BASELINE==='1';
const report={serverVersion:fixture.serverVersion,image:fixture.image,cases:[],result:'RUNNING',physicalTV:false,errors:[]};
report.runtimeSha256=crypto.createHash('sha256').update(fs.readFileSync(process.env.WATCHGUARD_BASELINE_DLL||'artifacts/WatchGuard/Jellyfin.Plugin.WatchGuard.dll')).digest('hex');
(async()=>{
 const browser=old?await require('./browser79/node_modules/puppeteer-core').launch({executablePath:process.env.WATCHGUARD_CHROMIUM79,headless:true}):await require('./browser/node_modules/playwright').chromium.launch({headless:true});
 let page, release=[], heldId, blocked=0, failure=false;
 report.engine=await browser.version();if(old)assert.match(report.engine,/\/79\./);
 const wait=(fn,arg)=>old?page.waitForFunction(fn,{},arg):page.waitForFunction(fn,arg);
 const frames=n=>page.evaluate(n=>new Promise(resolve=>{let count=0;const next=()=>++count===n?resolve():requestAnimationFrame(next);next();}),n);
 const unhold=()=>{heldId=null;release.splice(0).forEach(resolve=>resolve());};
 async function setup(layout,width) {
  const context=old?await browser.createIncognitoBrowserContext():await browser.newContext({viewport:{width,height:900},hasTouch:width===390,locale:'en-US',ignoreHTTPSErrors:fixture.tls===true});
  page=await context.newPage();if(old)await page.setViewport({width,height:900,hasTouch:width===390});
  page.on('pageerror',error=>report.errors.push({kind:'script',layout,message:String(error.stack||error.message).replace(/https?:\/\/[^\s]+/g,'[URL]').replace(/[A-Za-z0-9_-]{32,}/g,'[IDENTIFIER]')}));
  page.on('requestfailed',request=>report.errors.push({path:new URL(request.url()).pathname,error:request.failure().errorText}));
  page.setDefaultTimeout(20000);
  const init=()=>{
   const active=new Set(),add=document.addEventListener.bind(document),remove=document.removeEventListener.bind(document);
   document.addEventListener=function(type,fn,opts){if(type==='pointerdown'&&fn.name==='dismissOutside')active.add(fn);return add(type,fn,opts);};
   document.removeEventListener=function(type,fn,opts){if(type==='pointerdown'&&fn.name==='dismissOutside')active.delete(fn);return remove(type,fn,opts);};
   window.wgOutsideCount=()=>active.size;
  };
  if(old)await page.evaluateOnNewDocument(init);else await page.addInitScript(init);
  const handler=async(url,next,fail)=>{if(heldId&&(new URL(url).pathname.toLowerCase().endsWith('/items/'+heldId.toLowerCase())||/itemDetails.*\.chunk\.js/.test(url))){blocked++;await new Promise(resolve=>release.push(resolve));if(failure)return fail();}await next();};
  if(old){await page.setRequestInterception(true);page.on('request',r=>handler(r.url(),()=>r.continue(),()=>r.respond({status:503,contentType:'application/json',body:'{}'})).catch(()=>{}));}
  else await page.route('**/*',r=>handler(r.request().url(),()=>r.continue(),()=>r.fulfill({status:503,body:'{}'})));
  if(old){
   await page.goto(fixture.base+'/web/#/login');
   await wait(()=>document.querySelector('#txtManualName')||Array.from(document.querySelectorAll('button')).some(e=>e.textContent.trim()==='Manual Login'));
   await page.evaluate(()=>{const b=Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()==='Manual Login');if(b)b.click();});
   await page.waitForSelector('#txtManualName',{visible:true});await page.type('#txtManualName',fixture.username);await page.type('#txtManualPassword',fixture.password);await page.keyboard.press('Enter');
   await wait(()=>location.hash==='#/home'&&window.WatchGuardPoc&&WatchGuardPoc.isInstalled());
  }else await require('./browser-readiness.cjs').login(page,fixture);
  await page.evaluate(value=>localStorage.setItem('layout',value),layout);await page.reload();
  await wait(()=>window.WatchGuardPoc&&WatchGuardPoc.isInstalled());
  return context;
 }
 async function observe() {
  await page.evaluate(()=>{
   if(window.wgStopOutgoing)wgStopOutgoing();
   const data={frames:0,homeExposures:0,events:[],samples:[]};let running=true;
   const event=e=>{const d=e.detail||{},p=d.params||{};data.events.push({name:e.type,route:location.hash.split('?')[0],item:p.id,target:e.target.id,at:performance.now(),panel:!!document.querySelector('.watchguard-page'),cover:!!document.querySelector('.watchguard-outgoing')});};
   const names=['viewbeforehide','viewhide','viewbeforeshow','viewshow','hashchange'];names.forEach(name=>addEventListener(name,event,true));
   const sample=()=>{if(!running)return;data.frames++;let home=false;for(const [x,y] of [[innerWidth/2,innerHeight/2],[30,innerHeight-50],[innerWidth/2,160]]){const hit=document.elementFromPoint(x,y);if(hit&&hit.closest('.homePage,#homePage'))home=true;}
    if(home)data.homeExposures++;if(data.samples.length<180)data.samples.push({at:performance.now(),home,cover:!!document.querySelector('.watchguard-outgoing'),panel:!!document.querySelector('.watchguard-page')});requestAnimationFrame(sample);};sample();
   window.wgStopOutgoing=()=>{running=false;names.forEach(name=>removeEventListener(name,event,true));return data;};
  });
 }
 async function watchlists(items) {
  await page.evaluate(async ids=>{for(const id of ids)await ApiClient.ajax({url:ApiClient.getUrl('WatchGuard/Watchlist/'+id),type:'PUT'});},items.map(i=>i.Id));
  await page.goto(fixture.base+'/web/#/home?watchguard=watchlists&owner=mine&interest=watchlisted');
  await wait(ids=>{const p=document.querySelector('.watchguard-page');return p&&p.getAttribute('aria-busy')==='false'&&ids.every(id=>p.querySelector('a[href*="'+id+'"]'));},items.map(i=>i.Id));
 }
 async function activate(item,input) {
  const s='.watchguard-card a[href*="'+item.Id+'"]';
  await wait(s=>!!document.querySelector(s),s);
  if(input==='remote'){await page.focus(s);await page.keyboard.press('Enter');}
  else if(input==='touch')await page.tap(s);
  else await page.click(s);
  await wait(id=>location.hash.indexOf('#/details?')===0&&new URLSearchParams(location.hash.split('?')[1]).get('id')===id,item.Id);
 }
 async function ready(item) {
  await wait(item=>{const v=document.querySelector('#itemDetailPage:not(.hide)'),b=v&&v.querySelector('.btnPlaystate');return v&&v.querySelector('.nameContainer').textContent.includes(item.Name)&&b.getAttribute('data-id')===item.Id&&!document.querySelector('.watchguard-outgoing');},item);
 }
 try {
  for(const [layout,width,input] of [['tv',1280,'remote'],['desktop-legacy',1280,'mouse'],['mobile-legacy',390,'touch'],['modern',1280,'mouse'],['auto',390,'touch']]){
   if(baseline&&report.cases.length)break;
   const context=await setup(layout,width);
   const all=await page.evaluate(async()=>{const a=ApiClient,v=await a.ajax({url:a.getUrl('Items',{Recursive:true,IncludeItemTypes:'Movie,Series'}),type:'GET',dataType:'json'});return v.Items.map(i=>({Id:i.Id,Name:i.Name,Type:i.Type}));});
   const items=['Series','Movie'].map(type=>all.find(i=>i.Type===type));assert(items.every(Boolean));
   for(const item of items){
    if(baseline&&report.cases.length)break;
    await watchlists(items);await observe();blocked=0;heldId=item.Id;failure=false;const errorStart=report.errors.length;
    await activate(item,input);await frames(35);
    assert(blocked>0,'The test held native destination work');
    const row={layout,width,input,type:item.Type,blocked,language:await page.evaluate(()=>navigator.language)};report.cases.push(row);
    await page.screenshot({path:path.join(output,layout+'-'+item.Type+'-loading.png')});
    if(!baseline){
     assert(await page.evaluate(()=>!!document.querySelector('.watchguard-outgoing')&&!document.querySelector('.watchguard-page')&&wgOutsideCount()===0),'Watchlists teardown is prompt; only neutral loading remains');
     // Malformed/unrelated lifecycle events are tested on the isolated handoff
     // in web.test.cjs. Emitting a fabricated viewshow into Jellyfin also invokes
     // its native controllers, which require their real view/options contract.
    }
    unhold();await ready(item);await frames(3);
    row.transition=await page.evaluate(()=>wgStopOutgoing());
    row.focus=await page.evaluate(()=>({inDetail:!!document.activeElement.closest('#itemDetailPage'),tag:document.activeElement.tagName}));
    await page.screenshot({path:path.join(output,layout+'-'+item.Type+'-detail.png')});
    assert.equal(row.transition.homeExposures,0,'Home is never exposed during card navigation');
    assert.deepEqual(report.errors.slice(errorStart).filter(e=>e.kind==='script'),[],'Card navigation must not cause a script error');
    if(input==='remote')assert(row.focus.inDetail,'Remote focus transfers to native detail controls');
    await observe();await page.goBack();await wait(()=>!!document.querySelector('.watchguard-page'));
    await frames(3);row.back=await page.evaluate(()=>wgStopOutgoing());assert.equal(row.back.homeExposures,0);
    await observe();await page.goForward();await ready(item);await frames(3);row.forward=await page.evaluate(()=>wgStopOutgoing());assert.equal(row.forward.homeExposures,0);
   }
   if(!baseline&&layout==='tv'){
    // A fresh document clears the native restored-view cache for failure cases.
    await page.goto(fixture.base+'/web/#/home');await page.reload();await wait(()=>window.WatchGuardPoc&&WatchGuardPoc.isInstalled());
    await watchlists(items);heldId=items[0].Id;await activate(items[0],'remote');await frames(4);
    await page.goBack();await wait(()=>!!document.querySelector('.watchguard-page'));
    await activate(items[1],'remote');unhold();await ready(items[1]);
    report.cancelAndRapidSelection='PASS';
    await page.goto(fixture.base+'/web/#/home');await page.reload();await wait(()=>window.WatchGuardPoc&&WatchGuardPoc.isInstalled());
    await watchlists(items);heldId=items[0].Id;await activate(items[0],'remote');await frames(4);
    failure=true;unhold();await wait(()=>!!document.querySelector('.watchguard-outgoing-error'));
    assert(await page.evaluate(()=>!document.querySelector('.watchguard-outgoing')&&!document.querySelector('.watchguard-page')&&wgOutsideCount()===0));
    await page.screenshot({path:path.join(output,'failure-recovery.png')});
    await page.click('.watchguard-outgoing-error a');await wait(()=>!!document.querySelector('.watchguard-page'));failure=false;
    report.failureRecovery='PASS';
    // Switch the real ApiClient to another authenticated disposable account.
    await page.evaluate(async()=>{
     const a=ApiClient,name='Handoff-'+Date.now();
     await a.ajax({url:a.getUrl('Users/New'),type:'POST',contentType:'application/json',data:JSON.stringify({Name:name})});
     const other=await a.ajax({url:a.getUrl('Users/AuthenticateByName'),type:'POST',dataType:'json',contentType:'application/json',data:JSON.stringify({Username:name,Pw:''})});
     window.wgOtherAccount=other;
     window.wgOriginalAccount={token:a.accessToken(),user:a.getCurrentUserId()};
    });
    heldId=items[1].Id;await activate(items[1],'remote');await frames(4);
    await page.evaluate(()=>ApiClient.setAuthenticationInfo(wgOtherAccount.AccessToken,wgOtherAccount.User.Id));unhold();
    await wait(()=>!document.querySelector('.watchguard-outgoing,.watchguard-outgoing-error,.watchguard-page'));
    await page.goto(fixture.base+'/web/#/home?watchguard=watchlists&owner=mine&interest=watchlisted');
    await wait(()=>{const p=document.querySelector('.watchguard-page');return p&&p.getAttribute('aria-busy')==='false';});
    assert.equal(await page.evaluate(()=>document.querySelectorAll('.watchguard-card').length),0,'New account cannot inherit old membership cards');
    await page.evaluate(()=>{ApiClient.setAuthenticationInfo(wgOriginalAccount.token,wgOriginalAccount.user);delete window.wgOtherAccount;delete window.wgOriginalAccount;});
    await page.goto(fixture.base+'/web/#/home');await page.reload();await wait(()=>window.WatchGuardPoc&&WatchGuardPoc.isInstalled());
    await watchlists(items);report.accountSwitch='PASS';
    // Actual logout while the destination is held; no old Watchlists data survives.
    heldId=items[1].Id;await activate(items[1],'remote');await frames(4);
    await page.evaluate(()=>ApiClient.logout());unhold();
    await wait(()=>!document.querySelector('.watchguard-outgoing,.watchguard-outgoing-error,.watchguard-page'));
    report.logout='PASS';
   }
   await context.close();
  }
  report.result='PASS';
 }catch(error){report.result='FAIL';report.error=error.message;if(page&&!page.isClosed()){report.route=new URL(page.url()).hash.split('?')[0];report.failedTransition=await page.evaluate(()=>window.wgStopOutgoing&&wgStopOutgoing());await page.screenshot({path:path.join(output,'failure.png')});}throw error;}
 finally{unhold();fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
