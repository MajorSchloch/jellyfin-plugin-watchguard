/* Jellyfin Web 12.2: narrow ApiClient adapter and owned, framework-free UI. */
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
            catch (error) { signal?.removeEventListener('abort', abort); dialog.remove(); reject(error); }
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
    async function resolveScope(api, id, user) {
        if (!user) throw new Error('Not signed in');
        const item = await api.getItem(user, id);
        if (!item || key(item.Id) !== key(id)) throw new Error('Invalid target');
        let scope = item;
        if (['Episode', 'Season'].includes(item.Type)) {
            if (!key(item.SeriesId) || key(item.SeriesId) === key(id)) throw new Error('Missing parent series');
            scope = await api.getItem(user, item.SeriesId);
            if (!scope || scope.Type !== 'Series' || key(scope.Id) !== key(item.SeriesId)) throw new Error('Invalid parent series');
        } else if (!['Movie', 'Series'].includes(item.Type)) throw new Error('Unsupported item');
        return { item, scope };
    }
    async function protectionCheck(api, id, user) {
        const { item, scope } = await resolveScope(api, id, user);
        const status = await request(api, 'Protection/' + encodeURIComponent(scope.Id));
        const others = validateStatus(status, scope.Id, user);
        const target = scope === item ? '' : '\n\nDeleting ' + item.Type.toLowerCase() + ': ' + (item.Name || item.Id) +
            '\nThese users are interested in the parent series: ' + (scope.Name || scope.Id) + '. Interest is series-wide.';
        return others.length ? message + target + '\n\n' + describe(others) : null;
    }

    function selectInterest(entries, owner, user, kind = 'all', sort = 'title') {
        if (!Array.isArray(entries)) throw new Error('Invalid overview');
        const seen = new Set();
        const selected = [];
        for (const entry of entries) {
            if (!entry || !/^[0-9a-f]{32}$/i.test(key(entry.ItemId)) || seen.has(key(entry.ItemId)) || typeof entry.Name !== 'string' || !Array.isArray(entry.Users)) throw new Error('Invalid item');
            seen.add(key(entry.ItemId));
            const owners = new Set();
            for (const u of entry.Users) {
                if (!u || !/^[0-9a-f]{32}$/i.test(key(u.UserId)) || owners.has(key(u.UserId)) || typeof u.DisplayName !== 'string' ||
                    !Array.isArray(u.Reasons) || !u.Reasons.length || u.Reasons.some(r => !Object.hasOwn(reasons, r)) ||
                    (u.LastPlayedDate != null && (typeof u.LastPlayedDate !== 'string' || !Number.isFinite(Date.parse(u.LastPlayedDate))))) throw new Error('Invalid interest');
                owners.add(key(u.UserId));
            }
            const matches = entry.Users.filter(u => (owner === 'all' || key(u.UserId) === key(owner === 'mine' ? user : owner)) &&
                (kind === 'all' || (kind === 'watchlisted' ? u.Reasons.includes('Watchlisted') : u.Reasons.some(r => r === 'InProgress' || r === 'CurrentlyPlaying'))));
            if (matches.length) selected.push({ ...entry, Users: matches,
                IsWatchlistedByMe: entry.Users.some(u => key(u.UserId) === key(user) && u.Reasons.includes('Watchlisted')) });
        }
        const recent = item => Math.max(0, ...item.Users.map(u => u.LastPlayedDate ? Date.parse(u.LastPlayedDate) : 0));
        return selected.sort((a, b) => (sort === 'recent' ? recent(b) - recent(a) : 0) || a.Name.localeCompare(b.Name) || a.ItemId.localeCompare(b.ItemId));
    }

    function watchlistsPage(document, api, signal, filter, navigate, options = {}) {
        const kind = ['all', 'watchlisted', 'watching'].includes(options.interest) ? options.interest : 'all';
        const sort = options.sort === 'recent' ? 'recent' : 'title';
        const page = document.createElement('section'); page.className = 'watchguard-page padded-left padded-right';
        page.setAttribute('role', 'region'); page.setAttribute('aria-label', 'Watchlists');
        const heading = document.createElement('h1'); heading.className = 'sectionTitle'; heading.textContent = 'Watchlists';
        const toolbar = document.createElement('div'); toolbar.className = 'watchguard-toolbar';
        function dropdown(label, choices) {
            const select = document.createElement('select'); select.className = 'emby-select emby-select-withcolor'; select.setAttribute('aria-label', label);
            for (const [value, text, disabled] of choices) {
                const option = document.createElement('option'); option.value = value; option.textContent = text; option.disabled = !!disabled; select.append(option);
            }
            return select;
        }
        const select = dropdown('Watchlist owner', []); select.hidden = true;
        const interestFilter = dropdown('Interest filter', [['all', 'All interest'], ['watchlisted', 'Watchlisted'], ['watching', 'Watching']]); interestFilter.value = kind;
        const order = dropdown('Sort by', [['title', 'Title'], ['recent', 'Playback recency'], ['added', 'Watchlist date — not recorded', true]]); order.value = sort;
        order.title = 'Playback recency uses available native dates; unknown dates sort last. Watchlist add dates are not stored.';
        const refresh = document.createElement('button'); refresh.className = 'emby-button button-flat watchguard-refresh'; refresh.type = 'button'; refresh.title = 'Refresh'; refresh.setAttribute('aria-label', 'Refresh');
        const refreshIcon = document.createElement('span'); refreshIcon.className = 'material-icons'; refreshIcon.textContent = 'refresh'; refreshIcon.setAttribute('aria-hidden', 'true'); refresh.append(refreshIcon);
        toolbar.append(select, interestFilter, order, refresh);
        const status = document.createElement('p'); status.setAttribute('role', 'status');
        const notice = document.createElement('p'); notice.className = 'watchguard-notice secondaryText';
        const error = document.createElement('p'); error.setAttribute('role', 'alert');
        const grid = document.createElement('div'); grid.className = 'watchguard-grid';
        page.append(heading, toolbar, status, notice, error, grid);
        const user = api.getCurrentUserId(), token = api.accessToken();
        const active = () => !signal.aborted && api.getCurrentUserId() === user && api.accessToken() === token;
        let generation = 0;
        signal.addEventListener('abort', () => page.remove(), { once: true });
        async function load() {
            const revision = ++generation;
            const current = () => active() && revision === generation;
            if (!current()) return;
            grid.replaceChildren(); select.hidden = true; error.textContent = ''; status.textContent = 'Loading watchlists…'; refresh.disabled = true; interestFilter.disabled = true; order.disabled = true;
            try {
                const account = await api.getCurrentUser();
                if (!current()) return;
                const admin = account.Policy?.IsAdministrator === true;
                const result = await request(api, admin ? 'InterestOverview' : 'InterestOverview/Me');
                if (!current()) return;
                if (!result || result.IsComplete !== false || typeof result.LimitReached !== 'boolean' || typeof result.Notice !== 'string') throw new Error('Invalid coverage');
                const entries = result.Items;
                const selected = selectInterest(entries, admin ? filter : 'mine', user, kind, sort);
                // Reject accidental cross-user payloads even though the personal endpoint enforces isolation.
                if (!admin && entries.some(e => e.Users.some(u => key(u.UserId) !== key(user)))) throw new Error('Invalid account scope');
                notice.textContent = result.Notice; interestFilter.disabled = false; order.disabled = false;
                select.replaceChildren();
                const owners = new Map(entries.flatMap(entry => entry.Users).map(owner => [key(owner.UserId), owner]));
                const choices = [['mine', 'My list'], ...(admin ? [['all', 'All users'], ...Array.from(owners.values())
                    .sort((a, b) => a.DisplayName.localeCompare(b.DisplayName)).map(owner => [key(owner.UserId), owner.DisplayName])] : [])];
                for (const [value, name] of choices) {
                    const option = document.createElement('option'); option.value = value; option.textContent = name; select.append(option);
                }
                select.value = admin ? filter : 'mine'; select.hidden = !admin;
                if (admin && !choices.some(([value]) => value === filter)) {
                    const option = document.createElement('option'); option.value = filter; option.textContent = 'Unavailable user'; select.append(option); select.value = filter;
                }
                status.textContent = selected.length ? '' : 'No matching interest in this overview.';
                for (const entry of selected) {
                    const card = document.createElement('article'); card.className = 'watchguard-card';
                    const link = document.createElement('a'); link.className = 'button-link';
                    link.href = '#/details?id=' + encodeURIComponent(entry.ItemId) + '&serverId=' + encodeURIComponent(api.serverId());
                    const image = document.createElement('img'); image.alt = ''; image.loading = 'lazy';
                    image.src = api.getImageUrl(entry.ItemId, { type: 'Primary', maxWidth: 360, quality: 90 });
                    image.onerror = () => { image.hidden = true; };
                    const poster = document.createElement('div'); poster.className = 'watchguard-poster';
                    const fallback = document.createElement('span'); fallback.className = 'material-icons'; fallback.textContent = 'movie'; fallback.setAttribute('aria-hidden', 'true');
                    poster.append(fallback, image);
                    const name = document.createElement('div'); name.className = 'cardText'; name.textContent = entry.Name;
                    link.append(poster, name); card.append(link);
                    const ownersText = document.createElement('div'); ownersText.className = 'watchguard-status secondaryText';
                    if (admin) ownersText.classList.add('watchguard-owners');
                    for (const owner of entry.Users) {
                        const line = document.createElement('div');
                        line.textContent = (admin ? owner.DisplayName + ' — ' : '') + owner.Reasons.map(r => reasons[r]).join(' · '); ownersText.append(line);
                    }
                    card.append(ownersText);
                    if (entry.IsWatchlistedByMe) {
                        const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'emby-button button-flat watchguard-remove';
                        const icon = document.createElement('span'); icon.className = 'material-icons'; icon.textContent = 'bookmark_remove'; icon.setAttribute('aria-hidden', 'true'); remove.append(icon);
                        remove.title = 'Remove from Watchlist'; remove.setAttribute('aria-label', 'Remove ' + entry.Name + ' from Watchlist');
                        remove.onclick = async () => {
                            if (!current()) return;
                            remove.disabled = true; error.textContent = '';
                            try { await request(api, 'Watchlist/' + encodeURIComponent(entry.ItemId), 'DELETE'); if (current()) await load(); }
                            catch { if (current()) { error.textContent = 'WatchGuard: Could not remove this entry. Please retry.'; remove.disabled = false; } }
                        };
                        card.append(remove);
                    }
                    grid.append(card);
                }
            } catch { if (current()) { grid.replaceChildren(); select.hidden = true; notice.textContent = ''; status.textContent = ''; error.textContent = 'WatchGuard: Could not load watchlists. Please refresh to retry.'; } }
            finally { if (current()) refresh.disabled = false; }
        }
        const change = () => { if (active()) navigate(select.value || 'mine', interestFilter.value, order.value); };
        select.onchange = change; interestFilter.onchange = change; order.onchange = change;
        refresh.onclick = load;
        if (!signal.aborted) load();
        return page;
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { createAdapter, confirmDeletion, message, protectionCheck, validateStatus, describe, resolveScope, selectInterest, watchlistsPage };
        return;
    }
    if (root.WatchGuardPoc) return;
    let diagnostic = /*WATCHGUARD_DIAGNOSTICS*/false;
    let identity, panel, detailButton, signature, epoch = 0;
    let navigation, pagePanel, pageSignature, pageLifetime;
    let lifetime = new AbortController();
    function syncIdentity() {
        const api = root.ApiClient;
        const next = [api, api?.getCurrentUserId?.(), api?.accessToken?.()];
        if (!identity || next.some((v, i) => v !== identity[i])) {
            lifetime.abort(); lifetime = new AbortController();
            panel?.remove(); detailButton?.remove(); panel = null; signature = null; epoch++;
            navigation?.remove(); navigation = null; closePage();
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
                'WatchGuard: Interest could not be checked. Deletion was blocked. An administrator must be able to check this movie, series, or the parent series of this episode/season. Other deletion types are unsupported. Retry after resolving the problem.', false, lifetime.signal);
            throw new Error('Check unavailable');
        }
    }, api => syncIdentity() === api);
    root.WatchGuardPoc = Object.freeze({
        setDiagnostics: enabled => { diagnostic = enabled === true; },
        isInstalled: () => adapter.isInstalled(root.ApiClient)
    });

    const style = document.createElement('style');
    style.textContent = `
        .watchguard-nav {display:inline-flex;align-items:center;gap:.35em;white-space:nowrap;text-decoration:none;padding:.5em .7em;color:inherit;border-radius:4px;box-sizing:border-box}
        .watchguard-nav:hover {background:rgba(128,128,128,.2)}
        .watchguard-nav[aria-current="page"] {color:#00a4dc}
        .watchguard-nav .material-icons {font-size:1.25em}
        body.watchguard-page-open .skinBody {display:none!important}
        .watchguard-page {position:fixed;inset:var(--watchguard-top,64px) 0 0;overflow:auto;background:var(--jf-palette-background-default,#101010);z-index:10;padding-bottom:5em;box-sizing:border-box}
        .watchguard-page [hidden] {display:none!important}
        .watchguard-page select {width:auto;min-width:9em;max-width:100%;appearance:auto}
        .watchguard-toolbar {display:flex;align-items:center;gap:.8em;flex-wrap:wrap;margin:1.2em 0}
        .watchguard-refresh {margin-inline-start:auto;padding:.6em}
        .watchguard-notice {font-size:.85em;margin-bottom:1.5em}
        .watchguard-grid {display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:1.5em 1em;margin:1em 0;align-items:start}
        .watchguard-card {position:relative;min-width:0}
        .watchguard-remove {position:absolute;top:.3em;right:.3em;background:rgba(0,0,0,.75);border-radius:50%;padding:.5em;color:white}
        @media(max-width:480px) {.watchguard-grid {grid-template-columns:repeat(2,minmax(0,1fr))}.watchguard-toolbar {gap:.5em}.watchguard-page select {min-width:0;max-width:100%}}
        .watchguard-card a {display:block;color:inherit;text-decoration:none}
        .watchguard-poster {position:relative;aspect-ratio:2/3;background:#292929;display:flex;align-items:center;justify-content:center;border-radius:.25em;overflow:hidden}
        .watchguard-poster>.material-icons {font-size:3em;color:#999}
        .watchguard-poster img {position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
        .watchguard-card a:hover .watchguard-poster {box-shadow:0 0 0 2px #00a4dc}
        .watchguard-card .cardText,.watchguard-status {padding-top:.5em;overflow-wrap:anywhere}
        .watchguard-status {font-size:.8em;line-height:1.5}
        .watchguard-controls {display:inline-flex;position:relative;align-items:center}
        .watchguard-count {position:relative;z-index:2;border:0;border-radius:1em;background:var(--jf-palette-primary-main,#0086b3);color:white;min-width:1.5em;padding:.15em .4em;margin-inline-start:0;margin-inline-end:.4em;cursor:pointer;font:inherit;font-size:.7em;align-self:flex-start;margin-top:.7em}
        .watchguard-controls [hidden] {display:none!important}
        .watchguard-interest {position:fixed;inset:auto;margin:0;max-width:min(26rem,85vw);max-height:50vh;overflow:auto;padding:1em;border:1px solid #666;border-radius:.4em;background:var(--jf-palette-background-paper,#202020);color:var(--jf-palette-text-primary,#ddd);font-size:.9em;white-space:pre-line}
        .watchguard-error {position:absolute;top:100%;min-width:16rem;color:#ffb4ab;font-size:.85em}
        .watchguard-error:empty {display:none}
        .watchguard-sr-only {position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
    `;
    document.head.append(style);
    function closePage() {
        pageLifetime?.abort(); pageLifetime = null; pagePanel?.remove(); pagePanel = null; pageSignature = null;
        document.body.classList.remove('watchguard-page-open');
    }
    function updateNavigation() {
        const api = syncIdentity();
        const hash = root.location.hash;
        // Never add a user-content entry to dashboard, login, video or setup screens.
        const eligible = api && /^#\/(?:home|details|movies|tv|list|search|music|livetv)(?:[/?]|$)/.test(hash);
        if (!eligible) { navigation?.remove(); navigation = null; closePage(); return; }
        const visible = element => element && element.getClientRects().length > 0;
        const favorite = Array.from(document.querySelectorAll('a[href="#/home?tab=1"]')).find(visible);
        const legacy = document.querySelector('.skinHeader');
        const toolbar = favorite?.parentElement || (visible(legacy) ? legacy.querySelector('.headerLeft') : document.querySelector('header .MuiToolbar-root'));
        if (toolbar && (!navigation?.isConnected || navigation.parentElement !== toolbar)) {
            navigation?.remove(); navigation = document.createElement('a');
            navigation.className = (favorite?.className || 'emby-button button-flat') + ' watchguard-nav';
            navigation.href = '#/home?watchguard=watchlists';
            const icon = document.createElement('span'); icon.className = 'material-icons'; icon.textContent = 'bookmarks'; icon.setAttribute('aria-hidden', 'true');
            const text = document.createElement('span'); text.textContent = 'Watchlists'; navigation.append(icon, text);
            // One owned link only: never replace or reorder Jellyfin's React nodes or legacy tabs.
            toolbar.append(navigation);
        }
        const params = new URLSearchParams(hash.split('?')[1] || '');
        const open = /^#\/home(?:\?|$)/.test(hash) && params.get('watchguard') === 'watchlists';
        navigation?.setAttribute('aria-current', open ? 'page' : 'false');
        if (!open) { closePage(); return; }
        const header = visible(legacy) ? legacy : document.querySelector('header.MuiAppBar-root');
        if (header) document.body.style.setProperty('--watchguard-top', Math.max(0, header.getBoundingClientRect().bottom) + 'px');
        if (pageSignature === hash && pagePanel?.isConnected) return;
        closePage(); pageSignature = hash;
        pageLifetime = new AbortController();
        pagePanel = watchlistsPage(document, api, pageLifetime.signal, params.get('owner') || 'mine', (owner, interest, sort) => {
            root.location.hash = '/home?watchguard=watchlists&owner=' + encodeURIComponent(owner) + '&interest=' + encodeURIComponent(interest) + '&sort=' + encodeURIComponent(sort);
        }, {interest: params.get('interest'), sort: params.get('sort')});
        document.body.classList.add('watchguard-page-open'); document.body.append(pagePanel);
    }

    async function updateDetail() {
        const api = syncIdentity();
        const hash = root.location.hash;
        const params = new URLSearchParams(hash.split('?')[1] || '');
        const id = params.get('id');
        const view = document.querySelector('#itemDetailPage:not(.hide)');
        const anchor = view?.querySelector('.mainDetailButtons');
        const route = /^#\/details(?:\?|$)/.test(hash) && id && anchor && api &&
            (!params.get('serverId') || key(params.get('serverId')) === key(api.serverId()));
        const next = route ? hash : null;
        if (signature === next) return;
        signature = next; const revision = ++epoch;
        panel?.remove(); detailButton?.remove(); panel = null;
        if (!route) return;
        const user = api.getCurrentUserId();
        const current = () => valid(api, user) && revision === epoch && root.location.hash === hash;
        try {
            const { item, scope } = await resolveScope(api, id, user);
            if (!current()) return;
            const seriesLabel = scope === item ? '' : 'Series: ' + (scope.Name || scope.Id) + '. ';
            const scopeId = scope.Id;
            const container = document.createElement('section');
            container.className = 'watchguard-controls';
            const toggle = document.createElement('button');
            toggle.type = 'button'; toggle.className = 'emby-button button-flat detailButton watchguard-toggle'; toggle.disabled = true;
            const icon = document.createElement('span'); icon.className = 'material-icons detailButton-icon'; icon.textContent = 'bookmark_add'; icon.setAttribute('aria-hidden', 'true');
            const label = document.createElement('span'); label.className = 'watchguard-sr-only'; label.textContent = 'Loading Watchlist…';
            const content = document.createElement('div'); content.className = 'detailButton-content'; content.append(icon, label); toggle.append(content);
            const error = document.createElement('span'); error.className = 'watchguard-error'; error.setAttribute('role', 'alert');
            const interest = document.createElement('div'); interest.className = 'watchguard-interest'; interest.setAttribute('popover', 'auto'); interest.setAttribute('role', 'dialog'); interest.setAttribute('aria-label', 'Title interest');
            const count = document.createElement('button'); count.type = 'button'; count.className = 'watchguard-count'; count.hidden = true;
            count.setAttribute('aria-haspopup', 'dialog'); count.setAttribute('aria-expanded', 'false');
            count.onclick = () => {
                if (!current()) return;
                if (interest.matches(':popover-open')) interest.hidePopover();
                else {
                    const bounds = count.getBoundingClientRect();
                    interest.style.left = Math.max(8, Math.min(bounds.left, root.innerWidth - 340)) + 'px';
                    interest.style.top = Math.min(bounds.bottom + 8, root.innerHeight - 180) + 'px';
                    interest.showPopover();
                }
            };
            interest.addEventListener('toggle', () => count.setAttribute('aria-expanded', String(interest.matches(':popover-open'))));
            container.append(toggle, count, error, interest); anchor.insertBefore(container, anchor.querySelector('.btnMoreCommands')); panel = container; detailButton = toggle;
            let member;
            const render = () => {
                label.textContent = member ? 'Remove from Watchlist' : 'Add to Watchlist';
                toggle.title = seriesLabel + label.textContent;
                icon.textContent = member ? 'bookmark' : 'bookmark_add';
                toggle.setAttribute('aria-pressed', String(member)); toggle.disabled = false;
            };
            async function refreshInterest() {
                const account = await api.getCurrentUser();
                if (!current()) return;
                interest.textContent = ''; count.hidden = true;
                if (account.Policy?.IsAdministrator !== true) return;
                try {
                    const status = await request(api, 'Protection/' + encodeURIComponent(scopeId));
                    validateStatus(status, scopeId, user);
                    if (current()) {
                        interest.textContent = seriesLabel + (describe(status.Users) || 'No current interest.');
                        count.textContent = String(status.Users.length); count.hidden = false;
                        count.title = seriesLabel + 'Interested users: ' + status.Users.length;
                        count.setAttribute('aria-label', 'Show interested users (' + status.Users.length + ')');
                    }
                } catch { if (current()) {
                    interest.textContent = 'WatchGuard: Interest status unavailable.'; count.textContent = '!'; count.hidden = false;
                    count.setAttribute('aria-label', 'Interest status unavailable'); count.title = interest.textContent;
                } }
            }
            toggle.onclick = async () => {
                if (!current()) return;
                toggle.disabled = true; error.textContent = '';
                try {
                    await request(api, 'Watchlist/' + encodeURIComponent(scopeId), member ? 'DELETE' : 'PUT');
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
                member = entries.some(e => key(e.ItemId) === key(scopeId)); render();
            } catch { if (current()) { label.textContent = 'Watchlist unavailable'; error.textContent = 'WatchGuard: Could not load your watchlist. Reopen this page to retry.'; } }
            try { await refreshInterest(); } catch { if (current()) interest.textContent = 'WatchGuard: Could not verify this account.'; }
        } catch { /* Native item lookup failed; do not attach controls to an unverified item. */ }
    }
    const bind = () => { syncIdentity(); adapter.install(root.ApiClient); };
    bind();
    for (const name of ['viewbeforeshow', 'viewshow', 'pointerdown', 'keydown', 'click'])
        document.addEventListener(name, bind, true);
    document.addEventListener('viewshow', () => { signature = null; updateDetail(); }, true);
    root.addEventListener('hashchange', () => { updateNavigation(); updateDetail(); });
    setInterval(() => { bind(); updateNavigation(); updateDetail(); }, 500);
})(typeof window === 'undefined' ? globalThis : window);
