const readiness=require('./browser-readiness.cjs');
/* Auth/CSP bootstrap checks on disposable fixtures only. */
const {chromium}=require('./browser/node_modules/playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
const path=require('node:path');
const fixture=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
assert.equal(fixture.standalone,true);assert.match(fixture.base,/^https?:\/\/(?:127\.0\.0\.1|localhost):\d+(?:\/jellyfin)?$/);
(async()=>{
    const browser=await chromium.launch({headless:true});
    try {
        const output=path.resolve(fixture.reportDirectory || 'artifacts/v040/standalone');
        fs.mkdirSync(output,{recursive:true});
        for (const restricted of [false,true]) {
            const context=await browser.newContext({ignoreHTTPSErrors:fixture.tls === true,locale:'en-US'});const page=await context.newPage();page.setDefaultTimeout(15000);
            await readiness.capture(page);
            try {
            const browserErrors=[];
            page.on('pageerror',err=>browserErrors.push('pageerror: '+String(err.message||err).replace(/[A-Za-z0-9_-]{32,}/g,'[IDENTIFIER]').slice(0,400)));
            page.on('console',msg=>{if(msg.type()==='error')browserErrors.push('console: '+msg.text().replace(/[A-Za-z0-9_-]{32,}/g,'[IDENTIFIER]').slice(0,400));});
            const responses=[];
            page.on('response',response=>{if(response.status()>=400)responses.push({status:response.status(),path:new URL(response.url()).pathname});});
            let privateRequests=0;
            page.on('request',request=>{if(new URL(request.url()).pathname.endsWith('/Standalone/script.js'))privateRequests++;});
            if(restricted) await context.route('**/web/',async route=>{
                const response=await route.fetch();await route.fulfill({response,headers:{...response.headers(),'content-security-policy':"script-src 'self' 'unsafe-inline' 'unsafe-eval'"}});
            });
            try {
                await page.goto(fixture.base+'/web/');
            } catch (error) {
                // A freshly started Docker/Caddy network can briefly change while
                // Chromium is navigating. Retry only this transient transport error.
                if (!String(error).includes('net::ERR_NETWORK_CHANGED')) throw error;
                console.warn('Chromium network changed on initial navigation; retrying once');
                await readiness.setupRetry(page,{...fixture,output},restricted?'csp-login-retry':'login-retry');
                await page.goto('about:blank');
                await page.goto(fixture.base+'/web/');
            }
            try {
                await page.locator('#txtManualName').waitFor();
            } catch (error) {
                // Docker network setup occasionally makes Chromium invalidate all
                // in-flight resource requests (net::ERR_NETWORK_CHANGED). Reload
                // the native login page only for this recognized transport fault;
                // all assertions, including anonymous idle and CSP checks, remain.
                const networkChanged=browserErrors.some(message=>message.includes('net::ERR_NETWORK_CHANGED'));
                if (networkChanged) {
                    console.warn('Chromium network changed during Jellyfin Web bootstrap; retrying native login navigation once');
                    await readiness.setupRetry(page,{...fixture,output},restricted?'csp-login-retry':'login-retry');
                    await page.goto('about:blank');
                    await page.goto(fixture.base+'/web/');
                    try {
                        await page.locator('#txtManualName').waitFor();
                    } catch (retryError) {
                        error=retryError;
                    }
                }
                if (!await page.locator('#txtManualName').isVisible()) {
                    const state=await page.evaluate(()=>({url:location.href,title:document.title,ready:document.readyState,body:document.body?.innerText?.slice(0,500),scripts:[...document.scripts].length})).catch(err=>({evaluationError:String(err)}));
                    console.error('Standalone login diagnostic:',JSON.stringify({restricted,networkChanged,state,responses:responses.slice(-15),browserErrors:browserErrors.slice(-15)}));
                    await page.screenshot({path:path.join(output,restricted?'standalone-login-csp.png':'standalone-login.png'),fullPage:true}).catch(()=>{});
                    throw error;
                }
            }
            assert.equal(privateRequests,0);
            await page.locator('#txtManualName').fill(fixture.username);await page.locator('#txtManualPassword').fill(fixture.password);
            await page.getByRole('button',{name:'Sign In',exact:true}).click();
            if(restricted) {
                await page.waitForFunction(()=>window.WatchGuardStandalone?.status()==='failed-or-csp-blocked');
                assert.equal(await page.evaluate(()=>!!window.WatchGuardPoc),false);
            } else {
                await page.waitForFunction(()=>window.WatchGuardPoc?.isInstalled());
                assert.equal(privateRequests,1);
                await page.reload();await page.waitForFunction(()=>window.WatchGuardPoc?.isInstalled());
                assert.equal(privateRequests,2);
                await page.goto(fixture.base+'/web/#/home?watchguard=watchlists');
                await page.getByRole('region',{name:'Watchlists',exact:true}).waitFor();
                // Simulate unavailable/uninstalled backend while a tab still holds its adapter.
                await page.route('**/WatchGuard/Protection/*',route=>route.fulfill({status:404,body:''}));
                let deletes=0;await page.route('**/Items/*',route=>{if(route.request().method()==='DELETE'){deletes++;return route.abort();}return route.continue();});
                const blocked=page.evaluate(id=>window.ApiClient.deleteItem(id).then(()=>false,()=>true),fixture.items['PoC Movie Detail']);
                await page.getByRole('button',{name:'Cancel',exact:true}).click();
                assert.equal(await blocked,true);assert.equal(deletes,0);
            }
            } catch(error) {
                await readiness.failure(page,{...fixture,output},restricted?'csp-bootstrap':'bootstrap').catch(()=>console.warn('Diagnostic capture failed'));
                throw error;
            } finally {await context.close();}
        }
        console.log('Standalone browser: anonymous idle, authenticated load, reload, stale-tab failure and CSP blocking verified.');
    } finally {await browser.close();}
})();
