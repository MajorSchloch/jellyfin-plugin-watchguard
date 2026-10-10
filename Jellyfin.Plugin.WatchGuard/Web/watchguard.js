/* Jellyfin Web 12.2: narrow ApiClient adapter and legacy detail-view controls. */
(function (root) {
    'use strict';
    const message = 'WatchGuard: This item may still be in use.';

    function createAdapter(ask, log = () => {}, check = async () => message, contextValid = () => true) {
        const installed = new WeakMap();
        let queue = Promise.resolve();
        let sequence = 0;
        // Never log arguments, user/item IDs, URLs, tokens, native errors, or API objects.
        const emit = (event, operation = 0) => { try { log(event, operation); } catch { /* Diagnostics cannot bypass the gate. */ } };
        const cancelled = () => Object.assign(new Error('WatchGuard: deletion cancelled.'), { name: 'AbortError' });
        function install(api) {
            if (!api || typeof api.deleteItem !== 'function') return false;
            const previous = installed.get(api);
            if (previous) {
                if (api.deleteItem !== previous.method && !previous.reported) {
                    previous.reported = true;
                    emit('adapter-replaced'); // Do not enter a patching contest with another plugin.
                }
                return api.deleteItem === previous.method;
            }
            const original = api.deleteItem;
            function wrapped(...args) {
                const receiver = this;
                const operation = ++sequence;
                const user = api.getCurrentUserId?.();
                const token = api.accessToken?.();
                emit('intercepted', operation);
                const pending = queue.then(async () => {
                    if (api.getCurrentUserId?.() !== user || api.accessToken?.() !== token || !contextValid(api)) { emit('context-changed', operation); throw cancelled(); }
                    let warning;
                    try { warning = await check(api, args[0], user); }
                    catch { emit('check-failed', operation); throw cancelled(); }
                    if (api.getCurrentUserId?.() !== user || api.accessToken?.() !== token || !contextValid(api)) throw cancelled();
                    if (warning !== null) {
                        emit('confirmation-opened', operation);
                        let approved;
                        try { approved = await ask(warning); }
                        catch { emit('confirmation-failed', operation); throw cancelled(); }
                        if (approved !== true) { emit('cancelled', operation); throw cancelled(); }
                        emit('override', operation);
                    } else emit('clear', operation);
                    if (api.getCurrentUserId?.() !== user || api.accessToken?.() !== token || !contextValid(api)) { emit('context-changed', operation); throw cancelled(); }
                    emit('native-called', operation);
                    try {
                        const result = await Reflect.apply(original, receiver, args);
                        emit('native-resolved', operation);
                        return result;
                    } catch (error) {
                        emit('native-rejected', operation);
                        throw error; // Keep the exact native rejection, including permission failures.
                    }
                });
                queue = pending.catch(() => {}); // One cancellation must not poison subsequent attempts.
                return pending;
            }
            try { api.deleteItem = wrapped; } catch { emit('installation-failed'); return false; }
            if (api.deleteItem !== wrapped) { emit('installation-failed'); return false; }
            installed.set(api, { method: wrapped, reported: false });
            emit('installed');
            return true;
        }
        return { install, isInstalled: api => !!api && installed.get(api)?.method === api.deleteItem };
    }

    function confirmDeletion(document, text, allowDelete = true, signal) {
        return new Promise((resolve, reject) => {
            const previousFocus = document.activeElement;
            const dialog = document.createElement('dialog');
            dialog.setAttribute('aria-label', 'WatchGuard deletion confirmation');
            dialog.style.cssText = 'max-width:30rem;padding:1.5rem;border:1px solid #888;border-radius:.5rem;background:#202020;color:white;';
            const body = document.createElement('p'); body.textContent = text; body.style.whiteSpace = 'pre-line';
            const cancel = document.createElement('button'); cancel.textContent = 'Cancel';
            const proceed = document.createElement('button'); proceed.textContent = 'Delete Anyway';
            for (const button of [cancel, proceed]) {
                button.type = 'button'; button.className = 'emby-button raised'; button.style.margin = '.3rem';
            }
            let settled = false;
            const finish = approved => {
                if (settled) return;
                settled = true;
                signal?.removeEventListener('abort', abort);
                dialog.remove();
                if (previousFocus?.isConnected) previousFocus.focus();
                resolve(approved);
            };
            const abort = () => finish(false);
            signal?.addEventListener('abort', abort, { once: true });
            cancel.onclick = () => finish(false);
            proceed.onclick = () => finish(true);
            dialog.addEventListener('cancel', event => { event.preventDefault(); finish(false); });
            dialog.addEventListener('close', () => finish(false));
            dialog.append(body, cancel);
            if (allowDelete) dialog.append(proceed);
            if (signal?.aborted) { finish(false); return; }
            try { document.body.append(dialog); dialog.showModal(); cancel.focus(); }
            catch (error) { dialog.remove(); reject(error); }
        });
    }

    const key = id => typeof id === 'string' ? id.replaceAll('-', '').toLowerCase() : '';
    const reasons = { Watchlisted: 'Watchlist', InProgress: 'Watching', CurrentlyPlaying: 'Currently Playing' };
    function describe(users) {
        return users.map(user => user.DisplayName + ' — ' + user.Reasons.map(r => reasons[r]).join(', ')).join('\n');
    }
    function validateStatus(status, id, user) {
        if (!status || key(status.ItemId) !== key(id) || !Array.isArray(status.Users) ||
            typeof status.HasInterest !== 'boolean' || typeof status.HasOtherInterestedUsers !== 'boolean') throw new Error('Invalid status');
        const seen = new Set();
        for (const entry of status.Users) {
            if (!entry || !key(entry.UserId) || seen.has(key(entry.UserId)) || typeof entry.DisplayName !== 'string' ||
                !Array.isArray(entry.Reasons) || !entry.Reasons.length || entry.Reasons.some(r => !Object.hasOwn(reasons, r))) throw new Error('Invalid user');
            seen.add(key(entry.UserId));
        }
        const others = status.Users.filter(u => key(u.UserId) !== key(user));
        if (status.HasInterest !== (status.Users.length > 0) || status.HasOtherInterestedUsers !== (others.length > 0)) throw new Error('Inconsistent status');
        return others;
    }
    function request(api, route, type = 'GET') {
        if (!api.getCurrentUserId() || !api.accessToken()) return Promise.reject(new Error('Not signed in'));
        return api.ajax({ url: api.getUrl('WatchGuard/' + route), type, ...(type === 'GET' ? { dataType: 'json' } : {}) });
    }
    async function protectionCheck(api, id, user) {
        if (!user) throw new Error('Not signed in');
        const item = await api.getItem(user, id);
        if (!item || key(item.Id) !== key(id) || !['Movie', 'Series'].includes(item.Type))
            throw new Error('Unsupported item');
        const status = await request(api, 'Protection/' + encodeURIComponent(id));
        const others = validateStatus(status, id, user);
        return others.length ? message + '\n\n' + describe(others) : null;
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { createAdapter, confirmDeletion, message, protectionCheck, validateStatus, describe };
        return;
    }
    if (root.WatchGuardPoc) return;
    let diagnostic = /*WATCHGUARD_DIAGNOSTICS*/false;
    let identity, panel, signature, epoch = 0;
    let lifetime = new AbortController();
    function syncIdentity() {
        const api = root.ApiClient;
        const next = [api, api?.getCurrentUserId?.(), api?.accessToken?.()];
        if (!identity || next.some((v, i) => v !== identity[i])) {
            lifetime.abort(); lifetime = new AbortController();
            panel?.remove(); panel = null; signature = null; epoch++;
            identity = next;
        }
        return next[1] && next[2] ? api : null;
    }
    const valid = (api, user) => syncIdentity() === api && api.getCurrentUserId() === user;
    const adapter = createAdapter(text => confirmDeletion(document, text, true, lifetime.signal), (event, operation) => {
        if (diagnostic) console.info('[WatchGuard PoC]', event, operation);
    }, async (api, id, user) => {
        try { return await protectionCheck(api, id, user); }
        catch {
            if (valid(api, user)) await confirmDeletion(document,
                'WatchGuard: Interest could not be checked. Deletion was blocked. Only administrators can check supported movies and series. Retry after resolving the problem.', false, lifetime.signal);
            throw new Error('Check unavailable');
        }
    }, api => syncIdentity() === api);
    root.WatchGuardPoc = Object.freeze({
        setDiagnostics: enabled => { diagnostic = enabled === true; },
        isInstalled: () => adapter.isInstalled(root.ApiClient)
    });

    async function updateDetail() {
        const api = syncIdentity();
        const hash = root.location.hash;
        const params = new URLSearchParams(hash.split('?')[1] || '');
        const id = params.get('id');
        const view = document.querySelector('#itemDetailPage:not(.hide)');
        const anchor = view?.querySelector('.detailPagePrimaryContent');
        const route = /^#\/details(?:\?|$)/.test(hash) && id && anchor && api &&
            (!params.get('serverId') || key(params.get('serverId')) === key(api.serverId()));
        const next = route ? hash : null;
        if (signature === next) return;
        signature = next; const revision = ++epoch;
        panel?.remove(); panel = null;
        if (!route) return;
        const user = api.getCurrentUserId();
        const current = () => valid(api, user) && revision === epoch && root.location.hash === hash;
        try {
            const item = await api.getItem(user, id);
            if (!current() || key(item.Id) !== key(id) || !['Movie', 'Series'].includes(item.Type)) return;
            const container = document.createElement('section');
            container.className = 'watchguard-controls'; container.style.margin = '1em 0';
            const toggle = document.createElement('button');
            toggle.type = 'button'; toggle.className = 'emby-button raised'; toggle.disabled = true;
            const icon = document.createElement('span'); icon.className = 'material-icons'; icon.textContent = 'bookmark_add'; icon.setAttribute('aria-hidden', 'true');
            const label = document.createElement('span'); label.textContent = 'Loading Watchlist…';
            toggle.append(icon, label);
            const error = document.createElement('p'); error.setAttribute('role', 'alert');
            const interest = document.createElement('p'); interest.className = 'watchguard-interest'; interest.style.whiteSpace = 'pre-line';
            container.append(toggle, error, interest); anchor.append(container); panel = container;
            let member;
            const render = () => {
                label.textContent = member ? 'Remove from Watchlist' : 'Add to Watchlist';
                icon.textContent = member ? 'bookmark' : 'bookmark_add';
                toggle.setAttribute('aria-pressed', String(member)); toggle.disabled = false;
            };
            async function refreshInterest() {
                const account = await api.getCurrentUser();
                if (!current()) return;
                interest.textContent = '';
                if (account.Policy?.IsAdministrator !== true) return;
                try {
                    const status = await request(api, 'Protection/' + encodeURIComponent(id));
                    validateStatus(status, id, user);
                    if (current()) interest.textContent = describe(status.Users);
                } catch { if (current()) interest.textContent = 'WatchGuard: Interest status unavailable.'; }
            }
            toggle.onclick = async () => {
                if (!current()) return;
                toggle.disabled = true; error.textContent = '';
                try {
                    await request(api, 'Watchlist/' + encodeURIComponent(id), member ? 'DELETE' : 'PUT');
                    if (!current()) return;
                    member = !member; render();
                    try { await refreshInterest(); } catch { if (current()) interest.textContent = 'WatchGuard: Could not verify this account.'; }
                } catch {
                    if (current()) { error.textContent = 'WatchGuard: Could not update your watchlist. Please retry.'; toggle.disabled = false; }
                }
            };
            try {
                const entries = await request(api, 'Watchlist');
                if (!Array.isArray(entries)) throw new Error('Invalid watchlist');
                if (!current()) return;
                member = entries.some(e => key(e.ItemId) === key(id)); render();
            } catch { if (current()) { label.textContent = 'Watchlist unavailable'; error.textContent = 'WatchGuard: Could not load your watchlist. Reopen this page to retry.'; } }
            try { await refreshInterest(); } catch { if (current()) interest.textContent = 'WatchGuard: Could not verify this account.'; }
        } catch { /* Native item lookup failed; do not attach controls to an unverified item. */ }
    }
    const bind = () => { syncIdentity(); adapter.install(root.ApiClient); };
    bind();
    for (const name of ['viewbeforeshow', 'viewshow', 'pointerdown', 'keydown', 'click'])
        document.addEventListener(name, bind, true);
    document.addEventListener('viewshow', () => { signature = null; updateDetail(); }, true);
    root.addEventListener('hashchange', () => updateDetail());
    setInterval(() => { bind(); updateDetail(); }, 500);
})(typeof window === 'undefined' ? globalThis : window);
