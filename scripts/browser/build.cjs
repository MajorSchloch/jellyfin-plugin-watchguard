/* One source, deterministic embedded assets. No runtime polyfills or CDN. */
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const root = path.resolve(__dirname, '../..'), project = path.join(root, 'Jellyfin.Plugin.WatchGuard');
const lock = fs.readFileSync(path.join(__dirname, 'package-lock.json'), 'utf8');
const stamp = path.join(__dirname, 'node_modules/.watchguard-lock');
if (!fs.existsSync(stamp) || fs.readFileSync(stamp, 'utf8') !== lock) {
    cp.execFileSync('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], {cwd: __dirname, stdio: 'inherit'});
    fs.writeFileSync(stamp, lock);
}
const esbuild = require('esbuild'), acorn = require('acorn');
const files = ['Web/watchguard.js', 'Web/navigation.js', 'Web/settings.html', 'Standalone/bootstrap.js', 'Standalone/startup.js'];
function transform(source) {
    // These server-side replacements are intentional deployment switches, not credentials.
    const markers = ['WATCHGUARD_DIAGNOSTICS', 'WATCHGUARD_SERVER_EXPECTED'];
    for (const name of markers) source = source.replaceAll('/*' + name + '*/false', name + '_DISABLED');
    let result = esbuild.transformSync(source, {target: 'chrome79', charset: 'utf8', legalComments: 'inline'}).code;
    for (const name of markers) result = result.replaceAll(name + '_DISABLED', '/*' + name + '*/false');
    // ES2019 is deliberately stricter than Chromium 79's syntax support.
    acorn.parse(result, {ecmaVersion: 2019});
    return result;
}
for (const file of files) {
    const source = fs.readFileSync(path.join(project, file), 'utf8');
    const output = file.endsWith('.html') ? source.replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi,
        (_, start, script, end) => start + '\n' + transform(script) + end) : transform(source);
    const target = path.join(project, 'obj/browser', file);
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.writeFileSync(target, output);
}
console.log('Generated five embedded browser assets for Chromium 79; ES2019 parse checks passed.');
