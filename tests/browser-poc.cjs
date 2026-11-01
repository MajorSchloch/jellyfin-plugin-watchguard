const setNativeCheckbox=require('./native-checkbox.cjs');
const readiness = require('./browser-readiness.cjs');
const removalContract = require('./removal-feedback-contract.cjs');
/* Run only through docker-smoke.py, which owns a fresh server and synthetic media. */
const { chromium } = require('./browser/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fixture = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
assert.match(fixture.base, /^https?:\/\/(?:127\.0\.0\.1|localhost):\d+(?:\/jellyfin)?$/);
assert.equal(fixture.username, 'WatchGuardPoCTest');
const output = path.resolve(fixture.reportDirectory || 'artifacts/poc'); fs.mkdirSync(output, { recursive: true });
const errorText = 'There was an error deleting the item from the server. Please check that Jellyfin has write access to the media folder and try again.';
const mineActivity = fixture.activityIndex ? '**/WatchGuard/ActivityBrowser?owner=mine&*' : '**/WatchGuard/ActivityOverview/Me';
const allActivity = fixture.activityIndex ? '**/WatchGuard/ActivityBrowser?owner=all&*' : '**/WatchGuard/ActivityOverview';
const candidateVersion=/<Version>([^<]+)<\/Version>/.exec(fs.readFileSync(path.resolve(__dirname,'../Directory.Build.props'),'utf8'))[1];
const report = { deployedPackage:fixture.deployedPackage, knownLimitations:[], target: 'Jellyfin '+fixture.serverVersion, paths: [], diagnostics: [], deletes: [], orderingViolations: 0 };
(async () => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ ignoreHTTPSErrors: fixture.tls === true, viewport: { width: 1280, height: 900 }, locale: 'en-US' });
    const page = await context.newPage();
    await readiness.capture(page);
    // Keep the trigger/attachment boundary when a native menu assertion fails.
    // Record only structural state: no URLs, item/user IDs, tokens or responses.
    const menuEvents=[];
    await page.exposeFunction('watchguardFixtureMenuEvent', event => {
        if (report.phase !== 'Native membership actions') return;
        menuEvents.push(event);
        if (menuEvents.length > 64) menuEvents.shift();
    });
    await page.addInitScript(() => {
        let source, route, api, user, token;
        const record=(type,element) => window.watchguardFixtureMenuEvent({
            type, at:performance.timeOrigin+performance.now(),
            sourceConnected:source?.isConnected ?? null,
            sameRoute:route === location.hash,
            sameCaller:!!api && window.ApiClient === api && api.getCurrentUserId() === user && api.accessToken() === token,
            sourceType:source?.dataset.type || null,
            sourceHasServer:!!source?.dataset.serverid,
            sheets:document.querySelectorAll('.actionSheet.opened').length,
            commands:document.querySelectorAll('.actionSheet.opened .watchguard-native-action').length,
            dialogConnected:element?.isConnected ?? null
        });
        document.addEventListener('contextmenu',event => {
            source=event.target.closest?.('.card[data-id]');route=location.hash;
            api=window.ApiClient;user=api?.getCurrentUserId?.();token=api?.accessToken?.();
            if(source)record('contextmenu',source);
        },true);
        document.addEventListener('open',event => {
            if(!event.target.matches?.('.actionSheet'))return;
            const sheet=event.target;record('open',sheet);
            sheet.addEventListener('close',()=>record('close',sheet),{once:true});
            const observer=new MutationObserver(()=>record('menu-mutation',sheet));
            observer.observe(sheet,{childList:true,subtree:true});
            sheet.addEventListener('close',()=>observer.disconnect(),{once:true});
        },true);
        window.addEventListener('hashchange',()=>record('hashchange'));
    });
    // Capture native Jellyfin exceptions that can prevent getCommands() from revealing More.
    const nativeErrors = [];
    page.on('pageerror', err => {
        const message = String(err.message || err).replace(/[A-Za-z0-9_-]{32,}/g,'[IDENTIFIER]').slice(0,600);
        nativeErrors.push('pageerror: ' + message);
    });
    page.on('console', message => {
        if (message.type() === 'error') {
            nativeErrors.push('console: ' + message.text().replace(/[A-Za-z0-9_-]{32,}/g,'[IDENTIFIER]').slice(0,600));
        }
    });
    page.setDefaultTimeout(10000);
    let nativeCalls = 0; let holdDiscovery = false;
    page.on('console', message => {
        const text = message.text();
        if (/^\[WatchGuard PoC\] [a-z-]+ \d+(?:\/jellyfin)?$/.test(text)) {
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
        const result = response.status === 204 ? undefined : await response.json();
        if (fixture.activityIndex && method === 'POST' && /^\/(?:UserItems|Items)\//.test(route)) {
            const deadline = Date.now() + 90000;
            let state;
            do {
                state = await api('/WatchGuard/ActivityIndex/Status?owner=all');
                if (state.Freshness.DiscoveryFinished && state.Freshness.Pending === 0 && state.Freshness.Stored === state.Freshness.Validated) break;
                if (Date.now() >= deadline) throw new Error('Activity index did not settle: ' + JSON.stringify(state.Freshness));
                await new Promise(resolve => setTimeout(resolve, 250));
            } while (true);
        }
        return result;
    }
    async function exists(id, expected = 200) {
        const response = await fetch(fixture.base + '/Items/' + id,
            { headers: { Authorization: 'MediaBrowser Token="' + fixture.token + '"' } });
        assert.equal(response.status, expected);
    }
    async function detail(title) {
        await page.goto(fixture.base + '/web/#/details?id=' + fixture.items[title] + '&serverId=' + fixture.serverId);
        await page.locator('#itemDetailPage:visible').getByText(title, {exact:true}).first().waitFor();
        const more = page.locator('#itemDetailPage:visible .btnMoreCommands:visible');
        // Native UI contract: no hidden clicks or reload that erases a first failure.
        await more.waitFor({state:'visible',timeout:15000});
        await page.waitForFunction(() => window.WatchGuardPoc?.isInstalled());
    }
    async function openInterest() {
        await page.waitForFunction(() => {
            const node = document.querySelector('#itemDetailPage:not(.hide) .watchguard-interest');
            return node && node.getAttribute('aria-busy') === 'false';
        });
        const panel=page.locator('#itemDetailPage:not(.hide) .watchguard-series-activity');
        if(await panel.count() && !(await panel.getAttribute('open') !== null)) await panel.locator('summary').click();
    }
    async function selectOwner(owner) {
        await page.getByRole('combobox',{name:'Watchlist owner'}).selectOption(owner);
        await page.waitForFunction(scope=>document.querySelector('.watchguard-page')?.getAttribute('data-watchguard-scope')===scope && document.querySelector('.watchguard-refresh')?.matches(':not(:disabled):not([aria-disabled="true"])'),owner);
    }
    async function setStatuses(value) {
        const selected = Array.isArray(value) ? value : value === 'all' ? ['watchlisted','watching','playing','watched'] : value === 'watching' ? ['watching','playing'] : [value];
        const filter=page.locator('.watchguard-filter');
        if (!await filter.evaluate(e=>e.open)) await filter.locator('summary').click();
        for(const [id,label] of [['watchlisted','Watchlisted'],['watching','Watching'],['playing','Currently Playing'],['watched','Watched']]) {
            const checkbox=filter.getByRole('checkbox',{name:label,exact:true});
            if(await checkbox.isChecked()===selected.includes(id)) continue;
            await setNativeCheckbox(checkbox,selected.includes(id));
            await page.waitForFunction(({id,checked})=>new URLSearchParams(location.hash.split('?')[1]).get('interest')?.split(',').includes(id)===checked,{id,checked:selected.includes(id)});
            await page.waitForFunction(()=>document.querySelector('.watchguard-filter summary').title==='Status filters ('+new URLSearchParams(location.hash.split('?')[1]).get('interest').split(',').filter(s=>s!=='none').length+' selected)');
        }
        await filter.getByRole('checkbox',{name:'Watched',exact:true}).press('Escape');
        if (fixture.activityIndex && !holdDiscovery) await page.waitForFunction(()=>document.querySelector('.watchguard-page')?.getAttribute('aria-busy')==='false');
    }
    let pendingNativeReturn=null;
    async function nativeReturned() {
        if(!pendingNativeReturn)return; // Poster menus/bulk do not use the detail controller redirect.
        await page.waitForFunction(expected=>{
            const view=window.wgFixtureView;
            const key=value=>String(value||'').replaceAll('-','').toLowerCase();
            return view && view.serial>expected.serial && (expected.parent
                ? key(view.id)===key(expected.parent)||key(view.parentId)===key(expected.parent)||key(view.topParentId)===key(expected.parent)
                : view.route==='#/home');
        },pendingNativeReturn);
        pendingNativeReturn=null;
    }
    async function nativeDelete() {
        const id=new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('id');
        const item=await api('/Items/'+id);
        pendingNativeReturn={serial:await page.evaluate(()=>window.wgFixtureView.serial),parent:item.SeasonId||item.SeriesId||item.ParentId||null};
        await page.locator('#itemDetailPage:visible .btnMoreCommands:visible').click();
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
        assert.match(await dialog().innerText(), title === 'PoC Self' && fixture.standalone ? /This title is on your watchlist|You haven't finished watching this title|You are currently playing this title/ : fixture.standalone ? /BrowserMember[\s\S]*Watchlisted/ : /BrowserMember — Watchlist/);
        await exists(fixture.items[title]);
        if (escape === 'close') await dialog().evaluate(node=>node.close());
        else if (escape) await page.keyboard.press('Escape');
        else await dialog().getByRole('button', { name: 'Cancel', exact: true }).click();
        await page.getByText(errorText, { exact: true }).waitFor();
        assert.equal(report.deletes.length, count);
        await exists(fixture.items[title]);
        await page.screenshot({ path: path.join(output, 'native-cancel-error.png') });
        await page.getByRole('button', { name: 'Got It', exact: true }).click();
        await page.getByText(errorText, {exact:true}).waitFor({state:'hidden'});
        pendingNativeReturn=null;
    }
    async function approve(title) {
        const before = report.deletes.length;
        await dialog().waitFor(); await exists(fixture.items[title]);
        await page.screenshot({ path: path.join(output, 'watchguard-confirmation.png') });
        const response = page.waitForResponse(r => r.request().method() === 'DELETE' && new URL(r.url()).pathname.endsWith('/Items/' + fixture.items[title]));
        if (fixture.standalone && title === 'PoC Self') {
            assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Cancel');
            await page.keyboard.press('Tab');
            assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Delete Anyway');
            await page.keyboard.press('Enter');
        } else await dialog().getByRole('button', { name: 'Delete Anyway', exact: true }).click();
        assert.equal((await response).status(), 204);
        assert.equal(report.deletes.length, before + 1);
        await exists(fixture.items[title], 404);
        await nativeReturned();
    }
    async function applyLayout(layout) {
        await page.evaluate(mode=>mode ? localStorage.setItem('layout',mode) : localStorage.removeItem('layout'),layout);
        // Layout is selected at application bootstrap, not on a hash route change.
        // This is explicit configuration setup, never a retry of an operation.
        await page.goto(fixture.base+'/web/#/home');
        await page.reload();
        await page.getByText('My Media',{exact:true}).waitFor();
        await page.waitForFunction(()=>window.WatchGuardPoc?.isInstalled());
    }
    async function movies() {
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
        const loginStarted = Date.now();
        await page.getByRole('button', { name: 'Sign In', exact: true }).click();
        await page.waitForFunction(() => window.WatchGuardPoc?.isInstalled());
        report.loginToAdapterMs = Date.now() - loginStarted;
        await page.getByText('My Media', {exact:true}).waitFor();
        await readiness.identity(page,fixture);
        readiness.timing(fixture,'native-login',Date.now()-loginStarted);
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
        // The new account can start background discovery. Verify that an open
        // page picks up completion on its documented 30-second poll; ten seconds
        // would incorrectly demand a false empty state during population.
        await page.waitForFunction(()=>{const page=document.querySelector('.watchguard-page');return ['empty','populating'].includes(page?.dataset.viewState) || (!page?.dataset.viewState && page?.innerText.includes('No matching activity in this overview.'));},{},{timeout:45000});
        for (const title of ['PoC Movie Detail','PoC Series Detail']) await api('/WatchGuard/Watchlist/' + fixture.items[title],'PUT');
        let releaseDiscovery; holdDiscovery = true; const discoveryReleases = [];
        let overviewRequests = 0;
        const countOverview = r => { if (/\/WatchGuard\/(?:Watchlist|Watchlists|ActivityOverview|ActivityIndex|ActivityBrowser)(?:\/Me)?(?:\?|$)/.test(r.url())) overviewRequests++; };
        page.on('request', countOverview);
        await page.route(mineActivity, async route => {
            if (holdDiscovery) await new Promise(resolve => { releaseDiscovery = resolve; discoveryReleases.push(resolve); }); await route.continue();
        });
        await myList().getByRole('button',{name:'Refresh',exact:true}).click();
        await myList().getByRole('link',{name:'PoC Series Detail',exact:true}).waitFor();
        await myList().locator('.watchguard-loading-status').waitFor();
        assert.equal(await myList().locator('.watchguard-spinner').isVisible(),true);
        const originalCard = await myList().locator('.watchguard-card').first().elementHandle();
        await page.screenshot({path:path.join(output,'progressive-memberships.png')});
        await setStatuses('watching');
        await page.waitForFunction(()=>!document.querySelector('.watchguard-card'));
        assert.ok(!(await myList().innerText()).includes('No matching interest'));
        await setStatuses('all');
        if (fixture.standalone) {
            const memberships=await api('/WatchGuard/Watchlist');
            assert.equal(memberships.length,2);
            assert.ok(memberships.every(e=>typeof e.AddedAtUtc==='string' && Number.isFinite(Date.parse(e.AddedAtUtc))),
                'New candidate memberships must record actual UTC add dates');
            const addedSort=myList().getByRole('combobox',{name:'Sort by'});
            await addedSort.selectOption('added');
            assert.match(page.url(),/sort=added/);
            await myList().locator('.watchguard-dates summary span').filter({hasText:/^Added:/}).first().waitFor();
            assert.ok((await myList().locator('.watchguard-dates summary span').allInnerTexts()).some(t=>t.startsWith('Added:')),
                'Known add dates are shown on owner rows');
        }
        await myList().getByRole('combobox',{name:'Sort by'}).selectOption('recent');
        await myList().getByRole('combobox',{name:'Sort by'}).selectOption('title');
        if (fixture.activityIndex) assert.ok(overviewRequests >= 2,'Controls restart bounded queries'); else assert.equal(overviewRequests,2,'Legacy filters stay local');
        assert.ok(releaseDiscovery); holdDiscovery = false; discoveryReleases.forEach(release => release());
        await page.waitForFunction(()=>document.querySelector('.watchguard-refresh')?.matches(':not(:disabled):not([aria-disabled="true"])'));
        assert.equal(await myList().locator('.watchguard-spinner').count(),0);
        assert.equal(await originalCard.evaluate(e=>e===document.querySelector('.watchguard-card')),true);
        await page.unroute(mineActivity); page.off('request',countOverview);
        report.paths.push({path:'Progressive overview',result:'explicit cards rendered with discovery held; no false empty state; query controls superseded earlier responses; card node preserved on completion'});
        if (fixture.activityIndex) {
            await myList().locator('.watchguard-secondary > summary').click();
            const range = myList().getByRole('combobox', {name:'Activity range',exact:true});
            for (const days of ['7','90','30']) {
                await range.selectOption(days);
                await page.waitForFunction(() => document.querySelector('.watchguard-page')?.getAttribute('aria-busy') === 'false');
                assert.match(page.url(),new RegExp('days='+days));
            }
            const older=myList().getByRole('checkbox',{name:'Include older current interest',exact:true});
            await setNativeCheckbox(older,false); await page.waitForFunction(()=>document.querySelector('.watchguard-page')?.getAttribute('aria-busy')==='false');
            assert.match(page.url(),/older=false/);
            await setNativeCheckbox(older,true); await page.waitForFunction(()=>document.querySelector('.watchguard-page')?.getAttribute('aria-busy')==='false');
            await page.reload(); await page.waitForFunction(()=>document.querySelector('.watchguard-page')?.getAttribute('aria-busy')==='false');
            await myList().locator('.watchguard-secondary > summary').click();
            assert.equal(await range.inputValue(),'30'); assert.equal(await older.isChecked(),true);
            await myList().locator('.watchguard-secondary > summary').click();
            for(const width of [1280,390]) { await page.setViewportSize({width,height:900});
                assert.equal(await myList().evaluate(e=>e.scrollWidth<=e.clientWidth),true);
                await page.screenshot({path:path.join(output,'indexed-overview-'+width+'.png')}); }
            await page.setViewportSize({width:1280,height:900});
            report.paths.push({path:'Indexed time filters',result:'7/30/90-day URL selection, older-interest toggle, reload, native-sized controls and no overflow at 1280/390'});
        }

        assert.equal(await myList().locator('.watchguard-card').count(),2);
        await page.waitForFunction(()=>Array.from(document.querySelectorAll('.watchguard-poster img')).some(img=>img.naturalWidth>0));
        await selectOwner('all');
        await page.waitForFunction(()=>document.querySelectorAll('.watchguard-card').length===6);
        assert.equal(await myList().getByRole('link',{name:'PoC Movie Detail',exact:true}).count(),1);
        assert.match(await myList().innerText(),/BrowserMember/);
        assert.match(await myList().innerText(),/WatchGuardPoCTest/);
        await selectOwner(member.User.Id.replaceAll('-',''));
        await page.waitForFunction(()=>document.querySelectorAll('.watchguard-card').length===6);
        await selectOwner('mine');
        await page.waitForFunction(()=>document.querySelectorAll('.watchguard-card').length===2);
        const latestOwnerView=page.url();
        await page.goBack();
        if(fixture.activityIndex) await myList().waitFor({state:'detached'});
        else await page.waitForFunction(()=>document.querySelectorAll('.watchguard-card').length===6);
        await page.goForward();
        await page.waitForFunction(()=>document.querySelectorAll('.watchguard-card').length===2);
        if(fixture.activityIndex) assert.equal(page.url(),latestOwnerView,'Forward restores the latest owner view');
        // Hold initial activity across a failed removal. Cards must be usable
        // before activity completes; completion must not erase action feedback.
        let releaseRemovalActivity, removalActivityStarted;
        const removalActivityReady = new Promise(resolve => { removalActivityStarted = resolve; });
        const removalActivityGate = new Promise(resolve => { releaseRemovalActivity = resolve; });
        const holdRemovalActivity = async route => { removalActivityStarted(); await removalActivityGate; await route.continue(); };
        await page.route(mineActivity, holdRemovalActivity);
        await page.reload(); await myList().getByRole('link',{name:'PoC Series Detail',exact:true}).waitFor();
        await removalActivityReady;
        assert.equal(await myList().getAttribute('aria-busy'),'true','Remove is available on preliminary cards');
        await page.screenshot({path:path.join(output,'my-watchlist.png')});
        const removalMemberships = await api('/WatchGuard/Watchlist');
        const otherMemberships = await api('/WatchGuard/Watchlist','GET',undefined,member.AccessToken);
        const removalTitles = await myList().getByRole('link').allTextContents();
        const livePluginVersion = (await api('/WatchGuard/IntegrationStatus')).PluginVersion;
        removalContract.validateIdentity(fixture.deployedPackage,fixture.standalone,candidateVersion,livePluginVersion);
        const failedRemovalRequests = [];
        const removalMock = async route => {
            const request = route.request();
            failedRemovalRequests.push({method:request.method(),urlPath:new URL(request.url()).pathname});
            await route.fulfill({status:503,body:'unavailable'});
        };
        await page.route('**/WatchGuard/Watchlist/*', removalMock);
        await myList().getByRole('button',{name:'Remove PoC Movie Detail from Watchlist',exact:true}).click();
        try {
            await myList().getByRole('alert').filter({hasText:'Could not remove'}).waitFor();
        } catch (error) {
            console.error('Failed removal diagnostic:',JSON.stringify({
                intercepted:failedRemovalRequests,
                alerts:await myList().getByRole('alert').allTextContents().catch(()=>[]),
                cards:await myList().locator('.watchguard-card').count().catch(()=>-1),
                pageUrl:page.url(),
                adapter:await page.evaluate(()=>Boolean(window.WatchGuardPoc?.isInstalled())).catch(()=>false)
            }));
            throw error;
        }
        await page.screenshot({path:path.join(output,'removal-error-before-activity.png')});
        releaseRemovalActivity();
        await page.waitForFunction(()=>document.querySelector('.watchguard-page')?.getAttribute('aria-busy')==='false');
        await page.unroute(mineActivity,holdRemovalActivity);
        const removalAfterActivity = {
            alert:await myList().locator('[role="alert"]').textContent(),
            cards:await myList().locator('.watchguard-card').count(),
            failedDeletes:failedRemovalRequests.length,
            indexed:fixture.activityIndex === true
        };
        fs.writeFileSync(path.join(output,'removal-race.json'),JSON.stringify(removalAfterActivity,null,2)+'\n');
        await page.screenshot({path:path.join(output,'removal-error-after-activity.png')});
        assert.equal(removalAfterActivity.cards,2,'A failed removal must retain both cards');
        assert.equal(failedRemovalRequests.length,1,'Exactly one failed removal should be intercepted');
        assert.equal(failedRemovalRequests[0].method,'DELETE','The failed removal should use DELETE');
        assert.equal(await myList().getByRole('link').count(),2);
        assert.deepEqual(await myList().getByRole('link').allTextContents(),removalTitles,'Failed removal preserves the same cards');
        assert.deepEqual(await api('/WatchGuard/Watchlist'),removalMemberships,'Failed removal preserves membership');
        assert.deepEqual(await api('/WatchGuard/Watchlist','GET',undefined,member.AccessToken),otherMemberships,'Other owner membership is unchanged');
        const removalOutcome=removalContract.classify(fixture.deployedPackage,fixture.standalone,candidateVersion,
            (await api('/WatchGuard/IntegrationStatus')).PluginVersion,removalAfterActivity.alert);
        Object.assign(removalAfterActivity,removalOutcome,{membershipUnchanged:true,cardsUnchanged:true});
        if(removalOutcome.status==='KNOWN_LIMITATION'){
            report.knownLimitations.push(removalOutcome);
            console.log('KNOWN_LIMITATION: '+removalOutcome.limitation+'; ZIP '+fixture.deployedPackage.packageSha256+'; deployed DLL '+fixture.deployedPackage.deployedDllSha256);
        }
        fs.writeFileSync(path.join(output,'removal-race.json'),JSON.stringify(removalAfterActivity,null,2)+'\n');
        await page.unroute('**/WatchGuard/Watchlist/*',removalMock);
        await myList().getByRole('button',{name:'Remove PoC Movie Detail from Watchlist',exact:true}).click();
        await myList().getByRole('link',{name:'PoC Movie Detail',exact:true}).waitFor({state:'hidden'});
        assert.doesNotMatch(await myList().locator('[role="alert"]').textContent(),/Could not remove/,'Successful retry clears removal feedback');
        assert.deepEqual(await api('/WatchGuard/Watchlist'),removalMemberships.filter(e=>e.ItemId.replaceAll('-','')!==fixture.items['PoC Movie Detail'].replaceAll('-','')),'Explicit retry removes only the selected membership');
        assert.deepEqual(await api('/WatchGuard/Watchlist','GET',undefined,member.AccessToken),otherMemberships);
        removalAfterActivity.explicitRetry='PASS';
        fs.writeFileSync(path.join(output,'removal-race.json'),JSON.stringify(removalAfterActivity,null,2)+'\n');
        await myList().getByRole('link',{name:'PoC Series Detail',exact:true}).click();
        await page.locator('#itemDetailPage').getByText('PoC Series Detail',{exact:true}).first().waitFor();
        await page.getByRole('link',{name:'Watchlists',exact:true}).click();
        await myList().getByRole('button',{name:'Remove PoC Series Detail from Watchlist',exact:true}).click();
        // The new account can start background discovery. Verify that an open
        // page picks up completion on its documented 30-second poll; ten seconds
        // would incorrectly demand a false empty state during population.
        await page.waitForFunction(()=>{const page=document.querySelector('.watchguard-page');return ['empty','populating'].includes(page?.dataset.viewState) || (!page?.dataset.viewState && page?.innerText.includes('No matching activity in this overview.'));},{},{timeout:45000});
        await page.route(mineActivity, route => route.fulfill({status:503,body:'unavailable'}));
        await myList().getByRole('button',{name:'Refresh',exact:true}).click();
        await myList().getByRole('alert').filter({hasText:'Viewing activity unavailable'}).waitFor();
        await page.unroute(mineActivity);
        await myList().getByRole('button',{name:'Refresh',exact:true}).click();
        // The new account can start background discovery. Verify that an open
        // page picks up completion on its documented 30-second poll; ten seconds
        // would incorrectly demand a false empty state during population.
        await page.waitForFunction(()=>{const page=document.querySelector('.watchguard-page');return ['empty','populating'].includes(page?.dataset.viewState) || (!page?.dataset.viewState && page?.innerText.includes('No matching activity in this overview.'));},{},{timeout:45000});
        await page.goBack();
        report.paths.push({path:'My Watchlist',result:'empty/list, movie and series links, membership integrity, explicit removal retry and load/refresh recovery passed',removalFeedback:removalOutcome.status});
        report.phase = 'Playback-only series overview';
        const automaticId = fixture.items['PoC Parent Clear'];
        const episode = (await api('/Shows/' + automaticId + '/Episodes')).Items[0];
        await api('/UserItems/' + episode.Id + '/UserData','POST',{Played:true,PlaybackPositionTicks:0,LastPlayedDate:'2026-10-11T10:00:00Z'},member.AccessToken);
        await api('/UserItems/' + fixture.items['PoC Movie Detail'] + '/UserData','POST',{Played:false,PlaybackPositionTicks:1000000,LastPlayedDate:'2026-10-10T10:00:00Z'},member.AccessToken);
        await page.getByRole('link',{name:'Watchlists',exact:true}).click();
        await selectOwner('all');
        await setStatuses('watching');
        await myList().getByRole('link',{name:'PoC Parent Clear',exact:true}).waitFor();
        assert.equal(await myList().locator('.watchguard-card').count(),2);
        await myList().getByRole('combobox',{name:'Sort by'}).selectOption('recent');
        await page.waitForFunction(()=>document.querySelector('.watchguard-card .cardText')?.textContent==='PoC Parent Clear');
        await myList().getByRole('combobox',{name:'Sort by'}).selectOption('title');
        await page.waitForFunction(()=>document.querySelector('.watchguard-card .cardText')?.textContent==='PoC Movie Detail');
        await selectOwner('mine');
        // The new account can start background discovery. Verify that an open
        // page picks up completion on its documented 30-second poll; ten seconds
        // would incorrectly demand a false empty state during population.
        await page.waitForFunction(()=>{const page=document.querySelector('.watchguard-page');return ['empty','populating'].includes(page?.dataset.viewState) || (!page?.dataset.viewState && page?.innerText.includes('No matching activity in this overview.'));},{},{timeout:45000});
        await selectOwner(member.User.Id.replaceAll('-',''));
        await myList().getByRole('link',{name:'PoC Parent Clear',exact:true}).waitFor();
        assert.equal(await myList().getByRole('button',{name:'Remove PoC Parent Clear from Watchlist',exact:true}).count(),0);
        assert.ok(await myList().getByRole('img',{name:'Watching',exact:true}).count());
        assert.ok(!(await api('/WatchGuard/Watchlist','GET',undefined,member.AccessToken)).some(e=>e.ItemId.replaceAll('-','')===automaticId.replaceAll('-','')));
        const posterWidth=(await myList().locator('.watchguard-poster').first().boundingBox()).width;
        assert.ok(posterWidth>=120 && posterWidth<=240,'Desktop posters remain readable without filling the whole row');
        if (fixture.standalone) {
            const coverage=page.locator('.watchguard-coverage-details');
            assert.ok((await coverage.locator('summary').innerText()).trim());
            assert.equal(await coverage.evaluate(e=>e.open),false);
            await coverage.locator('summary').focus(); await page.keyboard.press('Enter');
            assert.equal(await coverage.evaluate(e=>e.open),true);
            assert.match(await coverage.innerText(),/not an exhaustive library audit/);
            await page.keyboard.press('Enter');
            assert.equal(await coverage.evaluate(e=>e.open),false);
            assert.equal(await page.locator('.watchguard-status-icons .watchguard-state-InProgress').first().evaluate(e=>getComputedStyle(e).color),'rgb(130, 196, 255)');
        }
        await page.screenshot({path:path.join(output,'interest-overview.png')});
        await page.setViewportSize({width:390,height:844});
        await page.waitForFunction(()=>{const e=document.querySelector('.watchguard-page');return e && e.scrollWidth<=e.clientWidth;});
        const cardsAtNarrow = await myList().locator('.watchguard-card').evaluateAll(cards=>cards.map(c=>{const b=c.getBoundingClientRect();return {left:b.left,right:b.right,width:b.width};}));
        assert.ok(cardsAtNarrow.every(c=>c.left>=0 && c.right<=390 && c.width>100));
        assert.equal(await myList().locator('.watchguard-grid').evaluate(e=>getComputedStyle(e).gridTemplateColumns.split(' ').length),2);
        await page.screenshot({path:path.join(output,'interest-overview-narrow.png')});
        await page.locator('.watchguard-filter summary').click();
        const popoverBounds=await page.locator('.watchguard-filter-options').boundingBox();
        assert.ok(popoverBounds.x>=0 && popoverBounds.x+popoverBounds.width<=390);
        await page.screenshot({path:path.join(output,'status-filters-narrow.png')});
        await page.locator('.watchguard-filter').getByRole('checkbox',{name:'Watching',exact:true}).press('Escape');
        if (fixture.standalone) {
            await api('/WatchGuard/Watchlist/'+fixture.items['PoC Movie Detail'],'PUT');
            await selectOwner('all'); await setStatuses('all');
            for (const width of [1280,390]) {
                await page.setViewportSize({width,height:900});
                await page.waitForFunction(()=>document.querySelector('.watchguard-refresh')?.matches(':not(:disabled):not([aria-disabled="true"])'));
                const bounds=await myList().locator('.watchguard-toolbar :is(select,summary,button)').evaluateAll(nodes=>nodes.filter(n=>n.getBoundingClientRect().width).map(n=>{const b=n.getBoundingClientRect();return {x:b.x,right:b.right,height:b.height};}));
                assert.ok(bounds.every(b=>b.x>=0 && b.right<=width && b.height>=44),'touch controls fit the viewport');
                const remove=await myList().locator('.watchguard-remove').first().boundingBox();
                assert.ok(remove.width>=44 && remove.height>=44);
                assert.ok(await myList().locator('.watchguard-card').filter({hasText:'BrowserMember'}).filter({hasText:'WatchGuardPoCTest'}).count());
                assert.equal(await myList().evaluate(e=>e.scrollWidth<=e.clientWidth),true);
                await page.screenshot({path:path.join(output,'overview-polish-'+width+'.png')});
                const disclosure=page.locator('.watchguard-coverage-details');
                await disclosure.locator('summary').focus();await page.keyboard.press('Enter');
                assert.equal(await disclosure.evaluate(e=>e.open),true);
                await page.screenshot({path:path.join(output,'overview-coverage-'+width+'.png')});
                await page.keyboard.press('Enter');
                assert.equal(await disclosure.evaluate(e=>e.open),false);
                if (width===1280) {
                    await myList().evaluate(e=>{e.style.setProperty('--jf-palette-background-default','#f5f5f5');e.style.setProperty('--jf-palette-text-primary','#202020');e.style.setProperty('--jf-palette-text-secondary','#202020');e.style.setProperty('--jf-palette-background-paper','#fff');});
                    assert.equal(await myList().evaluate(e=>getComputedStyle(e).color),'rgb(32, 32, 32)');
                    await page.waitForFunction(()=>['.watchguard-toolbar-field','.watchguard-filter summary','.watchguard-refresh','.watchguard-status'].every(selector=>getComputedStyle(document.querySelector(selector)).color==='rgb(32, 32, 32)'));
                    for(const selector of ['.watchguard-toolbar-field','.watchguard-filter summary','.watchguard-refresh','.watchguard-status'])
                        assert.equal(await myList().locator(selector).first().evaluate(e=>getComputedStyle(e).color),'rgb(32, 32, 32)',selector+' light-palette contrast');
                    assert.equal(await myList().locator('.watchguard-status-icons').first().evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(37, 42, 48)');
                    await page.screenshot({path:path.join(output,'overview-light-1280.png')});
                    await myList().evaluate(e=>{for(const name of ['--jf-palette-background-default','--jf-palette-text-primary','--jf-palette-text-secondary','--jf-palette-background-paper'])e.style.removeProperty(name);});
                }

            }
            const endpoint=allActivity;
            const warning=' Some continuing series lack episode or air-date coverage; Caught Up is not inferred for them. A safety limit was reached; some items are omitted.';
            await page.route(endpoint,async route=>{
                const response=await route.fetch();const data=await response.json();
                data.Notice+=warning;data.LimitReached=true;
                if(data.Coverage) {data.Coverage.Warnings=[warning.trim()];data.Coverage.EpisodeMetadataIncomplete=true;data.Coverage.VerificationLimited=true;}
                data.Items.forEach(item=>item.Users.forEach(user=>user.DisplayName='<img src=x onerror=alert(1)> '+ 'Long username '.repeat(12)));
                await route.fulfill({response,json:data});
            });
            await myList().getByRole('button',{name:'Refresh',exact:true}).click();
            await page.locator('.watchguard-coverage-warning').getByText(/A safety limit was reached/).waitFor();
            assert.equal(await page.locator('.watchguard-coverage-details').evaluate(e=>e.open),false);
            assert.equal(await page.locator('.watchguard-coverage-warning').isVisible(),true);
            assert.ok((await page.locator('.watchguard-coverage-warning').innerText()).includes(warning.trim()));
            assert.equal(await myList().locator('.watchguard-status img').count(),0);
            assert.equal(await myList().evaluate(e=>e.scrollWidth<=e.clientWidth),true);
            await page.screenshot({path:path.join(output,'overview-warning-390.png')});
            await page.unroute(endpoint);
            await api('/WatchGuard/Watchlist/'+fixture.items['PoC Movie Detail'],'DELETE');
            await myList().getByRole('button',{name:'Refresh',exact:true}).click();
            await page.waitForFunction(()=>document.querySelector('.watchguard-refresh')?.matches(':not(:disabled):not([aria-disabled="true"])'));
            report.paths.push({path:'Overview polish',result:'keyboard disclosure; visible safety/coverage warnings; labeled colors; multi-user/unsafe text; 44px controls and no overflow at 1280/390'});
        }
        await page.setViewportSize({width:1280,height:900});
        await myList().getByRole('link',{name:'PoC Parent Clear',exact:true}).click();
        await page.locator('#itemDetailPage:not(.hide)').getByText('PoC Parent Clear',{exact:true}).first().waitFor();
        await page.locator('#itemDetailPage:visible .btnMoreCommands:visible').waitFor();
        await openInterest();
        if (fixture.standalone) await page.locator('.watchguard-series-activity summary').filter({hasText:'Watching'}).waitFor();
        else await page.getByRole('status',{name:'Title interest',exact:true}).getByRole('img',{name:'Watching',exact:true}).waitFor();
        await page.keyboard.press('Escape');
        const beforeAuto = report.deletes.length;
        await nativeDelete(); await nativeConfirm();
        if (fixture.standalone) { await dialog().getByText('BrowserMember',{exact:true}).waitFor(); await dialog().getByText('Watching',{exact:true}).waitFor(); }
        else await dialog().getByText(/BrowserMember — Watching/).waitFor();
        await dialog().getByRole('button',{name:'Cancel',exact:true}).click();
        report.playbackCancellation = await require('./native-dialog-dismissal.cjs')(page, errorText);
        // Cancellation returns to this native view; it is not a successful
        // deletion redirect. Finish dialog/history teardown before another route.
        await page.locator('#itemDetailPage:visible').getByText('PoC Parent Clear',{exact:true}).first().waitFor();
        await page.locator('#itemDetailPage:visible .btnMoreCommands:visible').waitFor();
        pendingNativeReturn=null;
        report.playbackCancellation.viewReadyAt=await page.evaluate(()=>performance.now());
        assert.ok(report.playbackCancellation.closedAt<=report.playbackCancellation.viewReadyAt);
        assert.equal(report.deletes.length,beforeAuto); await exists(automaticId);
        // Reset only disposable native fixture state so the existing clear-parent deletion regression is unchanged.
        await api('/UserItems/' + episode.Id + '/UserData','POST',{Played:false,PlaybackPositionTicks:0},member.AccessToken);
        await api('/UserItems/' + fixture.items['PoC Movie Detail'] + '/UserData','POST',{Played:false,PlaybackPositionTicks:0},member.AccessToken);
        assert.ok(!(await api('/WatchGuard/Watchlist','GET',undefined,member.AccessToken)).some(e=>e.ItemId.replaceAll('-','')===automaticId.replaceAll('-','')));
        report.paths.push({path:'Playback-only series',result:'no membership, appears under Watching, user/reason filters and recency/title sorting pass; inline users and deletion warning show Watching; cancellation sends zero DELETE; no permanent membership created'});
        report.paths.push({path:'Modern compatibility',result:'Native modern React application routes /details to the legacy itemDetailPage; one placement path verified, no separate React details route exists in inspected source'});
        report.phase = 'Detail watchlist actions';
        if (fixture.standalone) await require('./watchlist-action-browser.cjs')({page,api,detail,fixture,member,output,report});
        report.phase = 'Watchlist UI';
        report.playbackCancellation.nextNavigationAt=await page.evaluate(()=>performance.now());
        assert.ok(report.playbackCancellation.viewReadyAt<=report.playbackCancellation.nextNavigationAt);
        await detail('PoC Movie Detail');
        report.playbackCancellation.nextDetailReady=true;
        await page.getByRole('button', { name:'Add to Watchlist', exact:true }).click();
        await page.getByRole('button', { name:'Remove from Watchlist', exact:true }).waitFor();
        assert.equal(await page.locator('.mainDetailButtons .watchguard-toggle').count(),1);
        assert.equal(await page.locator('.mainDetailButtons > .watchguard-controls').count(),1);
        await page.reload();
        await page.getByRole('button', { name:'Remove from Watchlist', exact:true }).waitFor();
        await openInterest();
        await page.locator('.watchguard-interest').getByText('BrowserMember',{exact:true}).waitFor();
        const nativeState = await api('/UserItems/' + fixture.items['PoC Movie Detail'] + '/UserData');
        assert.equal(nativeState.IsFavorite,false,'Watchlist must not change Favorites');
        assert.equal(await page.locator('.watchguard-controls').evaluate(e=>e.parentElement.classList.contains('mainDetailButtons')),true);
        assert.equal((await api('/WatchGuard/Watchlist')).length,1,'opening interest must not toggle membership');
        await page.screenshot({path:path.join(output,'watchlist-detail.png')});
        // Multiple real users with long names, without changing the later deletion fixtures.
        const longUsers = [];
        for (let i=0;i<3;i++) {
            const name = 'LongName' + i + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.repeat(3);
            const password = require('node:crypto').randomUUID();
            const added = await api('/Users/New','POST',{Name:name,Password:password}); longUsers.push(added.Id);
            const signed = await api('/Users/AuthenticateByName','POST',{Username:name,Pw:password});
            await api('/WatchGuard/Watchlist/'+fixture.items['PoC Movie Detail'],'PUT',undefined,signed.AccessToken);
        }
        await api('/Sessions/Playing','POST',{ItemId:fixture.items['PoC Movie Detail'],PlayMethod:'DirectPlay',PositionTicks:0},member.AccessToken);
        await api('/UserItems/'+fixture.items['PoC Movie Detail']+'/UserData','POST',{Played:false,PlaybackPositionTicks:1000000},member.AccessToken);
        for (const width of [1280,390]) {
            await page.setViewportSize({width,height:900}); await page.reload(); await openInterest();
            await page.locator('.watchguard-interest').getByRole('img',{name:'Currently Playing',exact:true}).waitFor();
            await page.locator('.watchguard-interest').getByRole('img',{name:'Watching',exact:true}).waitFor();
            const geometry=await page.locator('#itemDetailPage:not(.hide)').evaluate(view=>{
                const info=view.querySelector('.infoWrapper'),header=view.querySelector('.watchguard-header'),actions=view.querySelector('.mainDetailButtons');
                const h=header.getBoundingClientRect(),a=actions.getBoundingClientRect();
                return {inInfo:header.parentElement===info,flowsBefore:!!(info.compareDocumentPosition(actions)&Node.DOCUMENT_POSITION_FOLLOWING),
                    overlap:h.left<a.right&&h.right>a.left&&h.top<a.bottom&&h.bottom>a.top,
                    bounded:view.querySelector('.watchguard-interest').clientHeight<=parseFloat(getComputedStyle(view.querySelector('.watchguard-interest')).lineHeight)*3+1,
                    onScreen:h.left>=0&&h.right<=innerWidth,readable:h.width>=200,counts:view.querySelectorAll('.watchguard-count,[popover]').length};
            });
            assert.deepEqual(geometry,{inInfo:true,flowsBefore:true,overlap:false,bounded:true,onScreen:true,readable:true,counts:0});
            await page.screenshot({path:path.join(output,'inline-users-'+width+'.png')});
        }
        await page.setViewportSize({width:1280,height:900});
        await api('/Sessions/Playing/Stopped','POST',{ItemId:fixture.items['PoC Movie Detail'],PositionTicks:0},member.AccessToken);
        await api('/UserItems/'+fixture.items['PoC Movie Detail']+'/UserData','POST',{Played:false,PlaybackPositionTicks:0},member.AccessToken);
        for(const id of longUsers) await api('/Users/'+id,'DELETE');
        await page.reload(); await openInterest();
        report.paths.push({path:'Inline users',result:'five users including three long names; all three reasons; 1280/390 px geometry, bounded growth, no action overlap, no badge/popover'});
        await page.keyboard.press('Escape');
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
        await openInterest(); await page.screenshot({path:path.join(output,'inline-series.png')});
        await page.locator('#itemDetailPage:visible .btnMoreCommands:visible').click();
        const seriesCommand=page.locator('.actionSheet.opened .watchguard-native-action');
        await seriesCommand.getByText('Add to Watchlist',{exact:true}).waitFor();
        await seriesCommand.click();await seriesCommand.getByText('Remove from Watchlist',{exact:true}).waitFor();
        await seriesCommand.click();await seriesCommand.getByText('Add to Watchlist',{exact:true}).waitFor();
        await page.locator('.dialogContainer').filter({has:seriesCommand}).click({position:{x:5,y:5}});await seriesCommand.waitFor({state:'detached'});

        assert.equal(await page.locator('.watchguard-controls').count(),1);
        await page.goBack(); await page.getByRole('button', {name:'Add to Watchlist',exact:true}).waitFor();
        await page.goForward(); await page.getByRole('button', {name:'Add to Watchlist',exact:true}).waitFor();
        assert.equal(await page.locator('.watchguard-controls').count(),1);
        // A normal user gets their own controls but no cross-user protection requests.
        const memberContext = await browser.newContext({ignoreHTTPSErrors:fixture.tls === true}); const memberPage = await memberContext.newPage();
        let protectionRequests = 0;
        memberPage.on('request', r => { if (/\/WatchGuard\/(?:SeriesActivity\/|Protection\/|ActivityOverview(?:\?|$))/.test(r.url())) protectionRequests++; });
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
        report.phase = 'Viewing activity';
        const activityDate = new Date(Date.now()-2*86400000).toISOString();
        const historyMovie = fixture.items['PoC Zero'], historySeries = fixture.items['PoC Parent Clear'];
        const historyEpisodes = (await api('/Shows/'+historySeries+'/Episodes')).Items;
        for(const id of [historyMovie, fixture.items['PoC Movie Detail'], ...historyEpisodes.map(e=>e.Id)])
            await api('/UserItems/'+id+'/UserData','POST',{Played:true,PlaybackPositionTicks:0,LastPlayedDate:activityDate},member.AccessToken);
        assert.equal((await api('/WatchGuard/Protection/'+historyMovie)).HasInterest,false);
        assert.equal((await api('/WatchGuard/Protection/'+historySeries)).HasInterest,false);
        assert.equal((await api('/WatchGuard/Watchlist', 'GET', undefined, member.AccessToken)).some(e=>e.ItemId.replaceAll('-','')===historySeries.replaceAll('-','')),false);
        await page.getByRole('link',{name:'Watchlists',exact:true}).click();
        await selectOwner('all');
        await page.waitForFunction(()=>document.querySelector('.watchguard-refresh')?.matches(':not(:disabled):not([aria-disabled="true"])'));
        assert.equal(await myList().getByRole('link',{name:'PoC Zero',exact:true}).count(),0);
        assert.equal(await myList().getByRole('link',{name:'PoC Parent Clear',exact:true}).count(),0);
        await myList().getByRole('link',{name:'PoC Movie Detail',exact:true}).waitFor(); // Explicit + completed remains.
        const filterSummary=page.locator('.watchguard-filter summary');
        await filterSummary.focus(); await page.keyboard.press('Enter');
        await page.locator('.watchguard-filter').getByRole('checkbox',{name:'Watched',exact:true}).focus();
        await page.keyboard.press('Space');
        await page.screenshot({path:path.join(output,'status-filters-desktop.png')});
        await myList().getByRole('link',{name:'PoC Zero',exact:true}).waitFor();
        await page.locator('.watchguard-filter').getByRole('button',{name:'Reset to Defaults'}).click();
        await page.waitForFunction(()=>!document.querySelector('.watchguard-filter input[value="watched"]').checked);
        await page.locator('.watchguard-filter').getByRole('button',{name:'Reset to Defaults'}).press('Escape');
        const resetView=page.url();
        await page.goBack();
        if(fixture.activityIndex) await myList().waitFor({state:'detached'});
        else await myList().getByRole('link',{name:'PoC Zero',exact:true}).waitFor();
        await page.goForward(); await page.waitForFunction(()=>!document.querySelector('.watchguard-filter input[value="watched"]').checked);
        if(fixture.activityIndex) assert.equal(page.url(),resetView,'Forward restores Reset defaults, not an earlier filter');
        await page.reload(); await page.waitForFunction(()=>document.querySelector('.watchguard-refresh')?.matches(':not(:disabled):not([aria-disabled="true"])'));
        assert.equal(await myList().getByRole('link',{name:'PoC Zero',exact:true}).count(),0);
        await selectOwner('all'); // Reset now restores the complete personal view, including My list.
        await setStatuses('watched');
        await myList().getByRole('link',{name:'PoC Zero',exact:true}).waitFor();
        await page.waitForFunction(()=>document.querySelector('.watchguard-refresh')?.matches(':not(:disabled):not([aria-disabled="true"])'));
        assert.equal(await myList().locator('.watchguard-card').count(),3);
        const completedCard=myList().locator('.watchguard-card').filter({hasText:'PoC Parent Clear'});
        assert.match(await completedCard.innerText(),/BrowserMember/);
        if(fixture.standalone) {
            assert.match(await completedCard.innerText(),/0\/0\s*\+4/);
            await completedCard.getByRole('button',{name:/BrowserMember: 4 additional available episodes/}).click();
            assert.equal(await page.locator('.watchguard-extras-dialog').getByText('Date unknown · Watched',{exact:true}).count(),4);
            await page.locator('.watchguard-extras-dialog').getByRole('button',{name:'Close',exact:true}).click();
        } else assert.match(await completedCard.innerText(),/4\/4/);
        await completedCard.getByRole('img',{name:'Watched',exact:true}).waitFor();
        const nativeDate=(await api('/WatchGuard/ActivityOverview')).Items.find(i=>i.ItemId.replaceAll('-','')===historySeries.replaceAll('-','')).Users.find(u=>u.DisplayName==='BrowserMember').LastPlayedDate;
        const displayed=await page.evaluate(date=>new Intl.DateTimeFormat(undefined,{dateStyle:'medium'}).format(new Date(date)),nativeDate);
        assert.ok((await completedCard.innerText()).includes(displayed));
        for(const name of ['Watchlist','Watched']) await myList().locator('.watchguard-card').filter({hasText:'PoC Movie Detail'}).getByRole('img',{name,exact:true}).waitFor();
        await page.screenshot({path:path.join(output,'activity-watched.png')});
        await selectOwner('mine');
        // The new account can start background discovery. Verify that an open
        // page picks up completion on its documented 30-second poll; ten seconds
        // would incorrectly demand a false empty state during population.
        await page.waitForFunction(()=>{const page=document.querySelector('.watchguard-page');return ['empty','populating'].includes(page?.dataset.viewState) || (!page?.dataset.viewState && page?.innerText.includes('No matching activity in this overview.'));},{},{timeout:45000});
        await selectOwner(member.User.Id.replaceAll('-',''));
        assert.equal(await myList().locator('.watchguard-card').count(),3);
        await api('/Sessions/Playing','POST',{ItemId:historyMovie,PlayMethod:'DirectPlay',PositionTicks:0},member.AccessToken);
        await myList().getByRole('button',{name:'Refresh',exact:true}).click();
        await setStatuses('playing');
        await myList().getByRole('link',{name:'PoC Zero',exact:true}).waitFor();
        assert.equal(await myList().locator('.watchguard-card').count(),1);
        await myList().getByRole('img',{name:'Currently Playing',exact:true}).waitFor();
        await page.screenshot({path:path.join(output,'activity-playing.png')});
        await api('/Sessions/Playing/Stopped','POST',{ItemId:historyMovie,PositionTicks:0},member.AccessToken);
        // Ensure the later native clear-deletion regression targets recent completed history.
        await api('/UserItems/'+historyMovie+'/UserData','POST',{Played:true,PlaybackPositionTicks:0,LastPlayedDate:activityDate},member.AccessToken);
        assert.equal((await api('/WatchGuard/Protection/'+historyMovie)).HasInterest,false);
        report.paths.push({path:'Recent viewing activity',result:'completed movie and whole series, exact native date, four available episodes (undated extras in current UI), explicit+Watched merge, user/Watched/Playing filters, active indicator and history-only protection=false'});
        if (fixture.standalone) {
            report.phase = 'Caught Up';
            const originalSeries=await api('/Items/'+historySeries);
            const originals=[];
            for(const episode of historyEpisodes) {
                const dto=await api('/Items/'+episode.Id); originals.push(dto);
                await api('/Items/'+episode.Id,'POST',{...dto,PremiereDate:activityDate});
            }
            await api('/Items/'+historySeries,'POST',{...originalSeries,Status:'Continuing'});
            const activity=()=>api('/WatchGuard/ActivityOverview');
            const owner=result=>result.Items.find(i=>i.ItemId.replaceAll('-','')===historySeries.replaceAll('-','')).Users.find(u=>u.UserId.replaceAll('-','')===member.User.Id.replaceAll('-',''));
            assert.deepEqual(owner(await activity()).Reasons,['CaughtUp']);
            assert.equal((await api('/WatchGuard/Protection/'+historySeries)).HasInterest,true);
            await myList().getByRole('button',{name:'Refresh',exact:true}).click(); await setStatuses('watching');
            const caught=myList().locator('.watchguard-card').filter({hasText:'PoC Parent Clear'});
            await caught.getByRole('img',{name:'Caught Up',exact:true}).waitFor();assert.match(await caught.innerText(),/4\/4/);
            await page.screenshot({path:path.join(output,'caught-up.png')});
            const viewingStarted=Date.now();
            const viewing = await api('/WatchGuard/SeriesActivity/'+historySeries);
            report.seriesActivityMs=Date.now()-viewingStarted;
            assert.equal(viewing.IsComplete,true); assert.equal(viewing.SeriesStatus,'Continuing');
            const viewer=viewing.Users.find(u=>u.UserId.replaceAll('-','')===member.User.Id.replaceAll('-',''));
            assert.deepEqual(viewer.Reasons,['CaughtUp']); assert.equal(viewer.Watchlisted,false); assert.equal(viewer.WatchedEpisodes,4); assert.equal(viewer.CoverageComplete,true);
            const configId='a3c6bc84-783d-4ba8-a0db-89bfb83ab486';
            const config=await api('/Plugins/'+configId+'/Configuration');
            assert.equal(config.ProtectCaughtUpSeries,true);
            await api('/Items/'+historyEpisodes[0].Id,'POST',{...originals[0],PremiereDate:null});
            await assert.rejects(api('/WatchGuard/Protection/'+historySeries));
            const uncertain=await api('/WatchGuard/SeriesActivity/'+historySeries);
            assert.equal(uncertain.Users.find(u=>u.UserId.replaceAll('-','')===member.User.Id.replaceAll('-','')).CoverageComplete,false);
            await api('/Plugins/'+configId+'/Configuration','POST',{...config,ProtectCaughtUpSeries:false});
            assert.equal((await api('/WatchGuard/Protection/'+historySeries)).HasInterest,false);
            await api('/Items/'+historyEpisodes[0].Id,'POST',{...originals[0],PremiereDate:activityDate});
            await api('/Plugins/'+configId+'/Configuration','POST',config);
            await api('/WatchGuard/Watchlist/'+historySeries,'PUT');
            await api('/UserItems/'+historyEpisodes[0].Id+'/UserData','POST',{Played:false,PlaybackPositionTicks:1000000,LastPlayedDate:activityDate});
            await page.goto(fixture.base+'/web/#/details?id='+historySeries+'&serverId='+fixture.serverId);
            await page.locator('.watchguard-series-activity summary').filter({hasText:'Caught Up'}).click();
            await page.locator('.watchguard-series-viewers').getByText('BrowserMember',{exact:true}).waitFor();
            for (const width of [1280,390]) {
                await page.setViewportSize({width,height:900});
                const activityPanel=page.locator('.watchguard-series-activity'), summary=activityPanel.locator('summary');
                if(await activityPanel.getAttribute('open') !== null) await summary.press('Enter');
                const geometry=()=>page.locator('#itemDetailPage:not(.hide)').evaluate(view=>Object.fromEntries(
                    ['.nameContainer','.itemMiscInfo-primary','.mainDetailButtons','.detailRibbon'].map(selector=>{
                        const b=view.querySelector(selector).getBoundingClientRect();return [selector,{x:b.x+scrollX,y:b.y+scrollY,width:b.width,height:b.height}];
                    })));
                // Jellyfin's responsive shell settles asynchronously after resizing. Compare
                // expansion only after its native title/action geometry stops changing.
                await page.waitForFunction(()=>{
                    const view=document.querySelector('#itemDetailPage:not(.hide)');
                    const signature=['.nameContainer','.itemMiscInfo-primary','.mainDetailButtons','.detailRibbon'].map(s=>{const b=view.querySelector(s).getBoundingClientRect();return [b.x,b.y,b.width,b.height];}).flat().join(',');
                    const sample=window.__watchguardGeometrySample;
                    if(!sample || sample.signature!==signature) {window.__watchguardGeometrySample={signature,since:performance.now()};return false;}
                    return performance.now()-sample.since>500;
                });
                const collapsed=await geometry();
                assert.ok(collapsed['.nameContainer'].width>100 && collapsed['.nameContainer'].height>0,'native title remains visible');
                assert.equal(await activityPanel.evaluate(p=>!!p.closest('.detailPagePrimaryContent') && !p.closest('.detailRibbon')),true);
                await page.screenshot({path:path.join(output,'series-activity-collapsed-'+width+'.png')});
                await summary.press('Enter'); assert.notEqual(await activityPanel.getAttribute('open'),null);
                const expanded=await geometry();
                for(const selector of Object.keys(collapsed)) for(const coordinate of ['x','y','width','height'])
                    assert.ok(Math.abs(collapsed[selector][coordinate]-expanded[selector][coordinate])<1,selector+' shifted on expansion: '+coordinate+' '+collapsed[selector][coordinate]+' -> '+expanded[selector][coordinate]);
                const bounds=await activityPanel.boundingBox();
                assert.ok(bounds.x>=0 && bounds.x+bounds.width<=width+1);
                assert.equal(await activityPanel.evaluate(e=>e.scrollWidth<=e.clientWidth),true);
                const accents=await activityPanel.locator('.watchguard-chip').evaluateAll(nodes=>nodes.map(n=>({text:n.textContent,color:getComputedStyle(n).color})));
                assert.ok(accents.some(c=>c.text.includes('Caught Up') && c.color==='rgb(110, 219, 208)'));
                assert.ok(accents.some(c=>c.text.includes('Watching') && c.color==='rgb(130, 196, 255)'));
                assert.ok(accents.some(c=>c.text.includes('Watchlisted') && c.color==='rgb(243, 198, 108)'));
                await page.screenshot({path:path.join(output,'series-activity-expanded-'+width+'.png')});
                await summary.press('Enter');assert.equal(await activityPanel.getAttribute('open'),null);
                const recollapsed=await geometry();
                for(const selector of Object.keys(collapsed)) for(const coordinate of ['x','y','width','height'])
                    assert.ok(Math.abs(collapsed[selector][coordinate]-recollapsed[selector][coordinate])<1,selector+' shifted on collapse: '+coordinate);
                await summary.press('Enter');
            }
            await page.setViewportSize({width:1280,height:900});
            const beforeCaught=report.deletes.length;
            await nativeDelete(); await nativeConfirm();
            await dialog().getByText('Caught Up',{exact:true}).waitFor();
            await page.screenshot({path:path.join(output,'deletion-polish-desktop.png')});
            await page.setViewportSize({width:390,height:844});
            assert.equal(await dialog().evaluate(e=>e.scrollWidth<=e.clientWidth),true);
            await page.screenshot({path:path.join(output,'deletion-polish-mobile.png')});
            await page.setViewportSize({width:1280,height:900});
            await page.keyboard.press('Escape'); await page.getByRole('button',{name:'Got It',exact:true}).click();
            assert.equal(report.deletes.length,beforeCaught);
            await api('/WatchGuard/Watchlist/'+historySeries,'DELETE');
            await api('/UserItems/'+historyEpisodes[0].Id+'/UserData','POST',{Played:false,PlaybackPositionTicks:0});
            await page.goto(fixture.base+'/web/#/home?watchguard=watchlists&owner=all');
            await myList().waitFor();
            const latest=historyEpisodes.at(-1).Id;
            await api('/UserItems/'+latest+'/UserData','POST',{Played:false,PlaybackPositionTicks:0},member.AccessToken);
            assert.deepEqual(owner(await activity()).Reasons,['InProgress']);
            assert.equal((await api('/WatchGuard/Protection/'+historySeries)).HasInterest,true);
            await api('/Items/'+latest,'POST',{...originals.at(-1),PremiereDate:new Date(Date.now()+7*86400000).toISOString()});
            assert.deepEqual(owner(await activity()).Reasons,['CaughtUp']);
            assert.equal(owner(await activity()).AvailableEpisodes,3);
            // v0.5.2 informational extras: actual file, no permanent membership or protection change.
            const extraOwner=owner(await activity());
            assert.equal(extraOwner.EpisodeProgress.AiredAvailable,3);assert.equal(extraOwner.EpisodeProgress.AiredWatched,3);
            assert.equal(extraOwner.EpisodeProgress.ExtraEpisodes.length,1);
            assert.equal(extraOwner.EpisodeProgress.ExtraEpisodes[0].ReleaseStatus,'Future');
            assert.equal(extraOwner.EpisodeProgress.ExtraEpisodes[0].Watched,false);
            const protectionBeforeExtras=await api('/WatchGuard/Protection/'+historySeries);
            const extraButton=scope=>scope.getByRole('button',{name:/BrowserMember: 1 additional available episodes/});
            for(const width of [1280,390]) {
                await page.setViewportSize({width,height:900});
                await page.goto(fixture.base+'/web/#/home?watchguard=watchlists&owner=all&interest=watching');
                await myList().waitFor();
                // Fixture metadata changed through native APIs; local filter changes deliberately do not rediscover activity.
                await myList().getByRole('button',{name:'Refresh',exact:true}).click();
                await page.waitForFunction(()=>document.querySelector('.watchguard-page')?.getAttribute('aria-busy')==='false');
                const card=myList().locator('.watchguard-card').filter({hasText:'PoC Parent Clear'});
                await extraButton(card).waitFor();
                await card.getByRole('img',{name:'Caught up on aired episodes',exact:true}).waitFor();
                assert.match(await card.innerText(),/3\/3\s*\+1/);
                const poster=await card.locator('img').first().elementHandle();
                await extraButton(card).focus();await page.keyboard.press('Enter');
                const extras=page.locator('.watchguard-extras-dialog');await extras.waitFor();
                await extras.getByText(/Future-dated.*Unwatched/).waitFor();
                assert.equal(await extras.evaluate(e=>e.scrollWidth<=e.clientWidth),true);
                await page.screenshot({path:path.join(output,'extra-card-'+width+'.png')});
                await page.keyboard.press('Escape');await extras.waitFor({state:'detached'});
                assert.equal(await extraButton(card).evaluate(e=>e===document.activeElement),true);
                assert.equal(await poster.evaluate(e=>e.isConnected),true);
                await extraButton(card).click();await page.locator('.watchguard-extras-dialog').getByRole('button',{name:'Close',exact:true}).click();
                await page.goto(fixture.base+'/web/#/details?id='+historySeries+'&serverId='+fixture.serverId);
                const panel=page.locator('.watchguard-series-activity');await panel.locator('summary').click();
                await extraButton(panel).waitFor();await extraButton(panel).focus();await page.keyboard.press('Space');
                await page.locator('.watchguard-extras-dialog').getByText(/Future-dated.*Unwatched/).waitFor();
                await page.screenshot({path:path.join(output,'extra-series-'+width+'.png')});
                await page.locator('.watchguard-extras-dialog').getByRole('button',{name:'Close',exact:true}).click();
                assert.equal(await panel.evaluate(e=>e.scrollWidth<=e.clientWidth),true);
                await page.screenshot({path:path.join(output,'extra-series-inline-'+width+'.png')});
            }
            await page.setViewportSize({width:1280,height:900});
            assert.deepEqual(await api('/WatchGuard/Protection/'+historySeries),protectionBeforeExtras);
            // Per-user watched flag updates, while the same available episode remains outside aired progress.
            await api('/UserItems/'+latest+'/UserData','POST',{Played:true,PlaybackPositionTicks:0,LastPlayedDate:activityDate},member.AccessToken);
            assert.equal(owner(await activity()).EpisodeProgress.ExtraEpisodes[0].Watched,true);
            // Native IsUnaired includes release day. Classification must not call that future-dated.
            const releaseDay=new Date();releaseDay.setUTCHours(0,0,0,0);
            await api('/Items/'+latest,'POST',{...originals.at(-1),PremiereDate:releaseDay.toISOString()});
            assert.equal(owner(await activity()).EpisodeProgress.ExtraEpisodes[0].ReleaseStatus,'ReleaseDay');
            await api('/Items/'+latest,'POST',{...originals.at(-1),PremiereDate:null});
            const unknownExtras=await api('/WatchGuard/SeriesActivity/'+historySeries);
            const unknownViewer=unknownExtras.Users.find(u=>u.UserId.replaceAll('-','')===member.User.Id.replaceAll('-',''));
            assert.equal(unknownViewer.CoverageComplete,false);assert.ok(!unknownViewer.Reasons.includes('CaughtUp'));
            assert.equal(unknownViewer.EpisodeProgress.ExtraEpisodes[0].ReleaseStatus,'UnknownDate');
            await assert.rejects(api('/WatchGuard/Protection/'+historySeries));
            await api('/Items/'+latest,'POST',{...originals.at(-1),PremiereDate:new Date(Date.now()+7*86400000).toISOString()});
            report.extraEpisodes={status:'PASS',viewports:[1280,390],keyboard:['Enter','Space','Escape'],nativeDates:['Future','ReleaseDay','UnknownDate'],protectionUnchanged:true};

            // Fresh deletion protection deliberately keeps its original all-available episode policy.
            assert.equal((await api('/WatchGuard/Protection/'+historySeries)).HasInterest,true);
            await api('/UserItems/'+latest+'/UserData','POST',{Played:true,PlaybackPositionTicks:0,LastPlayedDate:activityDate},member.AccessToken);
            for(const dto of originals)await api('/Items/'+dto.Id,'POST',dto);
            await api('/Items/'+historySeries,'POST',{...originalSeries,Status:'Ended'});
            assert.deepEqual(owner(await activity()).Reasons,['Watched']);
            await api('/Items/'+historySeries,'POST',originalSeries);
            assert.equal((await api('/WatchGuard/Watchlist','GET',undefined,member.AccessToken)).some(e=>e.ItemId.replaceAll('-','')===historySeries.replaceAll('-','')),false);
            report.paths.push({path:'Caught Up',result:'native Continuing/Ended, aired 4/4, new unwatched episode, future available 3/3, Watching filter, configurable fresh Caught Up protection, targeted viewers, Escape zero DELETE and no permanent membership'});
        }
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
            if (title === 'PoC Self' && fixture.standalone) {
                // Synthetic hostile display data tests the actual adapter/dialog, never a replacement UI.
                const unsafe='<img src=x onerror="window.wgUnsafe=true">'+'Very long name '.repeat(30);
                const targetRoute=url=>/\/(?:Items|UserItems)\/[^/]+$/.test(url.pathname) && url.pathname.endsWith(fixture.items[title]);
                await page.route(targetRoute,async route=>{const response=await route.fetch();const data=await response.json();await route.fulfill({response,json:{...data,Name:unsafe}});});
                await page.route('**/WatchGuard/Protection/*',async route=>{
                    const response=await route.fetch();const data=await response.json();
                    data.Users[0].DisplayName=unsafe;data.Users[0].Reasons=['Watchlisted','InProgress','CurrentlyPlaying'];
                    data.Users.push({UserId:member.User.Id,DisplayName:unsafe,Reasons:['Watchlisted','InProgress','CurrentlyPlaying']});data.HasOtherInterestedUsers=true;
                    await route.fulfill({response,json:data});
                });
                const bookmark=page.getByRole('button',{name:'Remove from Watchlist',exact:true});await bookmark.focus();
                const before=report.deletes.length;
                await page.evaluate(id=>{window.wgDialogOutcome=null;window.ApiClient.deleteItem(id).then(()=>window.wgDialogOutcome='approved',e=>window.wgDialogOutcome=e.name);},fixture.items[title]);
                await dialog().waitFor();assert.equal(await dialog().count(),1);
                assert.equal(await dialog().locator('.watchguard-dialog-person').count(),2);
                assert.equal(await dialog().locator('.watchguard-dialog-reasons span').count(),6);
                assert.ok((await dialog().locator('.watchguard-dialog-target').textContent()).includes(unsafe));
                assert.equal(await dialog().locator('img,script,iframe').count(),0);
                assert.equal(await page.evaluate(()=>window.wgUnsafe),undefined);
                assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Cancel');
                await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Delete Anyway');
                await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Cancel');
                await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Delete Anyway');
                await page.keyboard.press('Shift+Tab');
                for(const [width,height,label] of [[1280,900,'desktop'],[390,700,'mobile']]) {
                    await page.setViewportSize({width,height});
                    const bounds=await dialog().boundingBox();assert.ok(bounds.x>=0 && bounds.width<=width && bounds.y>=0 && bounds.height<=height);
                    assert.equal(await dialog().evaluate(d=>d.scrollWidth<=d.clientWidth+1),true);
                    const actions=await dialog().getByRole('button',{name:'Cancel',exact:true}).boundingBox();assert.ok(actions.y>=0 && actions.y+actions.height<=height);
                    await page.screenshot({path:path.join(output,'deletion-long-'+label+'.png')});
                }
                await page.keyboard.press('Enter'); // Initially safe action remains deliberate even after keyboard traversal.
                await page.waitForFunction(()=>window.wgDialogOutcome==='AbortError');
                assert.equal(report.deletes.length,before);assert.equal(await bookmark.evaluate(e=>e===document.activeElement),true);
                await page.unroute(targetRoute);await page.unroute('**/WatchGuard/Protection/*');await page.setViewportSize({width:1280,height:900});
                report.paths.push({path:'Structured confirmation accessibility',result:'unsafe long title/names rendered literally; separate ownership and six reasons; modal focus cycle, Cancel Enter and focus restoration; desktop/mobile bounds and zero DELETE'});
                await page.evaluate(id=>{
                    const client=window.ApiClient, token=client.accessToken(), user=client.getCurrentUserId();
                    window.wgRestoreIdentity=()=>{client.setAuthenticationInfo(token,user);delete window.wgRestoreIdentity;};
                    window.wgDialogOutcome=null;
                    client.deleteItem(id).then(()=>window.wgDialogOutcome='approved',e=>window.wgDialogOutcome=e.name);
                },fixture.items[title]);
                await dialog().waitFor();await page.evaluate(()=>window.ApiClient.clearAuthenticationInfo());
                await page.waitForFunction(()=>window.wgDialogOutcome==='AbortError' && !document.querySelector('.watchguard-deletion-dialog'));
                assert.equal(report.deletes.length,before);
                await page.evaluate(()=>window.wgRestoreIdentity());await detail(title);
                report.paths.push({path:'Identity change during confirmation',result:'native ApiClient authentication cleared while open; lifetime cancels and removes dialog with zero DELETE; restored identity loads normally'});


                await nativeDelete(); await nativeConfirm();
                await dialog().getByText(/This title is on your watchlist/).waitFor(); await page.screenshot({path:path.join(output,'deletion-self.png')}); await cancel(title);
                for(const dismissal of [true,'close']) { await nativeDelete(); await nativeConfirm(); await cancel(title,dismissal); }
                // Same disposable title: verify native self resume and active playback independently.
                await api('/WatchGuard/Watchlist/' + fixture.items[title],'DELETE');
                await api('/UserItems/' + fixture.items[title] + '/UserData','POST',{Played:false,PlaybackPositionTicks:10000000});
                await nativeDelete(); await nativeConfirm();
                await dialog().getByText(/You haven't finished watching this title/).waitFor(); await cancel(title);
                await api('/UserItems/' + fixture.items[title] + '/UserData','POST',{Played:false,PlaybackPositionTicks:0});
                await api('/Sessions/Playing','POST',{ItemId:fixture.items[title],PlayMethod:'DirectPlay',PositionTicks:0});
                await nativeDelete(); await nativeConfirm();
                await dialog().getByText(/You are currently playing this title/).waitFor(); await cancel(title);
                await api('/Sessions/Playing/Stopped','POST',{ItemId:fixture.items[title],PositionTicks:0});
                await api('/WatchGuard/Watchlist/' + fixture.items[title],'PUT');
                await nativeDelete(); await nativeConfirm(); await approve(title);
                report.paths.push({path:'Self-only protection',result:'watchlist, native resume and session each Cancel with zero DELETE; override exactly once'});
                continue;
            }
            const response = page.waitForResponse(r => r.request().method()==='DELETE' && new URL(r.url()).pathname.endsWith('/Items/' + fixture.items[title]));
            await nativeDelete(); await nativeConfirm(); assert.equal((await response).status(),204);
            assert.equal(await dialog().count(),0); await exists(fixture.items[title],404); await nativeReturned();
            report.paths.push({path:title,result:'native deletion without extra WatchGuard warning'});
        }
        // Use the source-verified saved layout preference; never inject a replacement adapter.
        for (const [layout,title] of [['desktop-legacy','PoC Layout Legacy'],['modern','PoC Layout Modern']]) {
            report.phase = layout;
            await api('/WatchGuard/Watchlist/' + fixture.items[title],'PUT',undefined,member.AccessToken);
            await applyLayout(layout);
            await detail(title);
            assert.equal(await page.locator('.skinHeader').isVisible(),layout==='desktop-legacy');
            await page.getByRole('button',{name:'Add to Watchlist',exact:true}).waitFor();
            assert.equal(await page.locator('.mainDetailButtons .watchguard-toggle').count(),1);
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
        await applyLayout(null);
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
                await page.goto(fixture.base + '/web/#/details?id=' + target.Id + '&serverId=' + fixture.serverId);
                await page.locator('#itemDetailPage:visible .btnMoreCommands:visible').waitFor();
                await page.waitForFunction(()=>window.WatchGuardPoc?.isInstalled());
                await page.getByRole('button',{name:'Add to Watchlist',exact:true}).waitFor();
                await openInterest();
                if (interested) {
                    await page.locator('.watchguard-interest').filter({hasText:'Series: ' + parentTitle}).waitFor();
                    await page.locator('.watchguard-interest').getByText('BrowserMember',{exact:true}).waitFor();
                    await page.screenshot({path:path.join(output,'inline-' + target.Type.toLowerCase() + '.png')});
                }
                await page.keyboard.press('Escape');
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
                    assert.ok((await dialog().innerText()).includes('Deleting ' + target.Type.toLowerCase()));
                    assert.ok((await dialog().innerText()).includes(target.Name));
                    assert.ok((await dialog().innerText()).includes('parent series: ' + parentTitle));
                    await page.screenshot({path:path.join(output,'parent-' + target.Type + '-warning.png')});
                    await cancel(label);
                    await nativeDelete(); await nativeConfirm(); await approve(label);
                } else {
                    const response = page.waitForResponse(r=>r.request().method()==='DELETE' && new URL(r.url()).pathname.endsWith('/Items/' + target.Id));
                    await nativeDelete(); await nativeConfirm(); assert.equal((await response).status(),204);
                    assert.equal(await dialog().count(),0); await exists(target.Id,404); await nativeReturned();
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
        report.phase = 'Native membership actions';
        report.nativeMenuEvents=menuEvents;
        await detail('PoC Context Movie');
        const detailMembershipNode=fixture.standalone ? await page.locator('#itemDetailPage:visible .watchguard-toggle').elementHandle() : null;
        await page.locator('#itemDetailPage:visible .btnMoreCommands:visible').click();
        const ownCommand=()=>page.locator('.actionSheet.opened .watchguard-native-action');
        await ownCommand().getByText('Add to Watchlist',{exact:true}).waitFor();
        await page.screenshot({path:path.join(output,'native-menu.png')});
        await ownCommand().press('Enter');await ownCommand().getByText('Remove from Watchlist',{exact:true}).waitFor();
        await page.locator('.dialogContainer').filter({has:page.locator('.watchguard-native-action')}).click({position:{x:5,y:5}});await ownCommand().waitFor({state:'detached'});
        await page.getByRole('button',{name:'Remove from Watchlist',exact:true}).waitFor();
        if (fixture.standalone) assert.ok(await detailMembershipNode.evaluate(e=>e.isConnected && e===document.querySelector('#itemDetailPage:not(.hide) .watchguard-toggle')),
            'A native menu membership update retains the existing detail action');
        await movies();await card('PoC Context Movie').click({button:'right'});
        await ownCommand().getByText('Remove from Watchlist',{exact:true}).waitFor();assert.equal(await ownCommand().count(),1);
        await ownCommand().click();await ownCommand().getByText('Add to Watchlist',{exact:true}).waitFor();
        await page.locator('.dialogContainer').filter({has:page.locator('.watchguard-native-action')}).click({position:{x:5,y:5}});await ownCommand().waitFor({state:'detached'});
        await card('PoC Context Movie').click({button:'right'});
        await ownCommand().getByText('Add to Watchlist',{exact:true}).waitFor();
        await page.route('**/WatchGuard/Watchlist/*',route=>route.fulfill({status:503,body:'unavailable'}));
        await ownCommand().click();await ownCommand().getByRole('alert').waitFor();
        await page.unroute('**/WatchGuard/Watchlist/*');await page.locator('.dialogContainer').filter({has:page.locator('.watchguard-native-action')}).click({position:{x:5,y:5}});await ownCommand().waitFor({state:'detached'});
        report.paths.push({path:'Native membership menus',result:'detail and poster menu add/remove, own state, duplicate prevention, detail consistency and failed mutation feedback passed'});
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
        await selectOwner('all');
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
        if (fixture.standalone) {
            const administratorMemberships=await api('/WatchGuard/Watchlist');
            await page.getByRole('button',{name:'Add to Watchlist',exact:true}).click();
            const remove=page.getByRole('button',{name:'Remove from Watchlist',exact:true});await remove.waitFor();
            assert.equal(await remove.locator('.material-icons').textContent(),'bookmark_remove');
            await remove.click();await page.getByRole('button',{name:'Add to Watchlist',exact:true}).waitFor();
            assert.deepEqual(await api('/WatchGuard/Watchlist'),administratorMemberships,'Switched account cannot alter the previous account memberships');
            await exists(fixture.items['PoC Modern Movie']);
        }
        report.paths.push({path:'Account switch',result:'old controls removed on sign-out; normal-user detail has no cross-user indicator'});
        await page.getByRole('link',{name:'Watchlists',exact:true}).click();
        await myList().getByRole('link',{name:'PoC Parent Interested',exact:true}).waitFor();
        assert.equal(await myList().getByRole('link',{name:'PoC Self',exact:true}).count(),0);
        assert.equal(await myList().locator('.watchguard-owners').count(),0);
        assert.equal(await myList().getByRole('combobox',{name:'Watchlist owner'}).isVisible(),false);
        await page.goBack();
        const policy = {...member.User.Policy, EnableContentDeletion:true};
        await api('/Users/' + member.User.Id + '/Policy','POST',policy);
        await page.reload(); await page.locator('#itemDetailPage:visible .btnMoreCommands:visible').waitFor();
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
        console.log('PASS: mandatory native movie/series details, right-click menu, Escape, and bulk selection checks; fresh interest check precedes every observed DELETE. Historical limitations: '+report.knownLimitations.length+' (reported separately, not passes).');
        fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    } catch (error) {
        console.log('Failed phase:', report.phase);
        // Navigations can invalidate the page execution context while gathering
        // diagnostics. Never replace the original test failure with a diagnostic error.
        console.error('Original browser regression failure:',error.stack || String(error));
        if (fixture.standalone) {
            const standaloneState=await page.evaluate(()=>({state:window.WatchGuardStandalone?.status(),adapter:!!window.WatchGuardPoc,script:!!document.querySelector('#watchguard-standalone-loader')})).catch(err=>({diagnosticUnavailable:String(err)}));
            console.log('Standalone diagnostic:',standaloneState,nativeErrors.slice(-5));
        }
        await readiness.failure(page,{...fixture,output},'native-ui',error).catch(()=>console.warn('Additional browser evidence unavailable'));
        fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
        await page.screenshot({path:path.join(output,'failure.png')}).catch(err=>console.warn('Failure screenshot unavailable:',String(err)));
        throw error;
    } finally { await browser.close(); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
