// Test-only native route/view contract. Do not act on a matching Home card.
const assert = require('node:assert/strict');
const key = value => String(value || '').replaceAll('-', '').toLowerCase();
function observeViews() {
    window.wgFixtureActiveView = null;
    document.addEventListener('viewshow', event => { window.wgFixtureActiveView = event.target; });
    document.addEventListener('viewbeforehide', event => {
        if (window.wgFixtureActiveView === event.target) window.wgFixtureActiveView = null;
    });
}
function moviesReady(expected) {
    const route = new URL(location.href).hash;
    const params = new URLSearchParams(route.split('?')[1]);
    const wanted = new URLSearchParams(expected.split('?')[1]);
    const view = document.querySelector('#moviesPage');
    return route.split('?')[0] === '#/movies' &&
        params.get('topParentId') === wanted.get('topParentId') &&
        params.get('collectionType') === wanted.get('collectionType') &&
        view !== null && window.wgFixtureActiveView === view &&
        !view.closest('.hide, [aria-hidden="true"]') && view.getClientRects().length > 0 &&
        getComputedStyle(view).visibility === 'visible';
}
async function waitForMovies(page, expected) {
    assert.equal(expected.split('?')[0], '#/movies', 'Expected native Movies route');
    assert.match(new URLSearchParams(expected.split('?')[1]).get('topParentId') || '', /^[a-f\d]{32}$/i,
        'Expected Movies library identity');
    await page.waitForFunction(moviesReady, expected);
    return page.locator('#moviesPage:visible');
}
async function card(page, expected, fixture, title) {
    const view = await waitForMovies(page, expected);
    assert.ok(fixture.items[title], 'Known fixture item: ' + title);
    const node = view.locator('.card[data-id="' + fixture.items[title] + '"]');
    await node.waitFor({state:'visible'});
    assert.equal(await node.count(), 1, 'One intended card in the active Movies view');
    await node.getByText(title, {exact:true}).waitFor();
    const actual = await node.evaluate(element => ({
        id:element.dataset.id, server:element.dataset.serverid, type:element.dataset.type,
        links:Array.from(element.querySelectorAll('a[href]'), link => link.getAttribute('href'))
    }));
    assert.equal(key(actual.id), key(fixture.items[title]), 'Movie card identity');
    assert.equal(key(actual.server), key(fixture.serverId), 'Movie card server');
    assert.equal(actual.type, 'Movie', 'Movie card media type');
    assert.ok(actual.links.some(href => {
        const [route, query] = href.split('?');
        const params = new URLSearchParams(query);
        return route === '#/details' && key(params.get('id')) === key(fixture.items[title]) &&
            key(params.get('serverId')) === key(fixture.serverId);
    }), 'Movie card detail link resolves to the intended item and server');
    assert.equal(await page.evaluate(moviesReady, expected), true, 'Movies remains active before the action');
    return node;
}
module.exports = {observeViews, moviesReady, waitForMovies, card};
