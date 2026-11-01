const test = require('node:test');
const assert = require('node:assert/strict');
const {createReturnMemory, returnEntry} = require('../Jellyfin.Plugin.WatchGuard/Web/watchguard.js');

const route = '#/home?watchguard=watchlists&owner=mine&interest=watchlisted&sort=title';
const context = (changes = {}) => ({
    itemId: 'a'.repeat(32), offset: 128, depth: 3, ordinal: 41, action: 'title', focus: true,
    ...changes
});
const identity = () => [{}, 'account', 'token', 'server'];

test('return memory binds the context to its history entry, query and complete identity', () => {
    const memory = createReturnMemory(), account = identity();
    memory.remember('origin', route, account, context());
    assert.deepEqual(memory.read('origin', route, account), context());
    assert.equal(memory.read('fresh-entry', route, account), null, 'An equal URL is not the same history entry');
    assert.equal(memory.read('origin', route + '&search=changed', account), null);
    for (let field = 0; field < account.length; field++) {
        memory.remember('origin', route, account, context());
        const different = account.slice(); different[field] = field === 0 ? {} : 'changed';
        assert.equal(memory.read('origin', route, different), null, 'Identity field ' + field + ' must match');
    }
});

test('return memory stores only bounded navigation context, without cached rows or credentials', () => {
    const memory = createReturnMemory(), account = identity();
    const source = context({
        itemId: 'A'.repeat(32), offset: 50000, depth: 500, ordinal: -7,
        action: 'unknown-action', focus: false,
        Name: 'Private title', Users: [{DisplayName: 'Private owner'}], Continuation: 'private-cursor', token: 'private-token'
    });
    memory.remember('origin', route, account, source);
    const stored = memory.read('origin', route, account);
    assert.deepEqual(stored, context({offset: 10000, depth: 100, ordinal: 0, action: 'title', focus: false}));
    source.itemId = 'b'.repeat(32); source.offset = 0;
    stored.itemId = 'c'.repeat(32); stored.offset = 0;
    assert.deepEqual(memory.read('origin', route, account), context({offset: 10000, depth: 100, ordinal: 0, focus: false}));
    memory.remember('origin', route, account, context({offset: -50000, depth: -1, action: 'remove'}));
    assert.deepEqual(memory.read('origin', route, account), context({offset: -10000, depth: 1, action: 'remove'}));
});

test('return memory copies identity values and rejects invalid title identifiers', () => {
    const memory = createReturnMemory(), account = identity(), captured = account.slice();
    memory.remember('origin', route, account, context());
    account[1] = 'changed-account';
    assert.deepEqual(memory.read('origin', route, captured), context(), 'Later array mutation must not retarget stored context');
    for (const itemId of ['', 'not-an-id', '<script>', 'a'.repeat(31), 'a'.repeat(33)]) {
        memory.remember('invalid-' + itemId.length, route, captured, context({itemId}));
        assert.equal(memory.read('invalid-' + itemId.length, route, captured), null);
    }
});

test('return memory preserves a bounded effective query for checks after preferences resolve', () => {
    const memory = createReturnMemory(), account = identity();
    const view = JSON.stringify(['mine', ['watchlisted'], 'title', 30, true, 'search text']);
    memory.remember('origin', route, account, context({view}));
    assert.equal(memory.read('origin', route, account).view, view);
    memory.remember('origin', route, account, context({view: 'x'.repeat(2049)}));
    const result = memory.read('origin', route, account);
    assert.ok(result === null || result.view === undefined, 'A partial effective query must never match');
});

test('return memory cannot retain non-finite position or depth values', () => {
    const memory = createReturnMemory(), account = identity();
    for (const value of [NaN, Infinity, -Infinity]) {
        memory.remember('origin', route, account, context({offset: value, depth: value, ordinal: value}));
        const stored = memory.read('origin', route, account);
        assert.ok(Number.isFinite(stored.offset) && Math.abs(stored.offset) <= 10000);
        assert.ok(Number.isInteger(stored.depth) && stored.depth >= 1 && stored.depth <= 100);
        assert.ok(Number.isInteger(stored.ordinal) && stored.ordinal >= 0);
    }
});

