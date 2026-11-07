/* Native arrows plus rendered pixels: computed outlines alone miss clipping. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PNG}=require('./browser/node_modules/playwright-core/lib/utilsBundle');
function ink(buffer,color,inset=0,edge=false) {
    const png=PNG.sync.read(buffer),rgb=color.match(/[\d.]+/g).slice(0,3).map(Number);let count=0;
    for(let y=inset;y<png.height-inset;y++)for(let x=inset;x<png.width-inset;x++) {
        if(edge&&x>=6&&x<png.width-6&&y>=6&&y<png.height-6)continue;
        const i=(y*png.width+x)*4;
        if(rgb.every((v,c)=>Math.abs(png.data[i+c]-v)<15))count++;
    }
    return count;
}
module.exports=async(page,fixture,output,old=false,baseline=false)=>{
    fs.mkdirSync(output,{recursive:true});
    const report={baseline,engine:old?await page.browser().version():page.context().browser().version(),server:fixture.serverVersion,deployed:fixture.deployedPackage,physicalTV:false,cases:[]};
    const wait=(fn,arg)=>old?page.waitForFunction(fn,{},arg):page.waitForFunction(fn,arg);
    const selector='.watchguard-series-activity>summary';
    async function state(s) {return page.$eval(s,e=>{const c=getComputedStyle(e),r=e.getBoundingClientRect();return {color:c.color,outlineColor:c.outlineColor,outline:c.outlineStyle,offset:c.outlineOffset,active:e.getAttribute('aria-current'),rect:{x:r.x,y:r.y,width:r.width,height:r.height}};});}
    async function settled(s) {
        // Wait for actual CSS transitions to finish, including the old engine.
        await page.$eval(s,e=>new Promise((resolve,reject)=>{
            let last='',stable=0,frames=0;
            const sample=()=>{const c=getComputedStyle(e),r=e.getBoundingClientRect(),now=[c.color,c.outlineColor,r.x,r.y,r.width,r.height].join('|');
                stable=now===last?stable+1:0;last=now;
                if(stable===3)return resolve();if(++frames===120)return reject(new Error('Focus presentation did not settle'));
                requestAnimationFrame(sample);};sample();
        }));
    }
    async function crop(s,name) {const r=(await state(s)).rect;return page.screenshot({path:path.join(output,name+'.png'),clip:r});}
    try {
        for(const [layout,width] of [['tv',1280],['desktop-legacy',1280],['mobile-legacy',390]]) {
            if(old)await page.setViewport({width,height:900});else await page.setViewportSize({width,height:900});
            await page.evaluate(layout=>localStorage.setItem('layout',layout),layout);
            await page.goto(fixture.base+'/web/#/home');await page.reload();
            await wait(()=>window.WatchGuardPoc&&WatchGuardPoc.isInstalled()&&document.querySelector('.watchguard-nav-tab'));
            await wait(()=>Array.from(document.querySelectorAll('.homePage:not(.hide) .sectionTitle')).some(e=>e.textContent==='My Media')&&document.querySelector('.homePage:not(.hide) .cardImageContainer'));
            if(layout==='tv')await wait(()=>!!document.activeElement.closest('.homePage'));
            await page.mouse.move(width-1,899);
            const row={layout,width};report.cases.push(row);
            const home='.headerTabs .emby-tab-button[data-index="0"]',favorite='.headerTabs .emby-tab-button[data-index="1"]',nav='.watchguard-nav-tab';
            await page.focus(home);await settled(home);row.home=await state(home);
            await page.screenshot({path:path.join(output,layout+'-home-focus.png')});
            if(layout==='tv')await page.keyboard.press('ArrowRight');else {await page.keyboard.press('Tab');await page.focus(favorite);}
            assert(await page.$eval(favorite,e=>document.activeElement===e));await settled(favorite);row.favorite=await state(favorite);
            await page.screenshot({path:path.join(output,layout+'-favorites-focus.png')});
            if(layout==='tv')await page.keyboard.press('ArrowRight');else await page.keyboard.press('Tab');
            assert(await page.$eval(nav,e=>document.activeElement===e),'Native navigation reaches Watchlists');await settled(nav);row.menu=await state(nav);
            const menuImage=await crop(nav,layout+'-menu-crop');
            row.menu.textPixels=ink(menuImage,row.favorite.color,8);
            row.menu.edgePixels=ink(menuImage,row.menu.outlineColor,0,true);
            await page.screenshot({path:path.join(output,layout+'-watchlists-focus.png')});
            await page.keyboard.press('Enter');await wait(()=>!!document.querySelector('.watchguard-page'));
            await page.focus('.watchguard-refresh');await settled(nav);row.active=await state(nav);
            await page.screenshot({path:path.join(output,layout+'-watchlists-active.png')});
            await page.focus(nav);await settled(nav);row.activeFocused=await state(nav);
            await page.screenshot({path:path.join(output,layout+'-watchlists-active-focus.png')});
            await page.goto(fixture.base+'/web/#/details?id='+fixture.items['PoC Series Detail']+'&serverId='+fixture.serverId);
            await wait(()=>document.querySelector('.watchguard-series-activity>summary')&&document.querySelector('.watchguard-toggle')&&!document.querySelector('.watchguard-toggle').disabled);
            await page.focus('.watchguard-toggle');row.arrows=[];
            for(let n=0;n<12;n++) {
                if(await page.$eval(selector,e=>document.activeElement===e))break;
                await page.keyboard.press(layout==='tv'?'ArrowDown':'Tab');
                row.arrows.push(await page.evaluate(()=>({tag:document.activeElement.tagName,class:document.activeElement.className})));
            }
            assert(await page.$eval(selector,e=>document.activeElement===e),'Down/Tab reaches the detail disclosure');
            row.detail=await state(selector);
            const focused=await crop(selector,layout+'-detail-crop-focus');
            await page.screenshot({path:path.join(output,layout+'-detail-focus.png')});
            await page.$eval(selector,e=>e.blur());
            const unfocused=await crop(selector,layout+'-detail-crop-normal');
            await page.screenshot({path:path.join(output,layout+'-detail-normal.png')});
            row.detail.focusEdgePixels=ink(focused,row.detail.outlineColor,0,true);
            row.detail.normalEdgePixels=ink(unfocused,row.detail.outlineColor,0,true);
            await page.focus(selector);await page.keyboard.press('Enter');
            await wait(()=>document.querySelector('.watchguard-series-activity').open);
            await page.screenshot({path:path.join(output,layout+'-detail-open.png')});
            await page.keyboard.press('Escape');
            assert(await page.$eval(selector,e=>!e.parentElement.open&&document.activeElement===e),'Back closes and restores summary focus');
            await page.keyboard.press('Enter');await wait(()=>document.querySelector('.watchguard-series-activity').open);
            await page.keyboard.press(layout==='tv'?'ArrowDown':'Tab');
            assert(await page.$eval(selector,e=>document.activeElement!==e),'Navigation continues beyond the disclosure');
            // Down may leave the disclosure entirely. Back is scoped to an
            // owned open surface, so return before checking its dismissal.
            row.onward=await page.evaluate(()=>({tag:document.activeElement.tagName,class:document.activeElement.className}));
            await page.focus(selector);
            await page.keyboard.press('Escape');
            assert(await page.$eval(selector,e=>!e.parentElement.open&&document.activeElement===e));
            row.interaction='PASS';
            row.menuMatchesNative=row.menu.color===row.favorite.color&&row.menu.outline===row.favorite.outline&&row.menu.textPixels>20;
            row.detailVisible=row.detail.focusEdgePixels-row.detail.normalEdgePixels>row.detail.rect.width;
            if(!baseline) {
                if(layout==='tv')assert(row.menuMatchesNative,'TV Watchlists renders native text focus without a foreign border');
                else assert(row.menu.outline!=='none'&&row.menu.edgePixels>20,'Desktop/mobile keyboard focus retains a visible outline');
                if(layout==='tv')assert.notEqual(row.active.color,row.activeFocused.color,'TV active and focused text states remain distinct');
                else assert(row.activeFocused.active==='page'&&row.activeFocused.outline!=='none','Desktop/mobile retain an outline when the active tab has focus');
                assert(row.detailVisible,'Focus pixels must be visible inside the clipped detail disclosure');
            }
        }
        if(baseline)assert(report.cases.some(r=>!r.menuMatchesNative||!r.detailVisible),'Baseline must reproduce a visible regression');
        report.result=baseline?'REPRODUCED':'PASS';
    } catch(error) {report.result='FAIL';report.error=error.message;await page.screenshot({path:path.join(output,'failure.png')});throw error;}
    finally {fs.writeFileSync(path.join(output,'focus.json'),JSON.stringify(report,null,2)+'\n');}
    return report;
};
if(require.main===module) {
    const fixture=JSON.parse(fs.readFileSync(process.argv[2])),out=process.argv[3],old=!!process.env.WATCHGUARD_CHROMIUM79;
    assert.match(fixture.base,/^https?:\/\/(?:127\.0\.0\.1|localhost):\d+(?:\/jellyfin)?$/);
    (async()=>{const browser=old?await require('./browser79/node_modules/puppeteer-core').launch({executablePath:process.env.WATCHGUARD_CHROMIUM79,headless:true}):await require('./browser/node_modules/playwright').chromium.launch();
        try {const page=await browser.newPage();page.setDefaultTimeout(20000);
            if(old) {
                await page.goto(fixture.base+'/web/#/login');await page.waitForFunction(()=>document.querySelector('#txtManualName')||Array.from(document.querySelectorAll('button')).some(e=>e.textContent.trim()==='Manual Login'));
                await page.evaluate(()=>{const b=Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()==='Manual Login');if(b)b.click();});
                await page.waitForSelector('#txtManualName',{visible:true});await page.type('#txtManualName',fixture.username);await page.type('#txtManualPassword',fixture.password);await page.keyboard.press('Enter');
                await page.waitForFunction(()=>location.hash==='#/home'&&window.WatchGuardPoc&&WatchGuardPoc.isInstalled());
            } else await require('./browser-readiness.cjs').login(page,fixture);
            const report=await module.exports(page,fixture,out,old,process.argv.includes('--baseline'));
            report.engine=await browser.version();fs.writeFileSync(path.join(out,'focus.json'),JSON.stringify(report,null,2)+'\n');
        }finally{await browser.close();}
    })().catch(e=>{console.error(e);process.exitCode=1;});
}
