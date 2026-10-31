const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const acorn = require('acorn'), folder = process.argv[2];
const expected = ['Web.navigation.js', 'Web.watchguard.js', 'Web.settings.html', 'Standalone.bootstrap.js', 'Standalone.startup.js'];
assert.deepEqual(fs.readdirSync(folder).filter(n => /\.(js|html)$/.test(n)).sort(), expected.map(n => 'Jellyfin.Plugin.WatchGuard.' + n).sort());
for (const name of expected) {
    const source = fs.readFileSync(path.join(folder, 'Jellyfin.Plugin.WatchGuard.' + name), 'utf8');
    const scripts = name.endsWith('.html') ? [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]) : [source];
    assert(scripts.length > 0, 'No delivered script: ' + name);
    for (const script of scripts) {
        acorn.parse(script, {ecmaVersion: 2019});
        assert(!/\.(replaceAll|replaceChildren)\s*\(/.test(script), 'Unsupported DOM/string API: ' + name);
        assert(!/Object\.hasOwn\s*\(/.test(script), 'Unsupported Object API: ' + name);
    }
}
const read = name => fs.readFileSync(path.join(folder, 'Jellyfin.Plugin.WatchGuard.' + name), 'utf8');
// Test the exact inline startup concatenation, not only each separate resource.
acorn.parse(read('Web.navigation.js') + '\n' + read('Standalone.startup.js'), {ecmaVersion: 2019});
for (const marker of ['DIAGNOSTICS', 'SERVER_EXPECTED'])
    assert(read('Web.watchguard.js').includes('/*WATCHGUARD_' + marker + '*/false'), 'Lost server switch: ' + marker);
assert(read('Standalone.bootstrap.js').includes('WATCHGUARD_BUILD_ID'), 'Lost bootstrap build identity');
console.log('PASS: five packaged assets, settings inline code and startup concatenation parse as ES2019; server switches retained.');
