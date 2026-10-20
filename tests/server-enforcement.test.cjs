const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createServerAdapter}=require('../Jellyfin.Plugin.WatchGuard/Web/watchguard.js');
const {validateStatus}=require('../Jellyfin.Plugin.WatchGuard/Web/watchguard.js');
const id='1'.repeat(32), user='2'.repeat(32), generation='3'.repeat(32), challenge='4'.repeat(64);
function fixture(options={}) {
 const calls=[], notices=[];let token='token', location='details';
 const warning={scopeId:id,item:{Id:id,Type:'Movie',Name:'<unsafe>'},users:[{UserId:user,DisplayName:'<script>',Reasons:['Watchlisted']}],user};
 const expiration=new Date(Date.now()+60000).toISOString();
 const response=state=>({State:state,Action:'DeleteItem',Targets:[id],Scopes:[id],Generation:generation,ExpiresAt:expiration});
 const api={getCurrentUserId:()=>user,accessToken:()=>token,getUrl:p=>'/base/'+p,
  deleteItem(...args){calls.push({native:true,args,receiver:this});return Promise.resolve('native');},
  async ajax(r){calls.push(r);if(options.route) {const value=await options.route(r,{response,warning});if(value!==undefined)return value;}
   if(r.type==='DELETE') {if(options.nativeError)throw options.nativeError;return 'native';}
   const route=r.url.split('/').pop();
   if(route==='Capabilities')return {Protocol:1,State:'Enabled',Expected:true,Generation:generation};
   if(route==='Prepare')return {...response('Created'),ChallengeId:challenge};
   if(route==='Present')return {...response('Presented'),Protection:[{ItemId:id,HasInterest:true,HasOtherInterestedUsers:warning.users.some(p=>p.UserId!==user),Users:warning.users}]};
   if(route==='Approve')return response('Approved');
   if(route==='Revoke')return {State:'Revoked'};
  }};
 const adapter=createServerAdapter(options.ask|| (async()=>true),()=>{},async()=>options.clear?null:warning,()=>true,
 {resolveScope:async()=>({item:warning.item,scope:warning.item}),validateStatus,location:()=>location,expected:options.expected,notice:async t=>{notices.push(t);if(options.noticeError)throw Error('display failure');}});
 adapter.install(api);return {api,calls,notices,adapter,warning,changeToken:()=>token='changed',navigate:()=>location='elsewhere'};
}
const deletes=f=>f.calls.filter(c=>c.native||c.type==='DELETE');
test('deliberate approval sends exactly one scoped native transport, no speculative DELETE',async()=>{
 let decide;const f=fixture({ask:()=>new Promise(r=>decide=r)});const task=f.api.deleteItem(id);
 await new Promise(r=>setImmediate(r));assert.equal(f.calls.length,1);assert.equal(deletes(f).length,0);
 decide(true);assert.equal(await task,'native');assert.equal(deletes(f).length,1);
 assert.equal(deletes(f)[0].headers['X-WatchGuard-Approval'],challenge);
 assert.deepEqual(f.calls.map(c=>c.url.split('/').pop()),['Capabilities','Prepare','Present','Approve',id]);
 assert.ok(f.calls.every(c=>!c.url.includes(challenge)));
});
test('Cancel and dialog rejection never prepare, approve or DELETE',async()=>{
 for(const ask of [async()=>false,async()=>{throw Error('closed');}]) {const f=fixture({ask});await assert.rejects(f.api.deleteItem(id));assert.equal(deletes(f).length,0);assert.equal(f.calls.length,1);}
});
test('clear path invokes original receiver and arguments without approvals',async()=>{
 const f=fixture({clear:true});assert.equal(await f.api.deleteItem(id,'extra'),'native');assert.deepEqual(deletes(f)[0].args,[id,'extra']);assert.equal(deletes(f)[0].receiver,f.api);assert.equal(f.calls.length,2);
});
test('404 or explicit disabled capability allows fresh legacy behavior; failures never do',async()=>{
 for(const disabled of [true,false]) {const f=fixture({route:r=>{if(r.url.endsWith('Capabilities')){if(disabled)return {Protocol:1,State:'Disabled',Expected:false};throw {status:404};}}});await f.api.deleteItem(id);assert.equal(deletes(f)[0].native,true);}
});
for(const status of [401,403,409,410,429,503])test('protocol HTTP '+status+' fails closed without retry',async()=>{
 const f=fixture({route:r=>{if(r.url.endsWith('Approve'))throw {status};}});await assert.rejects(f.api.deleteItem(id));assert.equal(deletes(f).length,0);assert.equal(f.calls.filter(c=>c.url.endsWith('Approve')).length,1);
});
for(const route of ['Capabilities','Prepare','Present','Approve'])test('malformed '+route+' blocks',async()=>{
 const f=fixture({route:r=>r.url.endsWith(route)?{}:undefined});await assert.rejects(f.api.deleteItem(id));assert.equal(deletes(f).length,0);
});
test('interest changes require renewed explicit confirmation',async()=>{
 const f=fixture({route:(r,{response,warning})=>{if(r.url.endsWith('Present'))return {...response('Presented'),Protection:[{ItemId:id,HasInterest:true,HasOtherInterestedUsers:false,Users:[{...warning.users[0],Reasons:['InProgress']}]}]};}});await assert.rejects(f.api.deleteItem(id));assert.equal(deletes(f).length,0);
});
test('account and navigation changes cancel a pending dialog',async()=>{
 for(const action of ['changeToken','navigate']){let decide;const f=fixture({ask:()=>new Promise(r=>decide=r)});const task=f.api.deleteItem(id);await new Promise(r=>setImmediate(r));f[action]();decide(true);await assert.rejects(task);assert.equal(deletes(f).length,0);}
});
test('same-target concurrent callers share one operation; queue recovers from cancellation',async()=>{
 const f=fixture();const a=f.api.deleteItem(id),b=f.api.deleteItem(id);assert.equal(a,b);await Promise.all([a,b]);assert.equal(deletes(f).length,1);
 let count=0;const g=fixture({ask:async()=>++count>1});await assert.rejects(g.api.deleteItem(id));await g.api.deleteItem(id);assert.equal(deletes(g).length,1);
});
test('native rejection object is preserved and never retried',async()=>{
 const error={status:503};const f=fixture({nativeError:error});await assert.rejects(f.api.deleteItem(id),e=>e===error);assert.equal(deletes(f).length,1);assert.match(f.notices[0],/outcome is uncertain/);
});
test('a previously expected guard cannot silently fall back',async()=>{
 let enabled=true;const f=fixture({clear:true,route:r=>{if(!enabled&&r.url.endsWith('Capabilities'))throw {status:404};}});await f.api.deleteItem(id);enabled=false;await assert.rejects(f.api.deleteItem(id));assert.equal(deletes(f).length,1);
});

