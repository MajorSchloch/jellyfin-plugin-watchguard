const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('Jellyfin.Plugin.WatchGuard/Standalone/startup.js','utf8');
function fixture(hash='#/home?watchguard=watchlists',body=true){
 const events=new Map(),timers=new Map(),nodes=[];let mutation,disconnected=false;
 const node=()=>({isConnected:false,append(...children){children.forEach(c=>{c.isConnected=true;nodes.push(c);});},setAttribute(){},remove(){this.isConnected=false;}});
 const document={head:node(),body:body?node():null,documentElement:node(),createElement:node,addEventListener:(n,f)=>events.set(n,f),removeEventListener:n=>events.delete(n)};
 const sandbox={URLSearchParams,location:{hash},document,setTimeout:(f,ms)=>{timers.set(1,{f,ms});return 1;},clearTimeout:id=>timers.delete(id),addEventListener:(n,f)=>events.set(n,f),removeEventListener:n=>events.delete(n),MutationObserver:class{constructor(f){mutation=f;}observe(){}disconnect(){disconnected=true;}}};sandbox.window=sandbox;
 vm.runInNewContext(source,sandbox);
 return {sandbox,events,timers,nodes,node,mutate:()=>mutation(),disconnected:()=>disconnected};
}
test('Exact Watchlists entry owns one static loading panel before the deferred bootstrap',()=>{
 const f=fixture(undefined,false);assert.equal(f.sandbox.WatchGuardStandalone,undefined);assert.equal(f.sandbox.WatchGuardStartup.active(),true);
 f.sandbox.document.body=f.node();f.mutate();f.mutate();assert.equal(f.nodes.filter(n=>n.id==='watchguard-startup').length,1);
 vm.runInNewContext(source,f.sandbox);assert.equal(f.timers.size,1);
});
for(const route of ['#/home','#/home?tab=1','#/home?watchguard=other','#/details?watchguard=watchlists','#/dashboard','#/login','#/wizardstart','#/video','#/home/extra?watchguard=watchlists'])test('Ordinary route remains untouched: '+route,()=>{
 const f=fixture(route);assert.equal(f.nodes.length,0);assert.equal(f.timers.size,0);assert.equal(f.events.size,0);
});
for(const reason of ['handoff','timeout','navigation','script-error','pagehide'])test('Handoff releases all temporary DOM, observers and listeners: '+reason,()=>{
 const f=fixture();
 if(reason==='handoff')f.sandbox.WatchGuardStartup.finish();
 if(reason==='timeout'){assert.equal(f.timers.get(1).ms,20000);f.timers.get(1).f();}
 if(reason==='navigation'){f.sandbox.location.hash='#/login';f.events.get('hashchange')();}
 if(reason==='script-error')f.events.get('error')({target:{id:'watchguard-standalone-loader'}});
 if(reason==='pagehide')f.events.get('pagehide')({target:f.sandbox.document});
 assert.equal(f.sandbox.WatchGuardStartup.active(),false);assert.equal(f.events.size,0);assert.equal(f.timers.size,0);assert.ok(f.disconnected());
 assert.equal(f.nodes.filter(n=>n.id==='watchguard-startup'&&n.isConnected).length,0);
 f.sandbox.WatchGuardStartup.finish();
});
test('Unrelated resource errors do not dismiss Watchlists loading',()=>{const f=fixture();f.events.get('error')({target:{id:'native-image'}});assert.equal(f.sandbox.WatchGuardStartup.active(),true);});

test('Early navigation link starts the same bounded handoff; loaded runtime does not restart it',()=>{
 const f=fixture('#/home');f.sandbox.location.hash='#/home?watchguard=watchlists';
 f.sandbox.WatchGuardStartWatchlists();assert.ok(f.sandbox.WatchGuardStartup.active());
 f.sandbox.WatchGuardStartWatchlists();assert.equal(f.timers.size,1);
 f.sandbox.WatchGuardStartup.finish();f.sandbox.WatchGuardPoc={};f.sandbox.WatchGuardStartWatchlists();
 assert.equal(f.timers.size,0);assert.equal(f.events.size,0);
});

test('Legacy view pagehide is not a document unload and cannot expose Home',()=>{
 const f=fixture();f.events.get('pagehide')({target:f.node()});
 assert.equal(f.sandbox.WatchGuardStartup.active(),true);assert.equal(f.timers.size,1);
 f.events.get('pagehide')({target:f.sandbox.document});assert.equal(f.sandbox.WatchGuardStartup.active(),false);
});
