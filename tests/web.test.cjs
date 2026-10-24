const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createAdapter, confirmDeletion, message } = require('../Jellyfin.Plugin.WatchGuard/Web/watchguard.js');

function fixture(ask = async () => false, original) {
    const calls = [], events = [];
    let user = 'test-user';
    const api = { getCurrentUserId: () => user, deleteItem: original || async function (...args) { calls.push({ receiver: this, args }); return 'native-result'; } };
    const adapter = createAdapter(ask, (...values) => events.push(values));
    adapter.install(api);
    return { api, calls, events, adapter, setUser: value => { user = value; } };
}
test('Cancel prevents native method from being called', async () => {
    const f = fixture(async text => { assert.equal(text, 'WatchGuard: This item may still be in use.'); return false; });
    await assert.rejects(f.api.deleteItem('movie'), { name: 'AbortError' });
    assert.equal(f.calls.length, 0);
    assert.deepEqual(f.events.map(e => e[0]), ['installed', 'intercepted', 'confirmation-opened', 'cancelled']);
});
test('Delete Anyway invokes original once with exact receiver, arguments and fulfillment value', async () => {
    const value = {}, args = ['series', { extra: true }, undefined]; let count = 0;
    const receiver = {};
    const f = fixture(async () => true, function (...actual) {
        count++; assert.equal(this, receiver); assert.deepEqual(actual, args); assert.equal(actual[1], args[1]); return Promise.resolve(value);
    });
    assert.equal(await f.api.deleteItem.apply(receiver, args), value); assert.equal(count, 1);
});
test('waiting for confirmation makes no native call', async () => {
    let answer;
    const f = fixture(() => new Promise(resolve => { answer = resolve; }));
    const pending = f.api.deleteItem('movie'); await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.calls.length, 0); answer(true); await pending; assert.equal(f.calls.length, 1);
});
test('native permission rejection propagates unchanged', async () => {
    const failure = { status: 403 };
    const f = fixture(async () => true, () => Promise.reject(failure));
    await assert.rejects(f.api.deleteItem('movie'), error => error === failure);
});
test('synchronous native errors become rejected promises without retry', async () => {
    const failure = new Error('native'); let count = 0;
    const f = fixture(async () => true, () => { count++; throw failure; });
    await assert.rejects(f.api.deleteItem('movie'), error => error === failure); assert.equal(count, 1);
});
test('only explicit true approves; dialog failures fail closed', async () => {
    for (const ask of [() => undefined, () => 'true', () => Promise.reject(new Error('dialog')), () => { throw new Error('dialog'); }]) {
        const f = fixture(ask); await assert.rejects(f.api.deleteItem('movie')); assert.equal(f.calls.length, 0);
    }
});
test('cancellation does not poison a later attempt', async () => {
    let yes = false; const f = fixture(async () => yes);
    await assert.rejects(f.api.deleteItem('movie')); yes = true;
    await f.api.deleteItem('movie'); assert.equal(f.calls.length, 1);
});
test('bulk calls are confirmed independently and prompts are serialized', async () => {
    let active = 0, questions = 0;
    const f = fixture(async () => { assert.equal(active++, 0); const yes = questions++ === 1; await Promise.resolve(); active--; return yes; });
    const result = await Promise.allSettled([f.api.deleteItem('a'), f.api.deleteItem('b'), f.api.deleteItem('c')]);
    assert.deepEqual(result.map(r => r.status), ['rejected', 'fulfilled', 'rejected']);
    assert.deepEqual(f.calls.map(c => c.args), [['b']]);
});
test('account change while confirming cancels', async () => {
    const f = fixture(async () => { f.setUser('different'); return true; });
    await assert.rejects(f.api.deleteItem('movie')); assert.equal(f.calls.length, 0);
});
test('repeated installation does not stack; a replaced method is reported but not patched again', async () => {
    const f = fixture(async () => true); const installed = f.api.deleteItem;
    assert.equal(f.adapter.install(f.api), true); assert.equal(f.api.deleteItem, installed);
    await f.api.deleteItem('movie'); assert.equal(f.calls.length, 1);
    const replacement = async () => {}; f.api.deleteItem = replacement;
    assert.equal(f.adapter.install(f.api), false); assert.equal(f.adapter.isInstalled(f.api), false);
    assert.equal(f.api.deleteItem, replacement);
    f.adapter.install(f.api); assert.equal(f.events.filter(e => e[0] === 'adapter-replaced').length, 1);
});
test('diagnostics contain only fixed event names and counters, never arguments or error payloads', async () => {
    const f = fixture(async () => true, () => Promise.reject({ token: 'SECRET' }));
    await assert.rejects(f.api.deleteItem('SECRET', { url: 'SECRET' }));
    assert.ok(!JSON.stringify(f.events).includes('SECRET'));
    assert.ok(f.events.every(e => e.length === 2 && typeof e[0] === 'string' && Number.isInteger(e[1])));
});
test('logging failure cannot skip the gate and immutable clients fail visibly', async () => {
    const api = { deleteItem: () => assert.fail('native invoked') };
    const adapter = createAdapter(async () => false, () => { throw new Error('logger'); });
    adapter.install(api); await assert.rejects(api.deleteItem('a'));
    assert.equal(adapter.install(Object.freeze({ deleteItem() {} })), false);
});

// Small DOM fixture exercises event settlement, not Jellyfin integration/layout.
function documentFixture() {
    const nodes = [];
    const focus = { isConnected: true, focus() { this.restored = true; } };
    const doc = { activeElement: focus, body: { append(node) { nodes.push(node); } }, createElement(tag) {
        return { tag, style: {}, children: [], events: {}, attributes: {}, setAttribute(k,v) { this.attributes[k]=v; }, getAttribute(k) { return this.attributes[k] ?? null; },
            insertBefore(child, before) { child.remove(); child.parent = this; child.removed = false; const at = this.children.indexOf(before); this.children.splice(at < 0 ? this.children.length : at, 0, child); },
            append(...children) { for(const child of children) { child.remove(); child.parent = this; child.removed = false; this.children.push(child); } }, addEventListener(event, fn) { this.events[event] = fn; },
            showModal() { this.opened = true; }, focus() { this.focused = true; }, remove() { if(this.parent) this.parent.children = this.parent.children.filter(c=>c!==this); this.parent = null; this.removed = true; } };
    } };
    return { doc, nodes, focus };
}
function descendants(node) { return [node, ...node.children.flatMap(descendants)]; }
function button(dialog, label) { return descendants(dialog).find(n=>n.tag==='button' && n.textContent===label); }
function textOf(node) { return descendants(node).map(n=>n.textContent || '').join(' '); }
function warningText(warning) {
    const f=documentFixture();const pending=confirmDeletion(f.doc,warning);const text=textOf(f.nodes[0]);button(f.nodes[0],'Cancel').onclick();return text;
}
test('dialog Cancel, Escape and close all cancel and restore focus', async () => {
    for (const action of ['button', 'cancel', 'close']) {
        const f = documentFixture(); const result = confirmDeletion(f.doc, message); const dialog = f.nodes[0];
        assert.ok(textOf(dialog).includes(message));
        assert.equal(dialog.attributes['aria-labelledby'],'watchguard-delete-title');
        assert.equal(dialog.attributes['aria-describedby'],'watchguard-delete-description');
        assert.equal(button(dialog,'Cancel').focused, true);
        if (action === 'button') button(dialog,'Cancel').onclick();
        else dialog.events[action]({ preventDefault() {} });
        assert.equal(await result, false); assert.equal(dialog.removed, true); assert.equal(f.focus.restored, true);
    }
});
test('double approval settles once', async () => {
    const f = documentFixture(); const result = confirmDeletion(f.doc, message); const dialog = f.nodes[0];
    assert.equal(button(dialog,'Delete Anyway').type, 'button');
    button(dialog,'Delete Anyway').onclick(); button(dialog,'Delete Anyway').onclick(); dialog.events.close(); assert.equal(await result, true);
});

