/* Native data except explicitly labelled held/failing ActivityBrowser requests. */
const assert=require('node:assert/strict');
module.exports=async(page,fixture,{old,wait,route,cases=[]})=>{
 const settled=()=>wait(()=>document.querySelector('.watchguard-page')&&document.querySelector('.watchguard-page').getAttribute('aria-busy')==='false');
 const frames=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const native=(path,type='GET')=>page.evaluate(({path,type})=>ApiClient.ajax({url:ApiClient.getUrl(path),type,...(type==='GET'?{dataType:'json'}:{})}),{path,type});
 const snapshot=()=>page.evaluate(()=>{
  const p=document.querySelector('.watchguard-page'),active=document.activeElement;
  return {count:p.querySelectorAll('.watchguard-card').length,scroll:p.scrollTop,focus:active.tagName,label:active.getAttribute('aria-label'),href:active.getAttribute('href'),state:JSON.stringify(history.state),length:history.length,notice:Array.from(p.querySelectorAll('p')).some(e=>e.textContent.indexOf('Return position unavailable')>=0)};
 });
 async function open(depth=3,hash=route){
  await page.evaluate(()=>{location.hash='#/home';});await wait(()=>!document.querySelector('.watchguard-page'));
  await page.evaluate(hash=>{location.hash=hash;},hash);await settled();
  for(let n=0;n<4;n++){
   if(!await page.evaluate(()=>document.querySelector('.watchguard-page').getAttribute('data-view-state')==='paused'))break;
   await more('Continue loading');
  }
  for(let n=1;n<depth;n++)await more('Load more results');
 }
 async function more(label){
  await page.evaluate(label=>{const b=Array.from(document.querySelectorAll('.watchguard-page>button')).find(b=>b.textContent===label&&!b.hidden&&!b.disabled);if(!b)throw new Error('Expected usable loading control');b.scrollIntoView();b.click();},label);await settled();
 }
 async function activate(){
  const before=await page.evaluate(()=>{
   const p=document.querySelector('.watchguard-page'),links=p.querySelectorAll('.watchguard-card a'),a=links[Math.max(0,links.length-3)];
   a.focus();p.scrollTop+=a.getBoundingClientRect().top-p.getBoundingClientRect().top-180;
   window.wgReturnPanel=p;
   return {id:new URLSearchParams(a.hash.split('?')[1]).get('id'),href:a.getAttribute('href'),top:a.getBoundingClientRect().top-p.getBoundingClientRect().top,state:JSON.stringify(history.state),count:links.length};
  });
  await page.keyboard.press('Enter');await wait(()=>location.hash.indexOf('#/details?')===0&&!document.querySelector('.watchguard-page,.watchguard-outgoing'));return before;
 }
 async function back(){await page.goBack();await settled();await frames();}
 async function gate(mode,nth=1){
  let release,entered,count=0,held=false;
  const ready=new Promise(resolve=>entered=resolve),hold=new Promise(resolve=>release=resolve);
  const handle=async(url,next,reply)=>{
   if(new URL(url).pathname.endsWith('/WatchGuard/ActivityBrowser')){
    count++;
    if(count===nth){held=true;entered();if(mode==='hold'){await hold;return next();}return reply(mode);}
   }
   return next();
  };
  const listener=old?r=>handle(r.url(),()=>r.continue(),status=>r.respond({status,contentType:'application/json',body:'{}'})).catch(()=>{}):r=>handle(r.request().url(),()=>r.continue(),status=>r.fulfill({status,body:'{}'}));
  if(old){await page.setRequestInterception(true);page.on('request',listener);}else await page.route('**/WatchGuard/ActivityBrowser?**',listener);
  return {ready,release,count:()=>count,held:()=>held,async close(){release();if(old){page.removeListener('request',listener);await page.setRequestInterception(false);}else await page.unroute('**/WatchGuard/ActivityBrowser?**',listener);}};
 }
 // Observe rendered Home exposure through all routes; never repair unexpected navigation.
 await page.evaluate(()=>{
  const s={frames:0,home:0,running:true};window.wgReturnFrames=s;
  const tick=()=>{if(!s.running)return;s.frames++;if(location.hash.indexOf('watchguard=watchlists')>=0){const hit=document.elementFromPoint(innerWidth/2,innerHeight/2);if(hit&&hit.closest('.homePage,#homePage'))s.home++;}requestAnimationFrame(tick);};tick();
 });
 try {
  await open();const origin=await activate();await back();const returned=await snapshot();assert.equal(returned.href,origin.href);
  await page.goForward();await wait(()=>location.hash.indexOf('#/details?')===0&&!document.querySelector('.watchguard-page,.watchguard-outgoing'));
  await back();const again=await snapshot();assert.equal(again.href,origin.href);assert.equal(again.state,origin.state);assert.equal(again.length,returned.length);
  await page.goForward();await wait(()=>!document.querySelector('.watchguard-page'));
  await page.evaluate(hash=>{location.hash=hash;},route);await settled();const fresh=await snapshot();assert.equal(fresh.count,25);assert.equal(fresh.scroll,0);assert.notEqual(fresh.state,origin.state);
  cases.push({name:'Back/Forward and fresh entry',result:'PASS'});

  await open(1,route+'&search=PoC%20Series%20Detail');const series=await activate();await back();assert.equal((await snapshot()).href,series.href);cases.push({name:'Series return',result:'PASS'});

  for(const mode of ['slow','interaction','navigation','deadline']){
   await open();const before=await activate();const g=await gate('hold');
   try {
    await page.goBack();await g.ready;assert(g.held());
    assert.equal(await page.evaluate(()=>document.querySelector('.watchguard-page')===window.wgReturnPanel),false);
    if(mode==='interaction'){await page.focus('[aria-label="Search titles"]');await page.keyboard.type('Return');await wait(()=>location.hash.indexOf('search=Return')>=0);}
    if(mode==='navigation'){
     await page.evaluate(()=>{location.hash='#/home';});await wait(()=>!document.querySelector('.watchguard-page'));
     await page.evaluate(hash=>{location.hash=hash+'&search=PoC%20Series%20Detail';},route);await settled();
     await page.focus('[aria-label="Search titles"]');
    }
    if(mode==='deadline')await wait(()=>Array.from(document.querySelectorAll('.watchguard-page p')).some(p=>p.textContent==='Return position unavailable. Showing current results.'));
    await frames();g.release();await settled();await frames();
    const result=await snapshot();
    if(mode==='slow'){assert.equal(result.href,before.href);assert.equal(result.count,75);assert(g.count()<=6);}
    else {assert.notEqual(result.href,before.href);if(mode==='interaction'||mode==='navigation')assert.equal(result.label,'Search titles');if(mode==='navigation')assert.equal(result.count,1);}
    cases.push({name:mode+' during restoration',result:'PASS',activityRequests:g.count(),after:result});
   } finally {await g.close();}
  }
  for(const status of [409,401]){
   await open();await activate();const g=await gate(status,status===409?2:1);
   try {
    await back();await g.ready;
    if(status===409){assert.equal(await page.evaluate(()=>document.querySelector('.watchguard-page').getAttribute('data-view-state')),'expired');await more('Refresh this view');}
    else {assert.equal((await snapshot()).count,0);assert(await page.evaluate(()=>document.querySelector('.watchguard-page [role="alert"]').textContent.indexOf('Authorization denied')>=0));}
    cases.push({name:status===409?'Expired continuation (injected 409)':'Authentication denial (injected 401)',result:'PASS',activityRequests:g.count()});
   } finally {await g.close();}
   if(status===401){await page.goForward();await wait(()=>!document.querySelector('.watchguard-page'));await back();assert.equal((await snapshot()).count,25,'Denial clears saved deep position');}
  }

  await open(4);const deep=await activate();const budget=await gate('pass',99);
  try {await back();assert.equal((await snapshot()).count,75);assert.notEqual((await snapshot()).href,deep.href);assert(budget.count()<=6);await more('Load more results');assert((await snapshot()).count>75);assert.notEqual((await snapshot()).href,deep.href);cases.push({name:'Budget exhausted; manual continuation remains usable',result:'PASS',automaticPages:3});}finally{await budget.close();}

  await open();const removed=await activate();await native('WatchGuard/Watchlist/'+removed.id,'DELETE');
  try {await back();assert.notEqual((await snapshot()).href,removed.href);assert.equal(await page.evaluate(href=>Array.from(document.querySelectorAll('.watchguard-card a')).some(a=>a.getAttribute('href')===href),removed.href),false);cases.push({name:'Removed membership uses current results',result:'PASS'});}finally{await native('WatchGuard/Watchlist/'+removed.id,'PUT');}

  await open(3,route.replace('sort=title','sort=added'));const reordered=await activate();await native('WatchGuard/Watchlist/'+reordered.id,'DELETE');await native('WatchGuard/Watchlist/'+reordered.id,'PUT');await back();assert.equal((await snapshot()).href,reordered.href);assert.equal((await snapshot()).count,25);cases.push({name:'Changed ordering follows title on its new first page',result:'PASS'});

  await open();await activate();await page.evaluate(async()=>{
   const api=ApiClient,name='ReturnFixture-'+Date.now();
   await api.ajax({url:api.getUrl('Users/New'),type:'POST',contentType:'application/json',data:JSON.stringify({Name:name})});
   window.wgReturnOther=await api.ajax({url:api.getUrl('Users/AuthenticateByName'),type:'POST',dataType:'json',contentType:'application/json',data:JSON.stringify({Username:name,Pw:''})});
   window.wgReturnIdentity={token:api.accessToken(),user:api.getCurrentUserId()};
  });
  const account=await gate('hold');
  try {
   await page.goBack();await account.ready;await page.evaluate(()=>ApiClient.setAuthenticationInfo(wgReturnOther.AccessToken,wgReturnOther.User.Id));
   await wait(()=>document.querySelector('.watchguard-page')&&document.querySelector('.watchguard-page').getAttribute('aria-busy')==='false'&&document.querySelectorAll('.watchguard-card').length===0);
   account.release();await frames();assert.equal((await snapshot()).count,0);
   await page.evaluate(()=>{ApiClient.setAuthenticationInfo(wgReturnIdentity.token,wgReturnIdentity.user);delete window.wgReturnIdentity;delete window.wgReturnOther;});
   await wait(()=>document.querySelector('.watchguard-page')&&document.querySelector('.watchguard-page').getAttribute('aria-busy')==='false'&&document.querySelectorAll('.watchguard-card').length===25);
   assert.equal((await snapshot()).scroll,0);cases.push({name:'Real account change clears old context and ignores its late response',result:'PASS'});
  }finally{await account.close();}
  const frameResult=await page.evaluate(()=>{wgReturnFrames.running=false;return {frames:wgReturnFrames.frames,home:wgReturnFrames.home};});assert(frameResult.frames>0);assert.equal(frameResult.home,0);cases.push({name:'No rendered Home flashes',result:'PASS',...frameResult});
 }finally{await page.evaluate(()=>{if(window.wgReturnFrames)wgReturnFrames.running=false;});}
 return cases;
};
