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
        return { tag, style: {}, children: [], events: {}, attributes: {}, setAttribute(k,v) { this.attributes[k]=v; },
            append(...children) { for(const child of children) { child.remove(); child.parent = this; child.removed = false; this.children.push(child); } }, addEventListener(event, fn) { this.events[event] = fn; },
            showModal() { this.opened = true; }, focus() { this.focused = true; }, remove() { if(this.parent) this.parent.children = this.parent.children.filter(c=>c!==this); this.parent = null; this.removed = true; } };
    } };
    return { doc, nodes, focus };
}
test('dialog Cancel, Escape and close all cancel and restore focus', async () => {
    for (const action of ['button', 'cancel', 'close']) {
        const f = documentFixture(); const result = confirmDeletion(f.doc, message); const dialog = f.nodes[0];
        assert.equal(dialog.children[0].textContent, message);
        assert.equal(dialog.children[1].textContent, 'Cancel'); assert.equal(dialog.children[1].focused, true);
        if (action === 'button') dialog.children[1].onclick();
        else dialog.events[action]({ preventDefault() {} });
        assert.equal(await result, false); assert.equal(dialog.removed, true); assert.equal(f.focus.restored, true);
    }
});
test('double approval settles once', async () => {
    const f = documentFixture(); const result = confirmDeletion(f.doc, message); const dialog = f.nodes[0];
    assert.equal(dialog.children[2].textContent, 'Delete Anyway');
    dialog.children[2].onclick(); dialog.children[2].onclick(); dialog.events.close(); assert.equal(await result, true);
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
test('confirmed empty and self-only status skip the extra warning', async () => {
    for (const users of [[], [{ UserId: 'self', DisplayName: 'Me', Reasons: ['Watchlisted'] }]]) {
        const f = backendFixture(users); await f.api.deleteItem('movie'); assert.deepEqual(f.counts(), [1, 0]);
    }
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
    assert.equal(f.nodes[0].children[0].textContent, '<img onerror=evil()>');
    abort.abort(); assert.equal(await pending, false);
});

test('episode and season scope uses verified parent, labels actual target and preserves deletion ID', async () => {
    for (const type of ['Episode', 'Season']) {
        const calls = [], lookups = [];
        const api = { getCurrentUserId: () => 'self', accessToken: () => 'token', getUrl: p => p,
            getItem: async (user, id) => { lookups.push(id); return id === 'target' ? {Id:id, Type:type, SeriesId:'parent', Name:'Target title'} : {Id:id, Type:'Series', Name:'Parent title'}; },
            ajax: async options => { assert.equal(options.url,'WatchGuard/Protection/parent'); return {ItemId:'parent',HasInterest:true,HasOtherInterestedUsers:true,Users:[{UserId:'other',DisplayName:'Other',Reasons:['Watchlisted']}]}; },
            deleteItem: async (...args) => calls.push(args) };
        createAdapter(async text => { assert.match(text,new RegExp('Deleting ' + type.toLowerCase() + ': Target title')); assert.match(text,/parent series: Parent title/); return true; },undefined,protectionCheck).install(api);
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
    assert.equal(cards[0].children.length,3);
    assert.equal(cards[1].children.length,2);
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

function progressiveFixture(admin = true, preferences = false, owner = 'all') {
    const f = documentFixture(), create = f.doc.createElement, calls = [];
    f.doc.createElement = tag => { const n = create(tag); n.replaceChildren = () => { for(const child of [...n.children]) child.remove(); }; n.classList = {add(){}}; return n; };
    let token = 'first';
    const api = {getCurrentUser:async()=>({Name:'Me',Policy:{IsAdministrator:admin}}),getCurrentUserId:()=>me,accessToken:()=>token,getUrl:p=>p,serverId:()=> 'server',getImageUrl:()=> '/image',
        ajax:o=>o.url==='WatchGuard/Users'?Promise.resolve(overviewItems[0].Users):new Promise((resolve,reject)=>calls.push({o,resolve,reject}))};
    const abort = new AbortController();
    const navigation=[];
    const page = watchlistsPage(f.doc,api,abort.signal,owner,(...args)=>{navigation.push(args);page.updateFilters(...args);},{preferences});
    return {page,calls,abort,navigation,changeAccount(){token='second';}};
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
    assert.match(f.page.children[3].textContent,/limit reached/);
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
    f.page.updateFilters('all','watching','title');assert.equal(f.page.children[2].textContent,'');
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
test('Compact rows use safe names, distinct accessible icons, calendar dates and exact timestamp tooltips',()=>{
    const {userLine}=require('../Jellyfin.Plugin.WatchGuard/Web/watchguard.js');
    const date='2026-10-11T09:12:34Z';
    const owner={DisplayName:'<Tom>',Reasons:['Watchlisted','InProgress','CurrentlyPlaying','Watched','Watched'],LastPlayedDate:date,AvailableEpisodes:12,WatchedEpisodes:7};
    const line=userLine(documentFixture().doc,owner);
    assert.deepEqual(line.children[0].children.map(i=>i.textContent),['bookmark','play_circle','sensors','check_circle']);
    assert.deepEqual(line.children[0].children.map(i=>i.attributes['aria-label']),['Watchlist','Watching','Currently Playing','Watched']);
    assert.equal(line.children[1].textContent,'<Tom>');assert.equal(line.children[2].textContent,' · 7/12');
    const time=line.children[3];assert.equal(time.tag,'time');assert.equal(time.dateTime,date);
    assert.equal(time.textContent,new Intl.DateTimeFormat(undefined,{dateStyle:'medium'}).format(new Date(date)));
    assert.equal(time.attributes['aria-label'],'Last played: '+new Intl.DateTimeFormat(undefined,{dateStyle:'full',timeStyle:'long'}).format(new Date(date)));
    assert.equal(time.tabIndex,0);
    assert.equal(userLine(documentFixture().doc,{...owner,Reasons:['CurrentlyPlaying']}).children.length,3);
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