const { protectionCheck, validateStatus } = require('../Jellyfin.Plugin.WatchGuard/Web/watchguard.js');
function backendFixture(users = []) {
    let native = 0, prompts = 0;
    const api = { getCurrentUserId: () => 'self', accessToken: () => 'token', getUrl: p => p,
        getItem: async () => ({ Id: 'movie', Type: 'Movie' }),
        ajax: async () => ({ ItemId: 'movie', HasInterest: users.length > 0, HasOtherInterestedUsers: users.some(u => u.UserId !== 'self'), Users: users }),
        deleteItem: async () => { native++; } };
    createAdapter(async () => { prompts++; return true; }, undefined, protectionCheck).install(api);
    return { api, counts: () => [native, prompts] };
}
test('confirmed empty status skips the extra warning', async () => {
    const f = backendFixture(); await f.api.deleteItem('movie'); assert.deepEqual(f.counts(), [1, 0]);
});
test('self-only and combined interest warn for every supported target without extra checks', async () => {
    for (const type of ['Movie','Series','Season','Episode']) for (const reason of ['Watchlisted','InProgress','CurrentlyPlaying','CaughtUp']) {
        for (const approved of [false,true]) {
            let calls=0, checks=0, lookups=0;
            const api={getCurrentUserId:()=> 'self',accessToken:()=> 'token',getUrl:p=>p,
                getItem:async(u,id)=>{lookups++;return id==='parent'?{Id:id,Type:'Series',Name:'Parent'}:{Id:id,Type:type,SeriesId:'parent'};},
                ajax:async()=>{checks++;return {ItemId:['Season','Episode'].includes(type)?'parent':'target',HasInterest:true,HasOtherInterestedUsers:false,Users:[{UserId:'self',DisplayName:'Me',Reasons:[reason]}]};},
                deleteItem:async(...args)=>{calls++;assert.deepEqual(args,['target',42]);return 'native-result';}};
            createAdapter(async text=>{assert.ok(warningText(text).includes({CaughtUp:'You are caught up and waiting for new episodes.',Watchlisted:'This title is on your watchlist.',InProgress:"You haven't finished watching this title.",CurrentlyPlaying:'You are currently playing this title.'}[reason]));return approved;},undefined,protectionCheck).install(api);
            if(approved)assert.equal(await api.deleteItem('target',42),'native-result');else await assert.rejects(api.deleteItem('target',42),{name:'AbortError'});
            assert.equal(calls,approved?1:0);assert.equal(checks,1);assert.equal(lookups,['Season','Episode'].includes(type)?2:1);
        }
    }
});
test('self and other users keep distinct wording and multiple reasons',async()=>{
    const f=backendFixture([{UserId:'self',DisplayName:'Me',Reasons:['Watchlisted','InProgress']},{UserId:'other',DisplayName:'Other',Reasons:['Watchlisted','CurrentlyPlaying']}]);
    const text=warningText(await protectionCheck(f.api,'movie','self'));
    assert.match(text,/This title is on your watchlist/);assert.match(text,/You haven't finished watching/);assert.match(text,/Other\s+Watchlisted Currently Playing/);
});
test('other user multiple reasons needs one warning and one native call', async () => {
    const f = backendFixture([{ UserId: 'other', DisplayName: '<img onerror=evil()>', Reasons: ['Watchlisted', 'CurrentlyPlaying'] }]);
    await f.api.deleteItem('movie'); assert.deepEqual(f.counts(), [1, 1]);
});
test('failed, malformed, unauthorized and unsupported checks never invoke native deletion', async () => {
    for (const fail of [async () => { throw new Error('503'); }, async () => ({}), async () => ({ ItemId: 'movie', Users: [], HasInterest: true, HasOtherInterestedUsers: false })]) {
        const f = backendFixture(); f.api.ajax = fail;
        await assert.rejects(f.api.deleteItem('movie')); assert.deepEqual(f.counts(), [0, 0]);
    }
    const f = backendFixture(); f.api.getItem = async () => ({Id:'movie', Type:'Season'});
    await assert.rejects(f.api.deleteItem('movie')); assert.deepEqual(f.counts(), [0, 0]);
});
test('fresh lookup on every call and account change during lookup blocks native method', async () => {
    const f = backendFixture(); let checks = 0;
    const ajax = f.api.ajax; f.api.ajax = async () => { checks++; return ajax(); };
    await f.api.deleteItem('movie'); await f.api.deleteItem('movie'); assert.equal(checks, 2);
    f.api.ajax = async () => { f.api.accessToken = () => 'changed'; return ajax(); };
    await assert.rejects(f.api.deleteItem('movie')); assert.deepEqual(f.counts(), [2, 0]);
});
test('dialog renders untrusted content as text and closes on identity abort', async () => {
    const f = documentFixture(), abort = new AbortController();
    const pending = confirmDeletion(f.doc, '<img onerror=evil()>', true, abort.signal);
    assert.ok(textOf(f.nodes[0]).includes('<img onerror=evil()>'));
    abort.abort(); assert.equal(await pending, false);
});

test('episode and season scope uses verified parent, labels actual target and preserves deletion ID', async () => {
    for (const type of ['Episode', 'Season']) {
        const calls = [], lookups = [];
        const api = { getCurrentUserId: () => 'self', accessToken: () => 'token', getUrl: p => p,
            getItem: async (user, id) => { lookups.push(id); return id === 'target' ? {Id:id, Type:type, SeriesId:'parent', Name:'Target title'} : {Id:id, Type:'Series', Name:'Parent title'}; },
            ajax: async options => { assert.equal(options.url,'WatchGuard/Protection/parent'); return {ItemId:'parent',HasInterest:true,HasOtherInterestedUsers:true,Users:[{UserId:'other',DisplayName:'Other',Reasons:['Watchlisted']}]}; },
            deleteItem: async (...args) => calls.push(args) };
        createAdapter(async text => { assert.match(warningText(text),new RegExp('Deleting ' + type.toLowerCase() + ' Target title')); assert.match(warningText(text),/parent series: Parent title/); return true; },undefined,protectionCheck).install(api);
        await api.deleteItem('target'); assert.deepEqual(calls,[['target']]); assert.deepEqual(lookups,['target','parent']);
    }
});
test('episode and season with confirmed clear parent need no extra confirmation', async () => {
    for (const type of ['Episode','Season']) {
        const f = backendFixture();
        f.api.getItem = async (user,id) => id === 'child' ? {Id:id,Type:type,SeriesId:'movie'} : {Id:id,Type:'Series'};
        await f.api.deleteItem('child'); assert.deepEqual(f.counts(),[1,0]);
    }
});
test('missing, wrong-type, mismatched and failed parent resolution never deletes', async () => {
    for (const parent of [null,{Id:'parent',Type:'Movie'},{Id:'wrong',Type:'Series'},'throw']) {
        const f = backendFixture();
        f.api.getItem = async (user,id) => { if(id==='child')return {Id:id,Type:'Episode',SeriesId:'parent'}; if(parent==='throw')throw new Error('404'); return parent; };
        await assert.rejects(f.api.deleteItem('child')); assert.deepEqual(f.counts(),[0,0]);
    }
    for (const type of ['Episode','Season','Folder','BoxSet','Playlist','Unknown']) {
        const f = backendFixture(); f.api.getItem = async () => ({Id:'movie',Type:type});
        await assert.rejects(f.api.deleteItem('movie')); assert.deepEqual(f.counts(),[0,0]);
    }
});

test('Overview discards late responses after navigation or credential changes', async () => {
    const {watchlistsPage} = require('../Jellyfin.Plugin.WatchGuard/Web/watchguard.js');
    for (const action of ['abort','token']) {
        const f = documentFixture(), create = f.doc.createElement;
        f.doc.createElement = tag => { const node = create(tag); node.replaceChildren = () => { node.children = []; }; return node; };
        let complete, token = 'original';
        const api = {getCurrentUser:async()=>({Policy:{IsAdministrator:false}}),getCurrentUserId:()=> 'a'.repeat(32),accessToken:()=>token,getUrl:p=>p,serverId:()=> 'server',ajax:()=>new Promise(resolve=>{complete=resolve;})};
        const abort = new AbortController();
        const page = watchlistsPage(f.doc,api,abort.signal,'mine',()=>{});
        await new Promise(resolve=>setImmediate(resolve));
        assert.equal(page.children[2].textContent,'Loading watchlists…');
        if(action==='abort') abort.abort(); else token='another-account';
        complete({Items:[],IsComplete:false,LimitReached:false,Notice:'Not exhaustive'});
        await new Promise(resolve=>setImmediate(resolve));
        assert.equal(page.children[5].children.length,0);
        if(action==='abort') assert.equal(page.removed,true);
    }
});
const {selectInterest,watchlistsPage}=require('../Jellyfin.Plugin.WatchGuard/Web/watchguard.js');
const me='a'.repeat(32), other='b'.repeat(32);
const overviewItems=[{ItemId:'c'.repeat(32),Name:'Alpha',Users:[
    {UserId:me,DisplayName:'Me',Reasons:['Watchlisted'],LastPlayedDate:null},
    {UserId:other,DisplayName:'Other',Reasons:['Watchlisted','InProgress'],LastPlayedDate:'2026-10-01T00:00:00Z'}]},
    {ItemId:'d'.repeat(32),Name:'Beta',Users:[{UserId:me,DisplayName:'Me',Reasons:['CurrentlyPlaying'],LastPlayedDate:'2026-10-10T00:00:00Z'}]}];
test('Overview filters user and interest together, preserves reasons and sorts known playback dates',()=>{
    assert.equal(selectInterest(overviewItems,'all',me).length,2);
    assert.equal(selectInterest(overviewItems,'mine',me,['watching','playing'])[0].Name,'Beta');
    assert.deepEqual(selectInterest(overviewItems,other,me,'watching')[0].Users[0].Reasons,['Watchlisted','InProgress']);
    assert.equal(selectInterest(overviewItems,'all',me,'watchlisted').length,1);
    assert.equal(selectInterest(overviewItems,'all',me,'all','recent')[0].Name,'Beta');
    assert.equal(selectInterest(overviewItems,'all',me,'all','title')[0].Name,'Alpha');
    assert.equal(selectInterest(overviewItems,'mine',me,['watching','playing'])[0].IsWatchlistedByMe,false);
    assert.throws(()=>selectInterest([...overviewItems,overviewItems[0]],'all',me));
    assert.throws(()=>selectInterest([{...overviewItems[0],Users:[{UserId:me,DisplayName:'Me',Reasons:['Unknown']}]}],'all',me));
});
test('Overview renders text literally, distinguishes reasons and offers only explicit own removal',async()=>{
    const f=documentFixture(),create=f.doc.createElement;
    f.doc.createElement=tag=>{const n=create(tag);n.replaceChildren=()=>{n.children=[];};n.classList={add(){}};
        Object.defineProperty(n,'innerHTML',{set(){assert.fail('Untrusted HTML');}});return n;};
    const text='<img src=x onerror=alert(1)>';
    const items=structuredClone(overviewItems);items[0].Name=text;items[0].Users[1].DisplayName=text;
    const api={getCurrentUser:async()=>({Policy:{IsAdministrator:true}}),getCurrentUserId:()=>me,accessToken:()=> 'token',getUrl:p=>p,serverId:()=> 'server',getImageUrl:()=> '/image',
        ajax:async o=> o.url==='WatchGuard/Users' ? overviewItems[0].Users : o.url==='WatchGuard/Watchlists' ? [items[0]] : {Items:items.map(e=>({...e,Users:e.Users.map(u=>({...u,Reasons:u.Reasons.filter(r=>r!=='Watchlisted')})).filter(u=>u.Reasons.length)})),IsComplete:false,LimitReached:false,Notice:'Not exhaustive'}};
    const page=watchlistsPage(f.doc,api,new AbortController().signal,'all',()=>{});
    await new Promise(resolve=>setImmediate(resolve));
    const cards=page.children[5].children;
    assert.equal(cards.length,2);
    assert.equal(cards[0].children[0].children[1].textContent,text);
    assert.ok(cards[0].children[1].children[1].title.startsWith(text+' — Watchlist · Watching · Last played: '));
    assert.equal(descendants(cards[0]).filter(n=>n.className?.includes('watchguard-remove')).length,1);
    assert.equal(descendants(cards[1]).filter(n=>n.className?.includes('watchguard-remove')).length,0);
});
test('Personal overview rejects cross-user payloads even with forged owner filter',async()=>{
    const f=documentFixture(),create=f.doc.createElement;
    f.doc.createElement=tag=>{const n=create(tag);n.replaceChildren=()=>{n.children=[];};return n;};
    const api={getCurrentUser:async()=>({Policy:{IsAdministrator:false}}),getCurrentUserId:()=>me,accessToken:()=> 'token',getUrl:p=>p,
        ajax:async o=>o.url==='WatchGuard/Watchlist' ? [] : {Items:overviewItems,IsComplete:false,LimitReached:false,Notice:'Not exhaustive'}};
    const page=watchlistsPage(f.doc,api,new AbortController().signal,'all',()=>{});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(page.children[5].children.length,0);
    assert.match(page.children[4].textContent,/Viewing activity unavailable/);
});

function progressiveFixture(admin = true, preferences = false, owner = 'all', indexedActivity = false) {
    const f = documentFixture(), create = f.doc.createElement, calls = [];
    f.doc.createElement = tag => { const n = create(tag); n.replaceChildren = () => { for(const child of [...n.children]) child.remove(); }; n.classList = {add(){}}; return n; };
    let token = 'first';
    const api = {getCurrentUser:async()=>({Name:'Me',Policy:{IsAdministrator:admin}}),getCurrentUserId:()=>me,accessToken:()=>token,getUrl:p=>p,serverId:()=> 'server',getImageUrl:()=> '/image',
        ajax:o=>o.url==='WatchGuard/Users'?Promise.resolve(overviewItems[0].Users):new Promise((resolve,reject)=>calls.push({o,resolve,reject}))};
    const abort = new AbortController();
    const navigation=[];
    const page = watchlistsPage(f.doc,api,abort.signal,owner,(...args)=>{navigation.push(args);page.updateFilters(...args);},{preferences,indexedActivity});
    return {page,calls,abort,navigation,document:f.doc,changeAccount(){token='second';}};
}
const turn = () => new Promise(resolve=>setImmediate(resolve));
const automaticResult = {Items:[{...overviewItems[0],Users:[{...overviewItems[0].Users[1],Reasons:['InProgress','CurrentlyPlaying']}]}],IsComplete:false,LimitReached:true,Notice:'Not exhaustive; limit reached'};
test('Progressive memberships render before automatic discovery; filters and card identity survive merge without requests', async()=>{
    const f=progressiveFixture();await turn();
    assert.equal(f.calls[0].o.url,'WatchGuard/Watchlists');
    f.calls[0].resolve([overviewItems[0]]);await turn();
    const grid=f.page.children[5],card=grid.children[0];
    assert.equal(grid.children.length,1);assert.match(f.page.children[2].textContent,/Loading viewing/);
    assert.equal(f.calls[1].o.url,'WatchGuard/ActivityOverview');
    f.page.updateFilters('all','watching','recent'); assert.equal(grid.children.length,0);
    assert.match(f.page.children[2].textContent,/Loading/);assert.equal(f.calls.length,2);
    f.calls[1].resolve(automaticResult);await turn();
    assert.equal(grid.children[0],card); assert.match(card.children[1].children[0].title,/Watchlist · Watching · Currently Playing/);
    assert.match(textOf(f.page.children[3]),/limit reached/);
    f.page.updateFilters('all','all','title'); assert.equal(grid.children[0],card);assert.equal(f.calls.length,2);
    const removal=card.children.at(-1).onclick(); assert.equal(f.calls[2].o.type,'DELETE');f.calls[2].resolve();await removal;
    assert.equal(grid.children.length,1);assert.equal(f.calls.length,3);
    f.page.updateFilters('all','all','title');assert.equal(grid.children[0],card); // Another user's automatic interest survives.
});
test('Late automatic results are ignored after navigation and account change',async()=>{
    for(const action of ['abort','account']) {
        const f=progressiveFixture();await turn();f.calls[0].resolve([overviewItems[0]]);await turn();
        const before=f.page.children[5].children[0].children[1].children.map(n=>n.textContent);
        if(action==='abort')f.abort.abort();else f.changeAccount();
        f.calls[1].resolve(automaticResult);await turn();
        assert.deepEqual(f.page.children[5].children[0].children[1].children.map(n=>n.textContent),before);
    }
});
test('Automatic failure preserves explicit cards and never claims a complete or empty result',async()=>{
    const f=progressiveFixture();await turn();f.calls[0].resolve([overviewItems[0]]);await turn();
    const card=f.page.children[5].children[0];f.calls[1].reject(new Error('private'));await turn();
    assert.equal(f.page.children[5].children[0],card);assert.match(f.page.children[4].textContent,/Results are incomplete/);
    f.page.updateFilters('all','watching','title');assert.equal(f.page.attributes['data-view-state'],'failed');
    assert.ok(!f.page.children[4].textContent.includes('private'));
});
test('Explicit failure does not prevent automatic results and keeps failure visible',async()=>{
    const f=progressiveFixture();await turn();f.calls[0].reject(new Error('private'));await turn();
    assert.match(f.page.children[2].textContent,/Loading/);f.calls[1].resolve(automaticResult);await turn();
    assert.equal(f.page.children[5].children.length,1);assert.match(f.page.children[4].textContent,/Could not load watchlists/);
});


test('Activity dates, progress and status filters do not widen the protection reason allowlist', () => {
    const {activityText, mergeInterest, validateStatus} = require('../Jellyfin.Plugin.WatchGuard/Web/watchguard.js');
    const date = '2026-10-11T09:12:00Z';
    const owner = {UserId:other,DisplayName:'Other',Reasons:['Watched'],LastPlayedDate:date,AvailableEpisodes:12,WatchedEpisodes:12};
    const item = {...overviewItems[0],Users:[owner]};
    assert.equal(selectInterest([item],'all',me,'watched').length,1);
    assert.equal(selectInterest([item],'all',me,'watching').length,0);
    assert.equal(selectInterest([item],'all',me,'playing').length,0);
    assert.match(activityText(owner,true),/Other — Watched · 12\/12 episodes · Last played:/);
    assert.ok(activityText(owner,true).includes(new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(date))));
    assert.ok(!activityText({...owner,Reasons:['CurrentlyPlaying']},true).includes('Last played'));
    assert.match(activityText({...owner,Reasons:['CurrentlyPlaying']},true),/Currently Playing ●/);
    assert.ok(!activityText({...owner,Reasons:['Watchlisted']},true).includes('Last played'));
    const merged=mergeInterest([{...item,Users:[{...owner,Reasons:['Watchlisted'],LastPlayedDate:null,AvailableEpisodes:null,WatchedEpisodes:null}]}],[item]);
    assert.equal(merged.length,1);assert.equal(merged[0].Users.length,1);assert.deepEqual(merged[0].Users[0].Reasons,['Watchlisted','Watched']);
    assert.equal(merged[0].Users[0].WatchedEpisodes,12);
    assert.throws(()=>selectInterest([{...item,Users:[{...owner,WatchedEpisodes:13}]}],'all',me));
    assert.throws(()=>validateStatus({ItemId:item.ItemId,HasInterest:true,HasOtherInterestedUsers:true,Users:[owner]},item.ItemId,me));
});
test('Activity spinner stays visible during deferred discovery and disappears on success or failure',async()=>{
    for(const fail of [false,true]) {
        const f=progressiveFixture();await turn();f.calls[0].resolve([overviewItems[0]]);await turn();
        const spinner=f.page.children[2].children.find(e=>e.className==='material-icons watchguard-spinner');
        assert.ok(spinner);assert.equal(spinner.hidden,false);assert.equal(f.page.children[5].children.length,1);
        if(fail)f.calls[1].reject(new Error('failure'));else f.calls[1].resolve(automaticResult);await turn();
        assert.equal(spinner.hidden,true);assert.equal(f.page.children[5].children.length,1);
    }
});


