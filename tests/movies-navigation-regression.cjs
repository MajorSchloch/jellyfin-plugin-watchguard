const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const movies = require('./native-movies.cjs');
// Hold the real lazy-loaded Movies module. No clock delay or replacement view.
module.exports = async function regression(page, fixture, output) {
    const title = 'PoC Bulk One';
    const link = page.getByRole('link', {name:'PoC Movies', exact:true}).first();
    const expected = await link.getAttribute('href');
    let release;
    const held = new Promise(resolve => { release = resolve; });
    const chunk = /\/movies\.[a-z\d]+\.chunk\.js(?:\?|$)/i;
    const hold = async route => { await held; await route.continue(); };
    await page.route(chunk, hold);
    const evidence = {scenario:'Home and Movies share one real item; Movies module held', status:'RUNNING'};
    const save = () => fs.writeFileSync(path.join(output, 'movies-navigation.json'), JSON.stringify(evidence, null, 2)+'\n');
    try {
        await page.goto(fixture.base + '/web/#/home');
        await page.getByText(title, {exact:true}).waitFor();
        const homeCard = page.locator('.card[data-id="'+fixture.items[title]+'"]');
        await homeCard.waitFor({state:'visible'});
        await homeCard.scrollIntoViewIfNeeded();
        const requested = page.waitForRequest(chunk);
        await page.getByRole('link', {name:'PoC Movies', exact:true}).first().click();
        await requested;
        // Execute the old helper's actual condition while the destination is held.
        await page.getByText(title, {exact:true}).waitFor();
        await page.waitForFunction(() => window.WatchGuardPoc?.isInstalled());
        evidence.oldHelperAcceptedHome = await homeCard.isVisible();
        evidence.activeViewWhileHeld = await page.evaluate(() => window.wgFixtureActiveView?.id || null);
        evidence.destinationReadyWhileHeld = await page.evaluate(movies.moviesReady, expected);
        save();
        assert.equal(evidence.oldHelperAcceptedHome, true, 'Baseline accepts the duplicate Home card');
        assert.equal(evidence.destinationReadyWhileHeld, false, 'Movies must not be ready while its module is held');
        await page.screenshot({path:path.join(output, 'movies-navigation-held.png')});
        let finished = false;
        const waiting = movies.waitForMovies(page, expected).then(view => { finished = true; return view; });
        // A browser evaluation gives the pending readiness request a round trip.
        assert.equal(await page.evaluate(movies.moviesReady, expected), false);
        assert.equal(finished, false, 'New helper remains blocked before native arrival');
        release();
        await waiting;
        const target = await movies.card(page, expected, fixture, title);
        evidence.destinationCardVerified = true;
        await target.click({button:'right'});
        await page.locator('.actionSheet.opened .watchguard-native-action').waitFor();
        await page.locator('.dialogContainer').filter({has:page.locator('.watchguard-native-action')}).click({position:{x:5,y:5}});
        await page.locator('.actionSheet.opened').waitFor({state:'hidden'});
        await page.screenshot({path:path.join(output, 'movies-navigation-ready.png')});
        evidence.status = 'PASS';
        return evidence;
    } catch (error) {
        evidence.status = 'FAIL';
        throw error;
    } finally {
        release();
        await page.unroute(chunk, hold);
        save();
    }
};
