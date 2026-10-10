/* WatchGuard: Jellyfin Web 12 legacy ApiClient adapter. No fetch/XHR patching. */
(function (root) {
    'use strict';
    const sameId = (a, b) => String(a).replaceAll('-', '').toLowerCase() === String(b).replaceAll('-', '').toLowerCase();
    const field = (value, name) => value?.[name] ?? value?.[name[0].toUpperCase() + name.slice(1)];
    function request(api, path, type = 'GET') {
        return api.ajax({ url: api.getUrl('WatchGuard/' + path), type, ...(type === 'GET' ? { dataType: 'json' } : {}) });
    }
    async function guard(api, original, args, ask) {
        const userId = api.getCurrentUserId();
        const item = await api.getItem(userId, args[0]);
        const titleId = item.Type === 'Movie' || item.Type === 'Series' ? item.Id
            : item.Type === 'Episode' || item.Type === 'Season' ? item.SeriesId : null;
        if (titleId) {
            const user = await api.getCurrentUser(false);
            let message;
            if (user.Policy?.IsAdministrator) {
                const status = await request(api, 'Protection/' + encodeURIComponent(titleId));
                const people = field(status, 'users');
                if (!Array.isArray(people)) throw new Error('WatchGuard returned an invalid status; deletion stopped.');
                const others = people.filter(p => !sameId(field(p, 'userId'), userId));
                if (others.length) message = others.map(p => field(p, 'name') + ': ' + field(p, 'reasons').join(', ')).join('\n');
            } else {
                // Privacy boundary: only administrators may inspect other users' interest.
                message = 'Other users may want to watch this title. Only administrators can inspect their interest. Protection status could not be checked.';
            }
            if (message && !await ask('WatchGuard — ' + item.Name, message))
                throw new Error('WatchGuard: deletion cancelled.');
        }
        // Never change native permissions, arguments, return value, or the API request itself.
        if (!sameId(api.getCurrentUserId(), userId)) throw new Error('WatchGuard: user changed; deletion stopped.');
        return original.apply(api, args);
    }
    function install(api, ask) {
        if (!api || typeof api.deleteItem !== 'function' || api.deleteItem.watchGuard) return;
        const original = api.deleteItem;
        let queue = Promise.resolve();
        const wrapped = function (...args) {
            const pending = queue.then(() => guard(api, original, args, ask));
            queue = pending.catch(() => {});
            return pending;
        };
        wrapped.watchGuard = true;
        api.deleteItem = wrapped;
    }
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { guard, install };
        return;
    }
    if (root.watchGuardLoaded) return;
    root.watchGuardLoaded = true;

    function ask(title, message) {
        return new Promise(resolve => {
            const dialog = document.createElement('dialog');
            dialog.style.cssText = 'max-width:32rem;padding:1.5rem;border-radius:.5rem;background:#202020;color:white;border:1px solid #888;';
            const heading = document.createElement('h3'); heading.textContent = title;
            const body = document.createElement('p'); body.textContent = message; body.style.whiteSpace = 'pre-line';
            const cancel = document.createElement('button'); cancel.textContent = 'Cancel'; cancel.autofocus = true;
            const proceed = document.createElement('button'); proceed.textContent = 'Delete Anyway';
            for (const button of [cancel, proceed]) { button.className = 'emby-button raised'; button.style.margin = '.3rem'; }
            let done = false;
            const finish = value => { if (done) return; done = true; dialog.remove(); resolve(value); };
            cancel.onclick = () => finish(false); proceed.onclick = () => finish(true);
            dialog.addEventListener('cancel', event => { event.preventDefault(); finish(false); });
            dialog.addEventListener('close', () => finish(false));
            dialog.append(heading, body, cancel, proceed); document.body.append(dialog); dialog.showModal(); cancel.focus();
        });
    }
    const bind = () => install(root.ApiClient, ask);
    bind();
    // ApiClient can appear after injection and is replaced on server changes.
    setInterval(bind, 500);
    document.addEventListener('viewbeforeshow', bind, true);
    document.addEventListener('viewshow', event => {
        bind();
        const view = event.target;
        if (view?.id !== 'itemDetailPage') return;
        mount(view, event.detail?.params?.id);
    });
    let generation = 0;
    async function mount(view, itemId) {
        const current = ++generation;
        view.querySelector('[data-watchguard]')?.remove();
        const api = root.ApiClient;
        if (!api || !itemId) return;
        const userId = api.getCurrentUserId();
        const panel = document.createElement('section');
        panel.dataset.watchguard = ''; panel.style.cssText = 'padding:1em;clear:both;';
        const valid = () => current === generation && view.isConnected && root.ApiClient === api && sameId(api.getCurrentUserId(), userId);
        try {
            const item = await api.getItem(userId, itemId);
            if (!valid() || !['Movie', 'Series'].includes(item.Type)) return;
            // One source-verified placement selector; deletion never depends on DOM selectors.
            const host = view.querySelector('.detailPagePrimaryContent');
            if (!host) return;
            host.append(panel);
            const toggle = document.createElement('button'); toggle.className = 'emby-button raised';
            const list = document.createElement('button'); list.className = 'emby-button raised'; list.textContent = 'My Watchlist';
            const details = document.createElement('p'); panel.append(toggle, list, details);
            list.onclick = async () => {
                list.disabled = true;
                try {
                    const titles = await request(api, 'Watchlist');
                    if (!valid()) return;
                    const dialog = document.createElement('dialog');
                    dialog.style.cssText = 'max-width:32rem;max-height:80vh;overflow:auto;padding:1.5rem;background:#202020;color:white;';
                    const heading = document.createElement('h3'); heading.textContent = 'My Watchlist'; dialog.append(heading);
                    const items = document.createElement('ul'); dialog.append(items);
                    for (const title of titles) {
                        const row = document.createElement('li'); const link = document.createElement('a');
                        link.textContent = field(title, 'name');
                        link.href = '#/details?id=' + encodeURIComponent(field(title, 'id')) + '&serverId=' + encodeURIComponent(api.serverId());
                        link.onclick = () => dialog.close(); row.append(link); items.append(row);
                    }
                    if (!titles.length) items.textContent = 'Your watchlist is empty.';
                    const close = document.createElement('button'); close.textContent = 'Close'; close.className = 'emby-button raised';
                    close.onclick = () => dialog.close(); dialog.append(close);
                    dialog.addEventListener('close', () => dialog.remove(), { once: true });
                    document.body.append(dialog); dialog.showModal(); close.focus();
                } catch { if (valid()) details.textContent = 'WatchGuard could not load your watchlist.'; }
                finally { list.disabled = false; }
            };
            const refresh = async () => {
                const own = await request(api, 'Watchlist/' + encodeURIComponent(itemId));
                if (!valid()) return;
                const saved = field(own, 'watchlisted');
                toggle.textContent = saved ? 'Remove from Watchlist' : 'Add to Watchlist';
                toggle.setAttribute('aria-pressed', String(saved));
                toggle.onclick = async () => {
                    toggle.disabled = true;
                    try { await request(api, 'Watchlist/' + encodeURIComponent(itemId), saved ? 'DELETE' : 'PUT'); await refresh(); }
                    catch { if (valid()) details.textContent = 'WatchGuard could not save the watchlist change. Try again.'; }
                    finally { toggle.disabled = false; }
                };
                const user = await api.getCurrentUser(false);
                if (user.Policy?.IsAdministrator) {
                    const status = await request(api, 'Protection/' + encodeURIComponent(itemId));
                    if (!valid()) return;
                    const others = field(status, 'users').filter(p => !sameId(field(p, 'userId'), userId));
                    details.textContent = others.length ? 'Interested: ' + others.map(p => field(p, 'name') + ' (' + field(p, 'reasons').join(', ') + ')').join('; ') : 'No other users currently interested.';
                }
            };
            await refresh();
        } catch { if (valid()) panel.textContent = 'WatchGuard is unavailable. Watchlist status could not be loaded.'; }
    }
    // Cover injection after the initial viewshow event, without observing the whole DOM.
    const initial = document.getElementById('itemDetailPage');
    if (initial) mount(initial, new URLSearchParams(location.hash.split('?')[1] || location.search).get('id'));
})(typeof window === 'undefined' ? globalThis : window);