test('Status defaults, OR and owner predicates agree on the same user, including completed membership',()=>{
    const {selectedStatuses}=require('../Jellyfin.Plugin.WatchGuard/Web/watchguard.js');
    const history={...overviewItems[0],Users:[{...overviewItems[0].Users[0],Reasons:['Watched']}]};
    assert.equal(selectInterest([history],'all',me).length,0);
    history.Users[0].Reasons.push('Watchlisted');
    assert.equal(selectInterest([history],'all',me).length,1);
    assert.equal(selectInterest([history],'all',me,[]).length,0);
    assert.equal(selectInterest(overviewItems,'mine',me,['watching']).length,0);
    assert.equal(selectInterest(overviewItems,'mine',me,['watching','playing']).length,1);
    assert.equal(selectInterest(overviewItems,'all',me,['watchlisted','playing']).length,2);
    assert.deepEqual(selectedStatuses(null),['watchlisted','watching','playing']);
    assert.deepEqual(selectedStatuses('watched,playing,watched'),['playing','watched']);
    assert.deepEqual(selectedStatuses('none'),[]);
    assert.equal(selectedStatuses('all').length,4);
});
test('Rows expose distinct statuses and exact native timestamps through keyboard accessible details',()=>{
    const {userLine}=require('../Jellyfin.Plugin.WatchGuard/Web/watchguard.js');
    const date='2026-10-11T09:12:34Z';
    const owner={DisplayName:'<Tom>',Reasons:['Watchlisted','InProgress','CurrentlyPlaying','Watched','Watched'],LastPlayedDate:date,AvailableEpisodes:12,WatchedEpisodes:7};
    const line=userLine(documentFixture().doc,owner);
    assert.deepEqual(line.children[0].children.map(i=>i.attributes['aria-label']),['Watchlist','Watching','Currently Playing','Watched']);
    assert.equal(line.children[1].textContent,'<Tom>');assert.match(textOf(line),/7\/12/);
    const details=descendants(line).find(n=>n.tag==='details');assert.equal(details.children[0].tag,'summary');
    const time=descendants(details).find(n=>n.tag==='time');assert.equal(time.dateTime,date);
    assert.equal(time.textContent,'Last played: '+new Intl.DateTimeFormat(undefined,{dateStyle:'full',timeStyle:'long'}).format(new Date(date)));
    details.open=true;line.update({...owner,Reasons:['CurrentlyPlaying']},true);
    assert.equal(details.open,true);assert.equal(descendants(line).find(n=>n.tag==='details'),details);
});
test('Checkboxes serialize all selections, reset defaults and reflect history without fetching',async()=>{
    const f=progressiveFixture();await turn();f.calls[0].resolve([overviewItems[0]]);await turn();f.calls[1].resolve(automaticResult);await turn();
    const filter=f.page.children[1].children[1],panel=filter.children[1];
    assert.deepEqual(panel.children.slice(0,4).map(l=>l.children[0].checked),[true,true,true,false]);
    f.page.updateFilters('all','watched,playing','title');
    assert.deepEqual(panel.children.slice(0,4).map(l=>l.children[0].checked),[false,false,true,true]);
    panel.children[3].children[0].checked=false;panel.children[3].children[0].onchange();
    assert.deepEqual(f.navigation.at(-1),['all','playing','title']);
    panel.children[4].onclick();assert.deepEqual(f.navigation.at(-1),['all','watchlisted,watching,playing','title']);
    assert.deepEqual(panel.children.slice(0,4).map(l=>l.children[0].checked),[true,true,true,false]);
    filter.open=true;filter.events.keydown({key:'Escape',preventDefault(){}});assert.equal(filter.open,false);assert.equal(filter.children[0].focused,true);
    assert.equal(f.calls.length,2);
});


test('Owner changes request scoped sources; status changes stay local',async()=>{
    const f=progressiveFixture();await turn();f.calls[0].resolve([overviewItems[0]]);await turn();f.calls[1].resolve(automaticResult);await turn();
    f.page.updateFilters('mine',null,'title');await turn();assert.equal(f.calls[2].o.url,'WatchGuard/Watchlist');
    f.calls[2].resolve([{ItemId:overviewItems[0].ItemId,Name:'Alpha'}]);await turn();assert.equal(f.calls[3].o.url,'WatchGuard/ActivityOverview/Me');
    f.calls[3].resolve({...automaticResult,Items:[]});await turn();
    f.page.updateFilters(other,null,'title');await turn();assert.equal(f.calls[4].o.url,'WatchGuard/Watchlists/'+other);
    f.calls[4].resolve([]);await turn();assert.equal(f.calls[5].o.url,'WatchGuard/ActivityOverview/Users/'+other);
});
test('Shared personal membership helper coalesces reads and rejects stale accounts and failed writes',async()=>{
    const {createMembership}=require('../Jellyfin.Plugin.WatchGuard/Web/watchguard.js');
    let token='first', resolve, calls=[],changes=[];
    const api={getCurrentUserId:()=>me,accessToken:()=>token,getUrl:p=>p,ajax:o=>{calls.push(o);return new Promise(r=>{resolve=r;});}};
    const helper=createMembership(api,new AbortController().signal,(...a)=>changes.push(a));
    const a=helper.read(),b=helper.read();assert.equal(calls.length,1);resolve([{ItemId:other}]);await Promise.all([a,b]);
    const write=helper.set(other,true);resolve();await write;assert.deepEqual(changes,[[other,true]]);
    const stale=helper.read();token='second';resolve([]);await assert.rejects(stale);
    await assert.rejects(helper.set(other,false));assert.equal(calls.length,3);
});

test('Saved defaults apply only to absent URL parameters, including an explicit empty status selection', () => {
    const {preferenceView} = require('../Jellyfin.Plugin.WatchGuard/Web/watchguard.js');
    const saved = {Owner:'all', Statuses:['watched'], Sort:'recent'};
    assert.deepEqual(preferenceView(saved,null,null,null), {owner:'all',interest:'watched',sort:'recent'});
    assert.deepEqual(preferenceView(saved,'mine','none','title'), {owner:'mine',interest:'none',sort:'title'});
    assert.deepEqual(preferenceView(saved,null,'watching',null), {owner:'all',interest:'watching',sort:'recent'});
    assert.equal(preferenceView({...saved,Statuses:[]},null,null,null).interest,'none');
});


test('Preference responses cannot cross account or navigation lifetimes', async()=>{
    for(const action of ['abort','account']) {
        const f=progressiveFixture(true,true,null); await turn();
        assert.equal(f.calls[0].o.url,'WatchGuard/Preferences');
        if(action==='abort') f.abort.abort(); else f.changeAccount();
        f.calls[0].resolve({Owner:'all',Statuses:['watched'],Sort:'recent'}); await turn();
        assert.equal(f.calls.length,1); assert.equal(f.page.children[5].children.length,0);
    }
});
test('Saved owner scopes queries while explicit URL updates win during preference loading', async()=>{
    const f=progressiveFixture(true,true,null); await turn();
    f.page.updateFilters('mine','none','title');
    f.calls[0].resolve({Owner:'all',Statuses:['watched'],Sort:'recent'}); await turn();
    assert.equal(f.calls[1].o.url,'WatchGuard/Watchlist');
    const g=progressiveFixture(true,true,null); await turn();
    g.calls[0].resolve({Owner:other,Statuses:['watched'],Sort:'recent'}); await turn();
    assert.equal(g.calls[1].o.url,'WatchGuard/Watchlists/'+other);
});
test('Failed preferences retain a visible error and use defaults without writing recovery data', async()=>{
    const f=progressiveFixture(false,true,null); await turn(); f.calls[0].reject(new Error('corruption')); await turn();
    assert.equal(f.calls[1].o.url,'WatchGuard/Watchlist');
    assert.match(f.page.children[6].textContent,/stored data was not changed/);
    assert.ok(f.calls.every(c=>c.o.type==='GET'));
});

test('Caught Up belongs to Watching, renders its own icon/date and is accepted in fresh protection',()=>{
    const {activityText,userLine}=require('../Jellyfin.Plugin.WatchGuard/Web/watchguard.js');
    const owner={UserId:me,DisplayName:'Me',Reasons:['CaughtUp'],LastPlayedDate:'2026-10-01T12:00:00Z',AvailableEpisodes:12,WatchedEpisodes:12};
    const item={...overviewItems[0],Users:[owner]};
    assert.equal(selectInterest([item],'mine',me,null).length,1);
    assert.equal(selectInterest([item],'mine',me,'watching').length,1);
    assert.equal(selectInterest([item],'all',me,'watched').length,0);
    assert.equal(selectInterest([item],other,me,'watching').length,0);
    assert.match(activityText(owner,true),/Caught Up · 12\/12 episodes · Last played/);
    assert.equal(userLine(documentFixture().doc,owner).children[0].children[0].attributes['aria-label'],'Caught Up');
    assert.deepEqual(validateStatus({ItemId:item.ItemId,HasInterest:true,HasOtherInterestedUsers:false,Users:[owner]},item.ItemId,me),[owner]);
});

