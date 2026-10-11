/* Run only through docker-smoke.py, which owns a fresh server and synthetic media. */
const { chromium } = require('./browser/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fixture = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
assert.match(fixture.base, /^http:\/\/127\.0\.0\.1:\d+$/);
assert.equal(fixture.username, 'WatchGuardPoCTest');
const output = path.resolve('artifacts/poc'); fs.mkdirSync(output, { recursive: true });
const errorText = 'There was an error deleting the item from the server. Please check that Jellyfin has write access to the media folder and try again.';
const report = { target: 'Jellyfin 12.2', paths: [], diagnostics: [], deletes: [], orderingViolations: 0 };
(async () => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    let nativeCalls = 0;
    page.on('console', message => {
        const text = message.text();
        if (/^\[WatchGuard PoC\] [a-z-]+ \d+$/.test(text)) {
            report.diagnostics.push(text);
            if (text.includes(' native-called ')) nativeCalls++;
        }
    });
    page.on('request', request => {
        if (request.method() === 'DELETE' && /\/Items\//.test(new URL(request.url()).pathname)) {
            if (nativeCalls <= report.deletes.length) report.orderingViolations++;
            report.deletes.push({ path: new URL(request.url()).pathname, phase: report.phase });
        }
    });
    async function api(route, method = 'GET', body, token = fixture.token) {
        const response = await fetch(fixture.base + route, { method,
            headers: { Authorization: 'MediaBrowser Client="WatchGuardBrowser", Device="Disposable", DeviceId="browser-seed", Version="1", Token="' + token + '"', 'Content-Type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body) });
        assert.ok(response.ok, 'fixture API ' + method + ' ' + route + ': ' + response.status);
        return response.status === 204 ? undefined : response.json();
    }
    async function exists(id, expected = 200) {
        const response = await fetch(fixture.base + '/Items/' + id,
            { headers: { Authorization: 'MediaBrowser Token="' + fixture.token + '"' } });
        assert.equal(response.status, expected);
    }
    async function detail(title) {
        await page.goto('about:blank');
        await page.goto(fixture.base + '/web/#/details?id=' + fixture.items[title] + '&serverId=' + fixture.serverId);
        await page.locator('#itemDetailPage').getByText(title, {exact:true}).first().waitFor();
        await page.locator('#itemDetailPage .btnMoreCommands').waitFor();
        await page.waitForFunction(() => window.WatchGuardPoc?.isInstalled());
    }
    async function nativeDelete() {
        await page.locator('#itemDetailPage .btnMoreCommands').click();
        await page.getByText(/^Delete (?:media|series|episode|season)$/i).click();
    }
    async function nativeConfirm() {
        await page.getByRole('button', { name: /^Delete(?: \d+ Episodes)?$/ }).click();
    }
    function dialog() { return page.getByRole('dialog', { name: 'WatchGuard deletion confirmation' }); }
    async function cancel(title, escape = false) {
        const count = report.deletes.length;
        await dialog().waitFor();
        assert.equal(report.deletes.length, count);
        assert.match(await dialog().locator('p').innerText(), /BrowserMember — Watchlist/);
        await exists(fixture.items[title]);
        if (escape) await page.keyboard.press('Escape');
        else await dialog().getByRole('button', { name: 'Cancel', exact: true }).click();
        await page.getByText(errorText, { exact: true }).waitFor();
        assert.equal(report.deletes.length, count);
        await exists(fixture.items[title]);
        await page.screenshot({ path: path.join(output, 'native-cancel-error.png') });
        await page.getByRole('button', { name: 'Got It', exact: true }).click();
        await page.getByText(errorText, {exact:true}).waitFor({state:'hidden'});
    }
    async function approve(title) {
        const before = report.deletes.length;
        await dialog().waitFor(); await exists(fixture.items[title]);
        await page.screenshot({ path: path.join(output, 'watchguard-confirmation.png') });
        const response = page.waitForResponse(r => r.request().method() === 'DELETE' && new URL(r.url()).pathname.endsWith('/Items/' + fixture.items[title]));
        await dialog().getByRole('button', { name: 'Delete Anyway', exact: true }).click();
        assert.equal((await response).status(), 204);
        assert.equal(report.deletes.length, before + 1);
        await exists(fixture.items[title], 404);
    }
    async function movies() {
        await page.goto('about:blank');
        await page.goto(fixture.base + '/web/');
        await page.getByRole('link', { name: 'PoC Movies', exact: true }).first().click();
        await page.getByText('PoC Bulk One', { exact: true }).waitFor();
        await page.waitForFunction(() => window.WatchGuardPoc?.isInstalled());
    }
    function card(title) { return page.locator('.card[data-id="' + fixture.items[title] + '"]'); }
    try {
        await page.goto(fixture.base + '/web/');
        await page.locator('#txtManualName').fill(fixture.username);
        await page.locator('#txtManualPassword').fill(fixture.password);
        await page.getByRole('button', { name: 'Sign In', exact: true }).click();
        await page.waitForFunction(() => window.WatchGuardPoc?.isInstalled());
        await page.getByText('My Media', {exact:true}).waitFor();
        report.phase = 'Watchlist UI';
        const memberPassword = require('node:crypto').randomUUID();
        await api('/Users/New', 'POST', { Name: 'BrowserMember', Password: memberPassword });
        const member = await api('/Users/AuthenticateByName', 'POST', {Username:'BrowserMember', Pw:memberPassword});
        for (const title of ['PoC Movie Detail', 'PoC Series Detail', 'PoC Escape', 'PoC Context Movie', 'PoC Bulk One', 'PoC Bulk Two'])
            await api('/WatchGuard/Watchlist/' + fixture.items[title], 'PUT', undefined, member.AccessToken);
        report.phase = 'My Watchlist';
        await detail('PoC Movie Detail');
        const myList = () => page.getByRole('region',{name:'Watchlists',exact:true});
        await page.getByRole('link',{name:'Watchlists',exact:true}).click();
        await myList().getByText('Your watchlist is empty.',{exact:true}).waitFor();
        for (const title of ['PoC Movie Detail','PoC Series Detail']) await api('/WatchGuard/Watchlist/' + fixture.items[title],'PUT');
        await myList().getByRole('button',{name:'Refresh',exact:true}).click();
        await myList().getByRole('link',{name:'PoC Series Detail',exact:true}).waitFor();
        assert.equal(await myList().locator('.watchguard-card').count(),2);
        await page.waitForFunction(()=>Array.from(document.querySelectorAll('.watchguard-poster img')).some(img=>img.naturalWidth>0));
        await myList().getByRole('combobox',{name:'Watchlist owner'}).selectOption('all');
        await page.waitForFunction(()=>document.querySelectorAll('.watchguard-card').length===6);
        assert.equal(await myList().getByRole('link',{name:'PoC Movie Detail',exact:true}).count(),1);
        assert.match(await myList().innerText(),/BrowserMember/);
        assert.match(await myList().innerText(),/WatchGuardPoCTest/);
        await myList().getByRole('combobox',{name:'Watchlist owner'}).selectOption(member.User.Id.replaceAll('-',''));
        await page.waitForFunction(()=>document.querySelectorAll('.watchguard-card').length===6);
        await myList().getByRole('combobox',{name:'Watchlist owner'}).selectOption('mine');
        await page.waitForFunction(()=>document.querySelectorAll('.watchguard-card').length===2);
        await page.goBack();
        await page.waitForFunction(()=>document.querySelectorAll('.watchguard-card').length===6);
        await page.goForward();
        await page.waitForFunction(()=>document.querySelectorAll('.watchguard-card').length===2);
        await page.reload(); await myList().getByRole('link',{name:'PoC Series Detail',exact:true}).waitFor();
        await page.screenshot({path:path.join(output,'my-watchlist.png')});
        await page.route('**/WatchGuard/Watchlist/*', route => route.fulfill({status:503,body:'unavailable'}));
        await myList().getByRole('button',{name:'Remove PoC Movie Detail from Watchlist',exact:true}).click();
        await myList().getByRole('alert').filter({hasText:'Could not remove'}).waitFor();
        assert.equal(await myList().getByRole('link').count(),2);
        await page.unroute('**/WatchGuard/Watchlist/*');
        await myList().getByRole('button',{name:'Remove PoC Movie Detail from Watchlist',exact:true}).click();
        await myList().getByRole('link',{name:'PoC Movie Detail',exact:true}).waitFor({state:'hidden'});
        await myList().getByRole('link',{name:'PoC Series Detail',exact:true}).click();
        await page.locator('#itemDetailPage').getByText('PoC Series Detail',{exact:true}).first().waitFor();
        await page.getByRole('link',{name:'Watchlists',exact:true}).click();
        await myList().getByRole('button',{name:'Remove PoC Series Detail from Watchlist',exact:true}).click();
        await myList().getByText('Your watchlist is empty.',{exact:true}).waitFor();
        await page.route('**/WatchGuard/Watchlists', route => route.fulfill({status:503,body:'unavailable'}));
        await myList().getByRole('button',{name:'Refresh',exact:true}).click();
        await myList().getByRole('alert').filter({hasText:'Could not load'}).waitFor();
        await page.unroute('**/WatchGuard/Watchlists');
        await myList().getByRole('button',{name:'Refresh',exact:true}).click();
        await myList().getByText('Your watchlist is empty.',{exact:true}).waitFor();
        await page.goBack();
        report.paths.push({path:'My Watchlist',result:'empty/list, movie and series links, removal, failed removal/load and refresh recovery passed'});
        report.paths.push({path:'Modern compatibility',result:'12.2 modern React application routes /details to the legacy itemDetailPage; one placement path verified, no separate React details route exists in inspected source'});
        report.phase = 'Watchlist UI';
        await detail('PoC Movie Detail');
        await page.getByRole('button', { name:'Add to Watchlist', exact:true }).click();
        await page.getByRole('button', { name:'Remove from Watchlist', exact:true }).waitFor();
        assert.equal(await page.locator('.mainDetailButtons > .watchguard-toggle').count(),1);
        assert.equal(await page.locator('.mainDetailButtons + .watchguard-controls').count(),1);
        await page.reload();
        await page.getByRole('button', { name:'Remove from Watchlist', exact:true }).waitFor();
        await page.locator('.watchguard-interest').filter({hasText:'BrowserMember — Watchlist'}).waitFor();
        const nativeState = await api('/UserItems/' + fixture.items['PoC Movie Detail'] + '/UserData');
        assert.equal(nativeState.IsFavorite,false,'Watchlist must not change Favorites');
        const actionsBox = await page.locator('.mainDetailButtons').boundingBox();
        const interestBox = await page.locator('.watchguard-interest').boundingBox();
        assert.ok(interestBox.y >= actionsBox.y + actionsBox.height,'interest must be below action row');
        await page.screenshot({path:path.join(output,'watchlist-detail.png')});
        await page.getByRole('button', { name:'Remove from Watchlist', exact:true }).click();
        await page.getByRole('button', { name:'Add to Watchlist', exact:true }).waitFor();
        // Failed mutation leaves the existing state intact and surfaces a useful error.
        await page.route('**/WatchGuard/Watchlist/*', route => route.fulfill({status:503,body:'unavailable'}));
        await page.getByRole('button', { name:'Add to Watchlist', exact:true }).click();
        await page.getByRole('alert').filter({hasText:'Could not update'}).waitFor();
        await page.unroute('**/WatchGuard/Watchlist/*');
        // SPA navigation and browser history, without forcing reload.
        await page.evaluate(id => { location.hash = '/details?id=' + id; }, fixture.items['PoC Series Detail']);
        await page.getByRole('button', {name:'Add to Watchlist',exact:true}).waitFor();
        await page.locator('#itemDetailPage').getByText('PoC Series Detail',{exact:true}).first().waitFor();
        await page.waitForTimeout(600);
        await page.getByRole('button',{name:'Add to Watchlist',exact:true}).click();
        await page.getByRole('button',{name:'Remove from Watchlist',exact:true}).waitFor();
        assert.ok((await api('/WatchGuard/Watchlist')).some(e => e.ItemId.replaceAll('-', '') === fixture.items['PoC Series Detail'].replaceAll('-', '')));
        await page.getByRole('button',{name:'Remove from Watchlist',exact:true}).click();
        await page.getByRole('button',{name:'Add to Watchlist',exact:true}).waitFor();
        assert.equal(await page.locator('.watchguard-controls').count(),1);
        await page.goBack(); await page.getByRole('button', {name:'Add to Watchlist',exact:true}).waitFor();
        await page.goForward(); await page.getByRole('button', {name:'Add to Watchlist',exact:true}).waitFor();
        assert.equal(await page.locator('.watchguard-controls').count(),1);
        // A normal user gets their own controls but no cross-user protection requests.
        const memberContext = await browser.newContext(); const memberPage = await memberContext.newPage();
        let protectionRequests = 0;
        memberPage.on('request', r => { if (/\/WatchGuard\/(?:Protection\/|Watchlists(?:\?|$))/.test(r.url())) protectionRequests++; });
        await memberPage.goto(fixture.base + '/web/');
        await memberPage.locator('#txtManualName').fill('BrowserMember');
        await memberPage.locator('#txtManualPassword').fill(memberPassword);
        await memberPage.getByRole('button',{name:'Sign In',exact:true}).click();
        await memberPage.getByText('My Media',{exact:true}).waitFor();
        await memberPage.goto(fixture.base + '/web/#/details?id=' + fixture.items['PoC Movie Detail']);
        await memberPage.getByRole('button',{name:'Remove from Watchlist',exact:true}).waitFor();
        await memberPage.waitForTimeout(600);
        assert.equal(await memberPage.locator('.watchguard-interest').innerText(),'');
        await memberPage.getByRole('link',{name:'Watchlists',exact:true}).click();
        await memberPage.getByRole('region',{name:'Watchlists'}).getByRole('link',{name:'PoC Movie Detail',exact:true}).waitFor();
        assert.equal(await memberPage.getByRole('combobox',{name:'Watchlist owner'}).isVisible(),false);
        assert.equal(await memberPage.locator('.watchguard-owners').count(),0);
        await memberPage.evaluate(()=>{location.hash='/home?watchguard=watchlists&owner=all';});
        await memberPage.getByRole('region',{name:'Watchlists'}).getByRole('link',{name:'PoC Movie Detail',exact:true}).waitFor();
        assert.equal(await memberPage.locator('.watchguard-owners').count(),0);
        assert.equal(protectionRequests,0); await memberContext.close();
        report.paths.push({path:'Watchlist controls',result:'add/remove, reload persistence, mutation failure, admin indicator, private normal-user UI, SPA back/forward passed'});
        report.phase = 'Failed protection';
        await detail('PoC Modern Movie');
        await page.route('**/WatchGuard/Protection/*', route => route.fulfill({status:503,body:'unavailable'}));
        const beforeFailure = report.deletes.length;
        await nativeDelete(); await nativeConfirm();
        await dialog().getByText(/Interest could not be checked/).waitFor();
        assert.equal(await dialog().getByRole('button',{name:'Delete Anyway',exact:true}).count(),0);
        await dialog().getByRole('button',{name:'Cancel',exact:true}).click();
        await page.getByRole('button',{name:'Got It',exact:true}).click();
        assert.equal(report.deletes.length,beforeFailure); await exists(fixture.items['PoC Modern Movie']);
        await page.unroute('**/WatchGuard/Protection/*');
        for (const title of ['PoC Zero', 'PoC Self']) {
            report.phase = title; await detail(title);
            if (title === 'PoC Self') {
                await page.getByRole('button',{name:'Add to Watchlist',exact:true}).click();
                await page.getByRole('button',{name:'Remove from Watchlist',exact:true}).waitFor();
            }
            const response = page.waitForResponse(r => r.request().method()==='DELETE' && new URL(r.url()).pathname.endsWith('/Items/' + fixture.items[title]));
            await nativeDelete(); await nativeConfirm(); assert.equal((await response).status(),204);
            assert.equal(await dialog().count(),0); await exists(fixture.items[title],404);
            report.paths.push({path:title,result:'native deletion without extra WatchGuard warning'});
        }
        // Use the source-verified saved layout preference; never inject a replacement adapter.
        for (const [layout,title] of [['desktop-legacy','PoC Layout Legacy'],['modern','PoC Layout Modern']]) {
            report.phase = layout;
            await api('/WatchGuard/Watchlist/' + fixture.items[title],'PUT',undefined,member.AccessToken);
            await page.evaluate(mode=>localStorage.setItem('layout',mode),layout);
            await detail(title);
            assert.equal(await page.locator('.skinHeader').isVisible(),layout==='desktop-legacy');
            await page.getByRole('button',{name:'Add to Watchlist',exact:true}).waitFor();
            assert.equal(await page.locator('.mainDetailButtons > .watchguard-toggle').count(),1);
            await page.getByRole('button',{name:'Add to Watchlist',exact:true}).click();
            await page.getByRole('button',{name:'Remove from Watchlist',exact:true}).waitFor();
            await page.getByRole('link',{name:'Watchlists',exact:true}).click();
            await myList().getByRole('link',{name:title,exact:true}).waitFor();
            await page.goBack();
            await page.getByRole('button',{name:'Remove from Watchlist',exact:true}).click();
            await page.getByRole('button',{name:'Add to Watchlist',exact:true}).waitFor();
            await nativeDelete(); await nativeConfirm(); await cancel(title);
            await nativeDelete(); await nativeConfirm(); await approve(title);
            report.paths.push({path:'Explicit ' + layout,result:'correct shell verified; shared legacy detail controls/list and native cancel/override passed'});
        }
        await page.evaluate(()=>localStorage.removeItem('layout'));
        // Real episode/season targets: retain the original native deletion ID.
        for (const interested of [true,false]) {
            const parentTitle = interested ? 'PoC Parent Interested' : 'PoC Parent Clear';
            const parentId = fixture.items[parentTitle];
            if (interested) await api('/WatchGuard/Watchlist/' + parentId,'PUT',undefined,member.AccessToken);
            const children = (await api('/Items?ParentId=' + parentId + '&Recursive=true&IncludeItemTypes=Episode,Season')).Items;
            const targets = [children.find(i=>i.Type==='Episode' && i.ParentIndexNumber===1 && i.IndexNumber===1),
                children.find(i=>i.Type==='Season' && i.IndexNumber===2)];
            assert.ok(targets.every(Boolean),'fixture episode and season must exist');
            for (const target of targets) {
                const label = parentTitle + ' ' + target.Type; fixture.items[label] = target.Id;
                report.phase = label;
                await page.goto('about:blank');
                await page.goto(fixture.base + '/web/#/details?id=' + target.Id + '&serverId=' + fixture.serverId);
                await page.locator('#itemDetailPage .btnMoreCommands').waitFor();
                await page.waitForFunction(()=>window.WatchGuardPoc?.isInstalled());
                await page.getByRole('button',{name:'Add to Watchlist',exact:true}).waitFor();
                await page.locator('.watchguard-interest').filter({hasText:'Series: ' + parentTitle}).waitFor();
                if (interested) await page.locator('.watchguard-interest').filter({hasText:'BrowserMember — Watchlist'}).waitFor();
                await page.getByRole('button',{name:'Add to Watchlist',exact:true}).click();
                await page.getByRole('button',{name:'Remove from Watchlist',exact:true}).waitFor();
                const own = await api('/WatchGuard/Watchlist');
                assert.ok(own.some(e=>e.ItemId.replaceAll('-','')===parentId.replaceAll('-','')));
                assert.ok(!own.some(e=>e.ItemId.replaceAll('-','')===target.Id.replaceAll('-','')));
                await page.getByRole('button',{name:'Remove from Watchlist',exact:true}).click();
                await page.getByRole('button',{name:'Add to Watchlist',exact:true}).waitFor();
                if (interested && target.Type==='Episode') {
                    const parentRoute = url => url.pathname.endsWith('/' + parentId);
                    await page.route(parentRoute, route=>route.fulfill({status:404,body:'missing parent'}));
                    const before = report.deletes.length;
                    await nativeDelete(); await nativeConfirm();
                    await dialog().getByText(/Interest could not be checked/).waitFor();
                    assert.equal(await dialog().getByRole('button',{name:'Delete Anyway',exact:true}).count(),0);
                    await dialog().getByRole('button',{name:'Cancel',exact:true}).click();
                    await page.getByRole('button',{name:'Got It',exact:true}).click();
                    assert.equal(report.deletes.length,before); await exists(target.Id);
                    await page.unroute(parentRoute);
                    report.paths.push({path:'Missing parent resolution',result:'404 blocks deletion with zero DELETE requests'});
                }
                if (interested) {
                    await nativeDelete(); await nativeConfirm();
                    await dialog().waitFor();
                    assert.ok((await dialog().innerText()).includes('Deleting ' + target.Type.toLowerCase() + ': ' + target.Name));
                    assert.ok((await dialog().innerText()).includes('parent series: ' + parentTitle));
                    await page.screenshot({path:path.join(output,'parent-' + target.Type + '-warning.png')});
                    await cancel(label);
                    await nativeDelete(); await nativeConfirm(); await approve(label);
                } else {
                    const response = page.waitForResponse(r=>r.request().method()==='DELETE' && new URL(r.url()).pathname.endsWith('/Items/' + target.Id));
                    await nativeDelete(); await nativeConfirm(); assert.equal((await response).status(),204);
                    assert.equal(await dialog().count(),0); await exists(target.Id,404);
                }
                await exists(parentId);
                report.paths.push({path:label,result:interested?'parent interest labelled; Cancel zero DELETE; override deletes target once, parent survives':'confirmed clear parent; no extra warning; target deleted once, parent survives'});
            }
        }
        for (const title of ['PoC Movie Detail', 'PoC Series Detail']) {
            report.phase = title;
            await detail(title); await nativeDelete();
            const count = report.deletes.length; await nativeConfirm(); await cancel(title);
            assert.equal(report.deletes.length, count);
            await nativeDelete(); await nativeConfirm(); await approve(title);
            report.paths.push({ path: title, cancel: 'zero DELETE', override: 'one DELETE, HTTP 204', genericErrorOnCancel: true });
        }
        report.phase = 'Escape';
        await detail('PoC Escape'); await nativeDelete(); await nativeConfirm(); await cancel('PoC Escape', true);
        report.paths.push({ path: 'Escape on movie detail', cancel: 'zero DELETE', genericErrorOnCancel: true });
        report.phase = 'Card context menu';
        await movies(); await card('PoC Context Movie').click({ button: 'right' });
        await page.getByText(/^Delete (?:media|series|episode|season)$/i).click(); await nativeConfirm(); await cancel('PoC Context Movie');
        await card('PoC Context Movie').click({ button: 'right' });
        await page.getByText(/^Delete (?:media|series|episode|season)$/i).click(); await nativeConfirm(); await approve('PoC Context Movie');
        report.paths.push({ path: 'Card right-click menu', cancel: 'zero DELETE', override: 'one DELETE, HTTP 204', genericErrorOnCancel: true });
        async function selectBulk() {
            await movies(); await card('PoC Bulk One').click({button:'right'});
            await page.getByText('Select',{exact:true}).click();
            await card('PoC Bulk Two').locator('.itemSelectionPanel').click({position:{x:70,y:70}});
            await page.locator('.itemSelectionCount').filter({hasText:'2'}).waitFor();
            await page.locator('.btnSelectionPanelOptions').click();
            await page.getByText('Delete',{exact:true}).click();
            await page.getByRole('button',{name:'OK',exact:true}).click();
        }
        report.phase = 'Bulk cancel';
        const beforeBulk = report.deletes.length;
        await selectBulk();
        for (let i=0;i<2;i++) {
            await dialog().waitFor();
            assert.equal(report.deletes.length,beforeBulk);
            await dialog().getByRole('button',{name:'Cancel',exact:true}).click();
        }
        await page.getByText(errorText,{exact:true}).waitFor();
        assert.equal(report.deletes.length,beforeBulk);
        await exists(fixture.items['PoC Bulk One']); await exists(fixture.items['PoC Bulk Two']);
        await page.getByRole('button',{name:'Got It',exact:true}).click();
        await page.getByText(errorText,{exact:true}).waitFor({state:'hidden'});
        report.phase = 'Bulk override';
        await selectBulk(); await approve('PoC Bulk One'); await approve('PoC Bulk Two');
        assert.equal(report.deletes.length,beforeBulk+2);
        report.paths.push({path:'Native two-item bulk selection',cancel:'zero DELETE after cancelling both prompts',override:'one DELETE per approved item, HTTP 204',genericErrorOnCancel:true});
        assert.equal(report.diagnostics.filter(e=>e.includes(' native-called ')).length,report.deletes.length);
        assert.equal(report.diagnostics.filter(e=>e.includes(' override ') || e.includes(' clear ')).length,report.deletes.length);
        assert.equal(report.orderingViolations,0,'DELETE was observed without a preceding native-called diagnostic');
        report.phase = 'Sign out privacy';
        await detail('PoC Modern Movie');
        await page.getByRole('link',{name:'Watchlists',exact:true}).click();
        await myList().getByRole('combobox',{name:'Watchlist owner'}).selectOption('all');
        await myList().locator('.watchguard-owners').first().waitFor();
        await page.getByRole('button',{name:'User menu',exact:false}).click();
        await page.locator('#app-user-menu').getByText('Sign Out',{exact:true}).click();
        await page.waitForFunction(() => !document.querySelector('.watchguard-controls') && !document.querySelector('.watchguard-nav') && !document.querySelector('.watchguard-page'));
        // Switch accounts through the normal manual-login page in the same browser context.
        await page.waitForURL('**/#/login'); // Canonical 12.2 route; login.html creates duplicate compatibility views.
        await page.locator('#txtManualName').fill('BrowserMember');
        await page.locator('#txtManualPassword').fill(memberPassword);
        await page.getByRole('button',{name:'Sign In',exact:true}).click();
        await page.getByText('My Media',{exact:true}).waitFor();
        await detail('PoC Modern Movie');
        await page.getByRole('button',{name:'Add to Watchlist',exact:true}).waitFor();
        assert.equal(await page.locator('.watchguard-interest').innerText(),'');
        report.paths.push({path:'Account switch',result:'old controls removed on sign-out; normal-user detail has no cross-user indicator'});
        await page.getByRole('link',{name:'Watchlists',exact:true}).click();
        await myList().getByRole('link',{name:'PoC Parent Interested',exact:true}).waitFor();
        assert.equal(await myList().getByRole('link',{name:'PoC Self',exact:true}).count(),0);
        assert.equal(await myList().locator('.watchguard-owners').count(),0);
        assert.equal(await myList().getByRole('combobox').isVisible(),false);
        await page.goBack();
        const policy = {...member.User.Policy, EnableContentDeletion:true};
        await api('/Users/' + member.User.Id + '/Policy','POST',policy);
        await page.reload(); await page.locator('#itemDetailPage .btnMoreCommands').waitFor();
        report.phase = 'Non-admin deletion permission';
        const beforeDenied = report.deletes.length;
        await nativeDelete(); await nativeConfirm();
        await dialog().getByText(/Interest could not be checked/).waitFor();
        assert.equal(await dialog().getByRole('button',{name:'Delete Anyway',exact:true}).count(),0);
        await dialog().getByRole('button',{name:'Cancel',exact:true}).click();
        await page.getByRole('button',{name:'Got It',exact:true}).click();
        assert.equal(report.deletes.length,beforeDenied);
        report.paths.push({path:'Account isolation and native permissions',result:'My Watchlist belongs to switched user; native non-admin deletion right preserved, cross-user check denied with zero DELETE'});
        report.result='PASS';
        console.log('PASS: native movie/series details, right-click menu, Escape, and bulk selection; fresh interest check precedes every observed DELETE.');
        fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    } catch (error) {
        console.log('Failed phase:', report.phase);
        console.log(await page.locator('body').innerText());
        fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
        await page.screenshot({path:path.join(output,'failure.png')});
        throw error;
    } finally { await browser.close(); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
