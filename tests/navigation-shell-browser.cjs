/* Real native layout selection and geometry; --baseline records the released defect. */
const {chromium}=require('./browser/node_modules/playwright');
const readiness=require('./browser-readiness.cjs');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const fixture=JSON.parse(fs.readFileSync(process.argv[2])),output=process.argv[3]||'artifacts/navigation-shell';
const baseline=process.argv.includes('--baseline');
const layouts=['auto','modern','desktop-legacy','mobile-legacy'];
const report={serverVersion:fixture.serverVersion,image:fixture.image,baseline,device:'Chromium viewport/touch emulation; no physical device',cases:[],result:'RUNNING'};
fs.mkdirSync(output,{recursive:true});
(async()=>{const browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1280,height:900},hasTouch:true,locale:'en-US',ignoreHTTPSErrors:fixture.tls===true});page.setDefaultTimeout(20000);await readiness.capture(page);
try{await readiness.login(page,fixture);
for(const layout of layouts)for(const width of [1280,390]){
 await page.setViewportSize({width,height:900});await page.evaluate(x=>localStorage.setItem('layout',x),layout);
 await page.goto(fixture.base+'/web/#/home');await page.reload();await page.getByText('My Media',{exact:true}).filter({visible:true}).waitFor();
 const legacy=layout.endsWith('-legacy');
 await page.waitForFunction(()=>[...document.querySelectorAll('.watchguard-nav')].some(e=>e.getClientRects().length));
 assert.equal(await page.locator('.skinHeader').isVisible(),legacy);
 assert.equal(await page.locator('html').evaluate(e=>e.classList.contains('layout-mobile')),layout==='mobile-legacy');
 if(!legacy && width<600){
  await page.getByRole('button',{name:'Open Menu',exact:true}).click();
  const drawer=page.locator('.MuiDrawer-paper');await drawer.waitFor();const entry=drawer.locator('.watchguard-nav');await entry.waitFor();
  await page.screenshot({path:path.join(output,`${layout}-${width}-drawer.png`)});
  const row={layout,width,surface:'native mobile drawer'};report.cases.push(row);
  if(!baseline){assert.equal(await entry.count(),1);await entry.tap();await drawer.waitFor({state:'hidden'});await page.locator('.watchguard-page').waitFor();row.interactions='PASS';}
  continue;
 }
 const header=page.locator(legacy?'.skinHeader':'header.MuiAppBar-root'),link=header.locator('.watchguard-nav');
 await link.waitFor();
 const geometry=await header.evaluate(e=>{const link=e.querySelector('.watchguard-nav'),native=e.querySelector('.emby-tab-button[data-index="1"]')||e.querySelector('a[href="#/home?tab=1"]');const rect=x=>x?.getBoundingClientRect().toJSON();const props=x=>x?Object.fromEntries(['fontSize','fontFamily','fontWeight','lineHeight','paddingTop','paddingBottom','paddingLeft','paddingRight','color'].map(k=>[k,getComputedStyle(x)[k]])):null;return {link:rect(link),native:rect(native),styles:props(link),nativeStyles:props(native),header:rect(e),indices:[...e.querySelectorAll('.emby-tab-button')].map(x=>x.dataset.index),inNativeTabs:!!link?.closest('[is="emby-tabs"]'),overflow:e.scrollWidth>innerWidth};});
 const row={layout,width,...geometry,aligned:!!geometry.native&&Math.abs(geometry.link.y-geometry.native.y)<1&&Math.abs(geometry.link.height-geometry.native.height)<1};report.cases.push(row);
 await page.screenshot({path:path.join(output,`${layout}-${width}-home.png`)});
 if(baseline)continue;
 if(legacy){assert.ok(row.aligned,'Watchlists alongside Home/Favorites at native height');assert.equal(row.inNativeTabs,false,'Never join the indexed native tab controller');assert.deepEqual(row.indices,['0','1']);for(const k of ['fontSize','fontFamily','fontWeight','lineHeight','paddingTop','paddingBottom','paddingLeft','paddingRight'])assert.equal(row.styles[k],row.nativeStyles[k],k);}
 if(legacy){
  const native=header.locator('.emby-tab-button[data-index="1"]');
  await native.hover();await native.evaluate(e=>Promise.all(e.getAnimations().map(a=>a.finished)));
  const nativeHover=await native.evaluate(e=>getComputedStyle(e).color);
  await link.hover();await link.evaluate(e=>Promise.all(e.getAnimations().map(a=>a.finished)));
  assert.equal(await link.evaluate(e=>getComputedStyle(e).color),nativeHover,'Native hover color');
  row.hoverMatches=true;
 }
 assert.equal(row.overflow,false);assert.equal(await header.locator('.watchguard-nav').count(),1);
 if(legacy){
  await page.keyboard.press('Tab');await link.focus();const identity=await link.elementHandle();
  for(const size of [width===390?1280:390,width]){
   await page.setViewportSize({width:size,height:900});
   await page.waitForFunction(()=>getComputedStyle(document.querySelector('.watchguard-nav-tab')).fontSize===getComputedStyle(document.querySelector('.headerTabs .emby-tab-button')).fontSize);
   assert.ok(await identity.evaluate(e=>e.isConnected&&document.activeElement===e),'Resize preserves header node and keyboard focus');
   assert.equal(await header.locator('.watchguard-nav').count(),1);
  }
  row.resizeRetainsFocusAndIdentity=true;
 }
 // Drawer opening must not move/recreate the Legacy header link or its neighbors.
 const handle=await link.elementHandle(),before=await link.boundingBox();
 const menu=legacy?page.locator('.mainDrawerButton:visible'):page.getByRole('button',{name:'Open Menu',exact:true});
 if(legacy || width<600){await menu.click();const drawer=page.locator(legacy?'.mainDrawer.drawer-open':'.MuiDrawer-paper');await drawer.waitFor();
 await drawer.locator('.watchguard-nav').waitFor();
 await page.waitForFunction(selector=>Math.abs(document.querySelector(selector).getBoundingClientRect().left)<1,legacy?'.mainDrawer.drawer-open':'.MuiDrawer-paper');
 if(legacy){assert.ok(await handle.evaluate(e=>e.isConnected));assert.deepEqual(await link.boundingBox(),before);}
 await page.screenshot({path:path.join(output,`${layout}-${width}-drawer.png`)});
 await drawer.locator('.watchguard-nav').tap();await drawer.waitFor({state:'hidden'});await page.locator('.watchguard-page').waitFor();}else{await link.click();await page.locator('.watchguard-page').waitFor();}
 await page.waitForFunction(()=>document.querySelector('.watchguard-page')?.getAttribute('aria-busy')==='false');
 await page.keyboard.press('Tab');await link.focus();assert.equal(await link.evaluate(e=>document.activeElement===e),true);
 assert.equal(await link.getAttribute('aria-current'),'page');
 assert.notEqual(await link.evaluate(e=>getComputedStyle(e).outlineStyle),'none','Visible keyboard focus');
 const mounted=await page.locator('.watchguard-page').elementHandle();await page.keyboard.press('Enter');assert.ok(await mounted.evaluate(e=>e.isConnected),'Same-route keyboard activation retains the panel');
 await page.screenshot({path:path.join(output,`${layout}-${width}-selected-focus.png`)});
 // Native Home is already indexed as selected underneath Watchlists; clicking it
 // must still leave the overlay, without inventing tab index 2 or NaN.
 if(legacy){await header.locator('.emby-tab-button[data-index="0"]').click();await page.locator('.watchguard-page').waitFor({state:'detached'});await page.getByText('My Media',{exact:true}).filter({visible:true}).waitFor();await link.click();await page.locator('.watchguard-page').waitFor();await header.locator('.emby-tab-button[data-index="1"]').click();await page.locator('.watchguard-page').waitFor({state:'detached'});await page.waitForFunction(()=>document.querySelector('.emby-tab-button-active')?.dataset.index==='1');assert.deepEqual(await header.locator('.emby-tab-button').evaluateAll(es=>es.map(e=>e.dataset.index)),['0','1']);}
 row.interactions='PASS';
}
if(baseline)assert.ok(report.cases.filter(c=>c.layout.endsWith('-legacy')).every(c=>!c.aligned),'Released Legacy placement must fail the regression');
report.result=baseline?'REPRODUCED':'PASS';
}catch(e){report.result='FAIL';report.error=e.message;await page.screenshot({path:path.join(output,'failure.png')});throw e;}
finally{fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(report,null,2)+'\n');await browser.close();}})().catch(e=>{console.error(e);process.exit(1)});