test('structured dialog uses text nodes for long unsafe names and keeps separate ownership/reasons',async()=>{
    const f=documentFixture(), unsafe='<img src=x onerror=evil()>'.repeat(30);
    const pending=confirmDeletion(f.doc,{item:{Id:'item',Name:unsafe,Type:'Episode',IndexNumber:2,ParentIndexNumber:1},parentName:unsafe,user:'me',users:[
        {UserId:'me',DisplayName:unsafe,Reasons:['Watchlisted','InProgress','CurrentlyPlaying']},
        {UserId:'other',DisplayName:unsafe,Reasons:['Watchlisted','CurrentlyPlaying']} ]});
    const dialog=f.nodes[0], nodes=descendants(dialog);
    assert.ok(nodes.some(n=>n.textContent===unsafe));assert.ok(nodes.every(n=>n.innerHTML===undefined));
    assert.match(textOf(dialog),/Your interest/);assert.match(textOf(dialog),/Other people’s interest/);
    assert.match(textOf(dialog),/Season 1 · Episode 2/);assert.match(textOf(dialog),/cannot be undone/);
    assert.equal(nodes.filter(n=>n.className==='watchguard-dialog-person').length,2);
    assert.equal(button(dialog,'Cancel').focused,true);
    await assert.rejects(confirmDeletion(f.doc,message),/already open/);assert.equal(f.nodes.length,1);
    button(dialog,'Cancel').onclick();assert.equal(await pending,false);
    const next=confirmDeletion(f.doc,message,false);assert.equal(button(f.nodes[1],'Delete Anyway'),undefined);button(f.nodes[1],'Cancel').onclick();assert.equal(await next,false);
});

test('dialog Tab and Shift+Tab cycle only actions, including error-only dialogs',async()=>{
    for(const allowDelete of [true,false]) {
        const f=documentFixture(), pending=confirmDeletion(f.doc,message,allowDelete), d=f.nodes[0];
        const cancel=button(d,'Cancel'), approve=button(d,'Delete Anyway');
        let prevented=0, stopped=0;
        const press=shiftKey=>d.events.keydown({key:'Tab',shiftKey,preventDefault(){prevented++;},stopPropagation(){stopped++;}});
        f.doc.activeElement=cancel;press(true);assert.equal((allowDelete?approve:cancel).focused,true);
        f.doc.activeElement=approve || cancel;press(false);assert.equal(cancel.focused,true);
        assert.equal(prevented,2);assert.equal(stopped,2);
        cancel.onclick();assert.equal(await pending,false);
    }
});

test('targeted series panel safely renders deduplicated users, coverage and native dates',()=>{
    const {renderSeriesActivity}=require('../Jellyfin.Plugin.WatchGuard/Web/watchguard.js');
    const {doc}=documentFixture();const target=doc.createElement('div');target.replaceChildren=()=>{target.children=[];};
    const status={ItemId:me,IsComplete:false,Notice:'Partial <coverage>',Users:[
        {UserId:me,DisplayName:'<img onerror=evil()>',Reasons:['Watchlisted','CaughtUp'],AvailableEpisodes:12,WatchedEpisodes:12,CoverageComplete:true,LastPlayedDate:'2026-10-01T10:00:00Z'},
        {UserId:other,DisplayName:'Other',Reasons:['CurrentlyPlaying','InProgress'],AvailableEpisodes:12,WatchedEpisodes:7,CoverageComplete:false,LastPlayedDate:null}
    ]};
    renderSeriesActivity(doc,target,status,me,me);
    assert.match(textOf(target),/1 Watchlisted.*1 Watching.*1 Currently Playing.*1 Caught Up.*Incomplete/);
    assert.match(textOf(target),/You · <img onerror=evil\(\)>/);
    assert.match(textOf(target),/7\/12 episodes\s+\(incomplete coverage\)/);
    const list=descendants(target).find(n=>n.tag==='ul');assert.equal(list.children.length,2);assert.equal(list.children[0].children[0].textContent,'Other');
    assert.equal(descendants(target).some(n=>n.tag==='img'||n.tag==='script'),false);
    const bars=descendants(target).filter(n=>n.tag==='progress');assert.equal(bars.length,1);assert.equal(bars[0].max,12);assert.equal(bars[0].value,12);
    assert.match(bars[0].attributes['aria-label'],/12\/12 episodes/);
    assert.ok(descendants(target).some(n=>n.className==='watchguard-chip watchguard-state-CaughtUp' && n.textContent==='Caught Up'));
    assert.throws(()=>renderSeriesActivity(doc,target,{...status,Users:[status.Users[0],status.Users[0]]},me,me));
    assert.throws(()=>renderSeriesActivity(doc,target,{...status,Users:[{...status.Users[0],Reasons:['__proto__']}]},me,me));
});

test('series activity presents every status as labelled chips and never invents unknown progress',()=>{
    const {renderSeriesActivity}=require('../Jellyfin.Plugin.WatchGuard/Web/watchguard.js');
    const {doc}=documentFixture(), target=doc.createElement('div');target.replaceChildren=()=>{target.children=[];};
    const reasons=['Watchlisted','InProgress','CurrentlyPlaying','CaughtUp','Watched','Unknown'];
    const payload={ItemId:me,IsComplete:false,Notice:'Partial episode coverage',Users:[{UserId:me,DisplayName:'You <script>'.repeat(25),Reasons:reasons,AvailableEpisodes:0,WatchedEpisodes:0,CoverageComplete:false,LastPlayedDate:null}]};
    renderSeriesActivity(doc,target,payload,me,me);
    const nodes=descendants(target);assert.equal(nodes.filter(n=>n.tag==='progress').length,0);
    assert.equal(nodes.filter(n=>n.tag==='li').length,1);
    for(const reason of reasons) assert.equal(nodes.filter(n=>n.className==='watchguard-chip watchguard-state-'+reason).length,2);
    const notice=nodes.find(n=>n.tag==='small');assert.equal(notice.attributes['aria-label'],payload.Notice);assert.equal(notice.tabIndex,0);
    assert.ok(nodes.some(n=>n.tag==='summary'));assert.ok(nodes.every(n=>n.innerHTML===undefined));
});

test('Coverage disclosure keeps exact server notes and exposes safety and unknown coverage outside disclosure', async()=>{
    const {coveragePresentation}=require('../Jellyfin.Plugin.WatchGuard/Web/watchguard.js');
    const ordinary='Recent viewing activity: completed titles with a native playback date in the last 60 days, plus current viewing interest; not an exhaustive library audit.';
    assert.deepEqual(coveragePresentation(ordinary,false),{summary:'Completed activity: last 60 days · current interest · not exhaustive',warning:''});
    for(const [notice,limited,warning] of [
        [ordinary,false,''],
        [ordinary+' Some continuing series lack episode or air-date coverage; Caught Up is not inferred for them.',false,'Some continuing series lack episode or air-date coverage; Caught Up is not inferred for them.'],
        [ordinary+' A safety limit was reached; some items are omitted.',true,'A safety limit was reached; some items are omitted.'],
        ['Unknown <img src=x> coverage',false,'Unknown <img src=x> coverage'],
        ['',true,'A safety limit was reached; some items are omitted.']
    ]) {
        const f=progressiveFixture();await turn();f.calls[0].resolve([overviewItems[0]]);await turn();
        f.calls[1].resolve({...automaticResult,Notice:notice,LimitReached:limited});await turn();
        const container=f.page.children[3], disclosure=container.children[0], visible=container.children[1];
        assert.equal(container.hidden,false);assert.equal(disclosure.tag,'details');assert.ok(!disclosure.open);
        assert.ok(disclosure.children.some(n=>n.textContent===notice));
        assert.equal(visible.textContent,warning);assert.equal(visible.hidden,!warning);
        assert.equal(descendants(container).filter(n=>n.tag==='img').length,0);
        assert.equal(disclosure.children[0].tag,'summary');
    }
});

test('Structured activity coverage retains material warnings and old-server fallback',()=>{
 const {coveragePresentation}=require('../Jellyfin.Plugin.WatchGuard/Web/watchguard.js');
 const info={Version:1,ActivityWindowDays:17,Warnings:['Episode metadata is incomplete.','Some results were omitted.']};
 assert.deepEqual(coveragePresentation('Full server explanation',true,info),{summary:'Completed activity: last 17 days · current interest · not exhaustive',warning:info.Warnings.join(' ')});
 assert.match(coveragePresentation('Unknown <text>',false,{...info,Version:2}).warning,/Unknown <text>/);
 assert.match(coveragePresentation('Unknown',true,{...info,Warnings:[]}).warning,/safety limit/);
 assert.match(coveragePresentation('Unknown',false,{...info,ActivityWindowDays:999}).warning,/Unknown/);
});

test('Recently added sorts by the filtered owner dates, with legacy/automatic titles last',()=>{
    const newDate='2026-10-18T11:30:00Z', olderDate='2026-10-17T10:00:00Z';
    const items=[
        {ItemId:'1'.repeat(32),Name:'Legacy',Users:[{UserId:me,DisplayName:'Me',Reasons:['Watchlisted'],AddedAtUtc:null}]},
        {ItemId:'2'.repeat(32),Name:'Recent',Users:[
            {UserId:me,DisplayName:'Me',Reasons:['Watchlisted'],AddedAtUtc:olderDate},
            {UserId:other,DisplayName:'Other',Reasons:['Watchlisted','InProgress'],AddedAtUtc:newDate}]},
        {ItemId:'3'.repeat(32),Name:'Today',Users:[{UserId:me,DisplayName:'Me',Reasons:['Watchlisted'],AddedAtUtc:newDate}]},
        {ItemId:'4'.repeat(32),Name:'Playback only',Users:[{UserId:me,DisplayName:'Me',Reasons:['InProgress'],LastPlayedDate:newDate}]}
    ];
    assert.deepEqual(selectInterest(items,'all',me,'all','added').map(e=>e.Name),
        ['Recent','Today','Legacy','Playback only']);
    assert.deepEqual(selectInterest(items,'mine',me,'all','added').map(e=>e.Name),
        ['Today','Recent','Legacy','Playback only']);
    assert.deepEqual(selectInterest(items,'all',me,'watching','added').map(e=>e.Name),
        ['Recent','Playback only']);
    assert.equal(selectInterest(items,other,me,'watchlisted','added').length,1);
    assert.throws(()=>selectInterest([{ItemId:'5'.repeat(32),Name:'Forged',Users:[
        {UserId:me,DisplayName:'Me',Reasons:['InProgress'],AddedAtUtc:newDate}]}],'mine',me,'all','added'),/Invalid interest/);
    assert.throws(()=>selectInterest([{ItemId:'5'.repeat(32),Name:'Invalid',Users:[
        {UserId:me,DisplayName:'Me',Reasons:['Watchlisted'],AddedAtUtc:'not a date'}]}],'mine',me,'all','added'),/Invalid interest/);
});

test('Watchlist dates survive activity merge and never masquerade as playback history',()=>{
    const {mergeInterest}=require('../Jellyfin.Plugin.WatchGuard/Web/watchguard.js');
    const date='2026-10-18T11:30:00Z', played='2026-10-17T09:00:00Z';
    const explicit=[{ItemId:'6'.repeat(32),Name:'Date example',Users:[{
        UserId:me,DisplayName:'Me',Reasons:['Watchlisted'],LastPlayedDate:null,AddedAtUtc:date}]}];
    const activity=[{ItemId:'6'.repeat(32),Name:'Date example',Users:[{
        UserId:me,DisplayName:'Me',Reasons:['InProgress'],LastPlayedDate:played}]}];
    const merged=mergeInterest(explicit,activity);
    const owner=merged[0].Users[0];
    assert.equal(owner.AddedAtUtc,date);
    assert.equal(owner.LastPlayedDate,played);
    assert.deepEqual(owner.Reasons,['Watchlisted','InProgress']);
    assert.equal(selectInterest(merged,'mine',me,'all','added')[0].Name,'Date example');
});

test('Watchlist owner rows render real added dates, unknown dates, and old-server rows safely',()=>{
    const {userLine,activityText}=require('../Jellyfin.Plugin.WatchGuard/Web/watchguard.js');
    const date='2026-10-18T11:30:00Z';
    const known={UserId:me,DisplayName:'<unsafe>',Reasons:['Watchlisted'],AddedAtUtc:date};
    const row=userLine(documentFixture().doc,known);
    const added=descendants(row).find(e=>e.tag==='time');
    assert.ok(added);assert.equal(added.dateTime,date);assert.match(added.textContent,/Added:/);
    assert.ok(descendants(row).some(n=>n.tag==='summary'));
    assert.match(activityText(known,true),/Added:/);
    const unknown=userLine(documentFixture().doc,{...known,AddedAtUtc:null});
    assert.match(textOf(unknown),/Added: unknown/);
    const old=userLine(documentFixture().doc,{UserId:me,DisplayName:'Me',Reasons:['Watchlisted']});
    assert.equal(descendants(old).filter(n=>n.tag==='time').length,0,'No invented timestamp for old API rows');
    assert.equal(known.DisplayName,'<unsafe>','No user text is interpreted as HTML');
});

