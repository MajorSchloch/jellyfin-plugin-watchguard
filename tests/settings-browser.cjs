const readiness=require('./browser-readiness.cjs');
/* Disposable fixture only: native dashboard settings and server-side personal defaults. */
const {chromium} = require('./browser/node_modules/playwright');
const fs = require('node:fs'), assert = require('node:assert/strict');
const fixture = JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
assert.match(fixture.base,/^https?:\/\/(?:127\.0\.0\.1|localhost):\d+(?:\/jellyfin)?$/); assert.equal(fixture.username,'WatchGuardPoCTest');
(async () => {
    const browser = await chromium.launch({headless:true});
    const page = await browser.newPage({ignoreHTTPSErrors:fixture.tls === true}); page.setDefaultTimeout(12000);
    await readiness.capture(page);
    // A Saved message precedes the asynchronous status refresh. The native form
    // re-enables Save only after that refresh settles; never reuse a stale message.
    async function saveSettings() {
        const saved = page.waitForResponse(response => response.request().method() === 'POST' && /\/Plugins\/[^/]+\/Configuration(?:\?|$)/i.test(new URL(response.url()).pathname));
        await page.getByRole('button',{name:'Save',exact:true}).click();
        assert.equal((await saved).ok(),true,'native configuration save must succeed');
        await page.waitForFunction(()=>document.querySelector('#WatchGuardSettingsForm button[type=submit]')?.disabled === false);
        await page.getByText(/^Saved\. Activity settings/).waitFor();
    }
    async function refreshStatus() {
        // Wait for this refresh's final HTTP stage, not text left by the previous
        // refresh. IntegrationStatus clears the old row before fetching script.js.
        const completed = page.waitForResponse(response => response.request().method() === 'GET' &&
            new URL(response.url()).pathname.endsWith(fixture.standalone ? '/WatchGuard/Standalone/script.js' : '/WatchGuard/IntegrationStatus'));
        await page.getByRole('button',{name:'Refresh status and check this browser'}).click();
        assert.equal((await completed).ok(),true,'integration status refresh must succeed');
    }
    try {
        await page.goto(fixture.base+'/web/');
        await page.locator('#txtManualName').fill(fixture.username); await page.locator('#txtManualPassword').fill(fixture.password);
        const loginStarted=Date.now();
        await page.getByRole('button',{name:'Sign In',exact:true}).click();
        await page.waitForFunction(()=>window.WatchGuardPoc?.isInstalled());
        await page.getByText('My Media',{exact:true}).waitFor();
        await readiness.identity(page,fixture);
        readiness.timing(fixture,'settings-login',Date.now()-loginStarted);
        await page.goto(fixture.base+'/web/#/configurationpage?name=WatchGuard');
        await page.locator('#wgDays').waitFor();
        await page.waitForFunction(()=>document.querySelector('#wgDays')?.value==='30');
        if (fixture.standalone) { assert.equal(await page.locator('#wgCaughtUp').isChecked(),true); await page.getByText('Protect Caught Up series',{exact:true}).click(); }
        await page.locator('#wgDays').fill('17'); await page.locator('#wgLimit').fill('31');
        await saveSettings();
        await page.reload(); await page.waitForFunction(()=>document.querySelector('#wgDays')?.value==='17');
        assert.equal(await page.locator('#wgLimit').inputValue(),'31');
        if (fixture.standalone) { assert.equal(await page.locator('#wgCaughtUp').isChecked(),false); await page.getByText('Protect Caught Up series',{exact:true}).click(); await saveSettings(); }
        await page.waitForFunction(()=>window.WatchGuardPoc?.isInstalled());
        await refreshStatus();
        await page.getByText(fixture.standalone ? /Standalone loader active: true/ : /Server registration succeeded; browser unverified/).waitFor();
        await page.getByText(/This browser: adapter installed/).waitFor();
        if (fixture.standalone) {
            await page.locator('#wgIntegration').getByText('Authenticated script available to this browser now: true').waitFor();
            assert.equal(await page.locator('#wgIntegration').getByText('Authenticated script available to this browser now: true').count(),1,'status refresh must not duplicate availability lines');
            await page.route('**/WatchGuard/IntegrationStatus', async route => {
                const response=await route.fetch(), result=await response.json();
                result.Standalone.BuildId='different-server-build';
                await route.fulfill({response,json:result});
            });
            await refreshStatus();
            await page.locator('#wgBrowser').filter({hasText:/standalone build is stale, blocked or unavailable/}).waitFor();
            await page.unroute('**/WatchGuard/IntegrationStatus');
            await refreshStatus();
            await page.locator('#wgBrowser').filter({hasText:/This browser: adapter installed/}).waitFor();
        }
        await page.locator('#wgDays').fill('30'); await page.locator('#wgLimit').fill('100');
        await saveSettings();
        await page.goto(fixture.base+'/web/#/home?watchguard=watchlists&owner=all&interest=watched&sort=recent');
        const region = page.getByRole('region',{name:'Watchlists',exact:true});
        await page.waitForFunction(()=>document.querySelector('.watchguard-page')?.getAttribute('aria-busy')==='false');
        await region.locator('.watchguard-filter summary').click(); await region.getByRole('button',{name:'Save view as defaults'}).click();
        await region.getByText('View saved as your defaults.').waitFor();
        await page.goto(fixture.base+'/web/#/home'); await page.getByRole('link',{name:'Watchlists',exact:true}).click();
        await page.waitForFunction(()=>document.querySelector('.watchguard-page')?.getAttribute('data-watchguard-scope')==='all');
        assert.equal(await region.getByRole('combobox',{name:'Sort by'}).inputValue(),'recent');
        await region.locator('.watchguard-filter summary').click(); assert.equal(await region.getByRole('checkbox',{name:'Watched',exact:true}).isChecked(),true);
        assert.equal(await region.getByRole('checkbox',{name:'Watching',exact:true}).isChecked(),false);
        await page.reload(); await page.waitForFunction(()=>document.querySelector('.watchguard-page')?.getAttribute('data-watchguard-scope')==='all');
        await page.goto(fixture.base+'/web/#/home?watchguard=watchlists&owner=mine&interest=none&sort=title');
        await page.waitForFunction(()=>document.querySelector('.watchguard-page')?.getAttribute('data-watchguard-scope')==='mine');
        assert.equal(await region.getByRole('combobox',{name:'Sort by'}).inputValue(),'title');
        await region.locator('.watchguard-filter summary').click(); assert.equal(await region.locator('input:checked').count(),0);
        await region.getByRole('button',{name:'Reset to Defaults',exact:true}).click();
        await region.getByText('Defaults restored.').waitFor();
        await page.reload(); await page.waitForFunction(()=>document.querySelector('.watchguard-page')?.getAttribute('aria-busy')==='false');
        await region.locator('.watchguard-filter summary').click(); assert.equal(await region.locator('input:checked').count(),3);
        const report={result:'PASS',nativeConfiguration:true,settingsPersistence:true,serverAndBrowserStatus:true,saveDefaults:true,urlPrecedence:true,reset:true};
        fs.mkdirSync('artifacts',{recursive:true});fs.writeFileSync('artifacts/settings-validation.json',JSON.stringify(report,null,2)+'\n');
        console.log('Settings/preferences browser checks passed.');
    } catch (error) { await readiness.failure(page,{...fixture,output:fixture.reportDirectory},'settings',error).catch(()=>console.warn('Diagnostic capture failed')); throw error; }
    finally {await browser.close();}
})();