test('return memory keeps at most four entries and expires them after ten minutes', () => {
    let now = 1000;
    const memory = createReturnMemory(() => now), account = identity();
    for (let entry = 0; entry < 5; entry++) memory.remember('entry-' + entry, route, account, context({ordinal: entry}));
    assert.equal(memory.read('entry-0', route, account), null);
    for (let entry = 1; entry < 5; entry++) assert.equal(memory.read('entry-' + entry, route, account).ordinal, entry);
    now += 599999;
    assert.ok(memory.read('entry-4', route, account));
    now++;
    for (let entry = 1; entry < 5; entry++) assert.equal(memory.read('entry-' + entry, route, account), null);
});

test('return memory replaces one entry without accumulating snapshots and supports explicit clearing', () => {
    let now = 1000;
    const memory = createReturnMemory(() => now), account = identity();
    memory.remember('origin', route, account, context());
    now += 300000;
    memory.remember('origin', route, account, context({itemId: 'b'.repeat(32), ordinal: 2, depth: 1}));
    now += 300000;
    assert.deepEqual(memory.read('origin', route, account), context({itemId: 'b'.repeat(32), ordinal: 2, depth: 1}));
    memory.clear();
    assert.equal(memory.read('origin', route, account), null);
});

function historyFixture(state) {
    const writes = [];
    const history = {state, replaceState(next, title, url) { writes.push({next, title, url}); this.state = next; }};
    return {history, writes};
}

test('return entry preserves router state and reuses only its own opaque marker', () => {
    const native = {usr: {native: ['retained']}, key: 'router-key', idx: 7};
    const initial = structuredClone(native), f = historyFixture(native), url = '/jellyfin/web/' + route;
    const first = returnEntry(f.history, url);
    assert.equal(typeof first, 'string'); assert.ok(first.length > 0);
    assert.deepEqual(native, initial, 'The original state object must not change');
    assert.deepEqual({...f.history.state, watchguardReturnEntry: undefined}, {...initial, watchguardReturnEntry: undefined});
    assert.equal(f.history.state.watchguardReturnEntry, first);
    assert.equal(f.writes.length, 1); assert.equal(f.writes[0].url, url); assert.equal(f.writes[0].title, '');
    assert.equal(returnEntry(f.history, url), first);
    assert.equal(f.writes.length, 1, 'Routine reconciliation must not rewrite history');
    const fresh = returnEntry(f.history, url, true);
    assert.notEqual(fresh, first, 'A fresh visit must not inherit a prior entry');
    assert.deepEqual({...f.history.state, watchguardReturnEntry: undefined}, {...initial, watchguardReturnEntry: undefined});
    assert.equal(f.writes.length, 2);
});

test('return entry supports native null state without changing the URL or creating a history entry', () => {
    const f = historyFixture(null), url = '/web/' + route;
    const id = returnEntry(f.history, url);
    assert.deepEqual(f.history.state, {watchguardReturnEntry: id});
    assert.deepEqual(f.writes, [{next: {watchguardReturnEntry: id}, title: '', url}]);
});

test('return entry declines unsupported state shapes and failed history writes', () => {
    for (const state of [undefined, 'native-state', 7, false, [], new Date(0), new Map([['native', true]])]) {
        const f = historyFixture(state);
        assert.equal(returnEntry(f.history, route), null);
        assert.equal(f.writes.length, 0); assert.equal(f.history.state, state);
    }
    const native = {idx: 1};
    const f = historyFixture(native);
    f.history.replaceState = () => { throw new Error('History write unavailable'); };
    assert.equal(returnEntry(f.history, route), null);
    assert.equal(f.history.state, native); assert.deepEqual(native, {idx: 1});
});
