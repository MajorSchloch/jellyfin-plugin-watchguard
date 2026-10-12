/* Observe Jellyfin's unmodified native WebSocket; report no URL, token or frame payload. */
const {chromium}=require('./browser/node_modules/playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
const fixture=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
assert.equal(fixture.username,'WatchGuardPoCTest');
assert.match(fixture.base,/^https?:\/\/(?:localhost|127\.0\.0\.1):\d+(?:\/jellyfin)?$/);
(async()=>{
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage({ignoreHTTPSErrors:fixture.tls===true});
  const cdp=await page.context().newCDPSession(page), statuses=[], connected=new Set();let closed=0,frames=0,errors=0;
  await cdp.send('Network.enable');
  cdp.on('Network.webSocketHandshakeResponseReceived',event=>{statuses.push(event.response.status);if(event.response.status===101)connected.add(event.requestId);});
  cdp.on('Network.webSocketClosed',event=>{closed++;connected.delete(event.requestId);});
  cdp.on('Network.webSocketFrameReceived',()=>frames++);
  cdp.on('Network.webSocketFrameError',()=>errors++);
  await page.goto(fixture.base+'/web/');
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
