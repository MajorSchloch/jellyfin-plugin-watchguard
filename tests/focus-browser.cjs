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
// A continuous ring must join all four curved corners and straight edges.
// Pixel connectivity rejects the clipped square outline even when its edges
// and computed outline style look correct.
function ring(buffer,color,radius) {
    const p=PNG.sync.read(buffer),rgb=color.match(/[\d.]+/g).slice(0,3).map(Number),r=Math.max(6,Math.ceil(parseFloat(radius))),mask=new Uint8Array(p.width*p.height);
    const corners=(x,y)=>[x<r&&y<r,x>=p.width-r&&y<r,x>=p.width-r&&y>=p.height-r,x<r&&y>=p.height-r];
    let pixels=0,outerCorners=0;
    for(let y=0;y<p.height;y++)for(let x=0;x<p.width;x++) {
        if(Math.min(x,y,p.width-1-x,p.height-1-y)>r+2)continue;
        const i=(y*p.width+x)*4;
        if(rgb.every((v,c)=>Math.abs(p.data[i+c]-v)<25)) {
            mask[y*p.width+x]=1;pixels++;
            if((x<2||x>=p.width-2)&&(y<2||y>=p.height-2))outerCorners++;
        }
    }
    let largest={pixels:0,corners:[],edges:[]},components=0;
    for(let start=0;start<mask.length;start++)if(mask[start]) {
        components++;const queue=[start],hits=[false,false,false,false],edges=[false,false,false,false];mask[start]=0;
        for(let n=0;n<queue.length;n++) {
            const i=queue[n],x=i%p.width,y=Math.floor(i/p.width);
            corners(x,y).forEach((hit,c)=>{hits[c]=hits[c]||hit;});
            [y<4&&x>r&&x<p.width-r,x>=p.width-4&&y>r&&y<p.height-r,y>=p.height-4&&x>r&&x<p.width-r,x<4&&y>r&&y<p.height-r].forEach((hit,c)=>{edges[c]=edges[c]||hit;});
            for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++) {
                const nx=x+dx,ny=y+dy,j=ny*p.width+nx;
                if(nx>=0&&nx<p.width&&ny>=0&&ny<p.height&&mask[j]){mask[j]=0;queue.push(j);}
            }
        }
        if(queue.length>largest.pixels)largest={pixels:queue.length,corners:hits,edges};
    }
    return {pixels,outerCorners,components,largest,continuous:largest.corners.every(Boolean)&&largest.edges.every(Boolean)&&largest.pixels>p.width&&outerCorners===0};
}
module.exports=async(page,fixture,output,old=false,baseline=false)=>{
    fs.mkdirSync(output,{recursive:true});
    const report={baseline,engine:old?await page.browser().version():page.context().browser().version(),server:fixture.serverVersion,deployed:fixture.deployedPackage,physicalTV:false,cases:[]};
    const wait=(fn,arg)=>old?page.waitForFunction(fn,{},arg):page.waitForFunction(fn,arg);
    const selector='.watchguard-series-activity>summary';
    const restore=[],token=await page.evaluate(()=>ApiClient.accessToken());
    async function api(route,method='GET',body) {
        const response=await fetch(fixture.base+route,{method,headers:{Authorization:'MediaBrowser Client="WatchGuardFocus", Device="Disposable", DeviceId="focus-fixture", Version="1", Token="'+token+'"' ,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
        assert(response.ok,'Focus fixture API '+method+' '+route+': '+response.status);
        return response.status===204?null:response.json();
    }
    async function state(s) {return page.$eval(s,e=>{
        const c=getComputedStyle(e),r=e.getBoundingClientRect(),walk=document.createTreeWalker(e,NodeFilter.SHOW_TEXT);let node,label;
        while((node=walk.nextNode()))if(node.textContent.trim()){const range=document.createRange();range.selectNodeContents(node);const b=range.getBoundingClientRect();label={width:b.width,height:b.height};break;}
        return {color:c.color,outlineColor:c.outlineColor,outline:c.outlineStyle,shadow:c.boxShadow,indicatorColor:c.boxShadow!=='none'?(c.boxShadow.match(/rgba?\([^)]*\)/)||[])[0]:c.outlineColor,radius:c.borderRadius,panelRadius:getComputedStyle(e.parentElement).borderRadius,offset:c.outlineOffset,focused:document.activeElement===e,active:e.getAttribute('aria-current'),nativeActive:e.classList.contains('emby-tab-button-active'),transform:c.transform,label,rect:{x:r.x,y:r.y,width:r.width,height:r.height},layout:{x:e.offsetLeft,y:e.offsetTop,width:e.offsetWidth,height:e.offsetHeight}};
    });}
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
    async function crop(s,name,pad=0) {const r=(await state(s)).rect;return page.screenshot({path:path.join(output,name+'.png'),clip:{x:r.x-pad,y:r.y-pad,width:r.width+pad*2,height:r.height+pad*2}});}
    try {
        // Real synthetic episode metadata gives the open panel a native extras
        // button. Restore it afterward: this suite shares a disposable fixture.
        for(const [n,name] of ['PoC Series Detail S01E01','PoC Series Detail S01E02'].entries()) {
            const id=fixture.items[name],dto=await api('/Items/'+id),data=await api('/UserItems/'+id+'/UserData');
            restore.push(()=>api('/Items/'+id,'POST',dto),()=>api('/UserItems/'+id+'/UserData','POST',data));
            await api('/Items/'+id,'POST',{...dto,PremiereDate:new Date(Date.now()+(n?7:-7)*86400000).toISOString()});
            await api('/UserItems/'+id+'/UserData','POST',{Played:n===0,PlaybackPositionTicks:0,LastPlayedDate:new Date().toISOString()});
        }
        report.innerControl='Native SeriesActivity from synthetic aired/played and future/unplayed episodes; original metadata and user data restored';
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
            row.resting={favorite:await state(favorite),watchlists:await state(nav)};
            if(layout==='tv')row.nativeRules=await page.evaluate(()=>{
                const found=[];const visit=rules=>{for(const r of Array.from(rules)){if(r.cssRules)visit(r.cssRules);else if(r.selectorText&&r.selectorText.includes('emby-tab-button')&&!r.selectorText.includes('watchguard'))found.push(r.cssText);}};
                for(const sheet of Array.from(document.styleSheets)){try{visit(sheet.cssRules);}catch(_){}}return found;
            });
            await page.screenshot({path:path.join(output,layout+'-home-focus.png')});
            if(layout==='tv')await page.keyboard.press('ArrowRight');else {await page.keyboard.press('Tab');await page.focus(favorite);}
            assert(await page.$eval(favorite,e=>document.activeElement===e));await settled(favorite);row.favorite=await state(favorite);
            await page.screenshot({path:path.join(output,layout+'-favorites-focus.png')});
            if(layout==='tv') {
                await page.keyboard.press('Enter');
                await wait(()=>document.querySelector('.emby-tab-button-active').getAttribute('data-index')==='1');
                await settled(favorite);row.favoriteAfterActivation=await state(favorite);
                await page.screenshot({path:path.join(output,layout+'-favorites-after-activation.png')});
                // Measure selection without focus, then reach the active native
                // tab again using the remote arrows before continuing right.
                await page.focus(home);await settled(favorite);row.favoriteActive=await state(favorite);
                await page.screenshot({path:path.join(output,layout+'-favorites-active.png')});
                await page.keyboard.press('ArrowRight');await settled(favorite);row.favoriteActiveFocused=await state(favorite);
                await page.screenshot({path:path.join(output,layout+'-favorites-active-focus.png')});
                await page.keyboard.press('ArrowRight');
            }else await page.keyboard.press('Tab');
            row.neighbors={home:await state(home),favorite:await state(favorite)};
            assert(await page.$eval(nav,e=>document.activeElement===e),'Native navigation reaches Watchlists');await settled(nav);row.menu=await state(nav);
            const menuImage=await crop(nav,layout+'-menu-crop');
            row.menu.textPixels=ink(menuImage,row.favorite.color,8);
            row.menu.edgePixels=ink(menuImage,row.menu.outlineColor,0,true);
            await page.screenshot({path:path.join(output,layout+'-watchlists-focus.png')});
            await page.keyboard.press('Enter');await wait(()=>!!document.querySelector('.watchguard-page'));
            await settled(nav);row.afterActivation=await state(nav);
            await page.screenshot({path:path.join(output,layout+'-watchlists-after-activation.png')});
            await page.focus('.watchguard-refresh');await settled(nav);row.active=await state(nav);
            await page.screenshot({path:path.join(output,layout+'-watchlists-active.png')});
            await page.focus(nav);await settled(nav);row.activeFocused=await state(nav);
            row.neighborsAfter={home:await state(home),favorite:await state(favorite)};
            await page.screenshot({path:path.join(output,layout+'-watchlists-active-focus.png')});
            if(layout==='tv') {
                const scale=(value,rest)=>({width:value.label.width/rest.label.width,height:value.label.height/rest.label.height});
                row.growth={favoriteFocus:scale(row.favorite,row.resting.favorite),watchlistsFocus:scale(row.menu,row.resting.watchlists),favoriteActive:scale(row.favoriteActive,row.resting.favorite),watchlistsActive:scale(row.active,row.resting.watchlists),favoriteActiveFocus:scale(row.favoriteActiveFocused,row.resting.favorite),watchlistsActiveFocus:scale(row.activeFocused,row.resting.watchlists)};
            }
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
            row.detail.focusEdgePixels=ink(focused,row.detail.indicatorColor,0,true);
            row.detail.normalEdgePixels=ink(unfocused,row.detail.indicatorColor,0,true);
            row.closedRing=ring(focused,row.detail.indicatorColor,row.detail.panelRadius);
            await page.focus(selector);await page.keyboard.press('Enter');
            await wait(()=>document.querySelector('.watchguard-series-activity').open);
            await page.screenshot({path:path.join(output,layout+'-detail-open.png')});
            row.openRing=ring(await crop(selector,layout+'-detail-open-crop'),row.detail.indicatorColor,row.detail.panelRadius);
            await page.keyboard.press('Escape');
            assert(await page.$eval(selector,e=>!e.parentElement.open&&document.activeElement===e),'Back closes and restores summary focus');
            await page.keyboard.press('Enter');await wait(()=>document.querySelector('.watchguard-series-activity').open);
            await page.keyboard.press(layout==='tv'?'ArrowDown':'Tab');
            assert(await page.$eval('.watchguard-series-activity .watchguard-extra-button',e=>document.activeElement===e),'Arrows/Tab reach the real extras control inside the disclosure');
            row.inner=await state('.watchguard-series-activity .watchguard-extra-button');
            row.headingAfterInner=await state(selector);
            row.headingAfterInner.edgePixels=ink(await crop(selector,layout+'-detail-inner-heading-crop'),row.detail.indicatorColor,0,true);
            await page.screenshot({path:path.join(output,layout+'-detail-inner-focus.png')});
            assert(row.headingAfterInner.edgePixels<20,'Only the inner control is focused; the heading ring is removed');
            row.inner.edgePixels=ink(await crop('.watchguard-series-activity .watchguard-extra-button',layout+'-detail-inner-control-crop',6),row.inner.outlineColor,0,true);
            assert(row.inner.outline!=='none'&&row.inner.edgePixels>20,'Inner control retains its own rendered focus indicator');
            await page.keyboard.press('Enter');await wait(()=>!!document.querySelector('.watchguard-extras-dialog[open]'));
            await page.keyboard.press('Escape');
            assert(await page.$eval('.watchguard-series-activity .watchguard-extra-button',e=>document.activeElement===e),'Extras dismissal restores the inner control focus');
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
                assert(row.closedRing.continuous,'Closed heading has one continuous rounded focus ring');
                assert(row.openRing.continuous,'Open heading has one continuous rounded focus ring');
                for(const peer of ['home','favorite'])assert.deepEqual(row.neighbors[peer].layout,row.neighborsAfter[peer].layout,'Neighbor tab layout stays still through Watchlists focus and activation');
                if(layout==='tv')for(const suffix of ['Focus','Active','ActiveFocus'])for(const axis of ['width','height'])
                    assert(Math.abs(row.growth['favorite'+suffix][axis]-row.growth['watchlists'+suffix][axis])<.025,'TV '+suffix+' label growth matches its own native resting-size ratio');
            }
        }
        if(baseline)assert(report.cases.some(r=>!r.closedRing.continuous||!r.openRing.continuous),'Baseline must reproduce a visible regression');
        report.result=baseline?'REPRODUCED':'PASS';
    } catch(error) {report.result='FAIL';report.error=error.message;await page.screenshot({path:path.join(output,'failure.png')});throw error;}
    finally {for(const undo of restore.reverse())await undo();fs.writeFileSync(path.join(output,'focus.json'),JSON.stringify(report,null,2)+'\n');}
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
