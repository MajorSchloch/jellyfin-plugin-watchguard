const { test } = require('node:test');
const assert = require('node:assert/strict');
const { install } = require('../Jellyfin.Plugin.WatchGuard/Web/watchguard.js');
function fixture({ admin = true, type = 'Movie' } = {}) {
    const calls = []; let people = [{ userId: 'other', name: 'Alice', reasons: ['Watchlisted'] }];
    const api = {
        getCurrentUserId: () => 'self',
        getItem: async () => ({ Id: 'movie', Name: 'Movie', Type: type, SeriesId: 'series' }),
        getCurrentUser: async () => ({ Policy: { IsAdministrator: admin } }),
        getUrl: path => '/jellyfin/' + path,
        ajax: async options => { calls.push(options.url); return { users: people }; },
        deleteItem: async function (...args) { assert.equal(this, api); calls.push(['DELETE', ...args]); return 'native-result'; }
    };
    return { api, calls, setPeople: value => { people = value; } };
}
test('cancel reliably prevents native deletion', async () => {
    const { api, calls } = fixture();
    install(api, async (title, message) => { assert.match(message, /Alice: Watchlisted/); return false; });
    await assert.rejects(api.deleteItem('movie'), /cancelled/);
    assert.equal(calls.filter(Array.isArray).length, 0);
});
test('explicit override calls native method once preserving arguments, receiver and result', async () => {
    const { api, calls } = fixture(); install(api, async () => true);
    assert.equal(await api.deleteItem('movie', 'extra'), 'native-result');
    assert.deepEqual(calls.at(-1), ['DELETE', 'movie', 'extra']);
});
test('status is refreshed on every attempt', async () => {
    const f = fixture(); let warnings = 0; install(f.api, async () => { warnings++; return false; });
    f.setPeople([]); await f.api.deleteItem('movie');
    f.setPeople([{ userId: 'other', name: 'Bob', reasons: ['Partially watched'] }]);
    await assert.rejects(f.api.deleteItem('movie')); assert.equal(warnings, 1);
});
test('own interest alone does not warn', async () => {
    const f = fixture(); f.setPeople([{ userId: 'self', name: 'Me', reasons: ['Watchlisted'] }]);
    install(f.api, () => assert.fail('unexpected warning')); await f.api.deleteItem('movie');
});
test('network failure and missing title fail closed', async () => {
    for (const method of ['ajax', 'getItem']) {
        const f = fixture(); f.api[method] = async () => { throw new Error('unavailable'); };
        install(f.api, () => assert.fail('unexpected warning'));
        await assert.rejects(f.api.deleteItem('movie'), /unavailable/);
        assert.equal(f.calls.filter(Array.isArray).length, 0);
    }
});
test('non-admin gets generic warning without cross-user API access', async () => {
    const f = fixture({ admin: false }); install(f.api, async (_, message) => { assert.match(message, /could not be checked/); return false; });
    await assert.rejects(f.api.deleteItem('movie')); assert.deepEqual(f.calls, []);
});
test('installation is idempotent and native failure propagates', async () => {
    const f = fixture(); f.api.deleteItem = async () => { throw new Error('native denied'); };
    let count = 0; install(f.api, async () => { count++; return true; }); install(f.api, () => assert.fail());
    await assert.rejects(f.api.deleteItem('movie'), /native denied/); assert.equal(count, 1);
});
test('episode deletion checks series interest', async () => {
    const f = fixture({ type: 'Episode' }); install(f.api, async () => false);
    await assert.rejects(f.api.deleteItem('episode')); assert.match(f.calls[0], /Protection\/series$/);
});
test('parallel native bulk requests are checked individually and prompts serialized', async () => {
    const f = fixture(); let active = 0; install(f.api, async () => { assert.equal(active++, 0); await Promise.resolve(); active--; return false; });
    const results = await Promise.allSettled([f.api.deleteItem('a'), f.api.deleteItem('b')]);
    assert.ok(results.every(r => r.status === 'rejected')); assert.equal(f.calls.filter(Array.isArray).length, 0);
});
