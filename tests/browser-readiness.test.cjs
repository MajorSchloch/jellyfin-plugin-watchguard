// No Jellyfin instance or destructive operations: exercise diagnostic failures deterministically.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const cp=require('node:child_process');
const {EventEmitter}=require('node:events');
const readiness=require('./browser-readiness.cjs');

function fixture(t, faults={}) {
    const output=fs.mkdtempSync(path.join(os.tmpdir(),'watchguard-readiness-test-'));
    t.after(()=>fs.rmSync(output,{recursive:true,force:true}));
    t.mock.method(console,'warn',()=>{});
    const calls=[],rawPaths=[];
    let active=false,starts=0;
    const tracing={
        async start() {
            calls.push('start');assert.equal(active,false,'Must never start an active trace');
            starts++;
            if(faults.restart && starts>1)throw new Error('restart secret');
            active=true;
        },
        async stop(options) {
            calls.push('stop');assert.equal(active,true);
            if(options?.path) {rawPaths.push(options.path);fs.writeFileSync(options.path,'RAW token=short-secret');}
            if(faults.stop)throw new Error('stop secret');
            active=false;
        }
    };
    const page=Object.assign(new EventEmitter(),{
        addInitScript:async()=>{},context:()=>({tracing}),
        evaluate:async()=>{calls.push('evaluate');if(faults.evaluate)throw new Error('Execution context destroyed token=secret');return {route:'#/login',installed:false};},
        screenshot:async options=>{calls.push('screenshot');if(faults.screenshot)throw new Error('screenshot token=secret');fs.writeFileSync(options.path,'fixture image');},
    });
    t.mock.method(cp,'execFileSync',(_program,args)=>{
        calls.push('sanitize');assert.equal(path.dirname(args[1]),path.dirname(args[2]));
        assert.equal(args[1].startsWith(output+path.sep),false,'Raw traces must stay outside artifact directory');
        fs.writeFileSync(args[2],faults.sanitize?'partial':'SANITIZED');
        if(faults.sanitize)throw new Error('sanitizer secret');
    });
    return {page,output,calls,rawPaths,options:{output,base:'http://127.0.0.1:8096',userId:'user',serverId:'server',username:'user',password:'password'},
        state:()=>({active,starts}),read:name=>JSON.parse(fs.readFileSync(path.join(output,name),'utf8'))};
}
const original=()=>new Error('net::ERR_NETWORK_CHANGED https://localhost/web/?api_key=short-secret Token=short-secret');

for(const faults of [{evaluate:true},{screenshot:true},{evaluate:true,screenshot:true}]) {
    test('Capture failures still stop/sanitize/clean traces: '+JSON.stringify(faults),async t=>{
        const f=fixture(t,faults);await readiness.capture(f.page);
        const error=original(),result=await readiness.setupRetry(f.page,f.options,'login',error);
        assert.equal(result.traceStopped,true);assert.equal(result.traceRestarted,true);
        assert.ok(f.calls.indexOf('stop')>f.calls.indexOf('screenshot'));
        assert.deepEqual(f.calls.filter(x=>['start','stop'].includes(x)),['start','stop','start']);
        const report=f.read('login-1-readiness.json');
        assert.match(report.failure.message,/ERR_NETWORK_CHANGED/);
        assert.doesNotMatch(JSON.stringify(report),/short-secret|token=secret/);
        assert.deepEqual(report.diagnosticFailures.map(x=>x.stage),Object.keys(faults).map(x=>x==='evaluate'?'page-state':'screenshot'));
        assert.equal(fs.readFileSync(path.join(f.output,'login-1-trace.zip'),'utf8'),'SANITIZED');
        assert.ok(f.rawPaths.every(raw=>!fs.existsSync(path.dirname(raw))));
    });
}

test('Failed trace stop never restarts tracing and retains original error evidence',async t=>{
    const f=fixture(t,{stop:true,evaluate:true});await readiness.capture(f.page);
    const error=original(),result=await readiness.setupRetry(f.page,f.options,'login',error);
    assert.equal(result.traceStopped,false);assert.equal(result.traceRestarted,false);
    assert.deepEqual(f.calls.filter(x=>['start','stop','sanitize'].includes(x)),['start','stop']);
    assert.equal(f.state().active,true);
    const attempt=f.read('login-1-attempt.json');
    assert.match(attempt.failure.message,/ERR_NETWORK_CHANGED/);
    assert.ok(attempt.diagnosticFailures.some(x=>x.stage==='trace-stop'));
    assert.ok(f.rawPaths.every(raw=>!fs.existsSync(path.dirname(raw))));
    assert.equal(fs.existsSync(path.join(f.output,'login-1-trace.zip')),false);
    await assert.rejects(readiness.setupRetry(f.page,f.options,'login',new Error('second navigation')),error2=>error2===error);
});