test('Recently added saves explicitly, reloads, and URL fields override independently',async()=>{
    const f=progressiveFixture(true,true,null);
    await turn();f.calls[0].resolve({Owner:'mine',Statuses:['watchlisted'],Sort:'title'});await turn();
    assert.equal(f.calls[1].o.url,'WatchGuard/Watchlist');
    f.calls[1].resolve([{ItemId:'c'.repeat(32),Name:'Known',AddedAtUtc:'2026-10-18T11:30:00Z'}]);await turn();
    assert.equal(f.calls[2].o.url,'WatchGuard/ActivityOverview/Me');
    f.calls[2].resolve({Items:[],IsComplete:false,LimitReached:false,Notice:'Not exhaustive'});await turn();
    f.page.updateFilters('mine','watchlisted','added');
    const toolbar=f.page.children[1],sort=toolbar.children[2].children[1];
    assert.equal(sort.value,'added');
    const filterPanel=toolbar.children[1].children[1],save=filterPanel.children[4],reset=filterPanel.children[5];
    assert.ok(f.calls.every(c=>c.o.type==='GET'),'Links/filter changes never write defaults');
    const saving=save.onclick();
    assert.equal(f.calls[3].o.type,'PUT');
    const stored=JSON.parse(f.calls[3].o.data);
    assert.deepEqual(stored,{Owner:'mine',Statuses:['watchlisted'],Sort:'added'});
    f.calls[3].resolve(stored);await saving;
    assert.match(f.page.children[6].textContent,/View saved/);
    const reload=progressiveFixture(true,true,null);await turn();reload.calls[0].resolve(stored);await turn();
    reload.calls[1].resolve([]);await turn();
    assert.equal(reload.page.children[1].children[2].children[1].value,'added');
    const {preferenceView}=require('../Jellyfin.Plugin.WatchGuard/Web/watchguard.js');
    assert.deepEqual(preferenceView(stored,'all',null,null),{owner:'all',interest:'watchlisted',sort:'added'});
    assert.deepEqual(preferenceView(stored,null,'none',null),{owner:'mine',interest:'none',sort:'added'});
    assert.deepEqual(preferenceView(stored,null,null,'recent'),{owner:'mine',interest:'watchlisted',sort:'recent'});
    for(const next of ['title','recent']) {
        f.page.updateFilters('mine','watchlisted',next);
        const i=f.calls.length,p=save.onclick();assert.equal(f.calls[i].o.type,'PUT');
        assert.equal(JSON.parse(f.calls[i].o.data).Sort,next);
        f.calls[i].resolve(JSON.parse(f.calls[i].o.data));await p;
    }
    const i=f.calls.length,p=reset.onclick();assert.equal(f.calls[i].o.type,'DELETE');
    assert.notEqual(reset.disabled,true,'Reset remains focusable during its request');
    assert.equal(reset.attributes['aria-disabled'],'true');
    await reset.onclick();assert.equal(f.calls.length,i+1,'Repeated Reset is ignored while pending');
    f.calls[i].resolve({Owner:'mine',Statuses:['watchlisted','watching','playing'],Sort:'title'});await p;
    assert.equal(reset.attributes['aria-disabled'],'false');
    assert.deepEqual(f.navigation.at(-1),['mine','watchlisted,watching,playing','title']);
});

test('Preference save/reset errors stay visible and late writes cannot affect another account',async()=>{
    for(const operation of ['save','reset']) {
        const f=progressiveFixture(false,true,null);await turn();
        f.calls[0].resolve({Owner:'mine',Statuses:[],Sort:'added'});await turn();
        f.calls[1].resolve([]);await turn();f.calls[2].resolve({Items:[],IsComplete:false,LimitReached:false,Notice:'Bounded'});await turn();
        const button=f.page.children[1].children[1].children[1].children[operation==='save'?4:5];
        const first=button.onclick();f.calls.at(-1).reject(new Error('disk failure'));await first;
        assert.match(f.page.children[6].textContent,/Could not (save|reset)/);
        const prior=f.page.children[6].textContent, second=button.onclick();
        f.changeAccount();f.calls.at(-1).resolve({Owner:'all',Statuses:['watched'],Sort:'added'});await second;
        assert.equal(f.page.children[6].textContent,prior);assert.equal(f.navigation.length,0);
        const before=f.calls.length;await button.onclick();assert.equal(f.calls.length,before);
    }
});

const extraProgress = () => ({AiredAvailable:3,AiredWatched:3,ExtraEpisodes:[
    {ItemId:'d'.repeat(32),SeasonNumber:1,EpisodeNumber:4,EpisodeNumberEnd:null,Name:'<img onerror=evil()>',PremiereDate:'2026-10-24T00:00:00Z',ReleaseStatus:'Future',Watched:false},
    {ItemId:'e'.repeat(32),SeasonNumber:1,EpisodeNumber:5,Name:'Release day',PremiereDate:'2026-10-19T00:00:00Z',ReleaseStatus:'ReleaseDay',Watched:true},
    {ItemId:'f'.repeat(32),SeasonNumber:null,EpisodeNumber:null,Name:'Unknown',PremiereDate:null,ReleaseStatus:'UnknownDate',Watched:false}
]});
test('Additional episodes render an accessible button and safe per-user details with explicit date states',()=>{
    const {userLine,activityText}=require('../Jellyfin.Plugin.WatchGuard/Web/watchguard.js');
    const f=documentFixture(), owner={UserId:me,DisplayName:'Tom <script>',Reasons:['CaughtUp'],AvailableEpisodes:3,WatchedEpisodes:3,EpisodeProgress:extraProgress()};
    const row=userLine(f.doc,owner), more=button(row,'+3');more.isConnected=true;
    assert.match(activityText(owner,true),/Caught up on aired episodes.*3\/3 episodes \+3/);
    assert.equal(more.attributes['aria-haspopup'],'dialog');assert.match(more.attributes['aria-label'],/Tom <script>.*3 additional available/);
    more.onclick();more.onclick();assert.equal(descendants(row).filter(n=>n.tag==='dialog').length,1);
    const dialog=descendants(row).find(n=>n.tag==='dialog');assert.equal(button(dialog,'Close').focused,true);
    assert.match(textOf(dialog),/Season 1 · Episode 4.*<img onerror=evil\(\)>/);
    assert.match(textOf(dialog),/Future-dated.*Unwatched/);assert.match(textOf(dialog),/Release day.*Watched/);assert.match(textOf(dialog),/Date unknown.*Unwatched/);
    assert.equal(descendants(dialog).some(n=>n.tag==='img'||n.tag==='script'),false);
    dialog.events.cancel({preventDefault(){}});assert.equal(dialog.removed,true);assert.equal(more.focused,true);
    more.onclick();button(descendants(row).find(n=>n.tag==='dialog'),'Close').onclick();assert.equal(descendants(row).filter(n=>n.tag==='dialog').length,0);
    owner.EpisodeProgress.ExtraEpisodes.forEach(e=>e.Watched=true);assert.match(activityText(owner),/^Caught Up/);
});
test('Series panel and progressive merge preserve additive progress, older payloads and incomplete coverage',()=>{
    const {renderSeriesActivity,mergeInterest}=require('../Jellyfin.Plugin.WatchGuard/Web/watchguard.js');
    const f=documentFixture(), target=f.doc.createElement('div');target.replaceChildren=()=>{target.children=[];};
    const owner={UserId:me,DisplayName:'Tom',Reasons:['CaughtUp'],AvailableEpisodes:4,WatchedEpisodes:3,CoverageComplete:false,EpisodeProgress:extraProgress()};
    renderSeriesActivity(f.doc,target,{ItemId:me,IsComplete:true,Notice:'Metadata incomplete',Users:[owner]},me,me);
    assert.ok(button(target,'+3'));assert.match(textOf(target),/Caught up on aired episodes/);assert.match(textOf(target),/3\/3/);
    assert.equal(descendants(target).filter(n=>n.tag==='progress').length,0);assert.match(textOf(target),/incomplete coverage/);
    const item={...overviewItems[0],Users:[owner]}, merged=mergeInterest(overviewItems,[item]);
    assert.deepEqual(merged[0].Users.find(u=>u.UserId===me).EpisodeProgress,owner.EpisodeProgress);
    delete owner.EpisodeProgress;renderSeriesActivity(f.doc,target,{ItemId:me,IsComplete:true,Notice:'Old payload',Users:[owner]},me,me);
    assert.equal(descendants(target).filter(n=>n.className==='emby-button watchguard-extra-button').length,0);assert.match(textOf(target),/3\/4 episodes/);
});
test('Malformed extras fail validation without executing metadata or affecting protection validation',()=>{
    const {episodeProgress}=require('../Jellyfin.Plugin.WatchGuard/Web/watchguard.js');
    for(const change of [p=>p.AiredWatched=4,p=>p.ExtraEpisodes.push(p.ExtraEpisodes[0]),p=>p.ExtraEpisodes[0].ReleaseStatus='Aired',p=>p.ExtraEpisodes[0].Watched='yes',p=>p.ExtraEpisodes[0].PremiereDate=null]) {
        const p=extraProgress();change(p);assert.throws(()=>episodeProgress({EpisodeProgress:p}));
    }
    const owner={UserId:me,DisplayName:'Tom',Reasons:['CaughtUp'],EpisodeProgress:'invalid informational data'};
    assert.deepEqual(validateStatus({ItemId:me,HasInterest:true,HasOtherInterestedUsers:false,Users:[owner]},me,me),[owner]);
});

const indexedResult = (items = [], continuation = null) => ({Items:items,IsComplete:false,LimitReached:false,Notice:'Indexed; not exhaustive',Coverage:{Version:1,ActivityWindowDays:30,Warnings:[]},Freshness:{Revision:'view-1',DiscoveryFinished:true,Pending:0,LastUpdate:null},Continuation:continuation});
test('Combined controls query server filtering and ordering without saving preferences',async()=>{
    const f=progressiveFixture(true,false,'all',true);await turn();f.calls[0].resolve([overviewItems[0]]);await turn();
    assert.match(f.calls[1].o.url,/ActivityBrowser\?owner=all&days=30&older=true&statuses=watchlisted%2Cwatching%2Cplaying&sort=title&search=$/);
    f.calls[1].resolve(indexedResult());await turn();
    f.page.updateFilters('all','watchlisted','added','7','false','Zebra');await turn();
    f.calls[2].resolve([overviewItems[0]]);await turn();
    assert.match(f.calls[3].o.url,/days=7&older=false&statuses=watchlisted&sort=added&search=Zebra/);
    f.calls[3].resolve(indexedResult());await turn();
    assert.match(descendants(f.page).find(n=>n.className==='watchguard-secondary').children[0].textContent,/7 days.*recent only/);
    assert.ok(f.calls.every(c=>c.o.type==='GET'));f.abort.abort();
});
test('Indexed pagination preserves poster identity and refuses late account results',async()=>{
    const f=progressiveFixture(true,false,'all',true);await turn();f.calls[0].resolve([overviewItems[0]]);await turn();
    f.calls[1].resolve(indexedResult(automaticResult.Items,'opaque'));await turn();
    const grid=f.page.children[5],card=grid.children[0],more=f.page.children.at(-1);
    const loading=more.onclick();await turn();assert.match(f.calls[2].o.url,/continuation=opaque/);
    f.calls[2].resolve(indexedResult(automaticResult.Items));await loading;
    assert.equal(grid.children.length,1);assert.equal(grid.children[0],card);
    f.page.updateFilters('mine','watching','recent','90','true');await turn();
    const last=f.calls.at(-1);f.changeAccount();last.resolve([overviewItems[0]]);await turn();
    assert.equal(grid.children.length,0);f.abort.abort();
});
test('Indexed initial population is not a false empty result and malformed status remains an error',async()=>{
    const f=progressiveFixture(false,false,'mine',true);await turn();f.calls[0].resolve([]);await turn();
    const result=indexedResult();result.Freshness.DiscoveryFinished=false;f.calls[1].resolve(result);await turn();
    assert.equal(f.page.attributes['data-view-state'],'populating');
    const refresh=f.page.children[1].children[3].onclick();await turn();f.calls[2].resolve([]);await turn();
    f.calls[3].resolve({...result,Freshness:null});await refresh;
    assert.match(f.page.children[4].textContent,/unavailable/);f.abort.abort();
});

