/* Native Back/Forward and current server data. Request gates only delay delivery. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
module.exports=async function returnPosition(page,fixture,output,old=false) {
    const wait=(fn,arg)=>old?page.waitForFunction(fn,{},arg):page.waitForFunction(fn,arg);
    const frames=n=>page.evaluate(n=>new Promise(resolve=>{let count=0;function next(){if(++count===n)resolve();else requestAnimationFrame(next);}next();}),n);
    const query='?watchguard=watchlists&owner=mine&interest=watchlisted&sort=title';
    const url=fixture.base+'/web/#/home'+query,report={engine:old?'Chromium 79':'current Chromium',physicalTV:false,serverVersion:fixture.serverVersion,image:fixture.image,deployedPackage:fixture.deployedPackage,cases:[]};
    report.browserVersion=await (old?page.browser():page.context().browser()).version();if(old)assert.match(report.browserVersion,/\/79\./);
    const requests=[];let release=null,begin=null,hold=false,holdContinuation=false,heldRequest=null,denial=null;
    const touch=old?null:await page.context().newCDPSession(page);
    const observe=request=>{const u=new URL(request.url());if(u.pathname.endsWith('/WatchGuard/ActivityBrowser'))requests.push({continuation:u.searchParams.has('continuation'),check:u.searchParams.get('check')==='true'});};
    const intercept=async value=>{const request=old?value:value.request();if(denial&&request.method()==='GET'&&new URL(request.url()).pathname.endsWith('/WatchGuard/Watchlist')&&new URL(page.url()).hash.indexOf('#/details?')===0){const status=denial;denial=null;return old?value.respond({status,contentType:'application/json',body:'{}'}):value.fulfill({status,contentType:'application/json',body:'{}'});}if(hold&&new URL(request.url()).pathname.endsWith('/WatchGuard/ActivityBrowser')&&(!holdContinuation||new URL(request.url()).searchParams.has('continuation'))){heldRequest=request;begin();await new Promise(resolve=>{release=resolve;});}await value.continue();};
    const unhold=()=>{hold=false;if(release){const next=release;release=null;next();}};
    const gate=(continuation=false)=>{hold=true;holdContinuation=continuation;heldRequest=null;return Promise.all([new Promise(resolve=>{begin=resolve;}),page.waitForRequest(request=>{const url=new URL(request.url());return url.pathname.endsWith('/WatchGuard/ActivityBrowser')&&(!continuation||url.searchParams.has('continuation'));})]);};
    const completion=()=>new Promise(resolve=>{const expected=heldRequest;assert.ok(expected);const finish=request=>{if(request===expected){page.removeListener('requestfinished',finish);page.removeListener('requestfailed',finish);resolve();}};page.on('requestfinished',finish);page.on('requestfailed',finish);});
    const settled=()=>wait(()=>{const p=document.querySelector('.watchguard-page');return p&&p.getAttribute('aria-busy')==='false';});
    const state=id=>page.evaluate(id=>{const p=document.querySelector('.watchguard-page'),a=p&&p.querySelector('.watchguard-card a.button-link[href*="'+id+'"]'),e=document.activeElement;
        return {found:!!a,top:a&&a.getBoundingClientRect().top,scroll:p&&p.scrollTop,focused:e===a,focusLabel:e&&e.getAttribute('aria-label'),count:p&&p.querySelectorAll('.watchguard-card').length,viewState:p&&p.getAttribute('data-view-state'),returnState:p&&p.getAttribute('data-return-state')};},id);
    const scan=()=>page.evaluate(()=>{
        const data={frames:0,homeExposures:0};let running=true;
        function sample(){if(!running)return;data.frames++;for(const point of [[innerWidth/2,innerHeight/2],[25,innerHeight-40]]){const e=document.elementFromPoint(point[0],point[1]);if(e&&e.closest('.homePage,#homePage')){data.homeExposures++;break;}}requestAnimationFrame(sample);}sample();
        window.wgReturnFrames=()=>{running=false;return data;};
    });
    const stopScan=()=>page.evaluate(()=>window.wgReturnFrames());
    const selectAnchor=async item=>{
        const before=await page.evaluate(id=>{const p=document.querySelector('.watchguard-page'),a=p.querySelector('.watchguard-card a.button-link[href*="'+id+'"]');a.scrollIntoView({block:'center'});a.focus({preventScroll:true});window.wgReturnOldPanel=p;
            return {top:a.getBoundingClientRect().top,scroll:p.scrollTop,count:p.querySelectorAll('.watchguard-card').length,history:history.state};},item.Id);
        await frames(2);return before;
    };
    const detail=async item=>wait(item=>{const p=document.querySelector('#itemDetailPage:not(.hide)'),b=p&&p.querySelector('.btnPlaystate');return p&&b&&b.getAttribute('data-id')===item.Id&&p.querySelector('.nameContainer').textContent.includes(item.Name)&&!document.querySelector('.watchguard-page,.watchguard-outgoing');},item);
    const activate=async(item,input)=>{const selector='.watchguard-card a.button-link[href*="'+item.Id+'"]';if(input==='remote')await page.keyboard.press('Enter');else if(input==='touch'){const point=await page.$eval(selector,e=>{const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};});await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}else await page.click(selector);await detail(item);};
    const fresh=async()=>{await page.goto(fixture.base+'/web/#/home');await wait(()=>!document.querySelector('.watchguard-page'));await page.goto(url);await settled();};
    const more=async()=>{const handle=await page.evaluateHandle(()=>{const b=Array.from(document.querySelectorAll('.watchguard-page button')).find(e=>e.textContent.trim().indexOf('Load more')===0);if(!b||b.hidden)throw new Error('Native second page unavailable');return b;});await handle.asElement().click();await handle.dispose();await settled();};
    page.on('request',observe);
    if(old){await page.setRequestInterception(true);page.on('request',intercept);}else await page.route('**/WatchGuard/**',intercept);
    try {
        const items=await page.evaluate(async()=>{const result=await ApiClient.ajax({url:ApiClient.getUrl('Items',{Recursive:true,IncludeItemTypes:'Movie,Series'}),type:'GET',dataType:'json'});for(const item of result.Items)await ApiClient.ajax({url:ApiClient.getUrl('WatchGuard/Watchlist/'+item.Id),type:'PUT'});return result.Items.map(i=>({Id:i.Id,Name:i.Name,Type:i.Type}));});
        assert.ok(items.length>25,'Synthetic native library must reach a second result page');
        for(const [layout,width,input] of old?[['tv',1280,'remote']]:[['desktop-legacy',1280,'mouse'],['mobile-legacy',390,'touch'],['modern',1280,'mouse']]) {
            if(old)await page.setViewport({width,height:700});else await page.setViewportSize({width,height:700});
            await page.goto(fixture.base+'/web/#/home');await page.evaluate(value=>localStorage.setItem('layout',value),layout);await page.reload();await wait(()=>window.WatchGuardPoc&&WatchGuardPoc.isInstalled());
            for(const kind of ['first-movie','deep-movie','series']) {
                await fresh();
                let target;
                if(kind==='deep-movie'){await more();target=items.find(i=>i.Name==='Return Position 28');}
                else if(kind==='series')target=items.find(i=>i.Type==='Series');
                else target=items.find(i=>i.Name==='Return Position 04');
                assert.ok(target);report.activeCase={layout,width,input,kind,title:target.Name,phase:'capture'};
                const before=await selectAnchor(target);await page.screenshot({path:path.join(output,'return-'+layout+'-'+kind+'-before.png')});
                report.activeCase.before={top:before.top,scroll:before.scroll,count:before.count};report.activeCase.phase='detail';await scan();await activate(target,input);assert.equal(await page.evaluate(()=>window.wgReturnOldPanel.isConnected),false,'Departed panel is destroyed');
                report.activeCase.phase='return';const start=requests.length,started=gate();await page.goBack();await started;
                await page.screenshot({path:path.join(output,'return-'+layout+'-'+kind+'-loading.png')});unhold();
                await wait(id=>{const p=document.querySelector('.watchguard-page'),a=p&&p.querySelector('.watchguard-card a.button-link[href*="'+id+'"]');return p&&p.getAttribute('aria-busy')==='false'&&a&&document.activeElement===a;},target.Id);
                await frames(3);const after=await state(target.Id),transition=await stopScan(),work=requests.slice(start);
                assert.ok(Math.abs(after.top-before.top)<=48,'Back restores the title viewport offset');assert.ok(after.count>=before.count,'Back restores required loaded depth');assert.ok(work.length>=1&&work.length<=6,'Return uses current, bounded query work');assert.equal(transition.homeExposures,0);
                assert.equal(await page.evaluate(()=>document.querySelector('.watchguard-page')===window.wgReturnOldPanel),false,'Return authorizes a new panel');
                const returnedHistory=await page.evaluate(()=>history.state);for(const key of Object.keys(before.history||{}).filter(k=>k!=='watchguardReturnEntry'))assert.deepEqual(returnedHistory[key],before.history[key],'Native history field '+key+' is preserved');
                await page.screenshot({path:path.join(output,'return-'+layout+'-'+kind+'-after.png')});
                const row={layout,width,input,kind,before:{top:before.top,scroll:before.scroll,count:before.count},after,queries:work,transition};report.cases.push(row);if(input==='remote'){await page.keyboard.press('ArrowRight');assert.equal(await page.evaluate(id=>{const e=document.activeElement;return !!e.closest('.watchguard-card')&&!e.matches('a.button-link[href*="'+id+'"]');},target.Id),true,'Native arrows work from restored card focus');row.remoteAfterReturn='PASS';}report.activeCase.phase='forward-back';
                await page.goForward();await detail(target);await page.goBack();await wait(id=>{const p=document.querySelector('.watchguard-page'),a=p&&p.querySelector('a.button-link[href*="'+id+'"]');return p&&p.getAttribute('aria-busy')==='false'&&a&&document.activeElement===a;},target.Id);row.repeatBack='PASS';
            }
            // Changed memberships are fetched again, never restored from cached rows.
            report.activeCase={layout,kind:'removed-membership'};await fresh();await more();const removed=items.find(i=>i.Name==='Return Position 28');await selectAnchor(removed);await activate(removed,input);
            await page.evaluate(async id=>ApiClient.ajax({url:ApiClient.getUrl('WatchGuard/Watchlist/'+id),type:'DELETE'}),removed.Id);
            await page.goBack();await wait(()=>{const p=document.querySelector('.watchguard-page');return p&&p.getAttribute('aria-busy')==='false'&&p.getAttribute('data-return-state')==='fallback';});
            assert.equal((await state(removed.Id)).found,false);assert.equal((await state(removed.Id)).scroll,0);
            report.cases.push({layout,kind:'removed-membership',result:'PASS'});
            await page.evaluate(async id=>ApiClient.ajax({url:ApiClient.getUrl('WatchGuard/Watchlist/'+id),type:'PUT'}),removed.Id);
            // Change current membership after the first snapshot page. The native
            // server must reject its stale continuation; no synthetic 409 response.
            report.activeCase={layout,kind:'native-expired-continuation'};await fresh();await more();await selectAnchor(removed);await activate(removed,input);
            const continuationStarted=gate(true);await page.goBack();await continuationStarted;
            await page.evaluate(async id=>ApiClient.ajax({url:ApiClient.getUrl('WatchGuard/Watchlist/'+id),type:'DELETE'}),removed.Id);
            const rejected=page.waitForResponse(response=>new URL(response.url()).pathname.endsWith('/WatchGuard/ActivityBrowser')&&response.status()===409);unhold();await rejected;
            await wait(()=>{const p=document.querySelector('.watchguard-page');return p&&p.getAttribute('aria-busy')==='false'&&p.getAttribute('data-return-state')==='fallback';});
            assert.equal((await state(removed.Id)).found,false);assert.equal((await state(removed.Id)).scroll,0);
            assert.equal((await state(removed.Id)).viewState,'expired');report.cases.push({layout,kind:'native-expired-continuation',status:409,result:'PASS'});
            await page.evaluate(async id=>ApiClient.ajax({url:ApiClient.getUrl('WatchGuard/Watchlist/'+id),type:'PUT'}),removed.Id);
            // Real pointer/remote interaction wins over a pending restore.
            report.activeCase={layout,kind:'interaction-cancels-return'};await fresh();await more();const target=items.find(i=>i.Name==='Return Position 28');await selectAnchor(target);await activate(target,input);
            let started=gate();await page.goBack();await started;await page.focus('[aria-label="Search titles"]');await page.keyboard.press('ArrowLeft');const interrupted=await state(target.Id),afterInput=requests.length;unhold();await settled();await frames(3);
            assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')),'Search titles');assert.equal((await state(target.Id)).scroll,interrupted.scroll);assert.equal(requests.length,afterInput,'Interaction stops additional restoration queries');
            report.cases.push({layout,kind:'interaction-cancels-return',result:'PASS'});
            // A late query cannot restore another route.
            report.activeCase={layout,kind:'navigation-cancels-return'};await fresh();await selectAnchor(items.find(i=>i.Name==='Return Position 04'));await activate(items.find(i=>i.Name==='Return Position 04'),input);
            started=gate();await page.goBack();await started;const navigationDelivery=completion();await page.goto(fixture.base+'/web/#/home');unhold();await navigationDelivery;await wait(()=>!document.querySelector('.watchguard-page,.watchguard-outgoing'));await frames(3);
            assert.equal(new URL(page.url()).hash,'#/home');report.cases.push({layout,kind:'navigation-cancels-return',result:'PASS'});
            // A fresh entry never inherits the departed entry's position.
            report.activeCase={layout,kind:'fresh-entry'};await page.goto(url);await settled();assert.equal(await page.evaluate(()=>document.querySelector('.watchguard-page').scrollTop),0);report.cases.push({layout,kind:'fresh-entry',result:'PASS'});
        }
        // Scoped HTTP denials exercise current-detail cleanup. Other native data
        // and authorization responses remain real; these two failures are injected.
        for(const status of [401,403]) {
            report.activeCase={kind:'detail-authorization-denial',status};await fresh();const target=items.find(i=>i.Name==='Return Position 04');await selectAnchor(target);denial=status;await activate(target,old?'remote':'mouse');
            await wait(()=>{const error=document.querySelector('#itemDetailPage:not(.hide) .watchguard-error');return error&&error.textContent.indexOf('Could not load your watchlist')>=0;});assert.equal(denial,null);
            await page.goBack();await settled();assert.equal((await state(target.Id)).returnState,'none','A current authorization denial clears return hints');assert.equal((await state(target.Id)).scroll,0);
            report.cases.push({kind:'detail-authorization-denial',status,injectedFailure:true,result:'PASS'});
        }
        // Switch the real native client while an old account's return is pending.
        // Tokens stay in page memory and are never included in evidence.
        report.activeCase={kind:'account-change-during-return'};
        await fresh();await more();const accountTarget=items.find(i=>i.Name==='Return Position 28');await selectAnchor(accountTarget);await activate(accountTarget,old?'remote':'mouse');
        await page.evaluate(async()=>{const api=ApiClient,name='Return-'+Date.now();await api.ajax({url:api.getUrl('Users/New'),type:'POST',contentType:'application/json',data:JSON.stringify({Name:name})});const other=await api.ajax({url:api.getUrl('Users/AuthenticateByName'),type:'POST',dataType:'json',contentType:'application/json',data:JSON.stringify({Username:name,Pw:''})});window.wgReturnAccounts={original:{token:api.accessToken(),user:api.getCurrentUserId()},other:other};});
        const accountStarted=gate();await page.goBack();await accountStarted;
        try {
            const accountDelivery=completion();await page.evaluate(()=>ApiClient.setAuthenticationInfo(wgReturnAccounts.other.AccessToken,wgReturnAccounts.other.User.Id));unhold();await accountDelivery;
            await wait(()=>{const p=document.querySelector('.watchguard-page');return !p||(p.getAttribute('aria-busy')==='false'&&p.querySelectorAll('.watchguard-card').length===0);});
            await page.goto(fixture.base+'/web/#/home');await wait(()=>!document.querySelector('.watchguard-page'));await page.goto(url);await settled();
            assert.equal(await page.evaluate(()=>document.querySelectorAll('.watchguard-page .watchguard-card').length),0,'Another account receives no old membership rows');
            assert.equal(await page.evaluate(()=>document.querySelector('.watchguard-page').scrollTop),0,'Another account receives no old position');
            report.cases.push({kind:'account-change-during-return',result:'PASS'});
        } finally {
            unhold();await page.evaluate(()=>{const original=wgReturnAccounts.original;ApiClient.setAuthenticationInfo(original.token,original.user);delete window.wgReturnAccounts;});
            await page.goto(fixture.base+'/web/#/home');await page.reload();await wait(()=>window.WatchGuardPoc&&WatchGuardPoc.isInstalled());
        }
        delete report.activeCase;report.result='PASS';
    } catch(error) {report.result='FAIL';report.error=error.message;report.failure=await page.evaluate(()=>{const p=document.querySelector('.watchguard-page'),e=document.activeElement;return {route:location.hash.split('?')[0],count:p&&p.querySelectorAll('.watchguard-card').length,scroll:p&&p.scrollTop,viewState:p&&p.getAttribute('data-view-state'),returnState:p&&p.getAttribute('data-return-state'),focus:e&&e.getAttribute('aria-label')};});await page.screenshot({path:path.join(output,'return-failure.png')});throw error;}
    finally {unhold();await page.evaluate(()=>{if(window.wgReturnFrames)window.wgReturnFrames();});if(touch)await touch.detach();page.removeListener('request',observe);if(old){page.removeListener('request',intercept);await page.setRequestInterception(false);}else await page.unroute('**/WatchGuard/**',intercept);fs.writeFileSync(path.join(output,'return-position.json'),JSON.stringify(report,null,2)+'\n');}
    return report;
};
if(require.main===module){
    const fixture=JSON.parse(fs.readFileSync(process.argv[2])),output=process.argv[3]||'artifacts/return-position-native';fs.mkdirSync(output,{recursive:true});
    assert.match(fixture.base,/^https?:\/\/(?:127\.0\.0\.1|localhost):\d+(?:\/jellyfin)?$/);
    (async()=>{const old=!!process.env.WATCHGUARD_CHROMIUM79;
        const browser=old?await require('./browser79/node_modules/puppeteer-core').launch({executablePath:process.env.WATCHGUARD_CHROMIUM79,headless:true}):await require('./browser/node_modules/playwright').chromium.launch({headless:true});
        try{const page=await browser.newPage();page.setDefaultTimeout(20000);
            if(old){await page.goto(fixture.base+'/web/#/login');await page.waitForFunction(()=>document.querySelector('#txtManualName')||Array.from(document.querySelectorAll('button')).some(e=>e.textContent.trim()==='Manual Login'));await page.evaluate(()=>{const b=Array.from(document.querySelectorAll('button')).find(e=>e.textContent.trim()==='Manual Login');if(b)b.click();});await page.waitForSelector('#txtManualName',{visible:true});await page.type('#txtManualName',fixture.username);await page.type('#txtManualPassword',fixture.password);await page.keyboard.press('Enter');await page.waitForFunction(()=>location.hash==='#/home'&&window.WatchGuardPoc&&WatchGuardPoc.isInstalled());}
            else await require('./browser-readiness.cjs').login(page,fixture);
            await module.exports(page,fixture,output,old);
        }finally{await browser.close();}
    })().catch(error=>{console.error(error);process.exitCode=1;});
}