test('Sanitizer failure removes raw and partial traces but permits restart after successful stop',async t=>{
    const f=fixture(t,{sanitize:true});await readiness.capture(f.page);
    const result=await readiness.setupRetry(f.page,f.options,'login',original());
    assert.equal(result.traceStopped,true);assert.equal(result.traceRestarted,true);
    assert.ok(result.diagnosticFailures.some(x=>x.stage==='trace-sanitize'));
    assert.equal(fs.existsSync(path.join(f.output,'login-1-trace.zip')),false);
    assert.ok(f.rawPaths.every(raw=>!fs.existsSync(path.dirname(raw))));
    assert.ok(fs.existsSync(path.join(f.output,'login-1-failure.png')));
});

test('Trace restart failure is diagnostic only, not a replacement navigation exception',async t=>{
    const f=fixture(t,{restart:true});await readiness.capture(f.page);
    const result=await readiness.setupRetry(f.page,f.options,'login',original());
    assert.equal(result.traceStopped,true);assert.equal(result.traceRestarted,false);
    const attempt=f.read('login-1-attempt.json');
    assert.match(attempt.failure.message,/ERR_NETWORK_CHANGED/);
    assert.ok(attempt.diagnosticFailures.some(x=>x.stage==='trace-restart'));
});

test('Output/temporary-directory/report failures still attempt trace cleanup',async t=>{
    const f=fixture(t);await readiness.capture(f.page);
    const blocker=path.join(f.output,'file');fs.writeFileSync(blocker,'file');
    const result=await readiness.setupRetry(f.page,{...f.options,output:path.join(blocker,'child')},'login',original());
    assert.equal(result.traceStopped,true);assert.equal(result.traceRestarted,true);
    assert.ok(result.diagnosticFailures.some(x=>x.stage==='output-directory'));
    assert.equal(f.rawPaths.length,0);
    await readiness.failure(f.page,{},'no-output',original());
    assert.equal(f.state().active,false,'No output directory must not skip stop');
});

test('Failed raw trace allocation falls back to stopping without export',async t=>{
    const f=fixture(t);await readiness.capture(f.page);
    t.mock.method(fs,'mkdtempSync',()=>{throw new Error('no temp space');});
    const result=await readiness.setupRetry(f.page,f.options,'login',original());
    assert.equal(result.traceStopped,true);assert.equal(result.traceRestarted,true);
    assert.ok(result.diagnosticFailures.some(x=>x.stage==='trace-directory'));
    assert.equal(f.rawPaths.length,0);
});

test('Readiness report failure keeps sanitized trace and records the separate diagnostic failure',async t=>{
    const f=fixture(t);await readiness.capture(f.page);
    const write=fs.writeFileSync;
    t.mock.method(fs,'writeFileSync',(file,...args)=>{
        if(String(file).endsWith('-readiness.json'))throw new Error('report unavailable');
        return write(file,...args);
    });
    const result=await readiness.setupRetry(f.page,f.options,'login',original());
    assert.equal(result.traceStopped,true);assert.equal(result.traceRestarted,true);
    assert.ok(f.read('login-1-attempt.json').diagnosticFailures.some(x=>x.stage==='readiness-report'));
    assert.equal(fs.readFileSync(path.join(f.output,'login-1-trace.zip'),'utf8'),'SANITIZED');
});

function loginPage(f, {first=original(),second,authentication}={}) {
    let navigations=0,signIns=0;
    f.page.goto=async()=>{navigations++;if(navigations===1&&first)throw first;if(second)throw second;};
    f.page.waitForLoadState=async()=>{};
    f.page.waitForFunction=async()=>{};f.page.waitForURL=async()=>{};
    f.page.locator=()=>({isVisible:async()=>true,waitFor:async()=>{},fill:async()=>{}});
    f.page.getByRole=()=>({waitFor:async()=>{},click:async()=>{signIns++;if(authentication)throw authentication;}});
    // Identity reads only occur after successful sign-in; diagnostic capture can fail independently.
    f.page.evaluate=async()=>{if(signIns===0)throw new Error('Execution context destroyed');return {userId:'user',nativeUserId:'user',serverId:'server',address:f.options.base};};
    return ()=>({navigations,signIns});
}

