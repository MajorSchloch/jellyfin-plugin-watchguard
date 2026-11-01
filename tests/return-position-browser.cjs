/* Native Jellyfin router, current authorized data and disposable generated media. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const fixture=JSON.parse(fs.readFileSync(process.argv[2]));
assert.match(fixture.base,/^https?:\/\/(?:127\.0\.0\.1|localhost):\d+(?:\/jellyfin)?$/);
assert.equal(fixture.username,'WatchGuardPoCTest');
const output=process.argv[3]||'artifacts/testing/return-position';fs.mkdirSync(output,{recursive:true});
const baseline=false;
const report={baseline,server:fixture.serverVersion,physicalTV:false,cases:[],result:'RUNNING'};
(async()=>{
 for(const old of [false,true]) {
  assert(process.env.WATCHGUARD_CHROMIUM79,'Real Chromium 79 is required');
  const browser=old?await require('./browser79/node_modules/puppeteer-core').launch({executablePath:process.env.WATCHGUARD_CHROMIUM79,headless:true,args:['--no-sandbox']}):await require('./browser/node_modules/playwright').chromium.launch({headless:true});
  const engine=await browser.version();if(old)assert.match(engine,/\/79\./);
  try {for(const [layout,width] of [['desktop',1280],['mobile',390],['tv',1280]]) {
   const context=old?await browser.createIncognitoBrowserContext():await browser.newContext({viewport:{width,height:900},hasTouch:layout==='mobile'});
   const page=await context.newPage();page.setDefaultTimeout(20000);
   if(old)await page.setViewport({width,height:900,hasTouch:layout==='mobile'});
   const wait=(fn,arg)=>old?page.waitForFunction(fn,{},arg):page.waitForFunction(fn,arg);
   try {
    if(old){
     await page.goto(fixture.base+'/web/#/login');
     await wait(()=>document.querySelector('#txtManualName')||Array.from(document.querySelectorAll('button')).some(e=>e.textContent.trim()==='Manual Login'));
     await page.evaluate(()=>{const manual=Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()==='Manual Login');if(manual)manual.click();});
     await page.waitForSelector('#txtManualName',{visible:true});await page.type('#txtManualName',fixture.username);await page.type('#txtManualPassword',fixture.password);await page.keyboard.press('Enter');
     await wait(()=>location.hash==='#/home'&&window.WatchGuardPoc&&WatchGuardPoc.isInstalled());
    }else await require('./browser-readiness.cjs').login(page,fixture);
    await page.evaluate(value=>localStorage.setItem('layout',value),layout);await page.reload();
    await wait(()=>location.hash==='#/home'&&window.WatchGuardPoc&&WatchGuardPoc.isInstalled());
    await page.evaluate(async()=>{
     const items=await ApiClient.ajax({url:ApiClient.getUrl('Items',{Recursive:true,IncludeItemTypes:'Movie,Series',Limit:200}),type:'GET',dataType:'json'});
     for(const item of items.Items)if(item.Name.indexOf('Return Movie ')===0||item.Name==='PoC Series Detail')await ApiClient.ajax({url:ApiClient.getUrl('WatchGuard/Watchlist/'+item.Id),type:'PUT'});
    });
    const route='#/home?watchguard=watchlists&owner=mine&interest=watchlisted&sort=title';
    await page.evaluate(hash=>{location.hash=hash;},route);
    const settled=()=>wait(()=>document.querySelector('.watchguard-page')&&document.querySelector('.watchguard-page').getAttribute('aria-busy')==='false');
    await settled();
    // Normal explicit controls may finish bounded initial preparation.
    for(let n=0;n<4;n++){
     const paused=await page.evaluate(()=>document.querySelector('.watchguard-page').getAttribute('data-view-state')==='paused');
     if(!paused)break;
     await page.evaluate(()=>Array.from(document.querySelectorAll('.watchguard-page>button')).find(e=>e.textContent==='Continue loading').click());await settled();
    }
    for(const depth of [1,3]) {
     if(depth>1)for(let n=1;n<depth;n++){
      await page.evaluate(()=>Array.from(document.querySelectorAll('.watchguard-page>button')).find(e=>e.textContent==='Load more results'&&!e.hidden).click());await settled();
     }
     const before=await page.evaluate(()=>{
      const panel=document.querySelector('.watchguard-page'),cards=panel.querySelectorAll('.watchguard-card'),link=cards[cards.length-3].querySelector('a');
      link.focus();panel.scrollTop+=link.getBoundingClientRect().top-panel.getBoundingClientRect().top-180;
      window.wgReturnOriginal=panel;
      return {href:link.getAttribute('href'),top:link.getBoundingClientRect().top-panel.getBoundingClientRect().top,scroll:panel.scrollTop,count:cards.length,state:JSON.stringify(history.state),length:history.length};
     });
     await page.screenshot({path:path.join(output,(old?'79':'current')+'-'+layout+'-'+depth+'-before.png')});
     await page.keyboard.press('Enter');
     await wait(()=>location.hash.indexOf('#/details?')===0&&!document.querySelector('.watchguard-page')&&!document.querySelector('.watchguard-outgoing'));
     await page.goBack();await settled();
     const after=await page.evaluate(href=>{
      const panel=document.querySelector('.watchguard-page'),link=Array.from(panel.querySelectorAll('.watchguard-card a')).find(e=>e.getAttribute('href')===href);
      return {samePanel:panel===window.wgReturnOriginal,scroll:panel.scrollTop,found:!!link,top:link?link.getBoundingClientRect().top-panel.getBoundingClientRect().top:null,focused:link===document.activeElement,focusTag:document.activeElement.tagName,focusLabel:document.activeElement.getAttribute('aria-label'),count:panel.querySelectorAll('.watchguard-card').length,state:JSON.stringify(history.state),length:history.length};
     },before.href);
     report.cases.push({engine,layout,width,depth,before,after});
     assert.equal(after.samePanel,false);assert.equal(after.state,before.state,'Jellyfin history state preserved');
     if(baseline){assert.equal(after.scroll,0);assert.equal(after.focused,false);if(depth>1)assert.equal(after.found,false);}
     else {assert.equal(after.found,true);assert.equal(after.focused,true);assert.ok(Math.abs(after.top-before.top)<5);}
     await page.screenshot({path:path.join(output,(old?'79':'current')+'-'+layout+'-'+depth+'-after.png')});
    }
   } finally {await context.close();fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(report,null,2)+'\n');}
  }} finally {await browser.close();}
 }
 report.result='PASS';
})().catch(error=>{report.result='FAIL';report.error=error.message;process.exitCode=1;}).finally(()=>fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(report,null,2)+'\n'));
