const readiness=require('./browser-readiness.cjs');
/* Observe Jellyfin's unmodified native WebSocket; report no URL, token or frame payload. */
const {chromium}=require('./browser/node_modules/playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
const fixture=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
assert.equal(fixture.username,'WatchGuardPoCTest');
assert.match(fixture.base,/^https?:\/\/(?:localhost|127\.0\.0\.1):\d+(?:\/jellyfin)?$/);
(async()=>{
 const browser=await chromium.launch({headless:true});let page;
 try {
  const context=await browser.newContext({ignoreHTTPSErrors:fixture.tls===true,locale:'en-US'});
  page=await context.newPage();
  await readiness.capture(page);
  const browserErrors=[];
  page.on('pageerror',error=>browserErrors.push('pageerror: '+String(error.message||error).replace(/[A-Za-z0-9_-]{32,}/g,'[IDENTIFIER]').slice(0,350)));
  page.on('console',message=>{if(message.type()==='error')browserErrors.push('console: '+message.text().replace(/[A-Za-z0-9_-]{32,}/g,'[IDENTIFIER]').slice(0,350));});
  const cdp=await page.context().newCDPSession(page), statuses=[], connected=new Set();let closed=0,frames=0,errors=0;
  await cdp.send('Network.enable');
  cdp.on('Network.webSocketHandshakeResponseReceived',event=>{statuses.push(event.response.status);if(event.response.status===101)connected.add(event.requestId);});
  cdp.on('Network.webSocketClosed',event=>{closed++;connected.delete(event.requestId);});
  cdp.on('Network.webSocketFrameReceived',()=>frames++);
  cdp.on('Network.webSocketFrameError',()=>errors++);
  // Chromium may report ERR_NETWORK_CHANGED during the first navigation
  // immediately after the disposable Caddy network is attached. Catch the
  // navigation rejection itself (not just later console messages). Only this
  // pre-login GET is eligible for a bounded retry; no mutation or DELETE is.
  for (let attempt=0; attempt<2; attempt++) {
   try {
    await page.goto(fixture.base+'/web/');
    await page.locator('#txtManualName').waitFor({state:'visible',timeout:15000});
    break;
   } catch(error) {
    const networkChanged=String(error?.message||error).includes('net::ERR_NETWORK_CHANGED');
    if (!networkChanged || attempt===1) {
     const state=await page.evaluate(()=>({title:document.title,ready:document.readyState,loginPresent:Boolean(document.querySelector('#txtManualName')),scriptCount:document.scripts.length})).catch(e=>({evaluationError:String(e)}));
     console.error('Socket probe native login diagnostic:',JSON.stringify({networkChanged,state,browserErrors:browserErrors.slice(-15)}));
     throw error;
    }
    console.warn('Chromium network changed during initial Jellyfin login navigation; recording first failure and retrying safe GET, attempt '+(attempt+1));
    await readiness.setupRetry(page,{...fixture,output:fixture.reportDirectory},'socket-login-retry',error);
   }
  }
  await page.locator('#txtManualName').fill(fixture.username);await page.locator('#txtManualPassword').fill(fixture.password);
  const loginStarted=Date.now();
  await page.getByRole('button',{name:'Sign In',exact:true}).click();
  await page.waitForFunction(()=>window.WatchGuardPoc?.isInstalled());
  await page.getByText('My Media',{exact:true}).waitFor();
  await readiness.identity(page,fixture);
  readiness.timing(fixture,'socket-login',Date.now()-loginStarted);
  await page.evaluate(()=>window.ApiClient.ensureWebSocket());
  await page.waitForTimeout(3000);
  const open=await page.evaluate(()=>window.ApiClient.isWebSocketOpen());
  assert.ok(connected.size > 0 && frames > 0, 'Native WebSocket must remain connected and receive frames');
  const report={mode:fixture.standalone?'standalone':'injector',https:fixture.tls===true,nativeWebSocketOpen:open,handshakeStatusCodes:statuses,connectionsRemaining:connected.size,closed,framesReceived:frames,frameErrors:errors};
  fs.mkdirSync('artifacts/standalone',{recursive:true});
  fs.writeFileSync('artifacts/standalone/socket-'+report.mode+'.json',JSON.stringify(report,null,2)+'\n');
  console.log('Unmodified native browser WebSocket:',JSON.stringify(report));
 } catch(error) {
  await readiness.failure(page,{...fixture,output:fixture.reportDirectory},'socket',error).catch(()=>console.warn('Diagnostic capture failed'));throw error;
 } finally {await browser.close();}
})();
