/* Called only from the disposable native settings fixture. No native item DELETEs. */
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const readiness=require('./browser-readiness.cjs');
module.exports=async function(page,fixture) {
    const region=page.getByRole('region',{name:'Watchlists',exact:true});
    const sort=()=>region.getByRole('combobox',{name:'Sort by'});
    const writes=[];
    const observe=request=>{if(new URL(request.url()).pathname.endsWith('/WatchGuard/Preferences') && request.method()!=='GET') writes.push(request.method());};
    page.on('request',observe);
    const request=(path,type='GET',data)=>page.evaluate(async ({path,type,data})=>{
        const api=window.ApiClient;
        return api.ajax({url:api.getUrl(path),type,dataType:'json',...(data?{data:JSON.stringify(data),contentType:'application/json'}:{})});
    },{path,type,data});
    async function open(parameters='') {
        // Each reload assertion starts a fresh document. A fragment-only goto
        // could observe the previous region's aria-busy=false before routing.
        await page.goto('about:blank');
        await page.goto(fixture.base+'/web/#/home?watchguard=watchlists'+parameters);
        await page.waitForFunction(()=>document.querySelector('.watchguard-page')?.getAttribute('aria-busy')==='false');
    }
    async function action(label) {
        if(!await region.locator('.watchguard-filter').evaluate(e=>e.open)) await region.locator('.watchguard-filter summary').click();
        await region.getByRole('button',{name:label,exact:true}).click();
    }
    async function save() {
        const response=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/WatchGuard/Preferences') && r.request().method()==='PUT');
        await action('Save view as defaults');assert.equal((await response).ok(),true);
        await region.getByText('View saved as your defaults.',{exact:true}).waitFor();
    }
    async function reset() {
        const response=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/WatchGuard/Preferences') && r.request().method()==='DELETE');
        await action('Reset to Defaults');assert.equal((await response).ok(),true);
        await region.getByText('Defaults restored.',{exact:true}).waitFor();
    }
    async function signIn(username,password) {
        // Clear this disposable browser's authentication state, then perform a
        // native login. Do not inject another account into the existing ApiClient.
        await page.evaluate(()=>{localStorage.clear();sessionStorage.clear();});
        await page.context().clearCookies();
        await page.goto(fixture.base+'/web/');await page.reload();
        await page.locator('#txtManualName').fill(username);await page.locator('#txtManualPassword').fill(password);
        await page.getByRole('button',{name:'Sign In',exact:true}).click();
        await page.getByText('My Media',{exact:true}).waitFor();
        await page.waitForFunction(()=>window.WatchGuardPoc?.isInstalled() && window.ApiClient?.getCurrentUserId());
    }
    let member;
    try {
        await open('&owner=all&interest=watched&sort=added');
        await save();
        const added={Owner:'all',Statuses:['watched'],Sort:'added'};
        assert.deepEqual(await request('WatchGuard/Preferences'),added);
        await open();assert.equal(await sort().inputValue(),'added');
        await page.reload();await page.waitForFunction(()=>document.querySelector('.watchguard-page')?.getAttribute('aria-busy')==='false');
        assert.equal(await sort().inputValue(),'added');
        const before=writes.length;
        await open('&owner=mine');assert.equal(await sort().inputValue(),'added');
        assert.equal(await region.getAttribute('data-watchguard-scope'),'mine');
        await open('&interest=none');assert.equal(await sort().inputValue(),'added');
        assert.equal(await region.locator('input:checked').count(),0);
        await open('&sort=recent');assert.equal(await sort().inputValue(),'recent');
        assert.equal(await region.getAttribute('data-watchguard-scope'),'all');
        await sort().selectOption('title');
        assert.equal(writes.length,before,'Shared links and ordinary sort changes must never save');
        assert.deepEqual(await request('WatchGuard/Preferences'),added);
        for(const next of ['title','recent','added']) {
            await open();await sort().selectOption(next);
            await page.waitForFunction(expected=>new URLSearchParams(location.hash.split('?')[1]).get('sort')===expected,next);
            await save();
            await open();assert.equal(await sort().inputValue(),next);
        }
        // Failed mutations keep stored values and a visible failure message.
        const fail=route=>route.request().method()==='GET'?route.continue():route.fulfill({status:503,contentType:'application/json',body:'{}'});
        await page.route('**/WatchGuard/Preferences',fail);
        await action('Save view as defaults');await region.getByText('Could not save defaults. Please retry.',{exact:true}).waitFor();
        await action('Reset to Defaults');await region.getByText('Could not reset saved defaults. Please retry.',{exact:true}).waitFor();
        await page.unroute('**/WatchGuard/Preferences',fail);
        assert.deepEqual(await request('WatchGuard/Preferences'),added);
        const password='Disposable-'+crypto.randomUUID();
        member=await request('Users/New','POST',{Name:'Preference-'+crypto.randomUUID(),Password:password});
        await signIn(member.Name,password);
        await readiness.identity(page,{...fixture,userId:member.Id});
        await open();assert.equal(await sort().inputValue(),'title');
        assert.equal(await region.getAttribute('data-watchguard-scope'),'mine');
        await open('&sort=added');await save();
        assert.deepEqual(await request('WatchGuard/Preferences'),{Owner:'mine',Statuses:['watchlisted','watching','playing'],Sort:'added'});
        await reset();
        await signIn(fixture.username,fixture.password);
        await readiness.identity(page,fixture);
        await open();assert.equal(await sort().inputValue(),'added');
        assert.deepEqual(await request('WatchGuard/Preferences'),added,'Other account reset must not change admin defaults');
        await reset();await open();assert.equal(await sort().inputValue(),'title');
        assert.equal(await region.getAttribute('data-watchguard-scope'),'mine');
        assert.equal(await region.locator('input:checked').count(),3);
        console.log('Saved Recently added browser persistence, per-field URL overrides, replacement, reset, failures and account switching passed.');
    } finally {page.off('request',observe);}
};
