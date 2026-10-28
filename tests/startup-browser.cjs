/* Observe real document paints from before ANY entry-document script executes. */
const {chromium}=require('./browser/node_modules/playwright');
const readiness=require('./browser-readiness.cjs');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const fixture=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
assert.match(fixture.base,/^https?:\/\/(?:127\.0\.0\.1|localhost):\d+(?:\/jellyfin)?$/);
const output=process.argv[3]||'artifacts/startup-browser', baseline=process.argv.includes('--baseline');
fs.mkdirSync(output,{recursive:true});
const report={serverVersion:fixture.serverVersion,image:fixture.image,baseline,cases:[],refresh:[],recovery:[],result:'RUNNING'};
function observe(){
 const data={beforeBootstrap:!window.WatchGuardStandalone,frames:0,homeFrames:0,loadingFrames:0,panelFrames:0,replacements:0,firstHomeMs:null,firstLoadingMs:null,firstPanelMs:null};
 let panel;
 window.wgStartupObservation=data;
 function frame(){
  if(/^#\/home(?:\?|$)/.test(location.hash)&&new URLSearchParams(location.hash.split('?')[1]).get('watchguard')==='watchlists'){
   data.frames++;
   const current=document.querySelector('.watchguard-page'),loading=document.getElementById('watchguard-startup');
   const hit=document.elementFromPoint(innerWidth/2,innerHeight/2);
   if(current){if(panel&&panel!==current)data.replacements++;panel=current;data.panelFrames++;data.firstPanelMs??=performance.now();}
   if(loading&&loading.contains(hit)){data.loadingFrames++;data.firstLoadingMs??=performance.now();}
   // Sample visible native content, not merely Home DOM hidden behind the handoff.
   const home=[...document.querySelectorAll('h1,h2,h3,.sectionTitle')].find(e=>e.textContent.trim()==='My Media'&&e.getClientRects().length);
   if(home){const r=home.getBoundingClientRect(),top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);if(top&&(home.contains(top)||top.contains(home))){data.homeFrames++;data.firstHomeMs??=performance.now();}}
  }
  requestAnimationFrame(frame);
 }
 requestAnimationFrame(frame);
}
(async()=>{
 const browser=await chromium.launch({headless:true});let page;
 try{
  const context=await browser.newContext({ignoreHTTPSErrors:fixture.tls===true,viewport:{width:1280,height:900},locale:'en-US'});
  page=await context.newPage();page.setDefaultTimeout(20000);
  await readiness.login(page,fixture);
  await context.addInitScript(observe);
  const url=fixture.base+'/web/#/home?watchguard=watchlists&owner=mine&sort=title';
  let delayTarget='script.js', failure; const inFlight=new Set();let maxQueries=0,privateRequests=0;
  page.on('request',r=>{if(new URL(r.url()).pathname.endsWith('/Standalone/script.js'))privateRequests++;if(new URL(r.url()).pathname.endsWith('/ActivityBrowser')){inFlight.add(r);maxQueries=Math.max(maxQueries,inFlight.size);}});
  page.on('requestfinished',r=>inFlight.delete(r));page.on('requestfailed',r=>inFlight.delete(r));
  await context.route('**/WatchGuard/Standalone/*.js',async route=>{
   const name=new URL(route.request().url()).pathname.split('/').at(-1), current=failure;
   if(current==='bootstrap-503'&&name==='bootstrap.js')return route.fulfill({status:503,body:''});
   if(name==='script.js'&&['401','403','503'].includes(current))return route.fulfill({status:Number(current),body:''});
   if(name==='script.js'&&current==='invalid-script')return route.fulfill({contentType:'application/javascript',body:'/* no runtime */'});
   if(name==='script.js'&&current==='timeout'){await new Promise(r=>setTimeout(r,22500));return route.abort();}
   if(name===delayTarget)await new Promise(r=>setTimeout(r,2200));await route.continue();
  });
  const settled=async()=>{await page.waitForFunction(()=>document.querySelector('.watchguard-page')?.getAttribute('aria-busy')==='false');await page.waitForTimeout(150);};
  for(const layout of ['auto','desktop-legacy','mobile-legacy','modern'])for(const width of [1280,390]){
   await page.setViewportSize({width,height:900});await page.evaluate(l=>localStorage.setItem('layout',l),layout);
   for(const mode of ['direct','reload','hard-reload'])for(const target of ['bootstrap.js','script.js']){
    delayTarget=target;privateRequests=0;maxQueries=0;
    if(mode==='direct')await page.goto('about:blank');
    const name=layout+'-'+width+'-'+mode+'-'+target;
    const slow=page.waitForRequest(r=>new URL(r.url()).pathname.endsWith('/Standalone/'+target));
    const navigate=mode==='direct'?page.goto(url,{waitUntil:'commit'}):mode==='reload'?page.reload({waitUntil:'commit'}):(async()=>{const cdp=await context.newCDPSession(page);await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});await cdp.send('Page.reload',{ignoreCache:true});await cdp.detach();})();
    await slow;await navigate;await page.waitForTimeout(1700);
    await page.screenshot({path:path.join(output,name+'-waiting.png')});
    await settled();const result=await page.evaluate(()=>wgStartupObservation);report.cases.push({name,...result,privateRequests,maxConcurrentQueries:maxQueries});
   }
   // Refresh is a query action in the existing panel, with no entry handoff.
   await page.route('**/WatchGuard/ActivityBrowser?**',async r=>{await new Promise(resolve=>setTimeout(resolve,600));await r.continue();});
   await page.evaluate(()=>{
    const panel=document.querySelector('.watchguard-page'),disclosure=panel.querySelector('.watchguard-secondary');disclosure.open=true;
    const button=panel.querySelector('.watchguard-refresh');button.focus();
    window.refreshObservation={panel,disclosure,button,home:wgStartupObservation.homeFrames,history:JSON.stringify(history.state)};
   });
   await page.getByRole('button',{name:'Refresh',exact:true}).click();await settled();
   const refresh=await page.evaluate(()=>{const r=refreshObservation;return {samePanel:r.panel===document.querySelector('.watchguard-page'),disclosure:r.disclosure.open,focus:document.activeElement===r.button,homeFrames:wgStartupObservation.homeFrames-r.home,history:JSON.stringify(history.state)===r.history,handoff:!!document.getElementById('watchguard-startup')};});
   report.refresh.push({layout,width,...refresh});fs.writeFileSync(path.join(output,'progress.json'),JSON.stringify(report,null,2)+'\n');await page.unroute('**/WatchGuard/ActivityBrowser?**');
  }
  if(!baseline){
   delayTarget=null;
   for(const kind of ['bootstrap-503','401','403','503','invalid-script','csp-blob','timeout']){
    failure=kind;
    const csp=async route=>{const response=await route.fetch();await route.fulfill({response,headers:{...response.headers(),'content-security-policy':"script-src 'self' 'unsafe-inline' 'unsafe-eval'"}});};
    if(kind==='csp-blob')await page.route('**/web/',csp);
    await page.goto('about:blank');const started=Date.now();await page.goto(url,{waitUntil:'commit'});
    await page.waitForFunction(()=>window.WatchGuardStartup&&!WatchGuardStartup.active(),null,{timeout:23000});
    assert.equal(await page.locator('#watchguard-startup').count(),0);
    assert.equal(await page.locator('.watchguard-page').count(),0);
    await page.getByText('My Media',{exact:true}).waitFor();
    await page.screenshot({path:path.join(output,'recovery-'+kind+'.png')});
    const elapsedMs=Date.now()-started;if(kind==='timeout')assert.ok(elapsedMs>=19500&&elapsedMs<25000,'Real bounded startup deadline');
    report.recovery.push({kind,nativeHomeUsable:true,overlayRemoved:true,elapsedMs});
    if(kind==='csp-blob')await page.unroute('**/web/',csp);
    await page.evaluate(()=>location.hash='#/home');
   }
   failure=null;delayTarget=null;
   const noInline=async route=>{const response=await route.fetch();await route.fulfill({response,headers:{...response.headers(),'content-security-policy':"script-src 'self' blob: 'unsafe-eval'"}});};
   await page.route('**/web/',noInline);await page.goto('about:blank');await page.goto(url);await settled();assert.equal(await page.evaluate(()=>!!window.WatchGuardStartup),false);report.recovery.push({kind:'csp-inline',policyHonored:true,nativeUsable:true});await page.unroute('**/web/',noInline);
   failure=null;delayTarget='script.js';
   for(const destination of ['#/home','#/home?tab=1','#/dashboard','#/login','#/video']){
    await page.goto('about:blank');await page.goto(url,{waitUntil:'commit'});await page.locator('#watchguard-startup').waitFor();
    if(destination==='#/home')await page.getByRole('link',{name:'Go to Home',exact:true}).click();else await page.evaluate(hash=>location.hash=hash,destination);
    await page.waitForFunction(()=>!document.getElementById('watchguard-startup'));
    await page.waitForTimeout(2600);assert.equal(await page.locator('#watchguard-startup').count(),0);assert.equal(await page.locator('.watchguard-page').count(),0);
    report.recovery.push({kind:'leave-to-'+destination,overlayRemoved:true});
   }
   const anonymous=await browser.newContext();const login=await anonymous.newPage();await login.goto(url);await login.waitForFunction(()=>!document.getElementById('watchguard-startup'));assert.equal(await login.locator('.watchguard-page').count(),0);await login.waitForFunction(()=>document.querySelector('#txtManualName')?.getClientRects().length||[...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='Manual Login'&&e.getClientRects().length));report.recovery.push({kind:'anonymous',loginUsable:true});await anonymous.close();
  }
  report.result=baseline?'BASELINE_REPRODUCED':'PASS';
  if(baseline)assert.ok(report.cases.some(c=>c.homeFrames>0),'Baseline must expose native Home');
  else for(const c of report.cases){assert.ok(c.beforeBootstrap,c.name+': observer precedes bootstrap');assert.equal(c.homeFrames,0,c.name+': no painted Home');assert.equal(c.replacements,0,c.name+': one panel');assert.ok(c.loadingFrames>0,c.name+': visible handoff');assert.ok(c.panelFrames>0);assert.equal(c.privateRequests,1,c.name+': one authenticated runtime request');assert.ok(c.maxConcurrentQueries<=1);}
  if(!baseline)for(const r of report.refresh){assert.equal(r.samePanel,true);assert.equal(r.disclosure,true);assert.equal(r.focus,true);assert.equal(r.homeFrames,0);assert.equal(r.history,true);assert.equal(r.handoff,false);}
 }catch(error){report.result='FAIL';report.error=error.message;if(page)await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw error;}
 finally{fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(report,null,2)+'\n');await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