test('Indexed refresh failure retains usable cards but authorization denial clears activity',async()=>{
    const f=progressiveFixture(true,false,'all',true);await turn();f.calls[0].resolve([]);await turn();
    f.calls[1].resolve(indexedResult(automaticResult.Items));await turn();
    const grid=f.page.children[5],card=grid.children[0];assert.ok(card);
    let refresh=f.page.children[1].children[3].onclick();await turn();f.calls[2].resolve([]);await turn();
    assert.match(f.calls[3].o.url,/refresh=true/);f.calls[3].reject({status:503});await refresh;
    assert.equal(grid.children[0],card);assert.match(f.page.children[4].textContent,/unavailable/);
    refresh=f.page.children[1].children[3].onclick();await turn();f.calls[4].resolve([]);await turn();
    f.calls[5].reject({status:403});await refresh;assert.equal(grid.children.length,0);f.abort.abort();
});

for (const first of ['poll', 'more']) test('Indexed poll and pagination serialize snapshots: ' + first + ' starts first',async t=>{
    t.mock.timers.enable({apis:['setTimeout']});
    const f=progressiveFixture(true,false,'all',true);t.after(()=>f.abort.abort());
    await turn();f.calls[0].resolve([]);await turn();f.calls[1].resolve(indexedResult(automaticResult.Items,'old-next'));await turn();
    const more=f.page.children.at(-1),grid=f.page.children[5];
    const second={...automaticResult.Items[0],ItemId:'9'.repeat(32),Name:'Second title'};
    if(first==='poll') {
        t.mock.timers.tick(30000);await turn();assert.equal(f.calls.length,3);
        assert.equal(more.disabled,true);
        await more.onclick();assert.equal(f.calls.length,3,'No pagination may append to a snapshot being replaced');
        f.calls[2].resolve(indexedResult(automaticResult.Items,'fresh-next'));await turn();
        const loading=more.onclick();await turn();assert.match(f.calls[3].o.url,/continuation=fresh-next/);
        f.calls[3].resolve(indexedResult([second]));await loading;
    } else {
        const loading=more.onclick();await turn();assert.match(f.calls[2].o.url,/continuation=old-next/);
        t.mock.timers.tick(30000);await turn();assert.equal(f.calls.length,3,'Poll must wait for pagination');
        f.calls[2].resolve(indexedResult([second]));await loading;
        t.mock.timers.tick(30000);await turn();assert.equal(f.calls.length,4);
        assert.match(f.calls[3].o.url,/check=true&revision=view-1/);
        f.calls[3].resolve({...indexedResult(),Preparing:false,Changed:true});await turn();
        assert.equal(f.calls.length,4,'Polling must not retrieve or replace result pages');
    }
    assert.equal(grid.children.length,2);assert.equal(new Set(grid.children).size,2);
    assert.equal(more.hidden,true);const count=f.calls.length;await more.onclick();assert.equal(f.calls.length,count);
});

for(const operation of ['initial','refresh','poll','more']) for(const status of [401,403])
test(`Indexed ${operation} ${status} clears memberships, activity, directory and continuation`,async t=>{
    t.mock.timers.enable({apis:['setTimeout']});
    const f=progressiveFixture(true,false,'all',true);t.after(()=>f.abort.abort());
    await turn();f.calls[0].resolve([overviewItems[0]]);await turn();
    if(operation==='initial') f.calls[1].reject({status});
    else {
        f.calls[1].resolve(indexedResult(automaticResult.Items,'private-next'));await turn();
        if(operation==='refresh') {f.page.children[1].children[3].onclick();await turn();f.calls[2].resolve([overviewItems[0]]);await turn();}
        if(operation==='poll') {t.mock.timers.tick(30000);await turn();}
        if(operation==='more') {f.page.children.at(-1).onclick();await turn();}
        f.calls.at(-1).reject({status});
    }
    await turn();
    assert.equal(f.page.children[5].children.length,0);
    assert.equal(f.page.children.at(-1).hidden,true);
    assert.match(f.page.children[4].textContent,/authorization|access|authenticate/i);
    assert.equal(textOf(f.page).includes(overviewItems[0].Users[1].DisplayName),false);
    const before=f.calls.length;t.mock.timers.tick(30000);await turn();await f.page.children.at(-1).onclick();assert.equal(f.calls.length,before);
});

for(const denialFirst of [true,false]) test('Indexed authorization denial invalidates overlapping refresh: denial first=' + denialFirst,async t=>{
    const f=progressiveFixture(true,false,'all',true);t.after(()=>f.abort.abort());
    await turn();f.calls[0].resolve([]);await turn();f.calls[1].resolve(indexedResult(automaticResult.Items,'private-next'));await turn();
    const more=f.page.children.at(-1).onclick();await turn();
    const refresh=f.page.children[1].children[3].onclick();await turn();
    if(denialFirst) {f.calls[2].reject({status:403});await more;f.calls[3].resolve([overviewItems[0]]);await turn();if(f.calls[4]) f.calls[4].resolve(indexedResult(automaticResult.Items,'late-private-next'));await refresh;}
    else {f.calls[3].resolve([overviewItems[0]]);await turn();assert.equal(f.calls.length,4,'Replacement query waits for the earlier page');f.calls[2].reject({status:403});await more;await refresh;}
    assert.equal(f.page.children[5].children.length,0);assert.equal(f.page.children.at(-1).hidden,true);
});

test('Indexed pagination service failure retains usable cards and cursor',async t=>{
    const f=progressiveFixture(true,false,'all',true);t.after(()=>f.abort.abort());
    await turn();f.calls[0].resolve([]);await turn();f.calls[1].resolve(indexedResult(automaticResult.Items,'same-next'));await turn();
    const grid=f.page.children[5],card=grid.children[0],more=f.page.children.at(-1);
    const loading=more.onclick();await turn();f.calls[2].reject({status:503});await loading;
    assert.equal(grid.children[0],card);assert.equal(more.hidden,false);
    const retry=more.onclick();await turn();assert.match(f.calls[3].o.url,/continuation=same-next/);
    f.calls[3].resolve(indexedResult());await retry;assert.equal(grid.children[0],card);
});

for(const moreFirst of [true,false]) test('Indexed refresh supersedes pagination in either response order: pagination first=' + moreFirst,async t=>{
    const f=progressiveFixture(true,false,'all',true);t.after(()=>f.abort.abort());
    await turn();f.calls[0].resolve([]);await turn();f.calls[1].resolve(indexedResult(automaticResult.Items,'old-next'));await turn();
    const more=f.page.children.at(-1),grid=f.page.children[5],card=grid.children[0];
    const loading=more.onclick();await turn();const refresh=f.page.children[1].children[3].onclick();await turn();
    f.calls[3].resolve([]);await turn();
    const old={...automaticResult.Items[0],ItemId:'8'.repeat(32),Name:'Old snapshot'};
    const fresh={...automaticResult.Items[0],ItemId:'9'.repeat(32),Name:'New snapshot'};
    assert.equal(f.calls.length,4,'Replacement query is queued behind the earlier page');
    f.calls[2].resolve(indexedResult([old],'old-tail'));await loading;await turn();
    f.calls[4].resolve(indexedResult([...automaticResult.Items,fresh],'fresh-tail'));await refresh;
    assert.equal(grid.children.length,2);assert.ok(grid.children.includes(card));assert.equal(textOf(grid).includes('Old snapshot'),false);
    const next=more.onclick();await turn();assert.match(f.calls[5].o.url,/continuation=fresh-tail/);f.calls[5].resolve(indexedResult());await next;
    assert.equal(grid.children.length,2);assert.equal(more.hidden,true);
});

test('Indexed partial-title pages merge owners without replacing poster or duplicating users',async t=>{
    const f=progressiveFixture(true,false,'all',true);t.after(()=>f.abort.abort());
    await turn();f.calls[0].resolve([]);await turn();f.calls[1].resolve(indexedResult(automaticResult.Items,'remaining-owners'));await turn();
    const grid=f.page.children[5],card=grid.children[0],more=f.page.children.at(-1);
    const rest={...automaticResult.Items[0],Users:[{...automaticResult.Items[0].Users[0],UserId:me,DisplayName:'Additional owner'}]};
    const loading=more.onclick();await turn();f.calls[2].resolve(indexedResult([rest]));await loading;
    assert.equal(grid.children.length,1);assert.equal(grid.children[0],card);
    assert.equal(descendants(card).filter(n=>n.className==='watchguard-user-line').length,2);
    assert.match(textOf(card),/Additional owner/);assert.equal(more.hidden,true);
});

test('Combined browser retains server order and replaces preliminary membership cards',async t=>{
    const f=progressiveFixture(true,false,'all',true);t.after(()=>f.abort.abort());
    await turn();f.calls[0].resolve([overviewItems[0]]);await turn();
    assert.equal(f.page.attributes['data-view-state'],'preliminary');
    const z={...automaticResult.Items[0],Name:'Zebra'},a={...z,ItemId:'8'.repeat(32),Name:'Alpha'};
    f.calls[1].resolve(indexedResult([z,a]));await turn();
    assert.deepEqual(f.page.children[5].children.map(c=>c.children[0].children[1].textContent),['Zebra','Alpha']);
    assert.match(f.page.children[2].textContent,/2 titles loaded/);
});
test('Search debounces and immediately fences responses from the prior query',async t=>{
    t.mock.timers.enable({apis:['setTimeout']});const f=progressiveFixture(true,false,'all',true);t.after(()=>f.abort.abort());
    await turn();f.calls[0].resolve([]);await turn();
    const search=descendants(f.page).find(n=>n.type==='search');
    search.value='A';search.oninput();search.value='Al';search.oninput();
    f.calls[1].resolve(indexedResult(automaticResult.Items));await turn();assert.equal(f.page.children[5].children.length,0);
    t.mock.timers.tick(249);await turn();assert.equal(f.calls.length,2);
    t.mock.timers.tick(1);await turn();f.calls[2].resolve([]);await turn();
    assert.match(f.calls[3].o.url,/search=Al$/);f.calls[3].resolve(indexedResult());await turn();
    search.value='';search.oninput();t.mock.timers.tick(250);await turn();f.calls[4].resolve([]);await turn();
    assert.match(f.calls[5].o.url,/search=$/);f.calls[5].resolve(indexedResult());await turn();
});
test('Clearing search restores a newly prepared paged view and its continuation',async t=>{
    t.mock.timers.enable({apis:['setTimeout']});
    const f=progressiveFixture(true,false,'all',true);t.after(()=>f.abort.abort());
    await turn();f.calls[0].resolve([]);await turn();
    f.calls[1].resolve(indexedResult(automaticResult.Items,'initial-more'));await turn();
    const search=descendants(f.page).find(n=>n.type==='search'),more=f.page.children.at(-1);
    search.value='needle';search.oninput();t.mock.timers.tick(250);await turn();
    f.calls[2].resolve([]);await turn();f.calls[3].resolve(indexedResult(automaticResult.Items));await turn();
    assert.equal(more.hidden,true);
    search.value='';search.oninput();t.mock.timers.tick(250);await turn();
    f.calls[4].resolve([]);await turn();
    f.calls[5].resolve({...indexedResult([],'prepare-cleared'),Preparing:true});await turn();
    assert.match(f.calls[6].o.url,/continuation=prepare-cleared/);
    f.calls[6].resolve(indexedResult(automaticResult.Items,'cleared-more'));await turn();
    assert.equal(more.hidden,false);assert.equal(more.textContent,'Load more results');
    const card=f.page.children[5].children[0],loading=more.onclick();await turn();
    assert.match(f.calls[7].o.url,/search=&continuation=cleared-more$/);
    const second={...automaticResult.Items[0],ItemId:'9'.repeat(32),Name:'Second'};
    f.calls[7].resolve(indexedResult([second]));await loading;
    assert.equal(f.page.children[5].children.length,2);assert.equal(f.page.children[5].children[0],card);
});
test('Status checkbox requests a new server view and fences a pending page',async t=>{
    const f=progressiveFixture(true,false,'all',true);t.after(()=>f.abort.abort());await turn();f.calls[0].resolve([]);await turn();
    f.calls[1].resolve(indexedResult(automaticResult.Items,'old'));await turn();const loading=f.page.children.at(-1).onclick();await turn();
    const watched=descendants(f.page).find(n=>n.type==='checkbox'&&n.value==='watched');watched.checked=true;watched.onchange();await turn();
    f.calls[2].resolve(indexedResult([{...automaticResult.Items[0],Name:'Superseded'}]));await loading;
    f.calls[3].resolve([]);await turn();assert.match(f.calls[4].o.url,/statuses=.*watched/);
    f.calls[4].resolve(indexedResult());await turn();assert.equal(textOf(f.page).includes('Superseded'),false);
});
test('Preparing pages advance automatically, and expiration retains filters and cards',async t=>{
    const f=progressiveFixture(true,false,'all',true);t.after(()=>f.abort.abort());await turn();f.calls[0].resolve([overviewItems[0]]);await turn();
    f.calls[1].resolve({...indexedResult([],'prepare-next'),Preparing:true});await turn();
    assert.match(f.page.children[2].textContent,/Loading/);assert.equal(f.page.children[5].children.length,1);
    const more=f.page.children.at(-1);assert.match(f.calls[2].o.url,/continuation=prepare-next/);f.calls[2].resolve(indexedResult(automaticResult.Items,'page'));await turn();
    const card=f.page.children[5].children[0];const expired=more.onclick();await turn();f.calls[3].reject({status:409});await expired;
    assert.equal(f.page.children[5].children[0],card);assert.equal(more.hidden,false);assert.equal(more.textContent,'Refresh this view');assert.match(f.page.children[4].textContent,/same filters/);
    const recovery=more.onclick();await turn();f.calls[4].resolve([]);await turn();
    assert.match(f.calls[5].o.url,/owner=all.*statuses=watchlisted%2Cwatching%2Cplaying.*refresh=true/);
    f.calls[5].resolve(indexedResult(automaticResult.Items));await recovery;assert.equal(more.hidden,true);
});


