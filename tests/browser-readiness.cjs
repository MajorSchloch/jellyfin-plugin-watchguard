// Test-only readiness contracts. No deletion/approval retry is permitted here.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const observations = new WeakMap();
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
async function login(page, fixture) {
    await page.goto(fixture.base + '/web/');
    await page.locator('#txtManualName').fill(fixture.username);
    await page.locator('#txtManualPassword').fill(fixture.password);
    await page.getByRole('button', {name: 'Sign In', exact: true}).click();
    // Script installation can precede the login router's Home navigation.
    await page.waitForURL(url => url.hash.split('?')[0] === '#/home', {timeout: 30000});
    await page.getByRole('heading', {name: 'My Media', exact: true}).waitFor();
    await identity(page, fixture);
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
async function failure(page, fixture, label) {
    if (!page || !fixture.output) return;
    const state = await page.evaluate(() => ({
        route: location.hash.split('?')[0],
        authenticated: Boolean(window.ApiClient?.getCurrentUserId?.()),
        actualIdentity: {userId:window.ApiClient?.getCurrentUserId?.()||null,serverId:window.ApiClient?.serverId?.()||null},
        installed: Boolean(window.WatchGuardPoc?.isInstalled()),
        controls: Array.from(document.querySelectorAll('.btnMoreCommands,dialog.watchguard-deletion-dialog')).map(el => ({
            tag: el.tagName, classes: el.className, visible: !!el.getClientRects().length,
            open: el.open === true
        }))
    }));
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
module.exports = {identity, login, detail, failure, capture};
