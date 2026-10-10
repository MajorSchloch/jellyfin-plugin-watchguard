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
        return { tag, style: {}, children: [], events: {}, setAttribute() {},
            append(...children) { this.children.push(...children); }, addEventListener(event, fn) { this.events[event] = fn; },
            showModal() { this.opened = true; }, focus() { this.focused = true; }, remove() { this.removed = true; } };
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
