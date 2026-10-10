const assert = require('node:assert/strict');
const fs = require('node:fs');
const { install } = require('../Jellyfin.Plugin.WatchGuard/Web/watchguard.js');
const [base, credentials, id] = process.argv.slice(2);
if (!base || !credentials || !id) throw new Error('Run through docker-smoke.py against its disposable server.');
const auth = JSON.parse(fs.readFileSync(credentials));
const headers = { Authorization: 'MediaBrowser Token="' + auth.admin.AccessToken + '"' };
async function http(path, method = 'GET') {
  const response = await fetch(base + path, { method, headers });
  if (!response.ok) throw new Error('HTTP ' + response.status);
  return response.status === 204 ? undefined : response.json();
}
let deletes = 0;
const api = {
  getCurrentUserId: () => auth.admin.User.Id,
  getItem: (_user, item) => http('/Items/' + item),
  getCurrentUser: () => http('/Users/' + auth.admin.User.Id),
  getUrl: path => base + '/' + path,
  ajax: options => http(options.url.slice(base.length), options.type),
  deleteItem: item => { deletes++; return http('/Items/' + item, 'DELETE'); }
};
(async () => {
  let approve = false;
  install(api, async (_, text) => { assert.match(text, /WatchGuardMember: Watchlisted/); return approve; });
  await assert.rejects(api.deleteItem(id), /cancelled/);
  assert.equal(deletes, 0); await http('/Items/' + id);
  approve = true; await api.deleteItem(id); assert.equal(deletes, 1);
  await assert.rejects(http('/Items/' + id), /404/);
  await assert.rejects(http('/WatchGuard/Protection/' + id), /404/);
  console.log('PASS: live guard cancellation preserves synthetic media; explicit override calls native deletion; missing-item 404');
})().catch(error => { console.error(error); process.exitCode = 1; });
