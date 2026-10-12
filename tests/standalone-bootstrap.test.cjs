const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('Jellyfin.Plugin.WatchGuard/Standalone/bootstrap.js','utf8');
function fixture(blocked=false){
    let user='',token='',tick,cleared=false,finish;const calls=[];
    const api={getCurrentUserId:()=>user,accessToken:()=>token,getUrl:p=>'http://localhost/'+p,
        ajax:options=>{calls.push(options);return new Promise(resolve=>{finish=resolve;});}};
    const sandbox={URL,Blob,Date,setInterval:f=>{tick=f;return 1;},clearInterval:()=>{cleared=true;},
        location:{href:'http://localhost/web/',origin:'http://localhost'},ApiClient:api};sandbox.window=sandbox;
    sandbox.document={currentScript:{src:'http://localhost/WatchGuard/Standalone/bootstrap.js'},createElement:()=>({remove(){}}),
        head:{append:script=>{assert.match(script.src,/^blob:/);if(blocked)script.onerror();else {sandbox.WatchGuardPoc={};script.onload();}}}};
    vm.runInNewContext(source,sandbox);
    return {sandbox,calls,tick:()=>tick(),login:()=>{user='user';token='secret';},logout:()=>{user='';token='';},resolve:()=>finish('/* private static script */'),cleared:()=>cleared};
}
const turn=()=>new Promise(resolve=>setImmediate(resolve));
test('Bootstrap is anonymous-safe and loads once with no credential-bearing URL',async()=>{
    const f=fixture();assert.equal(f.calls.length,0);f.login();const pending=f.tick();assert.equal(f.calls.length,1);
    assert.equal(f.calls[0].url,'http://localhost/WatchGuard/Standalone/script.js');assert.ok(!JSON.stringify(f.calls).includes('secret'));
    f.resolve();await pending;assert.equal(f.sandbox.WatchGuardStandalone.status(),'loaded');assert.equal(f.cleared(),true);
    await f.tick();assert.equal(f.calls.length,1);
});
test('Logout while the authenticated script is in flight discards execution',async()=>{
    const f=fixture();f.login();const pending=f.tick();f.logout();f.resolve();await pending;
    assert.equal(f.sandbox.WatchGuardPoc,undefined);
});
test('CSP failure is reported and retries are rate limited',async()=>{
    const f=fixture(true);f.login();const pending=f.tick();f.resolve();await pending;await turn();
    assert.equal(f.sandbox.WatchGuardStandalone.status(),'failed-or-csp-blocked');assert.equal(f.sandbox.WatchGuardPoc,undefined);
    await f.tick();assert.equal(f.calls.length,1);
});
