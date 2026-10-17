// Test-only readiness contracts. No deletion/approval retry is permitted here.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const observations = new WeakMap();
const setupAttempts = new WeakMap();
const key = value => String(value || '').replaceAll('-', '').toLowerCase();
async function identity(page, fixture) {
    await page.waitForFunction(() => window.ApiClient?.getCurrentUserId?.() && window.WatchGuardPoc?.isInstalled(), null, {timeout: 15000});
    const actual = await page.evaluate(async () => {
        const api = window.ApiClient;
        const user = await api.getCurrentUser(false);
        return {userId: api.getCurrentUserId(), nativeUserId: user.Id, serverId: api.serverId(), address: api.serverAddress()};
    });
    assert.equal(key(actual.userId), key(fixture.userId), 'Active ApiClient user');
    assert.equal(key(actual.nativeUserId), key(fixture.userId), 'Native authenticated user');
    assert.equal(key(actual.serverId), key(fixture.serverId), 'Active ApiClient server');
    assert.equal(new URL(actual.address).origin, new URL(fixture.base).origin, 'Active ApiClient origin');
    assert.equal(new URL(actual.address).pathname.replace(/\/$/,''),new URL(fixture.base).pathname.replace(/\/$/,''),'Active ApiClient base path');
}
function timing(fixture,phase,ms) {
    const output=fixture.output||fixture.reportDirectory;
    if(!output)return;
    fs.mkdirSync(output,{recursive:true});
    fs.writeFileSync(path.join(output,'browser-timing-'+phase+'.json'),JSON.stringify({phase,ms,status:'PASS'})+'\n');
}
// Jellyfin may switch from the user chooser to the username/password form
// while Playwright is preparing the Manual Login click. Accept that legitimate
// transition; do not retry authentication or bypass any native login control.
async function revealManualLogin(page) {
    const username=page.locator('#txtManualName');
    if (!(await username.isVisible())) {
        const manual=page.getByRole('button',{name:'Manual Login',exact:true});
        try {
            await manual.click({timeout:3000});
        } catch (error) {
            // A disappearing chooser button is fine only when Jellyfin has
            // already revealed the actual username field. Otherwise fail.
            if (!(await username.isVisible())) throw error;
        }
    }
    await username.waitFor({state:'visible',timeout:15000});
}
async function login(page, fixture) {
    const started=Date.now();
    let networkChanged=false;
    // Docker can change the fixture's network when the disposable Caddy proxy
    // is attached. Observe real Chromium transport failures; retry only this
    // pre-authentication navigation, never an approval or DELETE.
    const observeFailure=request=>{
        if (String(request.failure()||'').includes('ERR_NETWORK_CHANGED')) networkChanged=true;
    };
    const observeConsole=message=>{
        if (message.type()==='error' && message.text().includes('ERR_NETWORK_CHANGED')) networkChanged=true;
    };
    page.on('requestfailed',observeFailure);
    page.on('console',observeConsole);
    try {
        for (let attempt=0; attempt<2; attempt++) {
            try {
                await page.goto(fixture.base + '/web/');
                // Once a disposable second user becomes visible on Jellyfin's
                // native login page, the manual username form is collapsed
                // behind its "Manual Login" control. Both layouts are valid.
                await page.waitForFunction(() => {
                    const input=document.querySelector('#txtManualName');
                    if (input?.getClientRects().length) return true;
                    return Array.from(document.querySelectorAll('button, a')).some(el =>
                        el.getClientRects().length && el.textContent.trim()==='Manual Login');
                },null,{timeout:15000});
                await revealManualLogin(page);
                break;
            } catch (error) {
                if (attempt !== 0 || !(networkChanged || String(error.message).includes('ERR_NETWORK_CHANGED'))) throw error;
                // Preserve screenshots, sanitized traces and timing of the
                // initial network failure before the one permitted navigation retry.
                await setupRetry(page,fixture,'login-network-changed');
                networkChanged=false;
            }
        }
    } finally {
        page.off('requestfailed',observeFailure);
        page.off('console',observeConsole);
    }
    await page.locator('#txtManualName').fill(fixture.username);
    await page.locator('#txtManualPassword').fill(fixture.password);
    await page.getByRole('button', {name: 'Sign In', exact: true}).click();
    // Script installation can precede the login router's Home navigation.
    await page.waitForURL(url => url.hash.split('?')[0] === '#/home', {timeout: 30000});
    await page.getByRole('heading', {name: 'My Media', exact: true}).waitFor();
    await identity(page, fixture);
    timing(fixture,fixture.legacyScript?'old-tab-login':fixture.proxy?'proxy-login':fixture.legacy?'web-only-login':'current-login',Date.now()-started);
}
async function detail(page, fixture, id) {
    await identity(page, fixture);
    await page.goto(fixture.base + '/web/#/details?id=' + encodeURIComponent(id) + '&serverId=' + encodeURIComponent(fixture.serverId));
    await page.waitForFunction(expected => {
        const query = new URLSearchParams(location.hash.split('?')[1]);
        const same = value => String(value || '').replaceAll('-', '').toLowerCase();
        return location.hash.startsWith('#/details?') && same(query.get('id')) === same(expected) &&
            window.WatchGuardPoc?.isInstalled() && Boolean(document.querySelector('#itemDetailPage:not(.hide) .nameContainer')?.textContent.trim());
    }, id, {timeout: 15000});
    await identity(page, fixture);
    const resolved = await page.evaluate(async id => (await ApiClient.getItem(ApiClient.getCurrentUserId(), id)).Id, id);
    assert.equal(key(resolved), key(id), 'Native detail item resolution');
    assert.equal(key(new URLSearchParams(new URL(page.url()).hash.split('?')[1]).get('id')), key(id), 'Route must remain on requested item');
}
async function capture(page) {
    await page.addInitScript(()=>{
        window.wgFixtureView={serial:0};
        document.addEventListener('viewshow',event=>{
            const query=new URLSearchParams(location.hash.split('?')[1]);
            window.wgFixtureView={serial:window.wgFixtureView.serial+1,
                id:event.detail?.params?.id||query.get('id'),
                parentId:event.detail?.params?.parentId||query.get('parentId'),
                topParentId:event.detail?.params?.topParentId||query.get('topParentId'),
                route:location.hash.split('?')[0]};
        });
    });
    const events=[];
    observations.set(page,events);
    const add=event=>{if(events.length===200)events.shift();events.push({ms:Date.now(),...event});};
    const safe=text=>String(text).replace(/(?:Bearer|Token[=\s]*|password[=:]\s*)[^\s,]+/gi,'[REDACTED]').replace(/[A-Za-z0-9_-]{32,}/g,'[IDENTIFIER]').slice(0,300);
    page.on('pageerror',error=>add({kind:'pageerror',message:safe(error.message)}));
    page.on('console',message=>{if(message.type()==='error')add({kind:'console-error',message:safe(message.text())});});
    page.on('framenavigated',frame=>{if(frame===page.mainFrame())add({kind:'navigation',route:new URL(frame.url()).hash.split('?')[0]});});
    page.on('response',response=>{
        const url=new URL(response.url());
        const method=response.request().method();
        const phase=url.pathname.includes('/ServerApproval/')?'approval':url.pathname.includes('/Protection/')?'protection':method==='DELETE'?'delete':null;
        if(phase)add({kind:'response',phase,method,status:response.status()});
    });
    await page.context().tracing.start({screenshots:true, snapshots:false, sources:false});
}
async function failure(page, fixture, label, error) {
    if (!page || !fixture.output) return;
    const state = await page.evaluate(() => ({
        route: location.hash.split('?')[0],
        redactedUrl:location.origin+location.pathname+location.hash.split('?')[0],
        authenticated: Boolean(window.ApiClient?.getCurrentUserId?.()),
        actualIdentity: {userId:window.ApiClient?.getCurrentUserId?.()||null,serverId:window.ApiClient?.serverId?.()||null},
        installed: Boolean(window.WatchGuardPoc?.isInstalled()),
        controls: Array.from(document.querySelectorAll('.btnMoreCommands,dialog.watchguard-deletion-dialog')).map(el => ({
            tag: el.tagName, classes: el.className, visible: !!el.getClientRects().length,
            open: el.open === true
        }))
    }));
    if(error)state.failure={name:error.name,message:String(error.message).replace(/[A-Za-z0-9_-]{32,}/g,'[IDENTIFIER]').slice(0,1000)};
    state.expectedBase=fixture.base;
    state.expectedIdentity={userId:fixture.userId||null,serverId:fixture.serverId||null};
    state.chronology=observations.get(page)||[];
    fs.mkdirSync(fixture.output, {recursive: true});
    fs.writeFileSync(path.join(fixture.output, label + '-readiness.json'), JSON.stringify(state, null, 2));
    await page.screenshot({path: path.join(fixture.output, label + '-failure.png')});
    const temp=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'watchguard-trace-'));
    try {
        const raw=path.join(temp,'raw.zip');
        await page.context().tracing.stop({path:raw});
        require('node:child_process').execFileSync('python3',[path.join(__dirname,'sanitize_trace.py'),raw,path.join(fixture.output,label+'-trace.zip')]);
    } finally { fs.rmSync(temp,{recursive:true,force:true}); }
}
async function setupRetry(page,fixture,label) {
    const attempt=(setupAttempts.get(page)||0)+1;
    assert.ok(attempt<=2,'Bounded pre-authentication navigation retries exhausted');
    setupAttempts.set(page,attempt);
    label+='-'+attempt;
    await failure(page,fixture,label).catch(()=>console.warn('Initial setup failure capture unavailable'));
    const output=fixture.output;
    if(output)fs.writeFileSync(path.join(output,label+'-attempt.json'),JSON.stringify({retry:true,operation:'login-navigation',cause:'ERR_NETWORK_CHANGED'}));
    await page.context().tracing.start({screenshots:true,snapshots:false,sources:false});
}
module.exports = {identity, login, revealManualLogin, detail, failure, capture, setupRetry, timing};
