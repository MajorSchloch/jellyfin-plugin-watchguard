/* Native rendered peers, real routes and owned-control interactions. No React runtime. */
const {chromium}=require('./browser/node_modules/playwright');
const readiness=require('./browser-readiness.cjs'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const fixture=JSON.parse(fs.readFileSync(process.argv[2])),baseline=process.argv.includes('--baseline');
const out=process.argv[3]&&!process.argv[3].startsWith('--')?process.argv[3]:path.join(fixture.reportDirectory,'native-controls');fs.mkdirSync(out,{recursive:true});
const styles=locator=>locator.evaluate(e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return {width:r.width,height:r.height,y:r.y-(e.closest('.mainDetailButtons')?.getBoundingClientRect().y||0),...Object.fromEntries(['fontSize','fontFamily','fontWeight','color','backgroundColor','borderColor','borderRadius','padding','outlineStyle','opacity'].map(k=>[k,s[k]]))};});
(async()=>{const browser=await chromium.launch();const report={version:fixture.serverVersion,image:fixture.image,baseline,device:'Chromium mouse/touch emulation; not physical devices',cases:[],result:'RUNNING'};let page;
try{
 const desktop=await browser.newContext({viewport:{width:1280,height:900},hasTouch:false,ignoreHTTPSErrors:fixture.tls===true,locale:'en-US'});page=await desktop.newPage();await readiness.login(page,fixture);
 const mobile=await browser.newContext({viewport:{width:390,height:900},hasTouch:true,ignoreHTTPSErrors:fixture.tls===true,locale:'en-US',storageState:await desktop.storageState()}),touch=await mobile.newPage();await touch.goto(fixture.base+'/web/#/home');await touch.waitForFunction(()=>window.WatchGuardPoc?.isInstalled());
 const mouse=page;
 if(!process.argv.includes('--themes-only'))for(const layout of ['auto','modern','desktop-legacy','mobile-legacy'])for(const width of [390,1280,2048]){
  page=width===390?touch:mouse;page.setDefaultTimeout(15000);await page.bringToFront();await page.setViewportSize({width,height:900});await page.evaluate(layout=>localStorage.setItem('layout',layout),layout);
  const row={layout,width};report.cases.push(row);const name=layout+'-'+width;
  await page.goto(fixture.base+'/web/#/details?id='+fixture.items['PoC Movie Detail']+'&serverId='+fixture.serverId);
  const button=page.locator('#itemDetailPage:visible .watchguard-toggle'),peer=page.locator('#itemDetailPage:visible .btnMoreCommands');await button.waitFor();await peer.waitFor();await page.waitForFunction(()=>!document.querySelector('.watchguard-toggle')?.disabled);
  row.detail={own:await styles(button),native:await styles(peer)};
  if(!baseline)for(const k of ['width','height','y'])assert.ok(Math.abs(row.detail.own[k]-row.detail.native[k])<1,'Detail geometry '+k);
  for(const k of ['fontFamily','fontSize','padding','borderRadius'])assert.equal(row.detail.own[k],row.detail.native[k]);
  await page.screenshot({path:path.join(out,name+'-detail-normal.png')});
  if(width!==390){await peer.hover();await peer.evaluate(e=>Promise.all(e.getAnimations().map(a=>a.finished)));row.nativeHover=await styles(peer);await button.hover();await button.evaluate(e=>Promise.all(e.getAnimations().map(a=>a.finished)));row.ownHover=await styles(button);if(!baseline)assert.equal(row.ownHover.color,row.nativeHover.color);}
  await page.mouse.move(0,0);await page.keyboard.press('Tab');await button.focus();row.focus=await button.evaluate(e=>({visible:e.matches(':focus-visible'),outline:getComputedStyle(e).outlineStyle}));
  if(!baseline)assert.ok(row.focus.visible&&row.focus.outline!=='none','Keyboard detail focus is visible');
  await page.screenshot({path:path.join(out,name+'-detail-focus.png')});
  if(!baseline){
   const original=await button.elementHandle(),pressed=await button.getAttribute('aria-pressed'),icon=await button.locator('.material-icons').textContent();
   const pattern='**/WatchGuard/Watchlist/'+fixture.items['PoC Movie Detail'];let release,started,calls=0;const hold=new Promise(r=>release=r),entered=new Promise(r=>started=r);
   const fail=async route=>{calls++;started();await hold;await route.fulfill({status:503,body:'unavailable'})};await page.route(pattern,fail);
   await button.focus();await page.keyboard.press('Enter');await entered;assert.ok(await button.isDisabled());assert.equal(await button.getAttribute('aria-busy'),'true');
   await button.evaluate(e=>{e.click();e.click()});assert.equal(calls,1);await page.screenshot({path:path.join(out,name+'-detail-pending.png')});release();
   await page.locator('#itemDetailPage:visible .watchguard-error').getByText('WatchGuard: Could not update your watchlist. Please retry.',{exact:true}).waitFor();
   await page.waitForFunction(()=>document.activeElement===document.querySelector('.watchguard-toggle'));
   assert.equal(await button.getAttribute('aria-pressed'),pressed);assert.equal(await button.locator('.material-icons').textContent(),icon);assert.equal(await button.getAttribute('aria-busy'),'false');
   assert.ok(await original.evaluate(e=>e===document.querySelector('.watchguard-toggle')));await page.unroute(pattern,fail);
   await page.screenshot({path:path.join(out,name+'-detail-failure.png')});
   await button.click();await page.waitForFunction(previous=>document.querySelector('.watchguard-toggle')?.getAttribute('aria-pressed')!==previous,pressed);
   await page.mouse.move(0,0);assert.equal(await button.locator('.material-icons').textContent(),pressed==='false'?'bookmark_remove':'bookmark_add');
   await page.screenshot({path:path.join(out,name+'-detail-selected.png')});
   await button.click();await page.waitForFunction(previous=>document.querySelector('.watchguard-toggle')?.getAttribute('aria-pressed')===previous,pressed);
   row.writes='One pending write; failure retains membership, node and focus; successful retry and inverse write';
  }
  // Native select is part of this same shared detail surface, including Modern.
  const source=page.locator('#itemDetailPage:visible select.selectSource');await source.waitFor({state:'attached'});row.nativeSelect=await styles(source);
  await page.goto(fixture.base+'/web/#/home?watchguard=watchlists&owner=all&interest=watchlisted,watching,playing,watched&sort=title');
  const panel=page.locator('.watchguard-page'),search=panel.getByRole('searchbox'),summary=panel.locator('.watchguard-filter>summary');await panel.waitFor();await panel.getByRole('combobox',{name:'Watchlist owner'}).waitFor();
  await page.waitForFunction(()=>document.querySelector('.watchguard-refresh')?.getAttribute('aria-disabled')!=='true');
  row.select=await styles(panel.getByRole('combobox',{name:'Sort by'}));row.search=await styles(search);
  row.overflow=await panel.evaluate(e=>e.scrollWidth>e.clientWidth);assert.equal(row.overflow,false);
  if(!baseline)for(const k of ['fontFamily','backgroundColor','borderColor'])assert.equal(row.select[k],row.nativeSelect[k],'Select native contract '+k);
  if(!baseline)assert.ok(Math.abs(parseFloat(row.select.borderRadius)/parseFloat(row.select.fontSize)-parseFloat(row.nativeSelect.borderRadius)/parseFloat(row.nativeSelect.fontSize))<.01,'Native em-relative field radius');
  await summary.click();await page.screenshot({path:path.join(out,name+'-filters.png')});
  const check=panel.getByRole('checkbox',{name:'Watched',exact:true});await check.focus();await page.keyboard.press('Escape');assert.equal(await summary.evaluate(e=>e.parentElement.open),false);assert.ok(await summary.evaluate(e=>document.activeElement===e));
  await page.keyboard.press('Enter');await check.waitFor();await search.click();assert.equal(await summary.evaluate(e=>e.parentElement.open),false);
  const oldPanel=await panel.elementHandle(),oldSearch=await search.elementHandle();
  await page.evaluate(()=>{const panel=document.querySelector('.watchguard-page'),search=panel.querySelector('input[type=search]');window.wgControlsTransition={frames:0,replaced:0,focusLost:0,home:0,done:false};function sample(){const d=wgControlsTransition;if(d.done)return;d.frames++;if(document.querySelector('.watchguard-page')!==panel)d.replaced++;if(document.activeElement!==search)d.focusLost++;if(!document.body.classList.contains('watchguard-page-open'))d.home++;requestAnimationFrame(sample)}requestAnimationFrame(sample)});
  const pattern='**/WatchGuard/ActivityBrowser?*';let release,started;const held=new Promise(r=>release=r),entered=new Promise(r=>started=r);let count=0;
  const delay=async route=>{count++;started();await held;await route.continue()};await page.route(pattern,delay);
  await search.fill('PoC');await entered;await search.fill('PoC Movie');release();
  await page.waitForFunction(()=>location.hash.includes('search=PoC%20Movie')&&document.querySelector('.watchguard-refresh')?.getAttribute('aria-disabled')!=='true');await page.unroute(pattern,delay);
  row.transition=await page.evaluate(()=>{wgControlsTransition.done=true;return wgControlsTransition});assert.ok(row.transition.frames>0);assert.equal(row.transition.replaced,0);assert.equal(row.transition.focusLost,0);assert.equal(row.transition.home,0);assert.ok(await oldPanel.evaluate(e=>e.isConnected));assert.ok(await oldSearch.evaluate(e=>e.isConnected));
  await page.screenshot({path:path.join(out,name+'-search.png')});
  await summary.click();await check.focus();await page.keyboard.press('Space');assert.equal(await check.isChecked(),false);assert.ok(await check.evaluate(e=>document.activeElement===e));await page.keyboard.press('Escape');
  row.interactions='Escape returns focus; outside dismiss; keyboard checkbox; delayed rapid search preserves panel, focus and route';
 }
 if(!baseline){
  page=mouse;await page.goto(fixture.base+'/web/#/home?watchguard=watchlists&owner=mine');const filter=page.locator('.watchguard-filter');await filter.locator('summary').click();
  const save=filter.getByRole('button',{name:'Save view as defaults',exact:true}),reset=filter.getByRole('button',{name:'Reset to Defaults',exact:true});
  let release,entered,calls=0;const held=new Promise(r=>release=r),started=new Promise(r=>entered=r);
  const fail=async route=>{if(route.request().method()==='GET')return route.continue();calls++;entered();await held;await route.fulfill({status:503,body:'unavailable'})};await page.route('**/WatchGuard/Preferences',fail);
  await save.focus();await page.keyboard.press('Enter');await started;assert.equal(await save.getAttribute('aria-busy'),'true');assert.ok(await save.evaluate(e=>document.activeElement===e));
  await save.evaluate(e=>{e.click();e.click()});await reset.evaluate(e=>e.click());assert.equal(calls,1);release();
  await page.getByText('Could not save defaults. Please retry.',{exact:true}).waitFor();assert.equal(await save.getAttribute('aria-busy'),'false');assert.ok(await save.evaluate(e=>document.activeElement===e));await page.unroute('**/WatchGuard/Preferences',fail);
  await save.click();await page.getByText('View saved as your defaults.',{exact:true}).waitFor();await reset.click();await page.getByText('Defaults restored.',{exact:true}).waitFor();assert.ok(await reset.evaluate(e=>document.activeElement===e));
  report.preferenceWrites='Pending save retains focus; repeated Save and conflicting Reset send one request; failure permits retry; Save/Reset success feedback retained';
 }
 // Built-in theme selection uses the real native settings form and save action.
 report.themes=[];page=mouse;await page.setViewportSize({width:1280,height:900});
 for(const [theme,title] of [['light','Light'],['purplehaze','Purple Haze'],['blueradiance','Blue Radiance'],['appletv','Apple TV'],['wmc','WMC'],['dark','Dark']]){
  await page.evaluate(()=>localStorage.setItem('layout','modern'));
  await page.goto(fixture.base+'/web/#/mypreferencesdisplay?userId='+fixture.userId);
  const themeSelect=page.getByRole('combobox',{name:/^Theme/});await themeSelect.waitFor();await themeSelect.click();await page.getByRole('option',{name:title,exact:true}).click();
  const saved=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().includes('/DisplayPreferences/')&&r.ok());await page.getByRole('button',{name:'Save',exact:true}).click();await saved;
  await page.waitForFunction(theme=>[...document.querySelectorAll('link[rel=stylesheet]')].some(e=>e.href.includes('/themes/'+theme+'/theme.css')),theme);
  await page.screenshot({path:path.join(out,'native-settings-'+theme+'.png')});
  await page.goto(fixture.base+'/web/#/home?watchguard=watchlists&owner=mine');await page.locator('.watchguard-page').waitFor();await page.locator('.watchguard-filter>summary').click();
  const colors=await page.evaluate(()=>{const panel=document.querySelector('.watchguard-page'),popup=panel.querySelector('.watchguard-filter-options');return {page:getComputedStyle(panel).backgroundColor,native:getComputedStyle(document.documentElement).backgroundColor,text:getComputedStyle(panel).color,nativeText:getComputedStyle(document.documentElement).color,popup:getComputedStyle(popup).backgroundColor,checkbox:getComputedStyle(panel.querySelector('.checkboxOutline')||panel.querySelector('input')).backgroundColor}});
  if(!baseline){assert.equal(colors.page,colors.native);assert.equal(colors.text,colors.nativeText);assert.notEqual(colors.popup,'rgba(0, 0, 0, 0)');}
  report.themes.push({theme,...colors});await page.screenshot({path:path.join(out,'toolbar-'+theme+'.png')});
 }
 report.result='PASS';
}catch(error){report.result='FAIL';report.error=String(error);if(page)await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});throw error;}
finally{fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2)+'\n');await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