test('expired Prepare cannot approve or redeem',async()=>{
 const f=fixture({route:(r,{response})=>r.url.endsWith('Prepare')?{...response('Created'),ChallengeId:challenge,ExpiresAt:'2000-01-01T00:00:00Z'}:undefined});await assert.rejects(f.api.deleteItem(id));assert.equal(deletes(f).length,0);assert.ok(!f.calls.some(r=>r.url.endsWith('Approve')));
});
test('parent scope mismatch before consent blocks',async()=>{
 const f=fixture();f.warning.scopeId='5'.repeat(32);await assert.rejects(f.api.deleteItem(id));assert.equal(deletes(f).length,0);
});

test('server-supplied expectation forbids first-request downgrade',async()=>{const f=fixture({expected:true,route:r=>{if(r.url.endsWith('Capabilities'))throw {status:404};}});await assert.rejects(f.api.deleteItem(id));assert.equal(deletes(f).length,0);});
test('token change after preparation prevents approval and redemption',async()=>{let f;f=fixture({route:r=>{if(r.url.endsWith('Prepare'))f.changeToken();}});await assert.rejects(f.api.deleteItem(id));assert.equal(deletes(f).length,0);assert.ok(!f.calls.some(r=>r.url.endsWith('Approve')));});
test('scope changes in authorized presentation require renewed consent',async()=>{const f=fixture({route:(r,{response,warning})=>r.url.endsWith('Present')?{...response('Presented'),Scopes:['6'.repeat(32)],Protection:[{ItemId:id,HasInterest:true,HasOtherInterestedUsers:warning.users.some(p=>p.UserId!==user),Users:warning.users}]}:undefined});await assert.rejects(f.api.deleteItem(id));assert.equal(deletes(f).length,0);});

