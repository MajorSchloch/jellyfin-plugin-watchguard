// Same native request/interaction regression in current Chromium and Chromium 79.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
module.exports=async function(page,fixture,output,oldEngine=false) {
    const wait=(fn,arg)=>oldEngine?page.waitForFunction(fn,{},arg):page.waitForFunction(fn,arg);
    const select=(selector,value)=>oldEngine?page.select(selector,value):page.selectOption(selector,value);
    const cases=[];
    for(const width of [1280,390]) {
        if(oldEngine)await page.setViewport({width,height:900});else await page.setViewportSize({width,height:900});
        await page.goto(fixture.base+'/web/#/home');
        await wait(()=>!document.querySelector('.watchguard-page'));
        let release,begin,held=false;const gate=new Promise(resolve=>{release=resolve;});
        const started=new Promise(resolve=>{begin=resolve;});
        const requests=[];
        const observe=request=>{
            const url=new URL(request.url());
            if(!url.pathname.includes('/WatchGuard/'))return;
            requests.push({method:request.method(),endpoint:url.pathname.split('/WatchGuard/')[1],query:Object.fromEntries([...url.searchParams].filter(([key])=>['owner','days','older','statuses','sort','search'].includes(key)))});
        };
        const intercept=async value=>{
            const request=oldEngine?value:value.request();
            if(request.method()==='GET' && new URL(request.url()).pathname.endsWith('/WatchGuard/Preferences')) {held=true;begin();await gate;}
            await value.continue();
        };
        page.on('request',observe);
        if(oldEngine){await page.setRequestInterception(true);page.on('request',intercept);}else await page.route('**/WatchGuard/Preferences',intercept);
        try {
            await Promise.all([started, page.waitForRequest(request=>request.method()==='GET' && new URL(request.url()).pathname.endsWith('/WatchGuard/Preferences')),
                page.goto(fixture.base+'/web/#/home?watchguard=watchlists&owner=all&interest=none&sort=title&days=90&older=false')]);
            await wait(()=>document.querySelector('.watchguard-page') && document.querySelector('[aria-label="Watchlist owner"]').hidden===false);
            assert.equal(held,true,'Interact before the real preferences request completes');
            await page.evaluate(()=>{
                const panel=document.querySelector('.watchguard-page');
                window.wgEarly={panel:panel,frames:0,replacements:0,home:0,running:true};
                function frame(){const state=window.wgEarly;if(!state.running)return;state.frames++;
                    if(document.querySelector('.watchguard-page')!==panel)state.replacements++;
                    if(!document.body.classList.contains('watchguard-page-open'))state.home++;
                    requestAnimationFrame(frame);
                }requestAnimationFrame(frame);
            });
            await page.click('.watchguard-filter summary');
            await page.click('.watchguard-filter input[value="watched"] + span');
            await page.keyboard.press('Escape');
            await select('[aria-label="Sort by"]','added');
            await select('[aria-label="Watchlist owner"]','mine');
            await page.click('.watchguard-secondary summary');
            await select('[aria-label="Activity range"]','7');
            await page.click('[aria-label="Search titles"]');
            await page.keyboard.type('Wrong');
            for(const character of 'Wrong') await page.keyboard.press('Backspace');
            await page.keyboard.type('PoC');
            await wait(()=>new URLSearchParams(location.hash.split('?')[1]).get('search')==='PoC');
            assert.equal(requests.filter(r=>r.endpoint==='Preferences').length,1,'One shared preferences read');
            assert.equal(requests.filter(r=>/^Watchlists?(?:\/|$)|^ActivityBrowser/.test(r.endpoint)).length,0,'No query before preferences resolve');
            await page.screenshot({path:path.join(output,'early-filters-'+width+'-held.png')});
            release();
            await wait(()=>document.querySelector('.watchguard-page').getAttribute('aria-busy')==='false');
            const query=requests.find(r=>r.endpoint==='ActivityBrowser');assert.ok(query,'Latest activity query starts');
            assert.deepEqual(query.query,{owner:'mine',days:'7',older:'false',statuses:'watched',sort:'added',search:'PoC'});
            assert.equal(requests.filter(r=>r.endpoint==='Preferences' && r.method!=='GET').length,0,'Filtering does not save preferences');
            const state=await page.evaluate(()=>{const s=window.wgEarly;return {frames:s.frames,replacements:s.replacements,home:s.home,focus:document.activeElement.getAttribute('aria-label'),disclosure:document.querySelector('.watchguard-secondary').open};});
            assert.ok(state.frames>0);assert.equal(state.replacements,0);assert.equal(state.home,0);assert.equal(state.focus,'Search titles');assert.equal(state.disclosure,true);
            await page.screenshot({path:path.join(output,'early-filters-'+width+'-ready.png')});
            const roundTrips=[];
            for(const via of ['control','history','equivalent']) {
                await select('[aria-label="Sort by"]','title');
                await wait(()=>document.querySelector('.watchguard-page').getAttribute('aria-busy')==='false');
                if(via==='history')await page.evaluate(()=>history.pushState(history.state,'',location.href));
                // Defer the native account promise, not its data. Jellyfin may
                // cache this lookup, so a network interceptor cannot hold it.
                await page.evaluate(()=>{
                    const original=ApiClient.getCurrentUser;
                    let release;const gate=new Promise(resolve=>{release=resolve;});
                    window.wgAccountGate={calls:0,release:release,original:original};
                    ApiClient.getCurrentUser=function(){window.wgAccountGate.calls++;const result=original.apply(this,arguments);return gate.then(()=>result);};
                });
                const start=requests.length;
                try {
                    await page.focus('[aria-label="Sort by"]');
                    await select('[aria-label="Sort by"]','added');
                    await wait(()=>window.wgAccountGate.calls===1);
                    if(via==='history')await page.goBack();else await select('[aria-label="Sort by"]',via==='equivalent'?'added':'title');
                    const expected=via==='equivalent'?'added':'title';
                    await wait(sort=>new URLSearchParams(location.hash.split('?')[1]).get('sort')===sort,expected);
                    assert.equal(requests.length,start,'No data requests before account resolution');
                    if(via==='control')await page.screenshot({path:path.join(output,'roundtrip-'+width+'-held.png')});
                    await page.evaluate(()=>window.wgAccountGate.release());
                    await wait(()=>document.querySelector('.watchguard-page').getAttribute('aria-busy')==='false');
                    const data=requests.slice(start);
                    assert.equal(data.filter(r=>/^Watchlists?$/.test(r.endpoint)).length,1,'One replacement membership request');
                    const queries=data.filter(r=>r.endpoint==='ActivityBrowser');
                    assert.ok(queries.length>=1 && queries.length<=4,'Bounded automatic preparation');
                    assert.ok(queries.every(r=>r.query.sort===expected),'Only the latest sort reaches activity');
                    const retained=await page.evaluate(()=>({panel:document.querySelector('.watchguard-page')===window.wgEarly.panel,focus:document.activeElement.getAttribute('aria-label'),disclosure:document.querySelector('.watchguard-secondary').open,lookups:window.wgAccountGate.calls}));
                    assert.equal(retained.panel,true);assert.equal(retained.focus,'Sort by');assert.equal(retained.disclosure,true);assert.equal(retained.lookups,1);
                    roundTrips.push({via,sort:expected,activityRequests:queries.length,retained,result:'PASS'});
                } finally {
                    await page.evaluate(()=>{const held=window.wgAccountGate;held.release();ApiClient.getCurrentUser=held.original;delete window.wgAccountGate;});
                }
            }
            const transition=await page.evaluate(()=>{const s=window.wgEarly;s.running=false;return {frames:s.frames,replacements:s.replacements,home:s.home};});
            assert.equal(transition.replacements,0);assert.equal(transition.home,0);
            await page.screenshot({path:path.join(output,'roundtrip-'+width+'-ready.png')});
            cases.push({width,result:'PASS',state,preferencesReads:1,query:query.query,roundTrips,transition});
        } finally {
            release();await page.evaluate(()=>{if(window.wgEarly)window.wgEarly.running=false;});
            if(oldEngine){page.removeListener('request',intercept);await page.setRequestInterception(false);}else await page.unroute('**/WatchGuard/Preferences',intercept);
            page.removeListener('request',observe);
            fs.writeFileSync(path.join(output,'early-filters.json'),JSON.stringify({engine:oldEngine?'Chromium 79':'current Chromium',cases},null,2)+'\n');
        }
    }
    return cases;
};
