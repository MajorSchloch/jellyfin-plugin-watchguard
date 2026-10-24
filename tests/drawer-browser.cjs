/* Native open-drawer integration: real Jellyfin routes, no replacement API responses. */
const {chromium}=require('./browser/node_modules/playwright');
const readiness=require('./browser-readiness.cjs');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const fixture=JSON.parse(fs.readFileSync(process.argv[2]));
const output=process.argv[3]||'artifacts/drawer-browser';
const baseline=process.argv.includes('--baseline');
assert.match(fixture.base,/^https?:\/\/(?:127\.0\.0\.1|localhost):\d+(?:\/jellyfin)?$/);
fs.mkdirSync(output,{recursive:true});
const report={serverVersion:fixture.serverVersion,image:fixture.image,baseline,cases:[],result:'RUNNING'};
(async()=>{
 const browser=await chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:390,height:900},ignoreHTTPSErrors:fixture.tls===true,locale:'en-US',hasTouch:true});
 page.setDefaultTimeout(15000);await readiness.capture(page);
 try {
  await readiness.login(page,fixture);
  for(const layout of ['modern','desktop-legacy']) {
   await page.evaluate(layout=>localStorage.setItem('layout',layout),layout);
   await page.goto(fixture.base+'/web/#/home');await page.reload();await page.getByText('My Media',{exact:true}).waitFor();
   const drawer=page.locator(layout==='modern'?'.MuiDrawer-paper':'.mainDrawer.drawer-open');
   const menu=layout==='modern'?page.getByRole('button',{name:'Open Menu',exact:true}):page.locator('.mainDrawerButton:visible');
   const close=async()=>{
    if(layout==='modern')await page.locator('.MuiDrawer-root .MuiBackdrop-root').click({position:{x:380,y:400}});
    else await drawer.locator('a[href="#/home"]').click();
    await drawer.waitFor({state:'hidden'});
   };
   for(const width of [390,600,390]) {
    await page.setViewportSize({width,height:900});
    await menu.click();await drawer.waitFor();await page.waitForTimeout(1100);
    const geometry=await drawer.evaluate((root,layout)=>{
     const link=root.querySelector('.watchguard-nav');
     const native=root.querySelector(layout==='modern'?'a[href="#/home?tab=1"]':'a[href="#/home"]');
     const rect=e=>{if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
     const icon=e=>e?.querySelector('.MuiListItemIcon-root,.navMenuOptionIcon,.watchguard-nav-icon');
     const label=e=>e?.querySelector('.MuiListItemText-root,.navMenuOptionText,.watchguard-nav-text');
     return {native:rect(native),link:rect(link),icon:rect(icon(link)),nativeIcon:rect(icon(native)),label:rect(label(link)),nativeLabel:rect(label(native)),drawer:rect(root),sameRow:!!link&&layout==='modern'&&link.closest('li')===native.closest('li'),count:document.querySelectorAll('.watchguard-nav').length,overflow:root.scrollWidth>root.clientWidth+1,active:link?.getAttribute('aria-current'),generatedClasses:link?.className.includes('css-')};
    },layout);
    const name=layout+'-'+width+'-'+report.cases.length;
    await page.screenshot({path:path.join(output,name+'.png')});
    const separate=!!geometry.link&&!geometry.sameRow&&geometry.link.y>=geometry.native.bottom-1;
    const aligned=!!geometry.icon&&!!geometry.label&&Math.abs(geometry.icon.x-geometry.nativeIcon.x)<=1&&Math.abs(geometry.label.x-geometry.nativeLabel.x)<=1&&Math.abs(geometry.link.height-geometry.native.height)<=1;
    const fullWidth=!!geometry.link&&Math.abs(geometry.link.x-geometry.native.x)<=1&&Math.abs(geometry.link.right-geometry.native.right)<=1;
    const result={name,...geometry,separate,aligned,fullWidth};report.cases.push(result);
    if(baseline){await close();continue;}
    assert.ok(separate,'Watchlists has its own drawer row');assert.ok(aligned,'Native icon/text columns and row height');assert.ok(fullWidth,'Full-width row');assert.equal(geometry.overflow,false);assert.equal(geometry.count,1);assert.equal(geometry.generatedClasses,false);
    await drawer.locator('.watchguard-nav').tap();await drawer.waitFor({state:'hidden'});
    await page.waitForFunction(()=>document.querySelector('.watchguard-page')?.getAttribute('aria-busy')==='false');
    assert.match(page.url(),/watchguard=watchlists/);
    await menu.click();await drawer.waitFor();await page.waitForTimeout(650);
    assert.equal(await drawer.locator('.watchguard-nav').getAttribute('aria-current'),'page');
    await page.screenshot({path:path.join(output,name+'-active.png')});
    // Same-route activation must close the drawer too, without replacing Watchlists.
    const panel=await page.locator('.watchguard-page').elementHandle();
    await drawer.locator('.watchguard-nav').focus();await page.keyboard.press('Enter');await drawer.waitFor({state:'hidden'});
    assert.ok(await panel.evaluate(e=>e.isConnected));
    await page.waitForTimeout(650);assert.equal(await page.locator('.watchguard-nav').count(),1);
    // Resize while open, then follow a native entry: no stale row or intercepted native navigation.
    await menu.click();await drawer.waitFor();await page.setViewportSize({width:width===390?600:390,height:900});await page.waitForTimeout(650);
    assert.equal(await page.locator('.watchguard-nav').count(),1);
    await drawer.locator('a[href="#/home"]').click();await drawer.waitFor({state:'hidden'});await page.locator('.watchguard-page').waitFor({state:'detached'});
    result.navigation='PASS';
   }
   // Cross the desktop breakpoint with the drawer open, then return to mobile.
   await page.setViewportSize({width:390,height:900});await menu.click();await drawer.waitFor();
   await page.setViewportSize({width:1280,height:900});await page.waitForTimeout(1100);
   assert.equal(await page.locator('.watchguard-nav').count(),1);
   if(await drawer.isVisible())await close();
   await page.waitForTimeout(650);
   assert.equal(await page.locator('.watchguard-nav').count(),1);
   assert.equal(await page.locator('.watchguard-nav').isVisible(),true);
   await page.screenshot({path:path.join(output,layout+'-desktop.png')});
   if(!baseline){await page.locator('.watchguard-nav').click();await page.locator('.watchguard-page').waitFor();}
   await page.setViewportSize({width:390,height:900});
  }
  report.result=baseline?'REPRODUCED':'PASS';
  if(baseline)assert.ok(report.cases.some(c=>!c.separate||!c.aligned),'Baseline must expose the reported defect');
 }catch(error){report.result='FAIL';report.error=error.message;await page.screenshot({path:path.join(output,'failure.png')});throw error;}
 finally{fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(report,null,2)+'\n');await browser.close();}
 console.log(JSON.stringify(report));
})().catch(error=>{console.error(error);process.exit(1)});
