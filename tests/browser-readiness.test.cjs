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
    f.page.goto=async()=>{navigations++;if(navigations===1)throw first;if(second)throw second;};
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
        f.page.emit('requestfailed',{failure:()=>({errorText:'net::ERR_NETWORK_CHANGED'})});
        return goto();
    };
    await readiness.login(f.page,f.options);
    assert.deepEqual(counts(),{navigations:2,signIns:1});
    assert.equal(f.page.listenerCount('requestfailed'),0);
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
