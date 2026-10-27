// Runs inside the real disposable Jellyfin browser fixture, before deletion tests.
const assert = require('node:assert/strict');
const path = require('node:path');
module.exports = async ({page, api, detail, fixture, member, output, report}) => {
    const id = fixture.items['PoC Movie Detail'];
    const normalized = value => value.replaceAll('-', '').toLowerCase();
    const owns = async token => (await api('/WatchGuard/Watchlist','GET',undefined,token)).some(e=>normalized(e.ItemId)===normalized(id));
    const otherBefore = await owns(member.AccessToken);
    const nativeBefore = await api('/UserItems/'+id+'/UserData');
    const routePattern = '**/WatchGuard/Watchlist/'+id;
    for (const width of [1280,390]) {
        await page.setViewportSize({width,height:900});
        await detail('PoC Movie Detail');
        const button=page.locator('#itemDetailPage:visible .watchguard-toggle');
        await page.getByRole('button',{name:'Add to Watchlist',exact:true}).waitFor();
        const node=await button.elementHandle();
        for (const saved of [false,true]) {
            const label=saved?'Remove from Watchlist':'Add to Watchlist';
            const icon=saved?'bookmark_remove':'bookmark_add';
            assert.equal(await button.getAttribute('title'),label);
            assert.equal(await button.locator('.material-icons').textContent(),icon);
            // A failed add or removal preserves the action and personal membership.
            const fail=route=>route.fulfill({status:503,body:'unavailable'});
            await page.route(routePattern,fail);
            await button.click();
            await page.getByRole('alert').filter({hasText:'Could not update'}).waitFor();
            await page.waitForFunction(()=>document.activeElement===document.querySelector('#itemDetailPage:not(.hide) .watchguard-toggle'));
            assert.equal(await button.getAttribute('aria-pressed'),String(saved));
            assert.equal(await owns(fixture.token),saved);
            assert.equal(await button.locator('.material-icons').textContent(),icon);
            await page.unroute(routePattern,fail);
            let release, started; let calls=0;
            const held=new Promise(resolve=>release=resolve), entered=new Promise(resolve=>started=resolve);
            const delay=async route=>{calls++;started();await held;await route.continue();};
            await page.route(routePattern,delay);
            await button.focus(); await page.keyboard.press('Enter'); await entered;
            assert.equal(await button.isDisabled(),true);
            // Native button activation while disabled must not send another write.
            await button.evaluate(element=>{element.click();element.click();});
            assert.equal(calls,1); release();
            await page.getByRole('button',{name:saved?'Add to Watchlist':'Remove from Watchlist',exact:true}).waitFor();
            await page.waitForFunction(()=>!document.querySelector('#itemDetailPage:not(.hide) .watchguard-toggle')?.disabled);
            await page.unroute(routePattern,delay);
            assert.equal(calls,1);
            assert.equal(await node.evaluate((original)=>original===document.querySelector('#itemDetailPage:not(.hide) .watchguard-toggle')),true);
            await page.waitForFunction(()=>document.activeElement===document.querySelector('#itemDetailPage:not(.hide) .watchguard-toggle'));
            assert.equal(await owns(fixture.token),!saved);
            assert.equal(await owns(member.AccessToken),otherBefore,'Another account retains its membership');
            if (!saved) {
                await page.mouse.move(0,0);
                const appearance=await button.locator('.material-icons').evaluate(el=>({text:el.textContent,color:getComputedStyle(el).color,visible:el.getBoundingClientRect().width>0&&getComputedStyle(el).opacity==='1'}));
                assert.equal(appearance.text,'bookmark_remove');assert.equal(appearance.visible,true);
                assert.equal(await button.getAttribute('aria-pressed'),'true');
                await button.focus();
                assert.equal(await button.evaluate(el=>el===document.activeElement),true);
                await page.screenshot({path:path.join(output,'watchlist-remove-'+width+'.png')});
                report.paths.push({path:'Watchlist action '+width,result:'Keyboard add/remove; both failed writes retain state; repeated disabled clicks send one write; saved minus visible without hover; same button node; other membership retained',appearance});
            }
        }
        assert.equal((await api('/Items/'+id)).Id.replaceAll('-',''),id.replaceAll('-',''),'Media remains available');
        assert.deepEqual(await api('/UserItems/'+id+'/UserData'),nativeBefore,'Membership changes do not change native user data');
    }
    // A delayed failed write must not repaint a different detail route.
    let release, entered;
    const held=new Promise(resolve=>release=resolve), started=new Promise(resolve=>entered=resolve);
    const stale=async route=>{entered();await held;await route.fulfill({status:503,body:'unavailable'});};
    await page.route(routePattern,stale);
    await page.getByRole('button',{name:'Add to Watchlist',exact:true}).click();await started;
    await page.evaluate(id=>{location.hash='/details?id='+id;},fixture.items['PoC Series Detail']);
    await page.locator('#itemDetailPage:visible').getByText('PoC Series Detail',{exact:true}).first().waitFor();
    await page.getByRole('button',{name:'Add to Watchlist',exact:true}).waitFor();
    const settled=page.waitForResponse(r=>r.url().endsWith('/WatchGuard/Watchlist/'+id)&&r.status()===503);
    release();await settled;await page.unroute(routePattern,stale);
    await page.waitForFunction(()=>!document.querySelector('#itemDetailPage:not(.hide) .watchguard-toggle')?.disabled);
    assert.equal(await page.locator('#itemDetailPage:visible .watchguard-error').innerText(),'');
    assert.equal(await owns(fixture.token),false);
    report.paths.push({path:'Watchlist navigation during write',result:'Delayed failure cannot repaint the new detail route or mutate membership'});
    await page.setViewportSize({width:1280,height:900});
};