test('Pagination preserves the focused removal action and its poster node',async t=>{
    const f=progressiveFixture(true,false,'all',true);t.after(()=>f.abort.abort());await turn();f.calls[0].resolve([]);await turn();
    f.calls[1].resolve(indexedResult([overviewItems[0]],'next'));await turn();
    const card=f.page.children[5].children[0],remove=descendants(card).find(n=>n.className?.includes('watchguard-remove'));
    assert.ok(remove);remove.focus();const next=f.page.children.at(-1).onclick();await turn();f.calls[2].resolve(indexedResult([]));await next;
    assert.equal(f.page.children[5].children[0],card);assert.ok(descendants(card).includes(remove));assert.equal(remove.removed,false);
});

test('Visible first-page polling replaces empty population and changed activity without Refresh',async t=>{
    t.mock.timers.enable({apis:['setTimeout']});const f=progressiveFixture(true,false,'all',true);t.after(()=>f.abort.abort());
    await turn();f.calls[0].resolve([]);await turn();f.calls[1].resolve({...indexedResult(),Freshness:{Revision:'empty',PopulationPending:true}});await turn();
    t.mock.timers.tick(30000);await turn();assert.ok(!f.calls[2].o.url.includes('check=true'));
    f.calls[2].resolve(indexedResult(automaticResult.Items));await turn();assert.equal(f.page.children[5].children.length,1);
    const poster=f.page.children[5].children[0].children[0];
    t.mock.timers.tick(30000);await turn();
    const stopped={...automaticResult.Items[0],Users:automaticResult.Items[0].Users.map(u=>({...u,Reasons:['InProgress']}))};
    f.calls[3].resolve(indexedResult([stopped]));await turn();assert.equal(f.page.children[5].children[0].children[0],poster);
    assert.ok(descendants(f.page.children[5]).filter(n=>n.className==='watchguard-live-stale').every(n=>n.hidden));
    assert.ok(!descendants(f.page.children[5]).some(n=>n.attributes?.['aria-label']==='Currently Playing'));
    t.mock.timers.tick(30000);await turn();f.calls[4].resolve(indexedResult());await turn();assert.equal(f.page.children[5].children.length,0);
});

test('Deeper views check changes, preserve ordering and label retained playback state',async t=>{
    t.mock.timers.enable({apis:['setTimeout']});const f=progressiveFixture(true,false,'all',true);t.after(()=>f.abort.abort());
    await turn();f.calls[0].resolve([]);await turn();f.calls[1].resolve(indexedResult(automaticResult.Items,'next'));await turn();
    const more=f.page.children.at(-1),loading=more.onclick();await turn();
    const second={...automaticResult.Items[0],ItemId:'9'.repeat(32),Name:'Second'};
    f.calls[2].resolve(indexedResult([second]));await loading;const cards=[...f.page.children[5].children];
    assert.match(textOf(f.page.children[5]),/Playing when loaded · may have stopped/);
    t.mock.timers.tick(30000);await turn();assert.match(f.calls[3].o.url,/check=true&revision=view-1$/);
    f.calls[3].resolve({...indexedResult(),Changed:true,Preparing:false});await turn();
    assert.deepEqual(f.page.children[5].children,cards);
    const updates=descendants(f.page).find(n=>n.textContent==='Updates available');assert.equal(updates.hidden,false);
    updates.onclick();await turn();f.calls[4].resolve([]);await turn();f.calls[5].resolve(indexedResult([second]));await turn();
    assert.equal(f.page.children[5].children.length,1);assert.equal(updates.hidden,true);
});

test('Automatic preparation crosses the empty prepared boundary and stops at the first ordered page',async t=>{
    const f=progressiveFixture(true,false,'all',true);t.after(()=>f.abort.abort());await turn();f.calls[0].resolve([overviewItems[0]]);await turn();
    f.calls[1].resolve({...indexedResult([],'a'),Preparing:true});await turn();
    assert.equal(f.page.children[5].children.length,1);assert.equal(f.page.attributes['data-view-state'],'preliminary');
    f.calls[2].resolve({...indexedResult([],'b'),Preparing:true});await turn();
    f.calls[3].resolve({...indexedResult([],'boundary'),Preparing:false});await turn();
    assert.match(f.calls[4].o.url,/continuation=boundary/);
    f.calls[4].resolve({...indexedResult(automaticResult.Items,'ordinary-more'),Preparing:false});await turn();
    assert.equal(f.calls.length,5);assert.equal(f.page.children.at(-1).textContent,'Load more results');assert.equal(f.page.attributes['aria-busy'],'false');
});

test('Automatic preparation exhausts four requests then requires a manual continuation',async t=>{
    t.mock.timers.enable({apis:['setTimeout']});const f=progressiveFixture(true,false,'all',true);t.after(()=>f.abort.abort());
    await turn();f.calls[0].resolve([overviewItems[0]]);await turn();
    for(let n=1;n<=4;n++){f.calls[n].resolve({...indexedResult([],'cursor-'+n),Preparing:true});await turn();}
    assert.equal(f.calls.length,5);assert.equal(f.page.children[5].children.length,1);
    const more=f.page.children.at(-1);assert.equal(more.textContent,'Continue loading');assert.equal(more.hidden,false);
    t.mock.timers.tick(30000);await turn();assert.equal(f.calls.length,5,'A poll must not reset an exhausted preparation budget');
    const loading=more.onclick();await turn();assert.match(f.calls[5].o.url,/continuation=cursor-4/);
    f.calls[5].resolve(indexedResult(automaticResult.Items,'ordinary-next'));await loading;assert.equal(f.calls.length,6);
    assert.equal(more.textContent,'Load more results');
});

for(const outcome of ['expiry','repeated cursor','empty']) test('Automatic preparation terminates on '+outcome,async t=>{
    const f=progressiveFixture(true,false,'all',true);t.after(()=>f.abort.abort());await turn();f.calls[0].resolve([overviewItems[0]]);await turn();
    f.calls[1].resolve({...indexedResult([],'same'),Preparing:true});await turn();
    if(outcome==='expiry')f.calls[2].reject({status:409});
    else f.calls[2].resolve(outcome==='empty'?indexedResult():{...indexedResult([],'same'),Preparing:true});
    await turn();assert.equal(f.calls.length,3);assert.equal(f.page.attributes['aria-busy'],'false');
    if(outcome==='empty'){assert.equal(f.page.children[5].children.length,0);assert.equal(f.page.children.at(-1).hidden,true);}
    else {assert.equal(f.page.children[5].children.length,1);assert.equal(f.page.children.at(-1).textContent,'Refresh this view');}
});

for(const cancellation of ['filters','search','account','navigation']) test('Automatic preparation fences '+cancellation+' changes before another request',async t=>{
    t.mock.timers.enable({apis:['setTimeout']});const f=progressiveFixture(true,false,'all',true);t.after(()=>f.abort.abort());await turn();f.calls[0].resolve([]);await turn();
    f.calls[1].resolve({...indexedResult([],'first'),Preparing:true});await turn();
    if(cancellation==='filters')f.page.updateFilters('mine','watched','title');
    if(cancellation==='search'){const search=descendants(f.page).find(n=>n.type==='search');search.value='new';search.oninput();}
    if(cancellation==='account')f.changeAccount();
    if(cancellation==='navigation')f.abort.abort();
    f.calls[2].resolve({...indexedResult([],'superseded'),Preparing:true});await turn();
    assert.ok(f.calls.every(c=>!c.o.url.includes('continuation=superseded')));
    assert.equal(f.page.children[5].children.length,0);
});

test('First-page update failures mark retained live badges stale',async t=>{
    t.mock.timers.enable({apis:['setTimeout']});const f=progressiveFixture(true,false,'all',true);t.after(()=>f.abort.abort());await turn();f.calls[0].resolve([]);await turn();
    f.calls[1].resolve(indexedResult(automaticResult.Items));await turn();t.mock.timers.tick(30000);await turn();f.calls[2].reject({status:503});await turn();
    assert.match(textOf(f.page.children[5]),/Playing when loaded · may have stopped/);assert.equal(f.page.children[5].children.length,1);
});

test('Deeper checks resume their bounded work on the next poll without fetching result pages',async t=>{
    t.mock.timers.enable({apis:['setTimeout']});const f=progressiveFixture(true,false,'all',true);t.after(()=>f.abort.abort());await turn();f.calls[0].resolve([]);await turn();
    f.calls[1].resolve(indexedResult(automaticResult.Items,'page-next'));await turn();const loading=f.page.children.at(-1).onclick();await turn();f.calls[2].resolve(indexedResult());await loading;
    t.mock.timers.tick(30000);await turn();
    for(let n=3;n<7;n++){assert.match(f.calls[n].o.url,/check=true/);f.calls[n].resolve({...indexedResult([],'check-'+n),Preparing:true,Changed:false});await turn();}
    assert.equal(f.calls.length,7);t.mock.timers.tick(30000);await turn();assert.match(f.calls[7].o.url,/continuation=check-6/);
    f.calls[7].resolve({...indexedResult(),Preparing:false,Changed:false});await turn();assert.equal(f.page.children[5].children.length,1);
});

test('Hidden documents pause first-page polling and resume without another navigation',async t=>{
    t.mock.timers.enable({apis:['setTimeout']});const f=progressiveFixture(true,false,'all',true);t.after(()=>f.abort.abort());await turn();f.calls[0].resolve([]);await turn();f.calls[1].resolve(indexedResult());await turn();
    f.document.hidden=true;t.mock.timers.tick(30000);await turn();assert.equal(f.calls.length,2);
    f.document.hidden=false;t.mock.timers.tick(30000);await turn();assert.equal(f.calls.length,3);f.calls[2].resolve(indexedResult(automaticResult.Items));await turn();assert.equal(f.page.children[5].children.length,1);
});

for(const status of [401,403]) test('Automatic preparation '+status+' clears the account and stops queued work',async t=>{
    t.mock.timers.enable({apis:['setTimeout']});const f=progressiveFixture(true,false,'all',true);t.after(()=>f.abort.abort());await turn();f.calls[0].resolve([overviewItems[0]]);await turn();f.calls[1].resolve({...indexedResult([],'auto-next'),Preparing:true});await turn();
    f.calls[2].reject({status});await turn();assert.equal(f.page.children[5].children.length,0);assert.equal(f.page.children.at(-1).hidden,true);
    assert.match(f.page.children[4].textContent,/Authorization denied/);t.mock.timers.tick(30000);await turn();assert.equal(f.calls.length,3);
});

