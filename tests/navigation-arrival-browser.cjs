/* Initial-document navigation observations against the real, authenticated Web. */
const {chromium}=require('./browser/node_modules/playwright');
const readiness=require('./browser-readiness.cjs'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const fixture=JSON.parse(fs.readFileSync(process.argv[2])),out=process.argv[3]||'artifacts/navigation-arrival',baseline=process.argv.includes('--baseline');
fs.mkdirSync(out,{recursive:true});
function observe(){
 const data={beforeBootstrap:!window.WatchGuardStandalone,firstNative:null,firstEntry:null,firstAuth:null,firstRuntime:null,missingFrames:0,replacements:0,movements:[],frames:[],drawerFrames:0,drawerMissingFrames:0,homeExposure:0,homeEvents:[]};window.wgArrival=data;
 let previous,entry;const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}};
 function frame(){const t=performance.now();if(window.ApiClient?.getCurrentUserId?.()&&window.ApiClient?.accessToken?.())data.firstAuth??=t;if(window.WatchGuardPoc)data.firstRuntime??=t;
 const header=[...document.querySelectorAll('header.MuiAppBar-root,.skinHeader')].find(e=>e.getClientRects().length),native=header?.querySelector('a[href="#/home?tab=1"],.emby-tab-button[data-index="1"]'),link=header?.querySelector('.watchguard-nav');
 if(native&&native.getClientRects().length){data.firstNative??=t;if(link){data.firstEntry??=t;if(entry&&entry!==link)data.replacements++;entry=link;}else data.missingFrames++;
 const next={t,native:rect(native),link:link?rect(link):null};if(previous&&!!previous.link!==!!next.link)data.movements.push({before:previous,after:next,dx:next.native.x-previous.native.x,dy:next.native.y-previous.native.y});if(data.frames.length<700)data.frames.push(next);previous=next;}
 if(/^#\/home(?:\?|$)/.test(location.hash)&&new URLSearchParams(location.hash.split('?')[1]).get('watchguard')==='watchlists'){
 const home=[...document.querySelectorAll('h1,h2,h3,.sectionTitle')].find(e=>e.textContent.trim()==='My Media'&&e.getClientRects().length);
 if(home){const r=home.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);if(hit&&(home.contains(hit)||hit.contains(home))){data.homeExposure++;data.homeEvents.push({t:performance.now(),runtime:!!window.WatchGuardPoc,loading:!!document.getElementById('watchguard-startup'),panel:!!document.querySelector('.watchguard-page')});}}}
 const drawer=[...document.querySelectorAll('.MuiDrawer-paper,.mainDrawer.drawer-open')].find(e=>getComputedStyle(e).visibility!=='hidden'&&e.getBoundingClientRect().right>0);
 if(drawer?.querySelector('a[href="#/home?tab=1"],a[href="#/home"]')){data.drawerFrames++;if(!drawer.querySelector('.watchguard-nav'))data.drawerMissingFrames++;}
 requestAnimationFrame(frame);
 }requestAnimationFrame(frame);
}
(async()=>{const browser=await chromium.launch();const context=await browser.newContext({viewport:{width:1280,height:900},hasTouch:true,ignoreHTTPSErrors:fixture.tls===true,locale:'en-US'}),page=await context.newPage();page.setDefaultTimeout(20000);
const report={version:fixture.serverVersion,image:fixture.image,baseline,device:'Chromium emulation, not physical devices',cases:[],result:'RUNNING'};
try{await readiness.login(page,fixture);await context.addInitScript(observe);const cdp=await context.newCDPSession(page);
if(!process.argv.includes('--early-only'))for(const layout of ['auto','modern','desktop-legacy','mobile-legacy'])for(const width of [390,1280,2048])for(const mode of ['warm','cold','slow-runtime','slow-bootstrap']){
 await page.setViewportSize({width,height:900});await page.evaluate(x=>localStorage.setItem('layout',x),layout);
 await cdp.send('Network.setCacheDisabled',{cacheDisabled:mode==='cold'});
 const delayed='**/WatchGuard/Standalone/'+(mode==='slow-bootstrap'?'bootstrap.js':'script.js');
 if(mode.startsWith('slow-'))await page.route(delayed,async r=>{await new Promise(resolve=>setTimeout(resolve,1400));await r.continue()});
 const name=`${layout}-${width}-${mode}`;
 await page.goto('about:blank');await page.goto(fixture.base+'/web/#/home',{waitUntil:'commit'});
 if(mode.startsWith('slow-')){await page.waitForFunction(()=>document.querySelector('header.MuiAppBar-root,.skinHeader'));await page.screenshot({path:path.join(out,name+'-arrival.png')});}
 await page.waitForFunction(()=>window.WatchGuardPoc?.isInstalled());await page.getByText('My Media',{exact:true}).filter({visible:true}).waitFor();await page.waitForTimeout(650);
 const row=await page.evaluate(()=>{const h=[...document.querySelectorAll('header.MuiAppBar-root,.skinHeader')].find(e=>e.getClientRects().length),n=h?.querySelector('a[href="#/home?tab=1"],.emby-tab-button[data-index="1"]'),w=h?.querySelector('.watchguard-nav'),props=e=>e?Object.fromEntries(['fontSize','fontFamily','fontWeight','lineHeight','paddingTop','paddingRight','paddingBottom','paddingLeft','color','backgroundColor','borderRadius'].map(k=>[k,getComputedStyle(e)[k]])):null;return {...wgArrival,nativeStyles:props(n),styles:props(w),nativeMarkup:n?.outerHTML,entryMarkup:w?.outerHTML}});
 row.name=name;report.cases.push(row);await page.screenshot({path:path.join(out,name+'-settled.png')});
 if(!baseline&&row.firstNative!==null){assert.equal(row.missingFrames,0,'Entry present on first native navigation paint: '+name);assert.equal(row.replacements,0);assert.equal(row.movements.length,0);for(const k of ['fontSize','fontFamily','fontWeight','lineHeight','paddingTop','paddingBottom','paddingLeft','paddingRight'])assert.equal(row.styles[k],row.nativeStyles[k],name+' '+k);}
 if(mode.startsWith('slow-'))await page.unroute(delayed);
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2)+'\n');
}
report.interactions=[];
if(!process.argv.includes('--early-only'))for(const layout of ['auto','modern','desktop-legacy','mobile-legacy'])for(const width of [390,1280,2048]){
 await page.setViewportSize({width,height:900});await page.evaluate(x=>localStorage.setItem('layout',x),layout);await page.goto('about:blank');await page.goto(fixture.base+'/web/#/home');
 await page.waitForFunction(()=>window.WatchGuardPoc?.isInstalled());await page.getByText('My Media',{exact:true}).filter({visible:true}).waitFor();
 const legacy=layout.endsWith('-legacy'),mobile=!legacy&&width===390;
 if(mobile)await page.getByRole('button',{name:'Open Menu',exact:true}).click();
 const surface=page.locator(mobile?'.MuiDrawer-paper':legacy?'.skinHeader':'header.MuiAppBar-root'),link=surface.locator('.watchguard-nav');await link.waitFor();
 const native=surface.locator(legacy?'.emby-tab-button[data-index="1"]':'a[href="#/home?tab=1"]');
 const styles=el=>el.evaluate(e=>Object.fromEntries(['color','backgroundColor','fontSize','fontWeight','lineHeight'].map(k=>[k,getComputedStyle(e)[k]])));
 const row={layout,width,normal:{native:await styles(native),watchguard:await styles(link)}};
 await native.hover();await page.waitForTimeout(250);const nativeHover=await styles(native);
 await link.hover();await page.waitForTimeout(250);row.hover={native:nativeHover,watchguard:await styles(link)};
 if(!baseline){assert.equal(row.hover.watchguard.color,row.hover.native.color);assert.equal(row.hover.watchguard.backgroundColor,row.hover.native.backgroundColor);}
 await page.screenshot({path:path.join(out,`${layout}-${width}-hover.png`)});
 await page.mouse.move(width-2,850);await page.keyboard.press('Tab');await link.focus();
 row.focus=await link.evaluate(e=>({visible:e.matches(':focus-visible')&&getComputedStyle(e).outlineStyle!=='none',identity:e})).then(x=>({visible:x.visible}));
 if(!baseline)assert.ok(row.focus.visible);await page.screenshot({path:path.join(out,`${layout}-${width}-focus.png`)});
 const handle=await link.elementHandle();await page.keyboard.press('Enter');await page.locator('.watchguard-page').waitFor();
 if(mobile){await page.locator('.MuiDrawer-paper').waitFor({state:'hidden'});await page.getByRole('button',{name:'Open Menu',exact:true}).click();await page.waitForTimeout(300);}
 row.selected=await link.getAttribute('aria-current');if(!baseline)assert.equal(row.selected,'page');await page.screenshot({path:path.join(out,`${layout}-${width}-selected.png`)});
 if(!mobile){for(const size of [width===390?1280:390,width]){await page.setViewportSize({width:size,height:900});await page.waitForTimeout(150);}await link.waitFor();row.sameNode=await handle.evaluate(e=>e.isConnected);if(!baseline)assert.ok(row.sameNode);}
 row.drawer=await page.evaluate(()=>({frames:wgArrival.drawerFrames,missingFrames:wgArrival.drawerMissingFrames}));if(!baseline)assert.equal(row.drawer.missingFrames,0);
 if(!baseline&&layout==='modern'&&width===2048){
  // Simulate a native presentation-class revision, not another Jellyfin release.
  await native.evaluate(e=>{const style=document.createElement('style');style.id='wg-presentation-probe';style.textContent='.css-wg-presentation-probe{letter-spacing:.08em}';document.head.append(style);e.classList.add('css-wg-presentation-probe','Mui-disabled','Mui-focusVisible');e.id='native-only-probe';e.setAttribute('tabindex','-1');});
  await page.waitForFunction(()=>document.querySelector('header .watchguard-nav')?.classList.contains('css-wg-presentation-probe'));
  assert.ok(await handle.evaluate(e=>e.isConnected&&!e.id&&!e.classList.contains('Mui-disabled')&&!e.classList.contains('Mui-focusVisible')&&e.tabIndex===0));
  assert.equal(await link.evaluate(e=>getComputedStyle(e).letterSpacing),await native.evaluate(e=>getComputedStyle(e).letterSpacing));
  await native.evaluate(e=>{e.classList.remove('css-wg-presentation-probe','Mui-disabled','Mui-focusVisible');e.removeAttribute('id');e.setAttribute('tabindex','0');document.getElementById('wg-presentation-probe').remove();});
  await page.waitForFunction(()=>!document.querySelector('header .watchguard-nav')?.classList.contains('css-wg-presentation-probe'));row.presentationReconciledWithoutStateOrIdentityCopy=true;
 }
 report.interactions.push(row);
}
if(!baseline){
 report.earlyEntry=[];
 for(const layout of ['auto','modern','desktop-legacy','mobile-legacy'])for(const width of [390,2048]){
  await page.setViewportSize({width,height:900});await page.evaluate(x=>localStorage.setItem('layout',x),layout);
  let release;const gate=new Promise(resolve=>release=resolve);await page.route('**/WatchGuard/Standalone/script.js',async route=>{await gate;await route.continue()});
  try {
   await page.goto('about:blank');await page.goto(fixture.base+'/web/#/home',{waitUntil:'commit'});
   if(!layout.endsWith('-legacy')&&width===390)await page.getByRole('button',{name:'Open Menu',exact:true}).click();
   const link=page.locator(layout.endsWith('-legacy')?'.skinHeader .watchguard-nav':width===390?'.MuiDrawer-paper .watchguard-nav':'header .watchguard-nav');await link.waitFor();
   assert.equal(await page.evaluate(()=>!!window.WatchGuardPoc),false,'Navigation works before activity runtime delivery');
   await page.evaluate(()=>{wgArrival.clickAt=performance.now();});await link.click();await page.locator('#watchguard-startup').waitFor();await page.screenshot({path:path.join(out,`${layout}-${width}-early-loading.png`)});
   release();await page.locator('.watchguard-page').waitFor();assert.equal(await page.locator('#watchguard-startup').count(),0);
   const homeExposure=await page.evaluate(()=>wgArrival.homeExposure);assert.equal(homeExposure,0,JSON.stringify(await page.evaluate(()=>({clickAt:wgArrival.clickAt,events:wgArrival.homeEvents,firstNative:wgArrival.firstNative}))));report.earlyEntry.push({layout,width,homeExposure});
  }finally{release();await page.unroute('**/WatchGuard/Standalone/script.js');}
 }
}
report.result=baseline?'BASELINE':'PASS';
}catch(e){report.result='FAIL';report.error=e.message;await page.screenshot({path:path.join(out,'failure.png')});throw e;}finally{fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2)+'\n');await browser.close()}})().catch(e=>{console.error(e);process.exit(1)});
