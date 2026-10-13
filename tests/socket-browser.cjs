/* Observe Jellyfin's unmodified native WebSocket; report no URL, token or frame payload. */
const {chromium}=require('./browser/node_modules/playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
const fixture=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
assert.equal(fixture.username,'WatchGuardPoCTest');
assert.match(fixture.base,/^https?:\/\/(?:localhost|127\.0\.0\.1):\d+(?:\/jellyfin)?$/);
(async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const context=await browser.newContext({ignoreHTTPSErrors:fixture.tls===true,locale:'en-US'});
  const page=await context.newPage();
  const browserErrors=[];
  page.on('pageerror',error=>browserErrors.push('pageerror: '+String(error.message||error).slice(0,350)));
  page.on('console',message=>{if(message.type()==='error')browserErrors.push('console: '+message.text().slice(0,350));});
  const cdp=await page.context().newCDPSession(page), statuses=[], connected=new Set();let closed=0,frames=0,errors=0;
  await cdp.send('Network.enable');
  cdp.on('Network.webSocketHandshakeResponseReceived',event=>{statuses.push(event.response.status);if(event.response.status===101)connected.add(event.requestId);});
  cdp.on('Network.webSocketClosed',event=>{closed++;connected.delete(event.requestId);});
  cdp.on('Network.webSocketFrameReceived',()=>frames++);
  cdp.on('Network.webSocketFrameError',()=>errors++);
  await page.goto(fixture.base+'/web/');
  try {
   await page.locator('#txtManualName').waitFor({state:'visible',timeout:15000});
  } catch (error) {
   const networkChanged=browserErrors.some(entry=>entry.includes('net::ERR_NETWORK_CHANGED'));
   if (networkChanged) {
    console.warn('Chromium network changed during native Jellyfin login bootstrap; retrying navigation once');
    browserErrors.length=0;
    await page.goto('about:blank');
    await page.goto(fixture.base+'/web/');
   }
   try {
    await page.locator('#txtManualName').waitFor({state:'visible',timeout:15000});
   } catch (retryError) {
    const state=await page.evaluate(()=>({title:document.title,ready:document.readyState,loginPresent:Boolean(document.querySelector('#txtManualName')),scriptCount:document.scripts.length})).catch(e=>({evaluationError:String(e)}));
    console.error('Socket probe native login diagnostic:',JSON.stringify({networkChanged,state,browserErrors:browserErrors.slice(-15)}));
    throw retryError;
   }
  }
  await page.locator('#txtManualName').fill(fixture.username);await page.locator('#txtManualPassword').fill(fixture.password);
  await page.getByRole('button',{name:'Sign In',exact:true}).click();
  await page.waitForFunction(()=>window.WatchGuardPoc?.isInstalled());
  await page.evaluate(()=>window.ApiClient.ensureWebSocket());
  await page.waitForTimeout(3000);
  const open=await page.evaluate(()=>window.ApiClient.isWebSocketOpen());
  assert.ok(connected.size > 0 && frames > 0, 'Native WebSocket must remain connected and receive frames');
  const report={mode:fixture.standalone?'standalone':'injector',https:fixture.tls===true,nativeWebSocketOpen:open,handshakeStatusCodes:statuses,connectionsRemaining:connected.size,closed,framesReceived:frames,frameErrors:errors};
  fs.mkdirSync('artifacts/standalone',{recursive:true});
  fs.writeFileSync('artifacts/standalone/socket-'+report.mode+'.json',JSON.stringify(report,null,2)+'\n');
  console.log('Unmodified native browser WebSocket:',JSON.stringify(report));
 } finally {await browser.close();}
})();