for(const status of [401,403,409]) test('Deeper authorized change check handles '+status+' without reordering or loops',async t=>{
    t.mock.timers.enable({apis:['setTimeout']});const f=progressiveFixture(true,false,'all',true);t.after(()=>f.abort.abort());await turn();f.calls[0].resolve([]);await turn();f.calls[1].resolve(indexedResult(automaticResult.Items,'more'));await turn();
    const loading=f.page.children.at(-1).onclick();await turn();f.calls[2].resolve(indexedResult());await loading;
    t.mock.timers.tick(30000);await turn();assert.match(f.calls[3].o.url,/check=true/);f.calls[3].reject({status});await turn();assert.equal(f.calls.length,4);
    if(status===409){assert.equal(f.page.children[5].children.length,1);assert.equal(f.page.children.at(-1).textContent,'Refresh this view');}
    else {assert.equal(f.page.children[5].children.length,0);t.mock.timers.tick(30000);await turn();assert.equal(f.calls.length,4);}
});

test('Updates available action retains the deeper view when the replacement query fails',async t=>{
    t.mock.timers.enable({apis:['setTimeout']});const f=progressiveFixture(true,false,'all',true);t.after(()=>f.abort.abort());await turn();f.calls[0].resolve([]);await turn();f.calls[1].resolve(indexedResult(automaticResult.Items,'more'));await turn();
    const loading=f.page.children.at(-1).onclick();await turn();f.calls[2].resolve(indexedResult());await loading;const card=f.page.children[5].children[0];
    t.mock.timers.tick(30000);await turn();f.calls[3].resolve({...indexedResult(),Changed:true,Preparing:false});await turn();
    descendants(f.page).find(n=>n.textContent==='Updates available').onclick();await turn();f.calls[4].resolve([]);await turn();f.calls[5].reject({status:503});await turn();
    assert.equal(f.page.children[5].children[0],card);assert.match(f.page.children[4].textContent,/unavailable/);assert.match(textOf(card),/may have stopped/);
});

test('Seven owners use persistent expansion and date details, with no presentation requests',async t=>{
    t.mock.timers.enable({apis:['setTimeout']});const f=progressiveFixture(true,false,'all',true);t.after(()=>f.abort.abort());
    await turn();f.calls[0].resolve([]);await turn();
    const users=Array.from({length:7},(_,i)=>({UserId:(i+1).toString(16).padStart(32,'0'),DisplayName:'Long household name '+i,Reasons:['Watchlisted'],AddedAtUtc:'2026-10-20T12:00:00Z'}));
    const item={...overviewItems[0],Users:users};f.calls[1].resolve(indexedResult([item]));await turn();
    const card=f.page.children[5].children[0],details=descendants(card).find(n=>n.className==='watchguard-more-owners');
    assert.equal(details.hidden,false);assert.equal(card.children[1].children.length,2);assert.equal(details.children[1].children.length,5);
    details.open=true;const row=details.children[1].children[0],dates=descendants(row).find(n=>n.className==='watchguard-dates');dates.open=true;
    assert.equal(f.calls.length,2);
    t.mock.timers.tick(30000);await turn();f.calls[2].resolve(indexedResult([{...item,Users:users.map((u,i)=>i===2?{...u,LastPlayedDate:'2026-10-21T12:00:00Z'}:u)}]));await turn();
    assert.equal(f.page.children[5].children[0],card);assert.equal(details.open,true);assert.equal(details.children[1].children[0],row);assert.equal(dates.open,true);
    assert.equal(descendants(dates).filter(n=>n.tag==='time').length,2);
});

test('Routine unchanged polls do not mutate the settled live announcement or owner options',async t=>{
    t.mock.timers.enable({apis:['setTimeout']});const f=progressiveFixture(true,false,'all',true);t.after(()=>f.abort.abort());
    await turn();f.calls[0].resolve([]);await turn();f.calls[1].resolve(indexedResult(automaticResult.Items));await turn();
    const live=descendants(f.page).find(n=>n.className==='watchguard-sr-only'),select=descendants(f.page).find(n=>n.attributes?.['aria-label']==='Watchlist owner');
    const options=[...select.children];let text=live.textContent,mutations=0;Object.defineProperty(live,'textContent',{get:()=>text,set:value=>{mutations++;text=value;}});
    t.mock.timers.tick(30000);await turn();f.calls[2].resolve(indexedResult(automaticResult.Items));await turn();
    assert.equal(mutations,0);assert.deepEqual(select.children,options);assert.match(f.page.children[2].textContent,/1 title loaded/);assert.doesNotMatch(f.page.children[2].textContent,/1 titles/);
});

test('Empty, unselected, unavailable and paused views have distinct recovery states',async t=>{
    for(const state of ['empty','unselected','failed','paused']) {
        const f=progressiveFixture(true,false,'all',true);t.after(()=>f.abort.abort());await turn();
        f.calls[0].resolve([]);await turn();
        if(state==='failed')f.calls[1].reject({status:503});
        else if(state==='paused')for(let i=1;i<=4;i++){f.calls[i].resolve({...indexedResult([],'prep'+i),Preparing:true});await turn();}
        else f.calls[1].resolve(indexedResult());
        await turn();
        if(state==='unselected'){f.page.updateFilters('all','none','title');await turn();f.calls[2].resolve([]);await turn();f.calls[3].resolve(indexedResult());await turn();}
        assert.equal(f.page.attributes['data-view-state'],state);
        if(state==='paused')assert.equal(f.page.children.at(-1).hidden,false);
        if(state==='failed')assert.ok(f.page.children[4].textContent);
    }
});

test('Typing during a quiet poll immediately presents foreground loading during debounce',async t=>{
    t.mock.timers.enable({apis:['setTimeout']});const f=progressiveFixture(true,false,'all',true);t.after(()=>f.abort.abort());
    await turn();f.calls[0].resolve([]);await turn();f.calls[1].resolve(indexedResult());await turn();
    t.mock.timers.tick(30000);await turn();const search=descendants(f.page).find(n=>n.type==='search');search.value='new title';search.oninput();
    assert.equal(f.page.attributes['data-view-state'],'loading');assert.equal(f.page.attributes['aria-busy'],'true');
    f.calls[2].resolve(indexedResult(automaticResult.Items));await turn();assert.equal(f.page.children[5].children.length,0);
});

test('Legacy overview does not claim indexed search or automatic polling',async()=>{
    const f=progressiveFixture();await turn();f.calls[0].resolve([]);await turn();f.calls[1].resolve(automaticResult);await turn();
    const disclosure=descendants(f.page).find(n=>n.className==='watchguard-coverage-details');
    assert.equal(disclosure.children.find(n=>n.id==='watchguard-search-scope').hidden,true);
    assert.equal(disclosure.children.at(-1).hidden,true);
    assert.ok(descendants(f.page).some(n=>n.className==='watchguard-sr-only' && n.attributes.role==='status'));
    f.abort.abort();
});

for(const changed of [false,true,'preparing']) test('Deeper check recovers from 503 with '+changed+' while retaining stale playback and the view',async t=>{
    t.mock.timers.enable({apis:['setTimeout']});const f=progressiveFixture(true,false,'all',true);t.after(()=>f.abort.abort());
    await turn();f.calls[0].resolve([]);await turn();
    const item={...automaticResult.Items[0],Users:[me,other,'e'.repeat(32)].map(UserId=>({...automaticResult.Items[0].Users[0],UserId}))};
    f.calls[1].resolve(indexedResult([item],'more'));await turn();
    const loading=f.page.children.at(-1).onclick();await turn();f.calls[2].resolve(indexedResult([{...item,ItemId:'9'.repeat(32),Name:'Second'}]));await loading;
    const grid=f.page.children[5],cards=[...grid.children],people=descendants(cards[0]).find(n=>n.className==='watchguard-more-owners');
    const dates=descendants(cards[0]).find(n=>n.className==='watchguard-dates'),focus=dates.children[0];
    people.open=true;dates.open=true;f.document.activeElement=focus;f.page.scrollTop=400;
    t.mock.timers.tick(30000);await turn();assert.match(f.calls[3].o.url,/check=true/);f.calls[3].reject({status:503});await turn();
    assert.equal(f.page.attributes['data-view-state'],'failed');
    t.mock.timers.tick(30000);await turn();
    if(changed==='preparing') for(let i=4;i<8;i++){f.calls[i].resolve({...indexedResult([],'check-'+i),Preparing:true,Changed:false});await turn();}
    else {f.calls[4].resolve({...indexedResult(),Preparing:false,Changed:changed});await turn();}
    assert.equal(f.page.attributes['data-view-state'],changed===true?'updates':'ready');
    assert.doesNotMatch(f.page.children[2].textContent,/unavailable/i);assert.equal(f.page.children[4].textContent,'');
    assert.equal(button(f.page,'Updates available').hidden,changed!==true);
    if(changed==='preparing') {
        t.mock.timers.tick(30000);await turn();assert.match(f.calls[8].o.url,/check=true.*continuation=check-7/);
        f.calls[8].resolve({...indexedResult(),Preparing:false,Changed:true});await turn();assert.equal(f.page.attributes['data-view-state'],'updates');
    }
    assert.deepEqual(grid.children,cards);assert.equal(f.page.scrollTop,400);assert.equal(f.document.activeElement,focus);
    assert.equal(people.open,true);assert.equal(dates.open,true);
    assert.ok(descendants(grid).filter(n=>n.className==='watchguard-live-stale').every(n=>!n.hidden));
});

test('Successful deeper checks preserve unrelated pagination errors',async t=>{
    t.mock.timers.enable({apis:['setTimeout']});const f=progressiveFixture(true,false,'all',true);t.after(()=>f.abort.abort());
    await turn();f.calls[0].resolve([]);await turn();f.calls[1].resolve(indexedResult(automaticResult.Items,'page-2'));await turn();
    const more=f.page.children.at(-1);let loading=more.onclick();await turn();f.calls[2].resolve(indexedResult([],'page-3'));await loading;
    loading=more.onclick();await turn();f.calls[3].reject({status:503});await loading;const error=f.page.children[4].textContent;assert.ok(error);
    t.mock.timers.tick(30000);await turn();f.calls[4].reject({status:503});await turn();
    t.mock.timers.tick(30000);await turn();f.calls[5].resolve({...indexedResult(),Preparing:false,Changed:true});await turn();
    assert.equal(f.page.children[4].textContent,error);assert.equal(f.page.attributes['data-view-state'],'failed');
    assert.equal(button(f.page,'Updates available').hidden,false);
});

test('Missing selected owner has one persistent option through polls and valid-owner selection',async t=>{
    t.mock.timers.enable({apis:['setTimeout']});const missing='f'.repeat(32),f=progressiveFixture(true,false,missing,true);t.after(()=>f.abort.abort());
    await turn();f.calls[0].resolve([]);await turn();f.calls[1].resolve(indexedResult());await turn();
    const select=descendants(f.page).find(n=>n.attributes?.['aria-label']==='Watchlist owner');
    const placeholders=()=>select.children.filter(n=>n.value===missing);
    assert.equal(placeholders().length,1);const placeholder=placeholders()[0];
    const valid=select.children.find(n=>n.value===other),mine=select.children.find(n=>n.value==='mine');
    for(let i=2;i<5;i++) {
        t.mock.timers.tick(30000);await turn();f.calls[i].resolve(indexedResult());await turn();
        assert.equal(placeholders().length,1);assert.equal(placeholders()[0],placeholder);assert.equal(select.value,missing);
        assert.equal(select.children.find(n=>n.value===other),valid);
    }
    select.value=other;select.onchange();await turn();f.calls[5].resolve([]);await turn();f.calls[6].resolve(indexedResult(automaticResult.Items));await turn();
    assert.equal(select.value,other);assert.equal(placeholders().length,0);
    assert.equal(select.children.find(n=>n.value===other),valid);assert.equal(select.children.find(n=>n.value==='mine'),mine);
});

test('Refresh stays focusable and coalesces repeated activation while loading',async t=>{
    const f=progressiveFixture(true,false,'all',true);t.after(()=>f.abort.abort());
    await turn();f.calls[0].resolve([]);await turn();f.calls[1].resolve(indexedResult(automaticResult.Items));await turn();
    const refresh=f.page.children[1].children[3],card=f.page.children[5].children[0];
    const loading=refresh.onclick();await turn();
    assert.notEqual(refresh.disabled,true);assert.equal(refresh.getAttribute('aria-disabled'),'true');
    const count=f.calls.length;await refresh.onclick();assert.equal(f.calls.length,count);
    f.calls[2].resolve([]);await turn();f.calls[3].resolve(indexedResult(automaticResult.Items));await loading;
    assert.equal(refresh.getAttribute('aria-disabled'),'false');assert.equal(f.page.children[5].children[0],card);
});