test('Only the first pre-authentication network navigation retries despite broken diagnostics',async t=>{
    const f=fixture(t,{screenshot:true,stop:true});await readiness.capture(f.page);
    const counts=loginPage(f);
    await readiness.login(f.page,f.options);
    assert.deepEqual(counts(),{navigations:2,signIns:1});
    assert.deepEqual(f.calls.filter(x=>['start','stop'].includes(x)),['start','stop']);
});

test('Native requestfailed errorText permits only the same pre-authentication network retry',async t=>{
    const f=fixture(t);await readiness.capture(f.page);
    const counts=loginPage(f,{first:new Error('login form was not ready')});
    const goto=f.page.goto;
    f.page.goto=async()=>{
        if(counts().navigations===0)f.page.emit('requestfailed',{failure:()=>({errorText:'net::ERR_NETWORK_CHANGED'})});
        return goto();
    };
    await readiness.login(f.page,f.options);
    assert.deepEqual(counts(),{navigations:2,signIns:1});
    assert.equal(f.page.listenerCount('requestfailed'),0);
});

test('Native startup requests settle before the fixture signs in',async t=>{
    const f=fixture(t);await readiness.capture(f.page);const counts=loginPage(f);
    let settled;const waiting=new Promise(resolve=>{settled=resolve;});
    f.page.waitForLoadState=async state=>{assert.equal(state,'networkidle');await waiting;};
    const login=readiness.login(f.page,f.options);
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(counts().signIns,0);
    settled();await login;assert.equal(counts().signIns,1);
});

test('Failed retry retains original navigation error as cause, with no third attempt',async t=>{
    const f=fixture(t,{screenshot:true});await readiness.capture(f.page);
    const first=original(),second=new Error('second navigation failed'),counts=loginPage(f,{first,second});
    await assert.rejects(readiness.login(f.page,f.options),error=>error===second && error.cause===first);
    assert.deepEqual(counts(),{navigations:2,signIns:0});
});

test('Unrelated navigation failures and authentication failures are never retried',async t=>{
    for(const stage of ['navigation','authentication']) {
        const f=fixture(t);await readiness.capture(f.page);
        const error=new Error(stage==='authentication'?'net::ERR_NETWORK_CHANGED during authentication':'unrelated navigation failure');
        const counts=loginPage(f,{first:stage==='navigation'?error:original(),authentication:stage==='authentication'?error:undefined});
        await assert.rejects(readiness.login(f.page,f.options),actual=>actual===error);
        assert.deepEqual(counts(),{navigations:stage==='navigation'?1:2,signIns:stage==='navigation'?0:1});
    }
});

for(const timing of ['before visibility wait','before fill'])
test('Late public-user chooser is revealed before one sign-in: '+timing,async t=>{
    const f=fixture(t);await readiness.capture(f.page);const counts=loginPage(f);
    let visible=true,fills=0,reveals=0,checks=0;
    f.page.locator=()=>({
        isVisible:async()=>{
            if(++checks===1 && timing==='before visibility wait'){visible=false;return true;}
            return visible;
        },waitFor:async()=>assert.equal(visible,true),
        fill:async()=>{if(++fills===1){visible=false;throw new Error('Form hidden by public-user chooser');}}
    });
    const role=f.page.getByRole;
    f.page.getByRole=(kind,options)=>options?.name==='Manual Login' ? {
        isVisible:async()=>!visible,click:async()=>{reveals++;visible=true;}
    }:role(kind,options);
    await readiness.login(f.page,f.options);
    assert.equal(reveals,1);assert.equal(fills,3);
    assert.deepEqual(counts(),{navigations:2,signIns:1});
});

for(const persistent of [false,true])test('Interrupted native translation resources are detected before sign-in: '+persistent,async t=>{
 const f=fixture(t);await readiness.capture(f.page);const counts=loginPage(f,{first:null});const goto=f.page.goto;
 f.page.goto=async()=>{if(persistent||counts().navigations===0)f.page.emit('requestfailed',{failure:()=>({errorText:'net::ERR_NETWORK_CHANGED'})});return goto();};
 if(persistent)await assert.rejects(readiness.login(f.page,f.options),/Native login resources interrupted/);
 else await readiness.login(f.page,f.options);
 assert.deepEqual(counts(),{navigations:2,signIns:persistent?0:1});
 assert.match(f.read('login-network-changed-1-attempt.json').failure.message,/ERR_NETWORK_CHANGED/);
 assert.equal(f.page.listenerCount('requestfailed'),0);
});

