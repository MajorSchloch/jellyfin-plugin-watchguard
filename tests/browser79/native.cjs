/* Real old engine + disposable native Jellyfin. Never use production credentials. */
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const puppeteer = require('./node_modules/puppeteer-core');
const crypto = require('node:crypto');
const version = /<Version>([^<]+)<\/Version>/.exec(fs.readFileSync('Directory.Build.props','utf8'))[1];
const fixture = JSON.parse(fs.readFileSync(process.argv[2]));
assert.match(fixture.base, /^https?:\/\/(?:127\.0\.0\.1|localhost):\d+(?:\/jellyfin)?$/);
assert.equal(fixture.username, 'WatchGuardPoCTest');
const output = process.argv[3] || 'artifacts/browser79-native';
fs.mkdirSync(output, {recursive:true});
const report = {server:fixture.serverVersion, image:fixture.image, device:'Chromium executable; no physical TV', cases:[], result:'RUNNING'};
report.packageSha256=crypto.createHash('sha256').update(fs.readFileSync('artifacts/Jellyfin.Plugin.WatchGuard-v'+version+'.zip')).digest('hex');
report.runtimeSha256=crypto.createHash('sha256').update(fs.readFileSync('artifacts/WatchGuard/Jellyfin.Plugin.WatchGuard.dll')).digest('hex');
(async () => {
    assert(process.env.WATCHGUARD_CHROMIUM79, 'Set the actual Chromium 79 executable path');
    const browser = await puppeteer.launch({executablePath:process.env.WATCHGUARD_CHROMIUM79, headless:true});
    report.engine = await browser.version(); assert.match(report.engine, /\/79\./);
    const page = await browser.newPage(); page.setDefaultTimeout(15000);
    await page.evaluateOnNewDocument(() => {
        // Test-only observer: prove that old engines do not leak the owned
        // document listener when routes destroy and recreate Watchlists.
        const listeners=new Set(), add=document.addEventListener.bind(document), remove=document.removeEventListener.bind(document);
        document.addEventListener=function(type,fn,options) {if(type==='pointerdown'&&fn.name==='dismissOutside')listeners.add(fn);return add(type,fn,options);};
        document.removeEventListener=function(type,fn,options) {if(type==='pointerdown'&&fn.name==='dismissOutside')listeners.delete(fn);return remove(type,fn,options);};
        window.wgOutsideListenerCount=()=>listeners.size;
    });
    const errors=[]; page.on('pageerror', error => errors.push(error.message));
    let mediaDeletes=0;
    page.on('request', request => { if(request.method()==='DELETE' && /\/Items\//i.test(new URL(request.url()).pathname)) mediaDeletes++; });
    try {
        await page.setViewport({width:1280,height:900});
        await page.goto(fixture.base + '/web/#/login');
        await page.waitForFunction(() => document.querySelector('#txtManualName') || Array.from(document.querySelectorAll('button')).some(e => e.textContent.trim() === 'Manual Login'));
        await page.evaluate(() => { const manual=Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()==='Manual Login'); if(manual)manual.click(); });
        await page.waitForSelector('#txtManualName',{visible:true});
        await page.type('#txtManualName', fixture.username); await page.type('#txtManualPassword',fixture.password);
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => location.hash === '#/home' && window.WatchGuardPoc && WatchGuardPoc.isInstalled());
        report.nativeLogin = 'PASS';
        report.pluginVersion=await page.evaluate(async()=> (await ApiClient.ajax({url:ApiClient.getUrl('WatchGuard/IntegrationStatus'),type:'GET',dataType:'json'})).PluginVersion);
        assert.equal(report.pluginVersion,version);
        // Prove the released syntax gap using the original source in this engine.
        const original=fs.readFileSync('Jellyfin.Plugin.WatchGuard/Standalone/bootstrap.js','utf8');
        assert.equal(await page.evaluate(source=>{try{new Function(source);return 'parsed';}catch(e){return e.name;}},original),'SyntaxError');
        report.originalOptionalChaining = 'SyntaxError in actual Chromium 79';
        for (const layout of ['tv', 'desktop-legacy', 'mobile-legacy', 'modern']) {
            await page.setViewport({width:layout==='mobile-legacy'?390:1280,height:900});
            await page.evaluate(value=>localStorage.setItem('layout',value),layout);
            if(layout==='tv') {
                await page.goto(fixture.base+'/web/#/home'); await page.reload();
                await page.waitForSelector('.watchguard-nav-tab',{visible:true});
                await page.focus('.emby-tab-button[data-index="1"]'); await page.keyboard.press('ArrowRight');
                assert(await page.evaluate(()=>document.activeElement.matches('.watchguard-nav')), 'Native Right reaches Watchlists from Favorites');
                await page.keyboard.press('Enter'); await page.waitForSelector('.watchguard-page');
            }
            await page.goto(fixture.base+'/web/#/home?watchguard=watchlists'); await page.reload();
            await page.waitForSelector('.watchguard-page');
            assert.equal(await page.evaluate(()=>wgOutsideListenerCount()),1);
            // The page node exists before its first render. A missing state is not readiness.
            await page.waitForFunction(()=>['ready','empty','populating'].includes(document.querySelector('.watchguard-page').getAttribute('data-view-state')));
            if(layout==='tv') assert(await page.evaluate(()=>document.documentElement.classList.contains('layout-tv')));
            const row={layout};report.cases.push(row);
            await page.focus('.watchguard-filter summary'); await page.keyboard.press('Enter');
            await page.waitForFunction(()=>document.querySelector('.watchguard-filter').open);
            await page.keyboard.press('ArrowDown');
            if(layout==='tv') assert(await page.evaluate(()=>document.querySelector('.watchguard-filter').contains(document.activeElement) && document.activeElement.tagName==='INPUT'), 'Native Down reaches status checkbox');
            if(layout==='tv') {
                const checked=await page.evaluate(()=>document.activeElement.checked);
                await page.keyboard.press('Enter');
                await page.waitForFunction(value=>document.activeElement.tagName==='INPUT' && document.activeElement.checked!==value,{},checked);
            }
            await page.keyboard.press('Escape');
            assert(await page.evaluate(()=>!document.querySelector('.watchguard-filter').open && document.activeElement.matches('.watchguard-filter summary')));
            const outline=await page.$eval('.watchguard-filter summary',e=>getComputedStyle(e).outlineStyle);assert.notEqual(outline,'none');
            await page.$eval('.watchguard-search input',e=>e.focus()); await page.type('.watchguard-search input','PoC');
            await page.waitForFunction(()=>location.hash.includes('search=PoC'));
            assert(await page.evaluate(()=>document.activeElement.matches('.watchguard-search input')));
            row.filtersAndFocus='PASS';
            if(layout!=='tv') {
                await page.waitForSelector('.watchguard-poster');
                const ratio=await page.$eval('.watchguard-poster',e=>{const r=e.getBoundingClientRect();return r.height/r.width;});
                assert(Math.abs(ratio-1.5)<0.02, 'Poster keeps its native 2:3 shape');row.posterRatio=ratio;
            }
            await page.screenshot({path:path.join(output,layout+'-watchlists.png')});
            const id=fixture.items['PoC Movie Detail'];
            await page.goto(fixture.base+'/web/#/details?id='+id+'&serverId='+fixture.serverId);
            await page.waitForFunction(()=>{const b=document.querySelector('#itemDetailPage:not(.hide) .watchguard-toggle');return b&&!b.disabled;});
            assert.equal(await page.evaluate(()=>wgOutsideListenerCount()),0);
            const selector='#itemDetailPage:not(.hide) .watchguard-toggle';
            const before=await page.$eval(selector,e=>e.getAttribute('aria-pressed'));
            await page.focus(selector); await page.keyboard.press('Enter');
            await page.waitForFunction((s,v)=>document.querySelector(s).getAttribute('aria-pressed')!==v && document.activeElement===document.querySelector(s),{},selector,before);
            await page.keyboard.press('Enter');
            await page.waitForFunction((s,v)=>document.querySelector(s).getAttribute('aria-pressed')===v,{},selector,before);
            assert(await page.evaluate(s=>document.activeElement===document.querySelector(s),selector));
            row.membershipAndFocus='PASS';
            await page.screenshot({path:path.join(output,layout+'-detail.png')});
            if(await page.$eval(selector,e=>e.getAttribute('aria-pressed'))!=='true') {
                await page.keyboard.press('Enter');
                await page.waitForFunction(s=>document.querySelector(s).getAttribute('aria-pressed')==='true' && document.activeElement===document.querySelector(s),{},selector);
            }
            await page.evaluate(id=>{window.wgCancellation=null;ApiClient.deleteItem(id).then(()=>{window.wgCancellation='deleted';},e=>{window.wgCancellation=e.name;});},id);
            await page.waitForSelector('.watchguard-deletion-dialog',{visible:true});
            if(layout==='tv') {
                await page.keyboard.press('ArrowRight');
                assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Delete Anyway');
            }
            await page.screenshot({path:path.join(output,layout+'-dialog.png')});
            await page.keyboard.press('Escape');
            await page.waitForFunction(()=>window.wgCancellation==='AbortError');
            assert.equal(mediaDeletes,0,'Cancel must never send a native media DELETE');
            assert(await page.evaluate(s=>document.activeElement===document.querySelector(s),selector));
            row.dialogCancelAndFocus='PASS';
        }
        await page.goto(fixture.base+'/web/#/configurationpage?name=WatchGuard');
        await page.waitForFunction(()=>document.querySelector('#wgIntegration') && document.querySelector('#wgIntegration').textContent.includes('Plugin loaded: true'));
        report.settingsInline='PASS';
        report.errors=errors; assert.deepEqual(errors,[]);
        report.result='PASS';
    } catch(error) { report.result='FAIL';report.error=error.message;report.errors=errors;await page.screenshot({path:path.join(output,'failure.png')});throw error; }
    finally { fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
