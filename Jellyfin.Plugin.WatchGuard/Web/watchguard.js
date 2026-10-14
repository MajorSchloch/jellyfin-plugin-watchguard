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

    const openDeletionDialogs = new WeakSet();
    function confirmDeletion(document, warning, allowDelete = true, signal) {
        if (openDeletionDialogs.has(document)) return Promise.reject(new Error('Confirmation already open'));
        return new Promise((resolve, reject) => {
            const previousFocus = document.activeElement;
            const dialog = document.createElement('dialog');
            dialog.className = 'watchguard-deletion-dialog';
            dialog.setAttribute('aria-labelledby', 'watchguard-delete-title');
            dialog.setAttribute('aria-describedby', 'watchguard-delete-description');
            dialog.style.cssText = 'box-sizing:border-box;width:calc(100% - 2rem);max-width:38rem;max-height:calc(100dvh - 2rem);padding:0;border:1px solid #555;border-radius:.5rem;background:#202020;color:#eee;font:inherit;overflow:auto;';
            const node = (tag, text, className = '') => {
                const element = document.createElement(tag); element.textContent = text; element.className = className; return element;
            };
            const content = node('div', '', 'watchguard-dialog-content');
            content.style.cssText = 'padding:1.5rem;overflow-wrap:anywhere;';
            const title = node('h2', 'WatchGuard deletion confirmation'); title.id = 'watchguard-delete-title';
            title.style.cssText = 'font-size:1.35em;line-height:1.3;margin:0 0 1rem;';
            const description = node('p', typeof warning === 'string' ? warning :
                'Deleting removes this media from the library and deletes its files. Other people may lose access. This cannot be undone here.');
            description.id = 'watchguard-delete-description'; description.style.cssText = 'line-height:1.5;margin:0 0 1rem;color:#ccc;white-space:pre-line;';
            content.append(title);
            if (typeof warning !== 'string') {
                const target = node('section', '', 'watchguard-dialog-target');
                const kind = node('div', 'Deleting ' + warning.item.Type.toLowerCase()); kind.style.cssText = 'font-size:.85em;color:#bbb;';
                const name = node('div', warning.item.Name || warning.item.Id); name.style.cssText = 'font-size:1.2em;font-weight:600;line-height:1.4;margin:.3rem 0;';
                target.append(kind, name);
                if (warning.item.Type === 'Episode' && Number.isInteger(warning.item.IndexNumber)) {
                    target.append(node('div', (Number.isInteger(warning.item.ParentIndexNumber) ? 'Season ' + warning.item.ParentIndexNumber + ' · ' : '') + 'Episode ' + warning.item.IndexNumber));
                }
                if (warning.parentName) {
                    const parent = node('p', 'Interest is for the parent series: ' + warning.parentName + '. Protection is series-wide.');
                    parent.style.cssText = 'color:#ccc;line-height:1.4;'; target.append(parent);
                }
                target.style.cssText = 'border-left:.2rem solid #f0b35a;padding:.25rem .8rem;margin-bottom:1rem;';
                content.append(target);
            }
            content.append(description);
            if (typeof warning !== 'string') {
                const labels = { Watchlisted: 'Watchlisted', InProgress: 'Watching', CurrentlyPlaying: 'Currently Playing', CaughtUp: 'Caught Up' };
                for (const self of [true, false]) {
                    const people = warning.users.filter(u => (key(u.UserId) === key(warning.user)) === self);
                    if (!people.length) continue;
                    const heading = node('h3', self ? 'Your interest' : 'Other people’s interest');
                    heading.style.cssText = 'font-size:1em;margin:1.2rem 0 .5rem;';
                    const list = node('ul', '', 'watchguard-dialog-people'); list.style.cssText = 'list-style:none;margin:0;padding:0;';
                    for (const person of people) {
                        const row = node('li', '', 'watchguard-dialog-person'); row.style.cssText = 'padding:.85rem;margin:.5rem 0;border:1px solid #444;border-radius:.65rem;line-height:1.5;background:#ffffff04;';
                        const name = node('strong', self ? 'You · ' + person.DisplayName : person.DisplayName); name.style.display = 'block'; row.append(name);
                        const statuses = node('div', '', 'watchguard-dialog-reasons'); statuses.style.cssText = 'display:flex;flex-wrap:wrap;gap:.35rem;margin-top:.35rem;';
                        for (const reason of new Set(person.Reasons)) {
                            const badge = node('span', labels[reason], 'watchguard-chip watchguard-state-' + reason); statuses.append(badge);
                        }
                        row.append(statuses);
                        if (self) {
                            const detail = node('p', person.Reasons.map(reason => ({
                                CaughtUp: 'You are caught up and waiting for new episodes.',
                                Watchlisted: 'This title is on your watchlist.',
                                InProgress: "You haven't finished watching this title.",
                                CurrentlyPlaying: 'You are currently playing this title.'
                            })[reason]).join(' ')); detail.style.cssText = 'font-size:.9em;color:#ccc;margin:.5rem 0 0;'; row.append(detail);
                        }
                        list.append(row);
                    }
                    content.append(heading, list);
                }
            }
            const actions = node('div', '', 'watchguard-dialog-actions');
            actions.style.cssText = 'display:flex;flex-wrap:wrap;justify-content:flex-end;gap:.5rem;padding:1rem 1.5rem;border-top:1px solid #444;background:#202020;position:sticky;bottom:0;';
            const cancel = node('button', 'Cancel');
            const proceed = node('button', 'Delete Anyway');
            for (const button of [cancel, proceed]) {
                button.type = 'button'; button.className = 'emby-button raised'; button.style.cssText = 'min-height:2.75rem;margin:0;padding:.65rem 1.1rem;';
            }
            cancel.setAttribute('autofocus', '');
            proceed.style.color = '#ffb4ab';
            let settled = false;
            const finish = approved => {
                if (settled) return;
                settled = true;
                signal?.removeEventListener('abort', abort);
                openDeletionDialogs.delete(document);
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
            // Native modal inertness does not prevent Tab from reaching browser chrome.
            // Keep keyboard traversal within this dialog's two explicit actions.
            dialog.addEventListener('keydown', event => {
                if (event.key !== 'Tab') return;
                event.preventDefault(); event.stopPropagation();
                const buttons = allowDelete ? [cancel, proceed] : [cancel];
                const current = buttons.indexOf(document.activeElement);
                buttons[current < 0 ? 0 : (current + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length].focus();
            });
            actions.append(cancel);
            if (allowDelete) actions.append(proceed);
            dialog.append(content, actions);
            if (signal?.aborted) { finish(false); return; }
            try { openDeletionDialogs.add(document); document.body.append(dialog); dialog.showModal(); cancel.focus(); }
            catch (error) { signal?.removeEventListener('abort', abort); openDeletionDialogs.delete(document); dialog.remove(); reject(error); }
        });
    }

    const key = id => typeof id === 'string' ? id.replaceAll('-', '').toLowerCase() : '';
    function renderSeriesActivity(document, target, status, itemId, user, seriesLabel = '') {
        if (!status || key(status.ItemId) !== key(itemId) || !Array.isArray(status.Users) ||
            typeof status.IsComplete !== 'boolean' || typeof status.Notice !== 'string') throw new Error('Invalid series activity');
        const labels = { Watchlisted: 'Watchlisted', InProgress: 'Watching', CurrentlyPlaying: 'Currently Playing', CaughtUp: 'Caught Up', Watched: 'Watched', Unknown: 'Unknown' };
        const seen = new Set();
        for (const owner of status.Users) {
            if (!owner || !key(owner.UserId) || seen.has(key(owner.UserId)) || typeof owner.DisplayName !== 'string' ||
                !Array.isArray(owner.Reasons) || !owner.Reasons.length || owner.Reasons.some(r => !Object.hasOwn(labels, r)) ||
                typeof owner.CoverageComplete !== 'boolean' || !Number.isInteger(owner.AvailableEpisodes) || !Number.isInteger(owner.WatchedEpisodes) ||
                owner.WatchedEpisodes < 0 || owner.AvailableEpisodes < owner.WatchedEpisodes) throw new Error('Invalid series activity user');
            seen.add(key(owner.UserId));
        }
        target.replaceChildren();
        const panel = document.createElement('details'); panel.className = 'watchguard-series-activity';
        const summary = document.createElement('summary');
        const heading = document.createElement('span'); heading.className = 'watchguard-activity-heading';
        heading.textContent = seriesLabel || 'Series viewing'; summary.append(heading);
        let hasCounts = false;
        for (const [reason, label] of Object.entries(labels)) {
            const count = status.Users.filter(u => u.Reasons.includes(reason)).length;
            if (!count) continue;
            const chip = document.createElement('span'); chip.className = 'watchguard-chip watchguard-state-' + reason;
            chip.textContent = count + ' ' + label; summary.append(chip); hasCounts = true;
        }
        if (!hasCounts || !status.IsComplete) {
            const note = document.createElement('span'); note.className = 'watchguard-coverage';
            note.textContent = status.IsComplete ? 'No recorded activity' : 'Incomplete'; summary.append(note);
        }
        panel.append(summary);
        const list = document.createElement('ul'); list.className = 'watchguard-series-viewers';
        const active = owner => owner.Reasons.includes('CurrentlyPlaying') ? 3 : owner.Reasons.some(r => ['InProgress', 'CaughtUp'].includes(r)) ? 2 : owner.Reasons.includes('Watchlisted') ? 1 : 0;
        for (const owner of [...status.Users].sort((a,b) => active(b) - active(a) || (Date.parse(b.LastPlayedDate) || 0) - (Date.parse(a.LastPlayedDate) || 0) || a.DisplayName.localeCompare(b.DisplayName))) {
            const row = document.createElement('li');
            const name = document.createElement('strong'); name.textContent = (key(owner.UserId) === key(user) ? 'You · ' : '') + owner.DisplayName;
            name.className = 'watchguard-viewer-name';
            const detail = document.createElement('div'); detail.className = 'watchguard-viewer-states';
            for (const reason of new Set(owner.Reasons)) {
                const chip = document.createElement('span'); chip.className = 'watchguard-chip watchguard-state-' + reason;
                chip.textContent = labels[reason]; detail.append(chip);
            }
            const metrics = document.createElement('div'); metrics.className = 'watchguard-viewer-metrics';
            const count = document.createElement('span');
            count.textContent = owner.WatchedEpisodes + '/' + owner.AvailableEpisodes + ' episodes' + (owner.CoverageComplete ? '' : ' (incomplete coverage)');
            metrics.append(count);
            if (owner.CoverageComplete && owner.AvailableEpisodes > 0) {
                const progress = document.createElement('progress'); progress.max = owner.AvailableEpisodes; progress.value = owner.WatchedEpisodes;
                progress.className = 'watchguard-viewer-progress watchguard-state-' + (owner.Reasons.includes('CaughtUp') ? 'CaughtUp' : owner.Reasons.includes('Watched') ? 'Watched' : 'InProgress');
                progress.setAttribute('aria-label', owner.DisplayName + ': ' + count.textContent); metrics.append(progress);
            }
            row.append(name, detail, metrics);
            const date = new Date(owner.LastPlayedDate);
            if (owner.LastPlayedDate && !Number.isNaN(date.getTime())) {
                const time = document.createElement('time'); time.dateTime = date.toISOString(); time.title = date.toLocaleString();
                time.textContent = 'Last watched ' + date.toLocaleDateString(); row.append(time);
            }
            list.append(row);
        }
        panel.append(list);
        const notice = document.createElement('small'); notice.className = 'watchguard-coverage';
        notice.textContent = !status.IsComplete ? 'Some activity could not be evaluated.' : status.Users.some(u => !u.CoverageComplete) ? 'Some episode coverage is incomplete.' : 'Based on episodes known to Jellyfin.';
        notice.title = status.Notice; notice.setAttribute('aria-label', status.Notice); notice.tabIndex = 0; panel.append(notice);
        target.append(panel);
    }

    const reasons = { Watchlisted: 'Watchlist', InProgress: 'Watching', CurrentlyPlaying: 'Currently Playing', CaughtUp: 'Caught Up' };
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
        return status.Users;
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
        const interested = validateStatus(status, scope.Id, user);
        // Structured, validated presentation data only; the gate and request count are unchanged.
        return interested.length ? { item: { Id: item.Id, Name: item.Name, Type: item.Type,
            IndexNumber: item.IndexNumber, ParentIndexNumber: item.ParentIndexNumber },
            parentName: scope === item ? null : (scope.Name || scope.Id), users: interested, user } : null;
    }

    // History is an overview-only status. Never add it to protection's reason allowlist.
    const activityReasons = { ...reasons, Watched: 'Watched', CaughtUp: 'Caught Up' };
    const activityFilters = { watchlisted: 'Watchlisted', watching: 'InProgress', playing: 'CurrentlyPlaying', watched: 'Watched' };
    const defaultFilters = ['watchlisted', 'watching', 'playing'];
    function selectedStatuses(value) {
        if (value == null) return [...defaultFilters];
        if (value === 'all') return Object.keys(activityFilters); // Existing bookmarked URLs.
        if (value === 'none') return [];
        const requested = Array.isArray(value) ? value : String(value).split(',');
        const selected = Object.keys(activityFilters).filter(k => requested.includes(k));
        return selected.length || !requested.length ? selected : [...defaultFilters];
    }
    const statusIcons = { Watchlisted: 'bookmark', InProgress: 'play_circle', CurrentlyPlaying: 'sensors', Watched: 'check_circle', CaughtUp: 'task_alt' };
    function userLine(document, owner) {
        const line = document.createElement('span'); line.className = 'watchguard-user-line';
        line.title = activityText(owner, true);
        const icons = document.createElement('span'); icons.className = 'watchguard-status-icons';
        for (const reason of Object.keys(activityReasons).filter(r => owner.Reasons.includes(r))) {
            const icon = document.createElement('span'); icon.className = 'material-icons watchguard-state-' + reason; icon.textContent = statusIcons[reason];
            icon.setAttribute('role', 'img'); icon.setAttribute('aria-label', activityReasons[reason]); icon.title = activityReasons[reason]; icons.append(icon);
        }
        const name = document.createElement('span'); name.className = 'watchguard-user'; name.textContent = owner.DisplayName; name.title = owner.DisplayName;
        line.append(icons, name);
        if (owner.AvailableEpisodes != null) {
            const progress = document.createElement('span'); progress.className = 'watchguard-progress';
            progress.textContent = ' · ' + owner.WatchedEpisodes + '/' + owner.AvailableEpisodes;
            progress.title = owner.WatchedEpisodes + ' of ' + owner.AvailableEpisodes + ' episodes'; line.append(progress);
        }
        if (owner.LastPlayedDate && owner.Reasons.some(r => r === 'InProgress' || r === 'Watched' || r === 'CaughtUp')) {
            const date = document.createElement('time'); date.dateTime = owner.LastPlayedDate; date.tabIndex = 0;
            date.textContent = new Intl.DateTimeFormat(undefined, {dateStyle: 'medium'}).format(new Date(owner.LastPlayedDate));
            date.title = 'Last played: ' + new Intl.DateTimeFormat(undefined, {dateStyle: 'full', timeStyle: 'long'}).format(new Date(owner.LastPlayedDate));
            date.setAttribute('aria-label', date.title); line.append(date);
        }
        return line;
    }
    function activityText(owner, showName) {
        let text = (showName ? owner.DisplayName + ' — ' : '') + owner.Reasons.map(r => activityReasons[r] + (r === 'CurrentlyPlaying' ? ' ●' : '')).join(' · ');
        if (owner.AvailableEpisodes != null) text += ' · ' + owner.WatchedEpisodes + '/' + owner.AvailableEpisodes + ' episodes';
        if (owner.LastPlayedDate && owner.Reasons.some(r => r === 'InProgress' || r === 'Watched' || r === 'CaughtUp'))
            text += ' · Last played: ' + new Intl.DateTimeFormat(undefined, {dateStyle: 'medium', timeStyle: 'short'}).format(new Date(owner.LastPlayedDate));
        return text;
    }

    function selectInterest(entries, owner, user, kind, sort = 'title') {
        const statuses = selectedStatuses(kind);
        if (!Array.isArray(entries)) throw new Error('Invalid overview');
        const seen = new Set();
        const selected = [];
        for (const entry of entries) {
            if (!entry || !/^[0-9a-f]{32}$/i.test(key(entry.ItemId)) || seen.has(key(entry.ItemId)) || typeof entry.Name !== 'string' || !Array.isArray(entry.Users)) throw new Error('Invalid item');
            seen.add(key(entry.ItemId));
            const owners = new Set();
            for (const u of entry.Users) {
                if (!u || !/^[0-9a-f]{32}$/i.test(key(u.UserId)) || owners.has(key(u.UserId)) || typeof u.DisplayName !== 'string' ||
                    !Array.isArray(u.Reasons) || !u.Reasons.length || u.Reasons.some(r => !Object.hasOwn(activityReasons, r)) ||
                    (u.LastPlayedDate != null && (typeof u.LastPlayedDate !== 'string' || !Number.isFinite(Date.parse(u.LastPlayedDate))))) throw new Error('Invalid interest');
                if ((u.AvailableEpisodes == null) !== (u.WatchedEpisodes == null) ||
                    (u.AvailableEpisodes != null && (!Number.isSafeInteger(u.AvailableEpisodes) || !Number.isSafeInteger(u.WatchedEpisodes) || u.AvailableEpisodes < 0 || u.WatchedEpisodes < 0 || u.WatchedEpisodes > u.AvailableEpisodes))) throw new Error('Invalid progress');
                owners.add(key(u.UserId));
            }
            const matches = entry.Users.filter(u => (owner === 'all' || key(u.UserId) === key(owner === 'mine' ? user : owner)) &&
                statuses.some(status => u.Reasons.includes(activityFilters[status]) || (status === 'watching' && u.Reasons.includes('CaughtUp'))));
            if (matches.length) selected.push({ ...entry, Users: matches,
                IsWatchlistedByMe: entry.Users.some(u => key(u.UserId) === key(user) && u.Reasons.includes('Watchlisted')) });
        }
        const recent = item => Math.max(0, ...item.Users.map(u => u.LastPlayedDate ? Date.parse(u.LastPlayedDate) : 0));
        return selected.sort((a, b) => (sort === 'recent' ? recent(b) - recent(a) : 0) || a.Name.localeCompare(b.Name) || a.ItemId.localeCompare(b.ItemId));
    }

    // Merge independent snapshots by stable IDs; automatic interest never becomes membership.
    function mergeInterest(...sources) {
        const items = new Map();
        for (const source of sources) {
            selectInterest(source, 'all', '', 'all', 'title'); // Validate before any DOM update.
            for (const entry of source) {
                let item = items.get(key(entry.ItemId));
                if (!item) { item = { ...entry, Users: [] }; items.set(key(entry.ItemId), item); }
                for (const owner of entry.Users) {
                    const previous = item.Users.find(u => key(u.UserId) === key(owner.UserId));
                    if (!previous) item.Users.push({ ...owner, Reasons: [...owner.Reasons] });
                    else {
                        previous.Reasons = [...new Set([...previous.Reasons, ...owner.Reasons])];
                        if (owner.AvailableEpisodes != null) { previous.AvailableEpisodes = owner.AvailableEpisodes; previous.WatchedEpisodes = owner.WatchedEpisodes; }
                        if (owner.LastPlayedDate && (!previous.LastPlayedDate || Date.parse(owner.LastPlayedDate) > Date.parse(previous.LastPlayedDate))) previous.LastPlayedDate = owner.LastPlayedDate;
                    }
                }
            }
        }
        return Array.from(items.values());
    }

    // One identity-bound membership snapshot; never used for playback or deletion decisions.
    function createMembership(api, signal, changed = () => {}) {
        const user = api.getCurrentUserId(), token = api.accessToken();
        let entries, pending, revision = 0;
        const valid = () => !signal.aborted && api.getCurrentUserId() === user && api.accessToken() === token;
        return {
            async read(fresh = false) {
                if (!valid()) throw new Error('Account changed');
                if (fresh) entries = undefined;
                if (entries) return entries;
                if (!pending) {
                    const stamp = revision;
                    pending = request(api, 'Watchlist').then(result => {
                        if (!valid() || revision !== stamp) throw new Error('Membership changed');
                        if (!Array.isArray(result) || result.some(e => !/^[0-9a-f]{32}$/i.test(key(e.ItemId)))) throw new Error('Invalid membership');
                        entries = result; return entries;
                    }).finally(() => { pending = null; });
                }
                return pending;
            },
            async set(id, present) {
                if (!valid()) throw new Error('Account changed');
                await request(api, 'Watchlist/' + encodeURIComponent(id), present ? 'PUT' : 'DELETE');
                if (!valid()) throw new Error('Account changed');
                revision++; entries = undefined; changed(id, present);
            }
        };
    }

    function preferenceView(saved, owner, interest, sort) {
        return { owner: owner ?? saved.Owner, interest: interest ?? (saved.Statuses.join(',') || 'none'), sort: sort ?? saved.Sort };
    }
    function preferenceRequest(api, type = 'GET', value) {
        if (!api.getCurrentUserId() || !api.accessToken()) return Promise.reject(new Error('Not signed in'));
        return api.ajax({url: api.getUrl('WatchGuard/Preferences'), type, dataType: 'json',
            ...(value ? {data: JSON.stringify(value), contentType: 'application/json'} : {})});
    }

    function watchlistsPage(document, api, signal, filter, navigate, options = {}) {
        let raw = {owner: filter, interest: options.interest, sort: options.sort};
        let saved = {Owner: 'mine', Statuses: [...defaultFilters], Sort: 'title'}, preferencesLoaded = false;
        let kind = selectedStatuses(options.interest);
        let sort = options.sort === 'recent' ? 'recent' : 'title';
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
        const interestFilter = document.createElement('details'); interestFilter.className = 'watchguard-filter';
        const summary = document.createElement('summary'); summary.className = 'emby-button button-flat'; summary.setAttribute('aria-label', 'Status filters');
        const choicesPanel = document.createElement('div'); choicesPanel.className = 'watchguard-filter-options';
        const checkboxes = new Map();
        for (const [value, reason] of Object.entries(activityFilters)) {
            const label = document.createElement('label');
            const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.value = value;
            const text = document.createElement('span'); text.textContent = reason === 'Watchlisted' ? 'Watchlisted' : activityReasons[reason];
            checkbox.onchange = () => { kind = [...checkboxes].filter(([, box]) => box.checked).map(([id]) => id); change(); };
            label.append(checkbox, text); choicesPanel.append(label); checkboxes.set(value, checkbox);
        }
        const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'emby-button button-flat'; reset.textContent = 'Reset to Defaults';
        reset.onclick = async () => {
            if (!options.preferences) { kind = [...defaultFilters]; change(); return; }
            if (!active()) return;
            reset.disabled = true;
            try {
                await preferenceRequest(api, 'DELETE');
                if (!active()) return;
                saved = {Owner: 'mine', Statuses: [...defaultFilters], Sort: 'title'};
                preferenceMessage.textContent = 'Defaults restored.';
                navigate('mine', defaultFilters.join(','), 'title');
            } catch { if (active()) preferenceMessage.textContent = 'Could not reset saved defaults. Please retry.'; }
            finally { reset.disabled = false; }
        };
        const save = document.createElement('button'); save.type = 'button'; save.className = 'emby-button button-flat'; save.textContent = 'Save view as defaults';
        save.onclick = async () => {
            if (!active()) return;
            save.disabled = true;
            try {
                const result = await preferenceRequest(api, 'PUT', {Owner: admin ? filter || 'mine' : 'mine', Statuses: [...kind], Sort: sort});
                if (active()) { saved = result; preferenceMessage.textContent = 'View saved as your defaults.'; }
            } catch { if (active()) preferenceMessage.textContent = 'Could not save defaults. Please retry.'; }
            finally { save.disabled = false; }
        };
        if (options.preferences) choicesPanel.append(save);
        choicesPanel.append(reset); interestFilter.append(summary, choicesPanel);
        interestFilter.addEventListener('keydown', event => { if (event.key === 'Escape') { interestFilter.open = false; summary.focus(); event.preventDefault(); } });
        document.addEventListener?.('pointerdown', event => { if (!interestFilter.contains(event.target)) interestFilter.open = false; }, {signal});
        const order = dropdown('Sort by', [['title', 'Title'], ['recent', 'Playback recency'], ['added', 'Watchlist date — not recorded', true]]); order.value = sort;
        order.title = 'Playback recency uses available native dates; unknown dates sort last. Watchlist add dates are not stored.';
        const refresh = document.createElement('button'); refresh.className = 'emby-button button-flat watchguard-refresh'; refresh.type = 'button'; refresh.title = 'Refresh'; refresh.setAttribute('aria-label', 'Refresh');
        const refreshIcon = document.createElement('span'); refreshIcon.className = 'material-icons'; refreshIcon.textContent = 'refresh'; refreshIcon.setAttribute('aria-hidden', 'true'); refresh.append(refreshIcon);
        toolbar.append(select, interestFilter, order, refresh);
        const status = document.createElement('p'); status.setAttribute('role', 'status');
        const spinner = document.createElement('span'); spinner.className = 'material-icons watchguard-spinner'; spinner.textContent = 'sync'; spinner.setAttribute('aria-hidden', 'true');
        status.className = 'watchguard-loading-status';
        const notice = document.createElement('p'); notice.className = 'watchguard-notice secondaryText';
        const error = document.createElement('p'); error.setAttribute('role', 'alert');
        const grid = document.createElement('div'); grid.className = 'watchguard-grid';
        const preferenceMessage = document.createElement('p'); preferenceMessage.setAttribute('role', 'status'); preferenceMessage.className = 'watchguard-notice';
        page.append(heading, toolbar, status, notice, error, grid, preferenceMessage);
        const user = api.getCurrentUserId(), token = api.accessToken();
        const active = () => !signal.aborted && api.getCurrentUserId() === user && api.accessToken() === token;
        let directory = [], loadedScope;
        let generation = 0, admin = false, explicit = [], automatic = [], pending = true, coverage = '', failures = [];
        const cards = new Map();
        signal.addEventListener('abort', () => { generation++; cards.clear(); page.remove(); }, { once: true });
        function render() {
            if (!active()) return;
            page.setAttribute('data-watchguard-scope', loadedScope || '');
            const entries = mergeInterest(explicit, automatic);
            if (!admin && entries.some(e => e.Users.some(u => key(u.UserId) !== key(user)))) throw new Error('Invalid account scope');
            const selected = selectInterest(entries, admin ? filter : 'mine', user, kind, sort);
            select.replaceChildren();
            const owners = new Map([...directory, ...entries.flatMap(entry => entry.Users)].map(owner => [key(owner.UserId), owner]));
            const choices = [['mine', 'My list'], ...(admin ? [['all', 'All users'], ...Array.from(owners.values())
                .sort((a, b) => a.DisplayName.localeCompare(b.DisplayName)).map(owner => [key(owner.UserId), owner.DisplayName])] : [])];
            for (const [value, name] of choices) {
                const option = document.createElement('option'); option.value = value; option.textContent = name; select.append(option);
            }
            select.value = admin ? filter : 'mine'; select.hidden = !admin;
            if (admin && !choices.some(([value]) => value === filter)) {
                const option = document.createElement('option'); option.value = filter; option.textContent = 'Unavailable user'; select.append(option); select.value = filter;
            }
            for (const [id, checkbox] of checkboxes) checkbox.checked = kind.includes(id);
            summary.replaceChildren();
            const filterIcon = document.createElement('span'); filterIcon.className = 'material-icons'; filterIcon.textContent = 'filter_list'; filterIcon.setAttribute('aria-hidden', 'true');
            const count = document.createElement('span'); count.textContent = String(kind.length); summary.append(filterIcon, count);
            summary.title = 'Status filters (' + kind.length + ' selected)'; summary.setAttribute('aria-label', summary.title); order.value = sort;
            status.textContent = pending ? 'Loading viewing activity…' : selected.length || failures.length ? '' : 'No matching activity in this overview.';
            spinner.hidden = !pending; if (pending) status.append(spinner); page.setAttribute('aria-busy', String(pending));
            notice.textContent = coverage;
            error.textContent = failures.join(' ');
            const visible = new Set(selected.map(e => key(e.ItemId)));
            for (const [id, record] of cards) if (!visible.has(id)) record.card.remove();
            for (const entry of selected) {
                let record = cards.get(key(entry.ItemId));
                if (!record) {
                    const card = document.createElement('article'); card.className = 'watchguard-card';
                    const link = document.createElement('a'); link.className = 'button-link';
                    link.href = '#/details?id=' + encodeURIComponent(entry.ItemId) + '&serverId=' + encodeURIComponent(api.serverId());
                    const image = document.createElement('img'); image.alt = ''; image.loading = 'lazy';
                    image.src = api.getImageUrl(entry.ItemId, { type: 'Primary', maxWidth: 360, quality: 90 });
                    image.onerror = () => { image.hidden = true; };
                    const poster = document.createElement('div'); poster.className = 'watchguard-poster';
                    const fallback = document.createElement('span'); fallback.className = 'material-icons'; fallback.textContent = 'movie'; fallback.setAttribute('aria-hidden', 'true');
                    poster.append(fallback, image);
                    const name = document.createElement('div'); name.className = 'cardText';
                    link.append(poster, name); card.append(link);
                    const ownersText = document.createElement('div'); ownersText.className = 'watchguard-status secondaryText';
                    if (admin) ownersText.classList.add('watchguard-owners');
                    card.append(ownersText); record = { card, name, ownersText }; cards.set(key(entry.ItemId), record);
                }
                record.name.textContent = entry.Name; record.name.title = entry.Name; record.ownersText.replaceChildren();
                for (const owner of entry.Users) {
                    record.ownersText.append(userLine(document, owner));
                }
                record.remove?.remove(); record.remove = null;
                if (entry.IsWatchlistedByMe) {
                    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'emby-button button-flat watchguard-remove';
                    const icon = document.createElement('span'); icon.className = 'material-icons'; icon.textContent = 'bookmark_remove'; icon.setAttribute('aria-hidden', 'true'); remove.append(icon);
                    remove.title = 'Remove from Watchlist'; remove.setAttribute('aria-label', 'Remove ' + entry.Name + ' from Watchlist');
                    remove.onclick = async () => {
                        if (!active()) return;
                        const revision = generation;
                        remove.disabled = true; error.textContent = '';
                        try {
                            await request(api, 'Watchlist/' + encodeURIComponent(entry.ItemId), 'DELETE');
                            if (!active() || revision !== generation) return;
                            explicit = explicit.map(e => key(e.ItemId) === key(entry.ItemId) ? { ...e, Users: e.Users.filter(u => key(u.UserId) !== key(user)) } : e).filter(e => e.Users.length);
                            render();
                        } catch { if (active() && revision === generation) { error.textContent = 'WatchGuard: Could not remove this entry. Please retry.'; remove.disabled = false; } }
                    };
                    record.card.append(remove); record.remove = remove;
                }
                grid.append(record.card); // Reuse the card/image node, including when sorting.
            }
        }
        async function load() {
            if (!active()) return;
            const revision = ++generation;
            const current = () => active() && revision === generation;
            pending = true; failures = []; coverage = ''; refresh.disabled = true;
            status.textContent = 'Loading watchlists…'; spinner.hidden = false; status.append(spinner); page.setAttribute('aria-busy', 'true'); error.textContent = '';
            try {
                const account = await api.getCurrentUser();
                if (!current()) return;
                admin = account.Policy?.IsAdministrator === true;
                if (options.preferences && !preferencesLoaded) {
                    try {
                        const result = await preferenceRequest(api);
                        if (!current()) return;
                        if (!result || typeof result.Owner !== 'string' || !Array.isArray(result.Statuses) || result.Statuses.some(s => !activityFilters[s]) || !['title','recent'].includes(result.Sort)) throw new Error('Invalid preferences');
                        saved = result;
                    } catch { if (current()) preferenceMessage.textContent = 'Saved defaults unavailable. Using URL or built-in defaults; stored data was not changed.'; }
                    if (!current()) return;
                    preferencesLoaded = true;
                    const view = preferenceView(saved, raw.owner, raw.interest, raw.sort);
                    filter = view.owner; kind = selectedStatuses(view.interest); sort = view.sort === 'recent' ? 'recent' : 'title';
                }
                const scope = !admin || filter === 'mine' || key(filter) === key(user) ? 'mine' : filter;
                loadedScope = scope;
                if (admin && !directory.length) {
                    const owners = await request(api, 'Users');
                    if (!current()) return;
                    if (!Array.isArray(owners) || owners.some(u => !/^[0-9a-f]{32}$/i.test(key(u.UserId)) || typeof u.DisplayName !== 'string')) throw new Error('Invalid users');
                    directory = owners;
                }
                try {
                    const result = await request(api, scope === 'mine' ? 'Watchlist' : scope === 'all' ? 'Watchlists' : 'Watchlists/' + encodeURIComponent(scope));
                    if (!current()) return;
                    if (!Array.isArray(result)) throw new Error('Invalid memberships');
                    const entries = result.map(e => ({ ...e, Users: (scope !== 'mine' ? e.Users : [{ UserId: user, DisplayName: account.Name || 'You' }]).map(u => ({ ...u, Reasons: ['Watchlisted'], LastPlayedDate: null })) }));
                    selectInterest(entries, 'all', user); explicit = entries;
                } catch { if (!current()) return; explicit = []; failures.push('WatchGuard: Could not load watchlists. Please refresh to retry.'); }
                automatic = []; render(); // Paint memberships before issuing expensive discovery.
                try {
                    const result = await request(api, scope === 'mine' ? 'ActivityOverview/Me' : scope === 'all' ? 'ActivityOverview' : 'ActivityOverview/Users/' + encodeURIComponent(scope));
                    if (!current()) return;
                    if (!result || result.IsComplete !== false || typeof result.LimitReached !== 'boolean' || typeof result.Notice !== 'string') throw new Error('Invalid coverage');
                    selectInterest(result.Items, 'all', user);
                    if (result.Items.some(e => e.Users.some(u => (scope !== 'all' && key(u.UserId) !== key(scope === 'mine' ? user : scope)) || u.Reasons.includes('Watchlisted')))) throw new Error('Invalid automatic scope');
                    automatic = result.Items; coverage = result.Notice;
                } catch { if (!current()) return; automatic = []; failures.push('WatchGuard: Viewing activity unavailable. Results are incomplete; refresh to retry.'); }
                pending = false; render();
            } catch { if (current()) { pending = false; failures = ['WatchGuard: Could not verify this account.']; explicit = []; automatic = []; render(); } }
            finally { if (current()) refresh.disabled = false; }
        }
        page.updateFilters = (owner, interest, sorting) => {
            raw = {owner, interest, sort: sorting};
            const view = preferenceView(saved, owner, interest, sorting);
            filter = view.owner; kind = selectedStatuses(view.interest); sort = view.sort === 'recent' ? 'recent' : 'title';
            const nextScope = !admin || filter === 'mine' || key(filter) === key(user) ? 'mine' : filter;
            if (loadedScope && nextScope !== loadedScope) { explicit = []; automatic = []; pending = true; render(); load(); } else render();
        };
        const change = () => { if (active()) navigate(select.value || 'mine', kind.join(',') || 'none', order.value); };
        select.onchange = change; order.onchange = change;
        refresh.onclick = load;
        if (!signal.aborted) load();
        return page;
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { renderSeriesActivity, createAdapter, confirmDeletion, message, protectionCheck, validateStatus, describe, resolveScope, selectInterest, mergeInterest, activityText, selectedStatuses, userLine, watchlistsPage, createMembership, preferenceView };
        return;
    }
    if (root.WatchGuardPoc) return;
    let diagnostic = /*WATCHGUARD_DIAGNOSTICS*/false;
    let identity, panel, detailButton, signature, membership, epoch = 0;
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
            membership = next[1] && next[2] ? createMembership(api, lifetime.signal, () => { signature = null; updateDetail(); }) : null;
            document.querySelectorAll('.watchguard-native-action').forEach(e => e.remove());
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
        .watchguard-deletion-dialog::backdrop {background:rgba(0,0,0,.65)}
        .watchguard-deletion-dialog button:focus-visible {outline:2px solid #fff;outline-offset:2px}

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
        .watchguard-loading-status {display:flex;align-items:center;gap:.5em}
        .watchguard-spinner {font-size:1.2em;animation:watchguard-spin 1s linear infinite;color:var(--jf-palette-primary-main,#00a4dc)}
        @keyframes watchguard-spin {to {transform:rotate(360deg)}}
        @media(prefers-reduced-motion:reduce) {.watchguard-spinner {animation:none}}
        .watchguard-notice {font-size:.85em;margin-bottom:1.5em}
        .watchguard-grid {display:grid;grid-template-columns:repeat(auto-fill,minmax(135px,1fr));gap:1.5em 1em;margin:1em 0;align-items:start}
        @media(min-width:1100px) {.watchguard-grid {grid-template-columns:repeat(8,minmax(0,1fr))}}
        .watchguard-filter {position:relative}
        .watchguard-filter summary {cursor:pointer;white-space:nowrap;display:flex;align-items:center;gap:.35em;min-height:2.5em;box-sizing:border-box}
        .watchguard-filter summary .material-icons {font-size:1.4em}
        .watchguard-filter-options {position:absolute;inset-block-start:100%;inset-inline-start:0;z-index:2;min-width:13em;padding:.5em;background:var(--jf-palette-background-paper,#202020);border:1px solid #666;border-radius:.3em;box-shadow:0 .3em 1em #0008}
        .watchguard-filter-options label {display:flex;align-items:center;gap:.65em;padding:.65em;cursor:pointer}
        .watchguard-filter-options input {width:1.2em;height:1.2em;accent-color:var(--jf-palette-primary-main,#00a4dc)}
        .watchguard-card {position:relative;min-width:0}
        .watchguard-remove {position:absolute;top:.3em;right:.3em;background:rgba(0,0,0,.75);border-radius:50%;padding:.5em;color:white}
        @media(max-width:480px) {.watchguard-grid {grid-template-columns:repeat(2,minmax(0,1fr))}.watchguard-toolbar {gap:.5em;position:relative}.watchguard-filter {position:static}.watchguard-page select {min-width:0;max-width:100%}}
        .watchguard-card a {display:block;color:inherit;text-decoration:none}
        .watchguard-poster {position:relative;aspect-ratio:2/3;background:#292929;display:flex;align-items:center;justify-content:center;border-radius:.25em;overflow:hidden}
        .watchguard-poster>.material-icons {font-size:3em;color:#999}
        .watchguard-poster img {position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
        .watchguard-card a:hover .watchguard-poster {box-shadow:0 0 0 2px #00a4dc}
        .watchguard-card .cardText {padding-top:.5em;font-size:.9em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .watchguard-status {padding-top:.4em}
        .watchguard-status .watchguard-user-line {display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:0 .25em;margin-bottom:.35em}
        .watchguard-status-icons {display:inline-flex;align-items:center;gap:.1em;flex-shrink:0}
        .watchguard-status-icons .material-icons {font-size:1.1em}
        .watchguard-user-line .watchguard-user {flex-shrink:1;min-width:0}
        .watchguard-status .watchguard-user {max-width:100%}
        .watchguard-progress {white-space:nowrap}
        .watchguard-user-line time {grid-column:1/-1;font-size:.9em;opacity:.85}
        .watchguard-status {font-size:.8em;line-height:1.5}
        .watchguard-controls {display:inline-flex;align-items:center}
        .watchguard-state-Watchlisted {--wg-accent:#f3c66c}
        .watchguard-state-InProgress {--wg-accent:#82c4ff}
        .watchguard-state-CaughtUp {--wg-accent:#6edbd0}
        .watchguard-state-Watched {--wg-accent:#93d6a2}
        .watchguard-state-CurrentlyPlaying {--wg-accent:#c9a3f7}
        .watchguard-state-Unknown {--wg-accent:#bac0ca}
        .watchguard-chip {display:inline-flex;align-items:center;color:var(--wg-accent,#ccc);background:color-mix(in srgb,var(--wg-accent,#ccc) 10%,transparent);border:1px solid color-mix(in srgb,var(--wg-accent,#ccc) 30%,transparent);border-radius:1em;padding:.15em .65em;font-size:.85em;line-height:1.5;max-width:100%;box-sizing:border-box;overflow-wrap:anywhere}
        .watchguard-status-icons [class*="watchguard-state-"] {color:var(--wg-accent)}
        .watchguard-series-activity {width:100%;box-sizing:border-box;border:1px solid #ffffff24;border-radius:.7rem;background:#ffffff03;overflow:hidden}
        .watchguard-series-activity summary {cursor:pointer;padding:.8rem 1rem;min-height:2.75rem;box-sizing:border-box;line-height:1.7;overflow-wrap:anywhere}
        .watchguard-series-activity summary::marker {color:#aab4bf}
        .watchguard-series-activity summary:focus-visible {outline:2px solid #82c4ff;outline-offset:-3px}
        .watchguard-series-activity summary>* {margin-inline-end:.5rem}
        .watchguard-activity-heading {font-weight:600;color:var(--jf-palette-text-primary,#eee)}
        .watchguard-series-viewers {list-style:none;padding:0 1rem;margin:0;max-height:28rem;overflow:auto}
        .watchguard-series-viewers li {display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.3fr) minmax(0,1fr);gap:.4rem .8rem;padding:.9rem 0;border-top:1px solid #ffffff1c;align-items:center;overflow-wrap:anywhere}
        .watchguard-viewer-name {color:var(--jf-palette-text-primary,#eee);min-width:0}
        .watchguard-viewer-states {display:flex;flex-wrap:wrap;gap:.3rem}
        .watchguard-viewer-metrics {display:grid;gap:.4rem;font-size:.85em}
        .watchguard-viewer-progress {width:100%;height:.35rem;border:0;border-radius:1rem;overflow:hidden;appearance:none;background:#ffffff20;accent-color:var(--wg-accent)}
        .watchguard-viewer-progress::-webkit-progress-bar {background:#ffffff20}
        .watchguard-viewer-progress::-webkit-progress-value {background:var(--wg-accent)}
        .watchguard-viewer-progress::-moz-progress-bar {background:var(--wg-accent)}
        .watchguard-series-viewers time {grid-column:1/-1;color:#b7bdc5;font-size:.8em}
        .watchguard-coverage {color:#b7bdc5;font-size:.8em}
        .watchguard-series-activity>small {display:block;padding:.6rem 1rem .85rem;line-height:1.5}
        .watchguard-header.watchguard-series-section {font-size:1em;margin:0 0 1.25rem}
        .watchguard-series-section .watchguard-interest {display:block;max-height:none}
        @media(max-width:50em) {
            .detailPagePrimaryContent:has(>.watchguard-series-section) {padding-inline:5%}
            .watchguard-series-viewers li {grid-template-columns:minmax(0,1fr)}
            .watchguard-series-activity summary {padding:.7rem .8rem}
            .watchguard-series-viewers {padding:0 .8rem}
        }
        .watchguard-header {min-width:0;max-width:100%;margin:.4em 0;font-size:.8em;line-height:1.5;overflow-wrap:anywhere}
        .watchguard-header [hidden] {display:none!important}
        .watchguard-interest {display:flex;flex-wrap:wrap;gap:.15em 1em;max-height:4.5em;overflow:auto;color:var(--jf-palette-text-secondary,#aaa)}
        .watchguard-interest>span {display:inline-flex;align-items:baseline;gap:.35em;min-width:0;max-width:100%}
        .watchguard-user {flex-shrink:0;max-width:min(20ch,40vw);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        @media(max-width:50em) {
            .detailRibbon:has(.watchguard-header), .detailPagePrimaryContainer:has(.watchguard-series-section)>.detailRibbon {display:block;width:100%;box-sizing:border-box;height:auto;min-height:7.2em}
        }
        .watchguard-error {color:#ffb4ab}
        .watchguard-error:empty,.watchguard-interest:empty {display:none}
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
        if (pagePanel?.isConnected) {
            if (pageSignature !== hash) pagePanel.updateFilters(params.get('owner'), params.get('interest'), params.get('sort'));
            pageSignature = hash; return;
        }
        closePage(); pageSignature = hash;
        pageLifetime = new AbortController();
        pagePanel = watchlistsPage(document, api, pageLifetime.signal, params.get('owner'), (owner, interest, sort) => {
            root.location.hash = '/home?watchguard=watchlists&owner=' + encodeURIComponent(owner) + '&interest=' + encodeURIComponent(interest) + '&sort=' + encodeURIComponent(sort);
        }, {interest: params.get('interest'), sort: params.get('sort'), preferences: true});
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
            const interest = document.createElement('div'); interest.className = 'watchguard-interest'; interest.setAttribute('role', 'status'); interest.setAttribute('aria-label', 'Title interest');
            const header = document.createElement('div'); header.className = 'watchguard-header'; header.append(interest, error);
            // Shared 12.2 template: infoWrapper contains title/metadata, before the sibling action row.
            const info = anchor.parentElement?.querySelector('.infoWrapper');
            if (!info) return;
            if (scope.Type === 'Series') {
                // Shared native legacy/modern detail template: content is outside the fixed header ribbon.
                const primaryContent = anchor.parentElement?.parentElement?.querySelector('.detailPagePrimaryContent');
                if (!primaryContent) return;
                header.className += ' watchguard-series-section';
                primaryContent.insertBefore(header, primaryContent.firstChild);
            } else info.append(header);
            container.append(toggle); anchor.insertBefore(container, anchor.querySelector('.btnMoreCommands')); panel = header; detailButton = container;
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
                interest.replaceChildren();
                if (account.Policy?.IsAdministrator !== true) return;
                interest.textContent = 'Loading interest…'; interest.setAttribute('aria-busy', 'true');
                try {
                    const series = scope.Type === 'Series';
                    const status = await request(api, (series ? 'SeriesActivity/' : 'Protection/') + encodeURIComponent(scopeId));
                    if (!series) validateStatus(status, scopeId, user);
                    if (current()) {
                        interest.replaceChildren();
                        if (seriesLabel && status.Users.length) { const scopeText = document.createElement('span'); scopeText.textContent = seriesLabel; interest.append(scopeText); }
                        if (series) renderSeriesActivity(document, interest, status, scopeId, user, seriesLabel);
                        else for (const owner of status.Users) interest.append(userLine(document, owner));
                    }
                } catch { if (current()) interest.textContent = 'WatchGuard: Interest status unavailable.'; }
                finally { if (current()) interest.setAttribute('aria-busy', 'false'); }
            }
            toggle.onclick = async () => {
                if (!current()) return;
                toggle.disabled = true; error.textContent = '';
                try {
                    await membership.set(scopeId, !member);
                    if (!current()) return;
                    member = !member; render();
                    try { await refreshInterest(); } catch { if (current()) interest.textContent = 'WatchGuard: Could not verify this account.'; }
                } catch {
                    if (current()) { error.textContent = 'WatchGuard: Could not update your watchlist. Please retry.'; toggle.disabled = false; }
                }
            };
            try {
                const entries = await membership.read(true);
                if (!Array.isArray(entries)) throw new Error('Invalid watchlist');
                if (!current()) return;
                member = entries.some(e => key(e.ItemId) === key(scopeId)); render();
            } catch { if (current()) { label.textContent = 'Watchlist unavailable'; error.textContent = 'WatchGuard: Could not load your watchlist. Reopen this page to retry.'; } }
            try { await refreshInterest(); } catch { if (current()) interest.textContent = 'WatchGuard: Could not verify this account.'; }
        } catch { /* Native item lookup failed; do not attach controls to an unverified item. */ }
    }
    // Pinned 12.2: native dialogHelper emits capture-observable `open`; no module patch.
    // The sheet carries commands, not its item ID. Only accept an unambiguous native trigger.
    let menuIntent, menuAmbiguous = false;
    function captureMenu(event) {
        const target = event.target;
        if (!target?.closest || target.closest('.watchguard-native-action')) return;
        const detail = target.closest('#itemDetailPage:not(.hide) .btnMoreCommands');
        const card = target.closest('.card[data-id][data-type][data-serverid]');
        const more = target.closest('[data-action="menu"]');
        if (!((event.type === 'click' && (detail || more)) || (event.type === 'contextmenu' && card))) return;
        const api = syncIdentity(); if (!api) return;
        if (menuIntent) { menuAmbiguous = true; menuIntent = null; return; }
        if (menuAmbiguous) return; // Competing async menus cannot be associated safely until navigation.
        const params = new URLSearchParams(root.location.hash.split('?')[1] || '');
        const id = detail ? params.get('id') : card?.dataset.id;
        const server = detail ? (params.get('serverId') || api.serverId()) : card?.dataset.serverid;
        if (!id || key(server) !== key(api.serverId()) || (card && !['Movie','Series'].includes(card.dataset.type))) return;
        menuIntent = {api, id, hash: root.location.hash, identity, node: detail || card};
    }
    document.addEventListener('click', captureMenu, true);
    document.addEventListener('contextmenu', captureMenu, true);
    document.addEventListener('open', async event => {
        const intent = menuIntent; menuIntent = null;
        const sheet = event.target;
        if (!intent || menuAmbiguous || !sheet.matches?.('.actionSheet')) return;
        const anchor = sheet.querySelector('[data-id="addtocollection"], [data-id="addtoplaylist"]');
        if (!anchor || sheet.querySelector('.watchguard-native-action')) return;
        const {api,id,hash,node} = intent, user = api.getCurrentUserId();
        const current = () => !menuAmbiguous && identity === intent.identity && valid(api,user) && root.location.hash === hash && node.isConnected && sheet.isConnected && sheet.classList.contains('opened');
        const command = document.createElement('button'); command.type = 'button'; command.disabled = true;
        command.className = 'emby-button listItem listItem-button actionSheetMenuItem watchguard-native-action';
        const icon = document.createElement('span'); icon.className = 'actionsheetMenuItemIcon listItemIcon listItemIcon-transparent material-icons'; icon.setAttribute('aria-hidden','true');
        const text = document.createElement('span'); text.className = 'listItemBody actionsheetListItemBody'; text.textContent = 'Loading Watchlist…';
        command.append(icon,text); anchor.after(command);
        let present;
        const render = () => { text.textContent = present ? 'Remove from Watchlist' : 'Add to Watchlist'; icon.textContent = present ? 'bookmark_remove' : 'bookmark_add'; command.disabled = false; };
        command.addEventListener('click', async click => {
            click.preventDefault(); click.stopImmediatePropagation(); // Only our owned command; native sheet must not execute an unknown command.
            if (!current() || command.disabled) return;
            command.disabled = true;
            try { await membership.set(id, !present); if (current()) { present = !present; render(); } }
            catch { if (current()) { text.textContent = 'WatchGuard: Update failed. Reopen this menu to retry.'; text.setAttribute('role','alert'); } }
        });
        try {
            const item = await api.getItem(user,id);
            if (!current()) { command.remove(); return; }
            if (key(item?.Id) !== key(id) || !['Movie','Series'].includes(item.Type)) { command.remove(); return; }
            const entries = await membership.read(true);
            if (!current()) { command.remove(); return; }
            present = entries.some(e => key(e.ItemId) === key(id)); render();
        } catch { if (current()) { text.textContent = 'WatchGuard: Watchlist unavailable. Reopen to retry.'; text.setAttribute('role','alert'); } else command.remove(); }
    }, true);
    root.addEventListener('hashchange', () => { menuIntent = null; menuAmbiguous = false; });

    const bind = () => { syncIdentity(); adapter.install(root.ApiClient); };
    bind();
    for (const name of ['viewbeforeshow', 'viewshow', 'pointerdown', 'keydown', 'click'])
        document.addEventListener(name, bind, true);
    document.addEventListener('viewshow', () => { signature = null; updateDetail(); }, true);
    root.addEventListener('hashchange', () => { updateNavigation(); updateDetail(); });
    setInterval(() => { bind(); updateNavigation(); updateDetail(); }, 500);
})(typeof window === 'undefined' ? globalThis : window);