const dismissNativeError=require('./native-dialog-dismissal.cjs');
function dismissalFixture({closeDuringClick=false, failure=false}={}) {
    const dialog=new EventTarget();
    let handle, hidden=false, clicks=0, disposed=false, release, entered;
    const waiting=new Promise(resolve=>entered=resolve);
    const completion=new Promise(resolve=>release=resolve);
    const error={
        async waitFor({state}) { assert.equal(hidden,state==='hidden'); },
        async evaluateHandle(fn) {
            const value=fn({closest:()=>dialog});
            handle={value, async evaluate(fn) {return fn(value);}, async dispose() {disposed=true;}};
            return handle;
        }
    };
    const page={
        getByText() {return error;},
        getByRole() {return {async click() {
            clicks++;
            // Text can be hidden while native history teardown is still pending.
            hidden=true;
            if(closeDuringClick) dialog.dispatchEvent(new Event('close'));
        }};},
        async waitForFunction(predicate, state) {
            entered();
            if(failure) throw new Error('Native close did not complete');
            if(!predicate(state.value)) await completion;
            assert.equal(predicate(state.value),true);
        }
    };
    return {page,waiting,finish() {dialog.dispatchEvent(new Event('close'));release();},
        state() {return {clicks,disposed,hidden,closed:handle?.value.closed};}};
}
test('native dismissal waits for history completion even after click returns and text is hidden',async()=>{
    const f=dismissalFixture();let finished=false;
    const result=dismissNativeError(f.page,'error').then(value=>{finished=true;return value;});
    await f.waiting;
    assert.deepEqual(f.state(),{clicks:1,disposed:false,hidden:true,closed:false});
    assert.equal(finished,false,'Navigation must remain blocked during native teardown');
    f.finish();
    const evidence=await result;
    assert.equal(evidence.closedWhenClickReturned,false);
    assert.ok(evidence.closedAt>=evidence.clickReturnedAt);
    assert.equal(f.state().disposed,true);
});
test('native dismissal observes close during the click without losing the event',async()=>{
    const f=dismissalFixture({closeDuringClick:true});
    const evidence=await dismissNativeError(f.page,'error');
    assert.equal(evidence.closedWhenClickReturned,true);
    assert.ok(evidence.closedAt<=evidence.clickReturnedAt);
    assert.equal(f.state().clicks,1);
});
test('native dismissal failure propagates without retry or recovery',async()=>{
    const f=dismissalFixture({failure:true});
    await assert.rejects(dismissNativeError(f.page,'error'),/Native close did not complete/);
    assert.equal(f.state().clicks,1);
    assert.equal(f.state().disposed,true);
});

const removalContract=require('./removal-feedback-contract.cjs');
const published031=require('./published-v031-identity.json');
const historicalIdentity={...published031,deployedDllSha256:published031.dllSha256,activeVersion:'0.3.1.0',reportedVersion:'0.3.1'};
test('Only the exact published v0.3.1 identity permits empty removal feedback',()=>{
    assert.equal(removalContract.classify(historicalIdentity,false,'0.7.13','0.3.1','').status,'KNOWN_LIMITATION');
    assert.equal(removalContract.classify(historicalIdentity,false,'0.7.13','0.3.1','Could not remove').status,'PASS');
    for(const field of Object.keys(historicalIdentity)){
        assert.throws(()=>removalContract.classify({...historicalIdentity,[field]:'unknown'},false,'0.7.13','0.3.1',''),field);
        const missing={...historicalIdentity};delete missing[field];
        assert.throws(()=>removalContract.classify(missing,false,'0.7.13','0.3.1',''),field+' missing');
    }
    assert.throws(()=>removalContract.classify(undefined,false,'0.7.13','0.3.1',''),'Legacy mode alone is insufficient');
    assert.throws(()=>removalContract.classify(historicalIdentity,false,'0.7.13','0.7.13',''),'Changed live plugin');
    assert.throws(()=>removalContract.classify(historicalIdentity,false,'0.7.13','0.3.1','Other failure'),'No other failure is exempt');
});
test('Current candidates must retain removal feedback even with historical mode flags',()=>{
    const candidate={version:'0.7.13',activeVersion:'0.7.13.0',reportedVersion:'0.7.13',packageSha256:'a'.repeat(64),dllSha256:'b'.repeat(64),deployedDllSha256:'b'.repeat(64)};
    assert.equal(removalContract.classify(candidate,true,'0.7.13','0.7.13','Could not remove').status,'PASS');
    assert.throws(()=>removalContract.classify(candidate,true,'0.7.13','0.7.13',''));
    assert.throws(()=>removalContract.classify(candidate,false,'0.7.13','0.7.13',''));
    assert.throws(()=>removalContract.classify(historicalIdentity,true,'0.7.13','0.3.1',''));
});