for(const reason of ['Watchlisted','InProgress','CurrentlyPlaying','CaughtUp'])test(reason+' retains the explicit self-interest approval flow',async()=>{const f=fixture();f.warning.users[0].Reasons=[reason];await f.api.deleteItem(id);assert.equal(deletes(f).length,1);});
test('combined self and other-user reasons remain distinct and validated',async()=>{const f=fixture();f.warning.users.push({UserId:'7'.repeat(32),DisplayName:'Other <unsafe>',Reasons:['Watchlisted','CaughtUp']});await f.api.deleteItem(id);assert.equal(deletes(f).length,1);});

test('production cancellation keeps AbortError and diagnostic events disclose no identity',async()=>{
 const events=[];const api={getCurrentUserId:()=>user,accessToken:()=> 'secret',getUrl:p=>'/'+p,deleteItem:()=>Promise.resolve(),ajax:async()=>({Protocol:1,State:'Disabled',Expected:false})};
 const adapter=createServerAdapter(async()=>false,(...v)=>events.push(v),async()=>({}),()=>true,{location:()=> 'fixed'});
 adapter.install(api);await assert.rejects(api.deleteItem(id),e=>e.name==='AbortError');
 assert.deepEqual(events.map(e=>e[0]),['installed','intercepted','confirmation-opened','cancelled']);
 assert.ok(events.every(e=>typeof e[1]==='number'));assert.ok(!JSON.stringify(events).includes('secret'));
});

test('observed enforcement survives replacing ApiClient within the same adapter lifetime',async()=>{
 const f=fixture({clear:true});await f.api.deleteItem(id);
 const replacement={...f.api,ajax:async()=>({Protocol:1,State:'Disabled',Expected:false}),deleteItem:()=>{throw Error('must not execute');}};
 f.adapter.install(replacement);await assert.rejects(replacement.deleteItem(id));assert.equal(deletes(f).length,1);
});

test('a failed feedback dialog cannot replace the native deletion rejection',async()=>{
 const error={status:503};const f=fixture({nativeError:error,noticeError:true});
 await assert.rejects(f.api.deleteItem(id),e=>e===error);assert.equal(deletes(f).length,1);
});
test('a foreign ApiClient receiver cannot redeem on a different native transport',async()=>{
 const f=fixture();await assert.rejects(f.api.deleteItem.call({...f.api},id));assert.equal(deletes(f).length,0);
});

const {revealManualLogin}=require('./browser-readiness.cjs');
function fakeJellyfinLoginForm(initialVisible,clickHandler) {
 let visible=initialVisible,clicks=0,waits=0;
 const username={
  async isVisible(){return visible;},
  async waitFor(options){waits++;assert.equal(options.state,'visible');assert.equal(visible,true,'The native username form must actually be visible');}
 };
 const page={
  locator(selector){assert.equal(selector,'#txtManualName');return username;},
  getByRole(role,options){
   assert.equal(role,'button');assert.deepEqual(options,{name:'Manual Login',exact:true});
   return {async click(options){clicks++;assert.ok(options.timeout>0 && options.timeout<=5000);return clickHandler(()=>{visible=true;});}};
  }
 };
 return {page,counts:()=>({clicks,waits})};
}
test('browser fixture skips the Manual Login button when the native form is already visible',async()=>{
 const f=fakeJellyfinLoginForm(true,()=>{throw Error('Manual Login must not be clicked');});
 await revealManualLogin(f.page);
 assert.deepEqual(f.counts(),{clicks:0,waits:0});
});
test('browser fixture opens a stable native Manual Login chooser exactly once',async()=>{
 const f=fakeJellyfinLoginForm(false,show=>show());
 await revealManualLogin(f.page);
 assert.deepEqual(f.counts(),{clicks:1,waits:1});
});
test('browser fixture accepts a chooser that disappears because the native form appears',async()=>{
 const f=fakeJellyfinLoginForm(false,show=>{show();throw Error('Manual Login button detached during navigation');});
 await revealManualLogin(f.page);
 assert.deepEqual(f.counts(),{clicks:1,waits:1});
});
test('browser fixture does not hide a genuine Manual Login button failure',async()=>{
 const lost=new Error('Unable to open Manual Login');
 const f=fakeJellyfinLoginForm(false,()=>{throw lost;});
 await assert.rejects(revealManualLogin(f.page),error=>error===lost);
 assert.deepEqual(f.counts(),{clicks:1,waits:0});
});
test('browser fixture refuses a click that did not reveal the native username form',async()=>{
 const f=fakeJellyfinLoginForm(false,()=>{});
 await assert.rejects(revealManualLogin(f.page),/must actually be visible/);
 assert.deepEqual(f.counts(),{clicks:1,waits:1});
});
