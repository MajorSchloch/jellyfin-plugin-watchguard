/* Disposable fixture only: native dashboard settings and server-side personal defaults. */
const {chromium} = require('./browser/node_modules/playwright');
const fs = require('node:fs'), assert = require('node:assert/strict');
const fixture = JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
assert.match(fixture.base,/^http:\/\/127\.0\.0\.1:\d+$/); assert.equal(fixture.username,'WatchGuardPoCTest');
(async () => {
    const browser = await chromium.launch({headless:true});
    const page = await browser.newPage(); page.setDefaultTimeout(12000);
    try {
        await page.goto(fixture.base+'/web/');
        await page.locator('#txtManualName').fill(fixture.username); await page.locator('#txtManualPassword').fill(fixture.password);
        await page.getByRole('button',{name:'Sign In',exact:true}).click();
        await page.waitForFunction(()=>window.WatchGuardPoc?.isInstalled());
        await page.getByText('My Media',{exact:true}).waitFor();
        await page.goto(fixture.base+'/web/#/configurationpage?name=WatchGuard');
        await page.locator('#wgDays').waitFor();
        await page.waitForFunction(()=>document.querySelector('#wgDays')?.value==='30');
        await page.locator('#wgDays').fill('17'); await page.locator('#wgLimit').fill('31');
        await page.getByRole('button',{name:'Save',exact:true}).click();
        await page.getByText(/^Saved\. Activity settings/).waitFor();
        await page.reload(); await page.waitForFunction(()=>document.querySelector('#wgDays')?.value==='17');
        assert.equal(await page.locator('#wgLimit').inputValue(),'31');
        await page.waitForFunction(()=>window.WatchGuardPoc?.isInstalled());
        await page.getByRole('button',{name:'Refresh status and check this browser'}).click();
        await page.getByText(/Server registration succeeded; browser unverified/).waitFor();
        await page.getByText(/This browser: adapter installed/).waitFor();
        await page.locator('#wgDays').fill('30'); await page.locator('#wgLimit').fill('100');
        await page.getByRole('button',{name:'Save',exact:true}).click(); await page.getByText(/^Saved\. Activity settings/).waitFor();
        await page.goto(fixture.base+'/web/#/home?watchguard=watchlists&owner=all&interest=watched&sort=recent');
        const region = page.getByRole('region',{name:'Watchlists',exact:true});
        await page.waitForFunction(()=>document.querySelector('.watchguard-page')?.getAttribute('aria-busy')==='false');
        await region.locator('summary').click(); await region.getByRole('button',{name:'Save view as defaults'}).click();
        await region.getByText('View saved as your defaults.').waitFor();
        await page.goto(fixture.base+'/web/#/home'); await page.getByRole('link',{name:'Watchlists',exact:true}).click();
        await page.waitForFunction(()=>document.querySelector('.watchguard-page')?.getAttribute('data-watchguard-scope')==='all');
        assert.equal(await region.getByRole('combobox',{name:'Sort by'}).inputValue(),'recent');
        await region.locator('summary').click(); assert.equal(await region.getByRole('checkbox',{name:'Watched',exact:true}).isChecked(),true);
        assert.equal(await region.getByRole('checkbox',{name:'Watching',exact:true}).isChecked(),false);
        await page.reload(); await page.waitForFunction(()=>document.querySelector('.watchguard-page')?.getAttribute('data-watchguard-scope')==='all');
        await page.goto(fixture.base+'/web/#/home?watchguard=watchlists&owner=mine&interest=none&sort=title');
        await page.waitForFunction(()=>document.querySelector('.watchguard-page')?.getAttribute('data-watchguard-scope')==='mine');
        assert.equal(await region.getByRole('combobox',{name:'Sort by'}).inputValue(),'title');
        await region.locator('summary').click(); assert.equal(await region.locator('input:checked').count(),0);
        await region.getByRole('button',{name:'Reset to Defaults',exact:true}).click();
        await region.getByText('Defaults restored.').waitFor();
        await page.reload(); await page.waitForFunction(()=>document.querySelector('.watchguard-page')?.getAttribute('aria-busy')==='false');
        await region.locator('summary').click(); assert.equal(await region.locator('input:checked').count(),3);
        const report={result:'PASS',nativeConfiguration:true,settingsPersistence:true,serverAndBrowserStatus:true,saveDefaults:true,urlPrecedence:true,reset:true};
        fs.mkdirSync('artifacts',{recursive:true});fs.writeFileSync('artifacts/settings-validation.json',JSON.stringify(report,null,2)+'\n');
        console.log('Settings/preferences browser checks passed.');
    } catch (error) { console.error('Settings phase URL:', new URL(page.url()).hash); console.error((await page.locator('body').innerText()).slice(0,2000)); await page.screenshot({path:'artifacts/settings-failure.png'}); throw error; }
    finally {await browser.close();}
})();
