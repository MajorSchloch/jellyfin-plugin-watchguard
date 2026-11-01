/* Jellyfin Web 12.2: narrow ApiClient adapter and owned, framework-free UI. */
(function (root) {
    'use strict';
    const message = 'WatchGuard: This item may still be in use.';

    // Jellyfin's inputManager emits cancellable commands before route Back.
    // Raw keys cover browsers/remotes without that integration. Scope all
    // interception to an owned open surface; never intercept ordinary navigation.
    function dismissible(element, close, enabled = () => true) {
        element.addEventListener('command', event => {
            if (enabled() && ['back', 'cancel'].includes(event.detail?.command)) {
                event.preventDefault(); event.stopPropagation(); close();
            }
        });
        element.addEventListener('keydown', event => {
            if (enabled() && (['Escape', 'BrowserBack', 'GoBack'].includes(event.key) || event.keyCode === 461)) {
                event.preventDefault(); event.stopPropagation(); close();
            }
        });
    }
    function remoteSummary(document) {
        const summary = document.createElement('summary');
        // Native focusManager includes .focusable, but not SUMMARY by default.
        summary.className = 'focusable'; summary.tabIndex = 0;
        return summary;
    }
    function disclosure(document) {
        const details = document.createElement('details');
        dismissible(details, () => { details.open = false; details.querySelector('summary')?.focus(); }, () => details.open);
        return details;
    }

    // Direct Watchlists entry has no public loader for Jellyfin's emby-select.
    // Its native component avoids browser select popups on webOS. Use a scoped
    // modal in TV layout, with the same select value/change contract and native
    // DIALOG/button directional navigation. Other layouts keep native selects.
    function tvChoices(document, select, signal, current, container) {
        let popup = null;
        const values = () => Array.from(select.options).map(o => [o.value, o.textContent, o.disabled]);
        const isOk = event => ['Enter', 'Accept'].includes(event.key) || [13, 195].includes(event.keyCode);
        const open = event => {
            if (!document.documentElement?.classList.contains('layout-tv')) return;
            if (event.type === 'mousedown' && event.button !== 0) return;
            if (event.type === 'keydown' && !isOk(event)) return;
            if (!current() || signal.aborted || select.disabled) return;
            event.preventDefault(); event.stopPropagation();
            if (popup) return;
            select.setAttribute('aria-haspopup', 'dialog');
            const options = values(), snapshot = JSON.stringify(options);
            const dialog = document.createElement('dialog'); dialog.className = 'watchguard-choice-dialog';
            dialog.setAttribute('aria-label', select.getAttribute('aria-label'));
            const heading = document.createElement('h3'); heading.textContent = select.getAttribute('aria-label'); dialog.append(heading);
            const finish = (restore = true) => {
                if (popup !== dialog) return;
                popup = null; signal.removeEventListener('abort', abort); dialog.remove();
                select.setAttribute('aria-expanded', 'false');
                if (restore && current() && select.isConnected) select.focus({preventScroll:true});
            };
            const abort = () => finish(false);
            let selected;
            for (const [value, label, disabled] of options) {
                const button = document.createElement('button'); button.type = 'button';
                button.className = 'emby-button button-flat'; button.textContent = label; button.disabled = disabled;
                button.setAttribute('aria-pressed', String(select.value === value));
                if (select.value === value && !disabled) selected = button;
                button.onclick = () => {
                    if (popup !== dialog || disabled) return;
                    const valid = current() && !signal.aborted && snapshot === JSON.stringify(values());
                    const changed = select.value !== value;
                    finish();
                    if (!valid || !changed) return;
                    select.value = value;
                    select.dispatchEvent(new Event('change', {bubbles:true}));
                };
                dialog.append(button);
            }
            const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'emby-button button-flat'; cancel.textContent = 'Cancel';
            cancel.onclick = () => finish(); dialog.append(cancel);
            dialog.addEventListener('cancel', event => { event.preventDefault(); finish(); });
            dialog.addEventListener('close', () => finish()); dismissible(dialog, () => finish());
            // Handle remote OK once, including controllers that use key code 195.
            dialog.addEventListener('keydown', event => {
                if (isOk(event) && event.target.tagName === 'BUTTON') {
                    event.preventDefault(); event.stopPropagation(); event.target.click();
                }
            });
            popup = dialog; signal.addEventListener('abort', abort, {once:true});
            // Keep dialog buttons outside the select label: removing a clicked
            // descendant before label activation can otherwise click the select again.
            container.append(dialog);
            try { dialog.showModal(); select.setAttribute('aria-expanded', 'true'); (selected || cancel).focus(); }
            catch { finish(); }
        };
        // Prevent the platform popup at its mousedown boundary. click also covers
        // native inputManager's select command; the open guard prevents duplicates.
        for (const event of ['mousedown', 'click', 'keydown']) select.addEventListener(event, open);
    }

    // Read-only feature checks: no requests, timers, credentials or DOM mutations.
    // Web's reported version is qualification context, never evidence of server protection.
    function browserCapabilities(api, document, host, installed) {
        let version = null;
        try { if (typeof api?.appVersion === 'function') { const reported = api.appVersion(); if (typeof reported === 'string') version = reported; } }
        catch { /* An optional version accessor cannot hide working feature checks. */ }
        const tested = ['12.2.0', '12.3.0', '12.4.0'].includes(version);
        const inRange = typeof version === 'string' && /^12\.(?:2|3|4)\.\d+$/.test(version);
        const accepted = tested ? 'Tested' : 'CompatibleUntested';
        const check = (id, ok, detail, action, unavailable = false) => ({Id:id, Status:ok ? accepted : unavailable ? 'Unavailable' : 'Unsupported', Detail:detail, Action:ok ? '' : action});
        const missing = methods => methods.filter(name => typeof api?.[name] !== 'function');
        const core = missing(['getCurrentUserId', 'accessToken', 'getUrl', 'ajax']);
        const activity = missing(['getCurrentUser', 'serverId', 'getImageUrl']);
        const deletion = missing(['deleteItem', 'getItem']);
        const layout = document.querySelector('.skinHeader, header.MuiAppBar-root, .mainDrawer, .MuiDrawer-root');
        const navigation = document.querySelector('.watchguard-nav');
        const contentRoute = /^#\/(?:home|details|movies|tv|list|search|music|livetv)(?:[/?]|$)/.test(host.location?.hash || '');
        const loader = host.WatchGuardStandalone?.status?.();
        return { WebVersion:version, TestedVersions:['12.2.0', '12.3.0', '12.4.0'], Checks:[
            check('web-version', inRange, version ? 'Web reports ' + version + (tested ? ' (qualified release).' : ' (not a qualified release).') : 'Web version is not reported.', 'Use packaged Web 12.2/12.3/12.4; custom or newer Web requires separate qualification.', !version),
            check('browser-api', !!api && !core.length, 'Required authenticated request API' + (core.length ? ': missing ' + core.join(', ') : ' is present.'), 'Sign in and fully reload a supported Web client.', !api),
            check('watchlists-api', !!api && !core.length && !activity.length, 'Watchlists API' + (activity.length ? ': missing ' + activity.join(', ') : ' is present.'), 'Restore the native Web API. Other features have independent checks.', !api),
            check('deletion-adapter', !!api && !core.length && !deletion.length && installed, 'Browser deletion adapter ' + (installed ? 'is attached to the current ApiClient.' : 'is not attached to the current ApiClient.'), 'Fully reload; check native API methods and competing adapters. This does not change server protection.', !api),
            check('browser-loader', loader === 'loaded', 'Standalone bootstrap: ' + (loader || 'not observed') + '. Build identity and authenticated script delivery are checked separately.', 'Fully reload; inspect standalone registration, CSP and authentication.', !loader),
            check('navigation-layout', !!layout && !!navigation?.isConnected, 'Recognized layout/navigation entry ' + (navigation?.isConnected ? 'is present.' : 'is not present on this screen.'), contentRoute ? 'Use a recognized native layout or open the saved Watchlists URL. Server enforcement is independent.' : 'Open Home or Watchlists to check navigation; dashboard/login/playback have no Watchlists entry.', !contentRoute),
            check('filter-history', typeof host.history?.replaceState === 'function', 'History replacement keeps Jellyfin-owned state; behavioral Back/Forward coverage is limited to qualified Web releases.', 'Use a browser with the History API.')
        ]};
    }

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
            dialog.style.cssText = 'box-sizing:border-box;width:calc(100% - 2rem);max-width:38rem;max-height:calc(100vh - 2rem);max-height:calc(100dvh - 2rem);padding:0;border:1px solid #555;border-radius:.5rem;background:#202020;color:#eee;font:inherit;overflow:auto;';
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
            try { openDeletionDialogs.add(document); document.body.append(dialog); dismissible(dialog, () => finish(false)); dialog.showModal(); cancel.focus(); }
            catch (error) { signal?.removeEventListener('abort', abort); openDeletionDialogs.delete(document); dialog.remove(); reject(error); }
        });
    }

    const key = id => typeof id === 'string' ? id.replace(/-/g, '').toLowerCase() : '';
    function episodeProgress(owner) {
        const progress = owner.EpisodeProgress;
        if (progress == null) return null; // Older servers retain their existing counts/labels.
        if (!Number.isSafeInteger(progress.AiredAvailable) || !Number.isSafeInteger(progress.AiredWatched) ||
            progress.AiredWatched < 0 || progress.AiredAvailable < progress.AiredWatched ||
            !Array.isArray(progress.ExtraEpisodes) || progress.ExtraEpisodes.length > 1000) throw new Error('Invalid episode progress');
        const seen = new Set();
        for (const e of progress.ExtraEpisodes) {
            if (!e || !/^[0-9a-f]{32}$/i.test(key(e.ItemId)) || seen.has(key(e.ItemId)) || typeof e.Name !== 'string' ||
                typeof e.Watched !== 'boolean' || !['Future','ReleaseDay','UnknownDate'].includes(e.ReleaseStatus) ||
                [e.SeasonNumber,e.EpisodeNumber,e.EpisodeNumberEnd].some(n => n != null && (!Number.isSafeInteger(n) || n < 0)) ||
                (e.ReleaseStatus === 'UnknownDate' ? e.PremiereDate != null : typeof e.PremiereDate !== 'string' || !Number.isFinite(Date.parse(e.PremiereDate))))
                throw new Error('Invalid extra episode');
            seen.add(key(e.ItemId));
        }
        return progress;
    }
    function viewingLabel(owner, reason, fallback) {
        return reason === 'CaughtUp' && episodeProgress(owner)?.ExtraEpisodes.some(e => !e.Watched)
            ? 'Caught up on aired episodes' : fallback;
    }
    let extraDialogSequence = 0;
    function appendEpisodeProgress(document, container, owner, suffix = '') {
        const progress = episodeProgress(owner);
        const watched = progress?.AiredWatched ?? owner.WatchedEpisodes, available = progress?.AiredAvailable ?? owner.AvailableEpisodes;
        const count = document.createElement('span'); count.textContent = watched + '/' + available + (progress?.ExtraEpisodes.length ? '' : suffix);
        if (progress) count.setAttribute('aria-label', watched + ' of ' + available + ' aired episodes');
        container.append(count);
        if (!progress?.ExtraEpisodes.length) return;
        const button = document.createElement('button'); button.type = 'button'; button.className = 'emby-button watchguard-extra-button';
        button.textContent = '+' + progress.ExtraEpisodes.length;
        button.setAttribute('aria-haspopup', 'dialog');
        button.setAttribute('aria-label', owner.DisplayName + ': ' + progress.ExtraEpisodes.length + ' additional available episodes; show dates and watched status');
        button.title = 'Additional available episodes';
        container.append(button);
        let open = false;
        button.onclick = event => {
            event?.preventDefault(); event?.stopPropagation();
            if (open) return;
            open = true;
            const dialog = document.createElement('dialog'); dialog.className = 'watchguard-extras-dialog';
            const heading = document.createElement('h3'); heading.id = 'watchguard-extras-' + (++extraDialogSequence);
            heading.textContent = owner.DisplayName + ' — Additional available episodes';
            dialog.setAttribute('aria-labelledby', heading.id);
            const description = document.createElement('p'); description.id = heading.id + '-description';
            description.textContent = 'These playable episodes are outside the aired fraction. Dates and watched status come from Jellyfin; unknown dates do not establish complete coverage.';
            dialog.setAttribute('aria-describedby', description.id);
            const list = document.createElement('ul');
            for (const e of progress.ExtraEpisodes) {
                const row = document.createElement('li'), title = document.createElement('strong'), info = document.createElement('span');
                title.textContent = 'Season ' + (e.SeasonNumber ?? '?') + ' · Episode ' + (e.EpisodeNumber ?? '?') +
                    (e.EpisodeNumberEnd != null && e.EpisodeNumberEnd !== e.EpisodeNumber ? '–' + e.EpisodeNumberEnd : '') + ' · ' + e.Name;
                const release = e.ReleaseStatus === 'UnknownDate' ? 'Date unknown' :
                    (e.ReleaseStatus === 'ReleaseDay' ? 'Release day' : 'Future-dated') + ' · ' + new Date(e.PremiereDate).toLocaleDateString();
                info.textContent = release + ' · ' + (e.Watched ? 'Watched' : 'Unwatched');
                row.append(title, info); list.append(row);
            }
            const close = document.createElement('button'); close.type = 'button'; close.className = 'emby-button raised'; close.textContent = 'Close';
            const finish = () => { open = false; dialog.remove(); if (button.isConnected) button.focus(); };
            close.onclick = finish;
            dialog.addEventListener('cancel', event => { event.preventDefault(); finish(); });
            dialog.addEventListener('close', finish);
            dialog.append(heading, description, list, close);
            // Keep the dialog owned by this rendered view: navigation/account teardown removes it.
            container.append(dialog); dismissible(dialog, finish);
            try { dialog.showModal(); close.focus(); } catch (error) { finish(); throw error; }
        };
    }
    function renderSeriesActivity(document, target, status, itemId, user, seriesLabel = '') {
        if (!status || key(status.ItemId) !== key(itemId) || !Array.isArray(status.Users) ||
            typeof status.IsComplete !== 'boolean' || typeof status.Notice !== 'string') throw new Error('Invalid series activity');
        const labels = { Watchlisted: 'Watchlisted', InProgress: 'Watching', CurrentlyPlaying: 'Currently Playing', CaughtUp: 'Caught Up', Watched: 'Watched', Unknown: 'Unknown' };
        const seen = new Set();
        for (const owner of status.Users) {
            if (!owner || !key(owner.UserId) || seen.has(key(owner.UserId)) || typeof owner.DisplayName !== 'string' ||
                !Array.isArray(owner.Reasons) || !owner.Reasons.length || owner.Reasons.some(r => !Object.prototype.hasOwnProperty.call(labels, r)) ||
                typeof owner.CoverageComplete !== 'boolean' || !Number.isInteger(owner.AvailableEpisodes) || !Number.isInteger(owner.WatchedEpisodes) ||
                owner.WatchedEpisodes < 0 || owner.AvailableEpisodes < owner.WatchedEpisodes) throw new Error('Invalid series activity user');
            episodeProgress(owner);
            seen.add(key(owner.UserId));
        }
        target.textContent = '';
        const panel = disclosure(document); panel.className = 'watchguard-series-activity';
        const summary = remoteSummary(document);
        const heading = document.createElement('span'); heading.className = 'watchguard-activity-heading';
        heading.textContent = seriesLabel || 'Series viewing'; summary.append(heading);
        let hasCounts = false;
        for (const [reason, label] of Object.entries(labels)) {
            const count = status.Users.filter(u => u.Reasons.includes(reason)).length;
            if (!count) continue;
            const chip = document.createElement('span'); chip.className = 'watchguard-chip watchguard-state-' + reason;
            chip.textContent = count + ' ' + (reason === 'CaughtUp' && status.Users.some(u => u.Reasons.includes(reason) && episodeProgress(u)?.ExtraEpisodes.some(e => !e.Watched)) ? 'Caught up on aired episodes' : label); summary.append(chip); hasCounts = true;
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
                chip.textContent = viewingLabel(owner, reason, labels[reason]); detail.append(chip);
            }
            const metrics = document.createElement('div'); metrics.className = 'watchguard-viewer-metrics';
            const count = document.createElement('span');
            appendEpisodeProgress(document, count, owner, ' episodes');
            if (!owner.CoverageComplete) { const note = document.createElement('span'); note.textContent = ' (incomplete coverage)'; count.append(note); }
            metrics.append(count);
            const aired = episodeProgress(owner);
            if (owner.CoverageComplete && (aired?.AiredAvailable ?? owner.AvailableEpisodes) > 0) {
                const progress = document.createElement('progress'); progress.max = aired?.AiredAvailable ?? owner.AvailableEpisodes; progress.value = aired?.AiredWatched ?? owner.WatchedEpisodes;
                progress.className = 'watchguard-viewer-progress watchguard-state-' + (owner.Reasons.includes('CaughtUp') ? 'CaughtUp' : owner.Reasons.includes('Watched') ? 'Watched' : 'InProgress');
                progress.setAttribute('aria-label', owner.DisplayName + ': ' + progress.value + '/' + progress.max + ' episodes'); metrics.append(progress);
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
                !Array.isArray(entry.Reasons) || !entry.Reasons.length || entry.Reasons.some(r => !Object.prototype.hasOwnProperty.call(reasons, r))) throw new Error('Invalid user');
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
            scopeId: scope.Id, parentName: scope === item ? null : (scope.Name || scope.Id), users: interested, user } : null;
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
    function userLine(document, owner, staleLive = false) {
        const line = document.createElement('div'); line.className = 'watchguard-user-line';
        const icons = document.createElement('span'); icons.className = 'watchguard-status-icons';
        const name = document.createElement('span'); name.className = 'watchguard-user';
        const stale = document.createElement('span'); stale.className = 'watchguard-live-stale';
        stale.textContent = 'Playing when loaded · may have stopped';
        const progress = document.createElement('span'); progress.className = 'watchguard-progress';
        const dates = disclosure(document); dates.className = 'watchguard-dates';
        const dateSummary = remoteSummary(document);
        const exactDates = document.createElement('div'); dates.append(dateSummary, exactDates);
        line.append(icons, name, stale, progress, dates);
        let priorProgress, priorIcons, priorDates;
        line.update = (person, retained) => {
            line.title = activityText(person, true).replace(/Currently Playing/gi, retained ? 'Playing when loaded (may have stopped)' : 'Currently Playing');
            if (name.textContent !== person.DisplayName) name.textContent = person.DisplayName;
            name.title = person.DisplayName;
            const iconKey = JSON.stringify([person.Reasons, viewingLabel(person, 'CaughtUp', 'Caught Up'), retained]);
            if (iconKey !== priorIcons) {
                for (const child of [...icons.children]) child.remove();
                for (const reason of Object.keys(activityReasons).filter(r => person.Reasons.includes(r))) {
                    const icon = document.createElement('span'); icon.className = 'material-icons watchguard-state-' + reason; icon.textContent = statusIcons[reason];
                    const label = retained && reason === 'CurrentlyPlaying' ? 'Playing when this view was loaded; may have stopped' : viewingLabel(person, reason, activityReasons[reason]);
                    icon.setAttribute('role', 'img'); icon.setAttribute('aria-label', label); icon.title = label; icons.append(icon);
                }
                priorIcons = iconKey;
            }
            stale.hidden = !(retained && person.Reasons.includes('CurrentlyPlaying'));
            const progressKey = JSON.stringify([person.DisplayName, person.AvailableEpisodes, person.WatchedEpisodes, person.EpisodeProgress]);
            if (progressKey !== priorProgress) {
                const focused = progress.contains?.(document.activeElement);
                for (const child of [...progress.children]) child.remove();
                if (person.AvailableEpisodes != null) appendEpisodeProgress(document, progress, person);
                if (focused) progress.querySelector?.('button')?.focus();
                priorProgress = progressKey;
            }
            progress.hidden = person.AvailableEpisodes == null;
            const values = [];
            if (person.Reasons.includes('Watchlisted') && Object.prototype.hasOwnProperty.call(person, 'AddedAtUtc')) values.push(['Added', person.AddedAtUtc]);
            if (person.LastPlayedDate) values.push(['Last played', person.LastPlayedDate]);
            const datesKey = JSON.stringify(values);
            if (priorDates !== datesKey) {
                for (const child of [...dateSummary.children, ...exactDates.children]) child.remove();
                for (const [label, value] of values) {
                    const short = document.createElement('span');
                    short.textContent = label + ': ' + (value ? new Intl.DateTimeFormat(undefined, {dateStyle:'medium'}).format(new Date(value)) : 'unknown');
                    dateSummary.append(short);
                    const exact = document.createElement(value ? 'time' : 'span');
                    if (value) exact.dateTime = value;
                    exact.textContent = label + ': ' + (value ? new Intl.DateTimeFormat(undefined, {dateStyle:'full', timeStyle:'long'}).format(new Date(value)) : 'unknown');
                    exactDates.append(exact);
                }
                priorDates = datesKey;
            }
            dates.hidden = !values.length;
            dateSummary.setAttribute('aria-label', 'Dates for ' + person.DisplayName + '; expand for exact times');
        };
        line.update(owner, staleLive);
        return line;
    }
    function activityText(owner, showName) {
        let text = (showName ? owner.DisplayName + ' — ' : '') + owner.Reasons.map(r => viewingLabel(owner, r, activityReasons[r]) + (r === 'CurrentlyPlaying' ? ' ●' : '')).join(' · ');
        const progress = episodeProgress(owner);
        if (owner.AvailableEpisodes != null) text += ' · ' + (progress?.AiredWatched ?? owner.WatchedEpisodes) + '/' + (progress?.AiredAvailable ?? owner.AvailableEpisodes) + ' episodes' + (progress?.ExtraEpisodes.length ? ' +' + progress.ExtraEpisodes.length : '');
        if (owner.Reasons.includes('Watchlisted') && Object.prototype.hasOwnProperty.call(owner, 'AddedAtUtc'))
            text += owner.AddedAtUtc && Number.isFinite(Date.parse(owner.AddedAtUtc))
                ? ' · Added: ' + new Intl.DateTimeFormat(undefined, {dateStyle: 'medium'}).format(new Date(owner.AddedAtUtc))
                : ' · Added: unknown';
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
                    !Array.isArray(u.Reasons) || !u.Reasons.length || u.Reasons.some(r => !Object.prototype.hasOwnProperty.call(activityReasons, r)) ||
                    (u.LastPlayedDate != null && (typeof u.LastPlayedDate !== 'string' || !Number.isFinite(Date.parse(u.LastPlayedDate)))) ||
                    (u.AddedAtUtc != null && (typeof u.AddedAtUtc !== 'string' || !Number.isFinite(Date.parse(u.AddedAtUtc)) ||
                        !u.Reasons.includes('Watchlisted')))) throw new Error('Invalid interest');
                if ((u.AvailableEpisodes == null) !== (u.WatchedEpisodes == null) ||
                    (u.AvailableEpisodes != null && (!Number.isSafeInteger(u.AvailableEpisodes) || !Number.isSafeInteger(u.WatchedEpisodes) || u.AvailableEpisodes < 0 || u.WatchedEpisodes < 0 || u.WatchedEpisodes > u.AvailableEpisodes))) throw new Error('Invalid progress');
                episodeProgress(u);
                owners.add(key(u.UserId));
            }
            const matches = entry.Users.filter(u => (owner === 'all' || key(u.UserId) === key(owner === 'mine' ? user : owner)) &&
                statuses.some(status => u.Reasons.includes(activityFilters[status]) || (status === 'watching' && u.Reasons.includes('CaughtUp'))));
            if (matches.length) selected.push({ ...entry, Users: matches,
                IsWatchlistedByMe: entry.Users.some(u => key(u.UserId) === key(user) && u.Reasons.includes('Watchlisted')) });
        }
        const recent = item => Math.max(0, ...item.Users.map(u => u.LastPlayedDate ? Date.parse(u.LastPlayedDate) : 0));
        const added = item => Math.max(0, ...item.Users.map(u =>
            u.Reasons.includes('Watchlisted') && u.AddedAtUtc ? Date.parse(u.AddedAtUtc) : 0));
        return selected.sort((a, b) => (sort === 'recent' ? recent(b) - recent(a) : sort === 'added' ? added(b) - added(a) : 0) ||
            a.Name.localeCompare(b.Name) || a.ItemId.localeCompare(b.ItemId));
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
                        if (owner.EpisodeProgress != null) previous.EpisodeProgress = owner.EpisodeProgress;
                        if (owner.LastPlayedDate && (!previous.LastPlayedDate || Date.parse(owner.LastPlayedDate) > Date.parse(previous.LastPlayedDate))) previous.LastPlayedDate = owner.LastPlayedDate;
                        if (owner.Reasons.includes('Watchlisted') && Object.prototype.hasOwnProperty.call(owner, 'AddedAtUtc')) {
                            if (Object.prototype.hasOwnProperty.call(previous, 'AddedAtUtc') && previous.AddedAtUtc !== owner.AddedAtUtc)
                                throw new Error('Conflicting watchlist dates');
                            previous.AddedAtUtc = owner.AddedAtUtc;
                        }
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
            async set(id, present, notify = true) {
                if (!valid()) throw new Error('Account changed');
                await request(api, 'Watchlist/' + encodeURIComponent(id), present ? 'PUT' : 'DELETE');
                if (!valid()) throw new Error('Account changed');
                revision++; entries = undefined; if (notify) changed(id, present);
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

    // The existing API has no separate window/episode-coverage fields. Recognize only
    // its exact routine preamble; unfamiliar notices remain visible, never hidden.
    function coveragePresentation(notice, limited, coverage) {
        if (coverage?.Version === 1 && Number.isInteger(coverage.ActivityWindowDays) && coverage.ActivityWindowDays >= 1 && coverage.ActivityWindowDays <= 90 &&
            Array.isArray(coverage.Warnings) && coverage.Warnings.every(w => typeof w === 'string')) {
            // Additive v0.4.6 fields; retain the full Notice in the disclosure and
            // retain text fallback for older servers or unfamiliar schema versions.
            return {summary: 'Completed activity: last ' + coverage.ActivityWindowDays + ' days · current interest · not exhaustive',
                warning: coverage.Warnings.join(' ') || (limited ? 'A safety limit was reached; some items are omitted.' : '')};
        }
        const routine = /^Recent viewing activity: completed titles with a native playback date in the last ([1-9][0-9]?) days, plus current viewing interest; not an exhaustive library audit\./.exec(notice);
        const remainder = routine ? notice.slice(routine[0].length).trim() : notice;
        return {
            summary: routine ? 'Completed activity: last ' + routine[1] + ' days · current interest · not exhaustive' : 'Activity coverage · not exhaustive',
            warning: remainder || (limited ? 'A safety limit was reached; some items are omitted.' : '')
        };
    }

    // Shared native emby-checkbox structure. The real input owns keyboard,
    // checked and focus behavior; the decorative outline never handles events.
    function checkboxLabel(document, input, text) {
        const label = document.createElement('label'); label.className = 'emby-checkbox-label';
        input.className = 'emby-checkbox';
        input.addEventListener('keydown', event => {
            if (event.key === 'Enter' && !input.disabled) { event.preventDefault(); event.stopPropagation(); input.click(); }
        });
        const caption = document.createElement('span'); caption.className = 'checkboxLabel'; caption.textContent = text;
        const outline = document.createElement('span'); outline.className = 'checkboxOutline'; outline.setAttribute('aria-hidden', 'true');
        const icon = document.createElement('span'); icon.className = 'material-icons checkboxIcon checkboxIcon-checked'; icon.textContent = 'check';
        outline.append(icon); label.append(input, caption, outline); return label;
    }

    function watchlistsPage(document, api, signal, filter, navigate, options = {}) {
        let raw = {owner: filter, interest: options.interest, sort: options.sort};
        let range = [7,30,90].includes(Number(options.days)) ? Number(options.days) : 30, includeOlder = options.older !== 'false';
        let continuation = null, pollTimer = null, searchTimer = null, loadedPages = 1, indexPopulating = false;
        let searchText = (options.search || '').slice(0, 120), combined = false, preparing = false, requiresRefresh = false;
        let freshnessRevision = null, checkCursor = null, updatesAvailable = false, liveStale = false;
        let queryFailed = false, checkFailed = false;
        let queryQueue = Promise.resolve();
        const automaticRequestBudget = 4;
        let saved = {Owner: 'mine', Statuses: [...defaultFilters], Sort: 'title'}, preferencesLoaded = false;
        let initialization = null;
        filter = filter || 'mine';
        let kind = selectedStatuses(options.interest);
        let sort = ['title', 'recent', 'added'].includes(options.sort) ? options.sort : 'title';
        const page = document.createElement('section'); page.className = 'watchguard-page backgroundContainer padded-left padded-right';
        page.setAttribute('role', 'region'); page.setAttribute('aria-label', 'Watchlists');
        const heading = document.createElement('h1'); heading.className = 'sectionTitle'; heading.textContent = 'Watchlists';
        const toolbar = document.createElement('div'); toolbar.className = 'watchguard-toolbar';
        function dropdown(label, choices) {
            const select = document.createElement('select'); select.className = 'emby-select emby-select-withcolor'; select.setAttribute('aria-label', label);
            tvChoices(document, select, signal, () => active(), page);
            for (const [value, text, disabled] of choices) {
                const option = document.createElement('option'); option.value = value; option.textContent = text; option.disabled = !!disabled; select.append(option);
            }
            return select;
        }
        function selectArrow() {
            const arrow = document.createElement('span'); arrow.className = 'selectArrowContainer'; arrow.setAttribute('aria-hidden', 'true');
            const icon = document.createElement('span'); icon.className = 'material-icons selectArrow'; icon.textContent = 'keyboard_arrow_down'; arrow.append(icon); return arrow;
        }
        const select = dropdown('Watchlist owner', []); select.hidden = true;
        const interestFilter = disclosure(document); interestFilter.className = 'watchguard-filter';
        const summary = remoteSummary(document); summary.className = 'emby-button button-flat focusable'; summary.setAttribute('aria-label', 'Status filters');
        const filterIcon = document.createElement('span'); filterIcon.className = 'material-icons'; filterIcon.textContent = 'filter_list'; filterIcon.setAttribute('aria-hidden', 'true');
        const filterCount = document.createElement('span'); summary.append(filterIcon, filterCount);
        const choicesPanel = document.createElement('div'); choicesPanel.className = 'watchguard-filter-options paperList';
        const checkboxes = new Map();
        for (const [value, reason] of Object.entries(activityFilters)) {
            const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.value = value;
            const label = checkboxLabel(document, checkbox, reason === 'Watchlisted' ? 'Watchlisted' : activityReasons[reason]);
            checkbox.onchange = () => { kind = [...checkboxes].filter(([, box]) => box.checked).map(([id]) => id); change(); };
            choicesPanel.append(label); checkboxes.set(value, checkbox);
        }
        const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'emby-button button-flat'; reset.textContent = 'Reset to Defaults';
        let resetting = false, saving = false;
        reset.onclick = async () => {
            if (!options.preferences) { kind = [...defaultFilters]; change(); return; }
            if (!active() || resetting || saving) return;
            // Keep keyboard focus while the preference request is pending.
            resetting = true; reset.setAttribute('aria-disabled', 'true'); save.setAttribute('aria-disabled', 'true'); reset.setAttribute('aria-busy', 'true');
            try {
                await preferenceRequest(api, 'DELETE');
                if (!active()) return;
                saved = {Owner: 'mine', Statuses: [...defaultFilters], Sort: 'title'};
                preferenceMessage.textContent = 'Defaults restored.';
                navigate('mine', defaultFilters.join(','), 'title');
            } catch { if (active()) preferenceMessage.textContent = 'Could not reset saved defaults. Please retry.'; }
            finally { resetting = false; reset.setAttribute('aria-disabled', 'false'); save.setAttribute('aria-disabled', 'false'); reset.setAttribute('aria-busy', 'false'); }
        };
        const save = document.createElement('button'); save.type = 'button'; save.className = 'emby-button button-flat'; save.textContent = 'Save view as defaults';
        save.onclick = async () => {
            if (!active() || saving || resetting) return;
            saving = true; save.setAttribute('aria-disabled', 'true'); reset.setAttribute('aria-disabled', 'true'); save.setAttribute('aria-busy', 'true');
            try {
                const result = await preferenceRequest(api, 'PUT', {Owner: admin ? filter || 'mine' : 'mine', Statuses: [...kind], Sort: sort});
                if (active()) { saved = result; preferenceMessage.textContent = 'View saved as your defaults.'; }
            } catch { if (active()) preferenceMessage.textContent = 'Could not save defaults. Please retry.'; }
            finally { saving = false; save.setAttribute('aria-disabled', 'false'); reset.setAttribute('aria-disabled', 'false'); save.setAttribute('aria-busy', 'false'); }
        };
        if (options.preferences) choicesPanel.append(save);
        choicesPanel.append(reset); interestFilter.append(summary, choicesPanel);
        interestFilter.addEventListener('toggle', () => interestFilter.classList.toggle('focuscontainer', interestFilter.open));
        const dismissOutside = event => { if (!interestFilter.contains(event.target)) interestFilter.open = false; };
        if (!signal.aborted) {
            document.addEventListener?.('pointerdown', dismissOutside);
            signal.addEventListener('abort', () => document.removeEventListener?.('pointerdown', dismissOutside), {once:true});
        }
        const order = dropdown('Sort by', [['title', 'Title'], ['recent', 'Playback recency'], ['added', 'Recently added']]); order.value = sort;
        order.title = 'Recently added uses recorded watchlist dates for the selected owners; older/unknown dates sort last. Playback recency uses native viewing dates.';
        const refresh = document.createElement('button'); refresh.className = 'emby-button button-flat watchguard-refresh'; refresh.type = 'button'; refresh.title = 'Refresh'; refresh.setAttribute('aria-label', 'Refresh');
        const refreshIcon = document.createElement('span'); refreshIcon.className = 'material-icons'; refreshIcon.textContent = 'refresh'; refreshIcon.setAttribute('aria-hidden', 'true'); refresh.append(refreshIcon);
        const ownerGroup = document.createElement('label'); ownerGroup.className = 'watchguard-toolbar-field watchguard-owner';
        const ownerLabel = document.createElement('span'); ownerLabel.className = 'selectLabel'; ownerLabel.textContent = 'Owner'; ownerGroup.append(ownerLabel, select, selectArrow());
        const sortGroup = document.createElement('label'); sortGroup.className = 'watchguard-toolbar-field watchguard-sort';
        const sortLabel = document.createElement('span'); sortLabel.className = 'selectLabel'; sortLabel.textContent = 'Sort by'; sortGroup.append(sortLabel, order, selectArrow());
        toolbar.append(ownerGroup, interestFilter, sortGroup, refresh);
        const search = document.createElement('input'); search.type = 'search'; search.maxLength = 120;
        search.className = 'emby-input'; search.setAttribute('aria-label', 'Search titles'); search.placeholder = 'Search known titles'; search.setAttribute('aria-describedby', 'watchguard-search-scope'); search.value = searchText;
        if (options.indexedActivity) {
            const field = document.createElement('label'); field.className = 'watchguard-toolbar-field watchguard-search';
            const label = document.createElement('span'); label.className = 'inputLabel'; label.textContent = 'Search titles'; field.append(label, search); toolbar.append(field);
        }
        const rangeSelect = dropdown('Activity range', [['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days']]);
        const olderToggle = document.createElement('input'); olderToggle.type = 'checkbox';
        const secondary = disclosure(document); secondary.className = 'watchguard-secondary';
        const secondarySummary = remoteSummary(document); secondary.append(secondarySummary);
        if (options.indexedActivity) {
            const field = document.createElement('label'); field.className = 'watchguard-toolbar-field';
            const label = document.createElement('span'); label.className = 'selectLabel'; label.textContent = 'Activity range'; field.append(label, rangeSelect, selectArrow());
            const olderLabel = checkboxLabel(document, olderToggle, 'Include older current interest'); olderLabel.classList.add('watchguard-older-interest');
            secondary.append(field, olderLabel); toolbar.append(secondary);
        }
        const more = document.createElement('button'); more.type = 'button'; more.className = 'emby-button button-flat'; more.textContent = 'Load more activity'; more.hidden = true;
        const updates = document.createElement('button'); updates.type = 'button'; updates.className = 'emby-button button-flat';
        updates.textContent = 'Updates available'; updates.title = 'Refresh this view with the same filters'; updates.hidden = true;
        updates.onclick = () => { if (active() && !pending) load(); };
        const freshness = document.createElement('p'); freshness.className = 'watchguard-notice';
        const status = document.createElement('p');
        const announcement = document.createElement('span'); announcement.className = 'watchguard-sr-only'; announcement.setAttribute('role', 'status');
        let lastAnnouncement = '';
        const setText = (element, text) => { if (element.textContent !== text) element.textContent = text; };
        const spinner = document.createElement('span'); spinner.className = 'material-icons watchguard-spinner'; spinner.textContent = 'sync'; spinner.setAttribute('aria-hidden', 'true');
        status.className = 'watchguard-loading-status';
        const notice = document.createElement('div'); notice.className = 'watchguard-notice'; notice.hidden = true;
        const coverageDetails = disclosure(document); coverageDetails.className = 'watchguard-coverage-details';
        const coverageSummary = remoteSummary(document);
        const coverageText = document.createElement('p');
        const searchScope = document.createElement('p'); searchScope.id = 'watchguard-search-scope'; searchScope.textContent = 'Search covers known activity and watchlists, not the entire library.';
        const updateHelp = document.createElement('p'); updateHelp.textContent = 'The first page updates every 30 seconds while visible. After Load more, checks keep the displayed order and offer updates separately. Playback labels describe the last loaded state; discovery and verification may still be incomplete.';
        searchScope.hidden = !options.indexedActivity; updateHelp.hidden = !options.indexedActivity;
        coverageDetails.append(coverageSummary, searchScope, coverageText, updateHelp);
        const coverageWarning = document.createElement('p'); coverageWarning.className = 'watchguard-coverage-warning'; coverageWarning.setAttribute('role', 'status');
        notice.append(coverageDetails, coverageWarning);
        const error = document.createElement('p'); error.setAttribute('role', 'alert');
        const grid = document.createElement('div'); grid.className = 'watchguard-grid';
        const preferenceMessage = document.createElement('p'); preferenceMessage.setAttribute('role', 'status'); preferenceMessage.className = 'watchguard-notice';
        page.append(heading, toolbar, status, notice, error, grid, preferenceMessage);
        page.append(announcement);
        if (options.indexedActivity) { status.after?.(freshness); page.append(updates, more); }
        const user = api.getCurrentUserId(), token = api.accessToken();
        const active = () => !signal.aborted && api.getCurrentUserId() === user && api.accessToken() === token;
        let directory = [], loadedScope, viewSignature, viewGeneration, ownerChoices;
        const requestedView = () => JSON.stringify([filter, kind, sort, range, includeOlder, searchText]);
        let polling = false;
        let generation = 0, admin = false, accountKnown = false, explicit = [], automatic = [], pending = true, coverage = '', coverageLimited = false, coverageInfo = null, failures = [];
        const cards = new Map();
        // Action feedback survives data refreshes. A retry clears only its title;
        // a changed filter context or page/account teardown clears all feedback.
        const removalFailures = new Set(), removals = new Set();
        let removalContext = 0;
        const clearRemovalFeedback = () => { removalFailures.clear(); removalContext++; };
        const renderErrors = () => setText(error, [...failures, ...(removalFailures.size ? ['WatchGuard: Could not remove this entry. Please retry.'] : [])].join(' '));
        signal.addEventListener('abort', () => { generation++; if (pollTimer) clearTimeout(pollTimer); if (searchTimer) clearTimeout(searchTimer); cards.clear(); clearRemovalFeedback(); removals.clear(); error.textContent = ''; page.remove(); }, { once: true });
        function render() {
            if (!active()) return;
            page.setAttribute('data-watchguard-scope', loadedScope || '');
            rangeSelect.value = String(range); olderToggle.checked = includeOlder; more.hidden = (!continuation && !requiresRefresh) || (preparing && pending); more.disabled = pending;
            updates.hidden = !updatesAvailable; updates.disabled = pending;
            const entries = combined ? automatic : mergeInterest(explicit, automatic);
            if (!admin && entries.some(e => e.Users.some(u => key(u.UserId) !== key(user)))) throw new Error('Invalid account scope');
            const selected = combined ? entries.map(e => ({...e, IsWatchlistedByMe: e.Users.some(u => key(u.UserId) === key(user) && u.Reasons.includes('Watchlisted'))})) :
                selectInterest(entries, admin ? filter : 'mine', user, kind, sort).filter(e => e.Name.toLowerCase().includes(searchText.trim().toLowerCase()));
            more.textContent = requiresRefresh ? 'Refresh this view' : preparing ? 'Continue loading' : 'Load more results';
            const owners = new Map([...directory, ...entries.flatMap(entry => entry.Users)].map(owner => [key(owner.UserId), owner]));
            const choices = [['mine', 'My list'], ...(admin ? [['all', 'All users'], ...Array.from(owners.values())
                .sort((a, b) => a.DisplayName.localeCompare(b.DisplayName)).map(owner => [key(owner.UserId), owner.DisplayName])] : [])];
            if (admin && !choices.some(([value]) => value === filter)) choices.push([filter, 'Unavailable user']);
            const choicesKey = JSON.stringify(choices);
            if (choicesKey !== ownerChoices) {
                const existing = new Map([...select.children].map(option => [option.value, option]));
                const values = new Set(choices.map(([value]) => value));
                for (const option of [...select.children]) if (!values.has(option.value)) option.remove();
                for (const [position, [value, name]] of choices.entries()) {
                    const option = existing.get(value) || document.createElement('option');
                    option.value = value; setText(option, name);
                    if (select.children[position] !== option) select.insertBefore(option, select.children[position] || null);
                }
                ownerChoices = choicesKey;
            }
            select.value = admin ? filter : 'mine'; select.hidden = !admin; ownerGroup.hidden = !admin;
            for (const [id, checkbox] of checkboxes) checkbox.checked = kind.includes(id);
            setText(filterCount, 'Status · ' + kind.length);
            summary.title = 'Status filters (' + kind.length + ' selected)'; summary.setAttribute('aria-label', summary.title); order.value = sort;
            const amount = selected.length + (selected.length === 1 ? ' title loaded' : ' titles loaded');
            let state = 'ready', message = selected.length ? amount + (continuation ? ' · More available' : '') : 'No matches for these filters';
            let detail = '';
            if (!kind.length) { state = 'unselected'; message = 'Select a status to see titles'; }
            else if (requiresRefresh) { state = 'expired'; message = (selected.length ? amount + ' · ' : '') + 'View expired'; detail = 'Refresh this view to continue with the same filters.'; }
            else if (preparing && !pending) { state = 'paused'; message = 'Loading paused'; detail = 'Continue loading to finish this view.'; }
            else if (pending && !polling) { state = selected.length && !combined ? 'preliminary' : 'loading'; message = selected.length && combined ? amount + ' · Loading…' : 'Loading viewing activity…'; }
            else if (failures.length || queryFailed || checkFailed) { state = 'failed'; message = selected.length ? amount + ' · Update unavailable' : 'Activity unavailable'; detail = 'Refresh to retry.'; }
            else if (updatesAvailable) { state = 'updates'; message = amount + ' · Updates available'; }
            else if (indexPopulating) { state = 'populating'; message = selected.length ? amount + ' · Background population' : 'Background population · No verified matches yet'; }
            else if (!selected.length) { state = 'empty'; if (kind.length === 4 && !searchText) message = 'No known activity or watchlists'; }
            if (!combined && selected.length && options.indexedActivity) detail = 'Showing preliminary watchlists only.' + (detail ? ' ' + detail : '');
            if (checkCursor && state === 'ready') detail = 'Checking for updates will continue automatically.';
            if (polling && state === 'ready') detail = loadedPages > 1 ? 'Checking for updates…' : 'Updating…';
            page.setAttribute('data-view-state', state);
            setText(status, message); setText(freshness, detail); freshness.hidden = !detail;
            // A separate, deduplicated live region announces settled changes, never
            // routine poll starts or a whole grid. Exact row changes stay in place.
            const announcementText = message + (detail ? '. ' + detail : '');
            if (!pending && announcementText !== lastAnnouncement) { setText(announcement, announcementText); lastAnnouncement = announcementText; }
            spinner.hidden = !pending; if (pending && !polling) status.append(spinner); page.setAttribute('aria-busy', String(pending));
            const info = coveragePresentation(coverage, coverageLimited, coverageInfo);
            notice.hidden = !options.indexedActivity && !coverage && !coverageLimited;
            setText(secondarySummary, 'Activity: ' + range + ' days' + (includeOlder ? ' · older interest included' : ' · recent only'));
            setText(coverageSummary, 'About these results');
            setText(coverageText, coverage); // Complete server explanation stays available.
            const warning = info.warning === 'Some visible activity is awaiting background verification.' ? '' : info.warning;
            setText(coverageWarning, warning); coverageWarning.hidden = !warning;
            renderErrors();
            const visible = new Set(selected.map(e => key(e.ItemId)));
            for (const [id, record] of cards) if (!visible.has(id)) record.card.remove();
            for (const [position, entry] of selected.entries()) {
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
                    const otherOwners = disclosure(document); otherOwners.className = 'watchguard-more-owners';
                    const otherSummary = remoteSummary(document); otherOwners.append(otherSummary);
                    const extraOwners = document.createElement('div'); otherOwners.append(extraOwners);
                    card.append(ownersText, otherOwners); record = { card, name, ownersText, otherOwners, otherSummary, extraOwners, rows: new Map() }; cards.set(key(entry.ItemId), record);
                }
                record.name.textContent = entry.Name; record.name.title = entry.Name;
                const staleLive = options.indexedActivity && (liveStale || loadedPages > 1);
                const ownerIds = new Set(entry.Users.map(o => key(o.UserId)));
                for (const [id, row] of record.rows) if (!ownerIds.has(id)) { row.remove(); record.rows.delete(id); }
                for (const [index, owner] of entry.Users.entries()) {
                    const id = key(owner.UserId);
                    let row = record.rows.get(id);
                    if (!row) { row = userLine(document, owner, staleLive); record.rows.set(id, row); }
                    else row.update(owner, staleLive);
                    const target = index < 2 ? record.ownersText : record.extraOwners, position = index < 2 ? index : index - 2;
                    if (target.children[position] !== row) target.insertBefore(row, target.children[position] || null);
                }
                record.otherOwners.hidden = entry.Users.length <= 2;
                setText(record.otherSummary, (entry.Users.length - 2) + ' more ' + (entry.Users.length === 3 ? 'person' : 'people'));
                if (!entry.IsWatchlistedByMe) { record.remove?.remove(); record.remove = null; }
                if (entry.IsWatchlistedByMe && !record.remove) {
                    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'emby-button button-flat watchguard-remove';
                    const icon = document.createElement('span'); icon.className = 'material-icons'; icon.textContent = 'bookmark_remove'; icon.setAttribute('aria-hidden', 'true'); remove.append(icon);
                    remove.title = 'Remove from Watchlist'; remove.setAttribute('aria-label', 'Remove ' + entry.Name + ' from Watchlist');
                    remove.onclick = async () => {
                        const id = key(entry.ItemId);
                        if (!active() || removals.has(id)) return;
                        const revision = generation, context = removalContext;
                        removals.add(id); removalFailures.delete(id);
                        remove.disabled = true; renderErrors();
                        try {
                            await request(api, 'Watchlist/' + encodeURIComponent(entry.ItemId), 'DELETE');
                            if (!active() || revision !== generation) return;
                            explicit = explicit.map(e => key(e.ItemId) === key(entry.ItemId) ? { ...e, Users: e.Users.filter(u => key(u.UserId) !== key(user)) } : e).filter(e => e.Users.length);
                            if (options.indexedActivity) await load(true); else render();
                        } catch (failure) {
                            if (authorizationDenied(failure)) return;
                            if (active() && revision === generation && context === removalContext) { removalFailures.add(id); renderErrors(); }
                        } finally {
                            removals.delete(id);
                            if (active()) remove.disabled = false;
                        }
                    };
                    record.card.append(remove); record.remove = remove;
                }
                if (record.remove) { record.remove.setAttribute('aria-label', 'Remove ' + entry.Name + ' from Watchlist'); record.remove.disabled = removals.has(key(entry.ItemId)); }
                if (grid.children[position] !== record.card) grid.insertBefore(record.card, grid.children[position] || null); // Preserve unchanged nodes and focus.
            }
        }
        function authorizationDenied(failure) {
            if (!active() || ![401, 403].includes(failure?.status)) return false;
            // Even a superseded request's denial invalidates this captured
            // account's protected view. No concurrent response may restore it.
            generation++;
            if (pollTimer) clearTimeout(pollTimer); if (searchTimer) clearTimeout(searchTimer);
            explicit = []; automatic = []; directory = []; continuation = null;
            loadedPages = 1; indexPopulating = false; pending = false; combined = false; preparing = false; requiresRefresh = false;
            coverage = ''; coverageLimited = false; coverageInfo = null;
            freshnessRevision = null; checkCursor = null; updatesAvailable = false; liveStale = false; queryFailed = false; checkFailed = false;
            grid.textContent = ''; cards.clear(); clearRemovalFeedback(); freshness.textContent = '';
            failures = ['WatchGuard: Authorization denied. Reload or authenticate again before viewing activity.'];
            refresh.setAttribute('aria-disabled', 'false'); render();
            return true;
        }
        function queryRequest(route, revision) {
            const operation = queryQueue.then(async () => {
                if (!active() || revision !== generation) return null;
                try { return await request(api, route); }
                catch (failure) { authorizationDenied(failure); throw failure; }
            });
            queryQueue = operation.catch(() => {});
            return operation;
        }
        function validateBrowser(result) {
            if (!result || result.IsComplete !== false || !result.Freshness ||
                (result.Freshness.Revision != null && typeof result.Freshness.Revision !== 'string') ||
                (result.Continuation != null && typeof result.Continuation !== 'string')) throw new Error('Invalid activity query');
            selectInterest(result.Items, 'all', user);
            if (result.Items.some(e => e.Users.some(u => loadedScope !== 'all' && key(u.UserId) !== key(loadedScope === 'mine' ? user : loadedScope)))) throw new Error('Invalid scope');
        }
        async function queryBatch(cursor, revision, {check = false, prioritize = false} = {}) {
            const route = indexRoute(loadedScope, null) + (check ? '&check=true&revision=' + encodeURIComponent(freshnessRevision || '') : '');
            const seen = new Set(cursor ? [cursor] : []);
            for (let n = 0; n < automaticRequestBudget; n++) {
                const result = await queryRequest(route + (prioritize && n === 0 && !cursor ? '&refresh=true' : '') + (cursor ? '&continuation=' + encodeURIComponent(cursor) : ''), revision);
                if (!active() || revision !== generation) return null;
                validateBrowser(result);
                if (check && (typeof result.Changed !== 'boolean' || result.Freshness.Revision !== freshnessRevision || result.Items.length)) throw new Error('Invalid activity change check');
                const advance = check ? result.Preparing && !result.Changed : result.Preparing || (!result.Items.length && result.Continuation);
                if (!advance) return {result, waiting: false};
                if (!result.Continuation || seen.has(result.Continuation)) throw Object.assign(new Error('Activity query did not advance'), {status:409});
                seen.add(result.Continuation); cursor = result.Continuation;
                if (n === automaticRequestBudget - 1) return {result, waiting: true};
            }
        }
        function firstPage(batch) {
            const {result, waiting} = batch;
            coverage = result.Notice; coverageLimited = result.LimitReached; coverageInfo = result.Coverage;
            if (waiting) {
                preparing = true; continuation = result.Continuation; liveStale = true; requiresRefresh = false;
                if (!automatic.length) combined = false;
                return;
            }
            indexState(result); automatic = result.Items; loadedPages = 1; failures = [];
            freshnessRevision = result.Freshness.Revision; checkCursor = null; updatesAvailable = false; liveStale = false; queryFailed = false; checkFailed = false;
        }
        function queryFailure(failure, check = false) {
            if ([400,409].includes(failure?.status)) { continuation = null; checkCursor = null; requiresRefresh = true; }
            liveStale = true;
            if (check) checkFailed = true; else queryFailed = true;
        }
        // Account/preferences belong to the page lifetime, not a query generation.
        // Early controls share this work; only the latest load may request data.
        function initialize() {
            if (initialization) return initialization;
            const operation = (async () => {
                const account = await api.getCurrentUser();
                if (!active()) return null;
                admin = account.Policy?.IsAdministrator === true; accountKnown = true;
                if (options.indexedActivity) render();
                if (options.preferences && !preferencesLoaded) {
                    try {
                        const result = await preferenceRequest(api);
                        if (!active()) return null;
                        if (!result || typeof result.Owner !== 'string' || !Array.isArray(result.Statuses) || result.Statuses.some(s => !activityFilters[s]) || !['title','recent','added'].includes(result.Sort)) throw new Error('Invalid preferences');
                        saved = result;
                    } catch (failure) {
                        if (authorizationDenied(failure)) return null;
                        if (active()) preferenceMessage.textContent = 'Saved defaults unavailable. Using URL or built-in defaults; stored data was not changed.';
                    }
                    if (!active()) return null;
                    preferencesLoaded = true;
                    // raw is the latest URL/control intent, including changes made
                    // while this request was pending. Saved values fill gaps only.
                    const view = preferenceView(saved, raw.owner, raw.interest, raw.sort);
                    filter = view.owner; kind = selectedStatuses(view.interest); sort = ['title', 'recent', 'added'].includes(view.sort) ? view.sort : 'title';
                }
                return account;
            })();
            initialization = operation;
            const finished = () => { if (initialization === operation) initialization = null; };
            operation.then(finished, finished);
            return operation;
        }
        async function load(prioritize = false) {
            if (!active()) return;
            const revision = ++generation;
            // Own the requested view before account/preferences initialization.
            // A return to an earlier view must replace intervening work; an
            // equivalent update must retain work that still owns this generation.
            viewGeneration = revision; viewSignature = requestedView();
            const current = () => active() && revision === generation;
            polling = false; pending = true; failures = []; coverage = ''; coverageLimited = false; coverageInfo = null; notice.hidden = true; refresh.setAttribute('aria-disabled', 'true');
            status.textContent = 'Loading watchlists…'; spinner.hidden = false; status.append(spinner); page.setAttribute('aria-busy', 'true'); renderErrors();
            try {
                const account = await initialize();
                if (!current() || !account) return;
                const scope = !admin || filter === 'mine' || key(filter) === key(user) ? 'mine' : filter;
                loadedScope = scope; viewSignature = requestedView();
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
                    const entries = result.map(e => ({ ...e, Users: (scope !== 'mine' ? e.Users : [{
                        UserId: user, DisplayName: account.Name || 'You',
                        ...(Object.prototype.hasOwnProperty.call(e, 'AddedAtUtc') ? { AddedAtUtc: e.AddedAtUtc } : {})
                    }]).map(u => ({ ...u, Reasons: ['Watchlisted'], LastPlayedDate: null })) }));
                    selectInterest(entries, 'all', user); explicit = entries; if (!automatic.length) combined = false;
                } catch (failure) { if (authorizationDenied(failure) || !current()) return; if (!options.indexedActivity) explicit = []; failures.push('WatchGuard: Could not load watchlists. Please refresh to retry.'); }
                if (!options.indexedActivity) automatic = [];
                render(); // Paint memberships before activity is available.
                try {
                    const batch = options.indexedActivity ? await queryBatch(null, revision, {prioritize}) : null;
                    if (!current()) return;
                    const result = options.indexedActivity ? batch.result : await request(api, scope === 'mine' ? 'ActivityOverview/Me' : scope === 'all' ? 'ActivityOverview' : 'ActivityOverview/Users/' + encodeURIComponent(scope));
                    if (!current()) return;
                    if (!result || result.IsComplete !== false || typeof result.LimitReached !== 'boolean' || typeof result.Notice !== 'string') throw new Error('Invalid coverage');
                    selectInterest(result.Items, 'all', user);
                    if (result.Items.some(e => e.Users.some(u => (scope !== 'all' && key(u.UserId) !== key(scope === 'mine' ? user : scope)) || (!options.indexedActivity && u.Reasons.includes('Watchlisted'))))) throw new Error('Invalid automatic scope');
                    if (options.indexedActivity) firstPage(batch);
                    else { automatic = result.Items; coverage = result.Notice; coverageLimited = result.LimitReached; coverageInfo = result.Coverage; }
                } catch (failure) {
                    if (authorizationDenied(failure) || !current()) return;
                    // Keep a same-view refresh usable on transport/lookup failure.
                    // Native authorization failures must clear previously shown activity.
                    if (!options.indexedActivity) automatic = [];
                    if (options.indexedActivity) queryFailure(failure);
                    failures.push('WatchGuard: Viewing activity unavailable. Results are incomplete; refresh to retry.');
                }
                pending = false; render();
            } catch (failure) { if (authorizationDenied(failure)) return; if (current()) { pending = false; failures = ['WatchGuard: Could not verify this account.']; explicit = []; automatic = []; directory = []; continuation = null; render(); } }
            finally { if (current()) { refresh.setAttribute('aria-disabled', 'false'); schedulePoll(); } }
        }
        function indexRoute(scope, cursor, prioritize = false) {
            return 'ActivityBrowser?owner=' + encodeURIComponent(scope) + '&days=' + range + '&older=' + includeOlder +
                '&statuses=' + encodeURIComponent(kind.join(',') || 'none') + '&sort=' + encodeURIComponent(sort) + '&search=' + encodeURIComponent(searchText.trim()) +
                (cursor ? '&continuation=' + encodeURIComponent(cursor) : '') + (prioritize ? '&refresh=true' : '');
        }
        function indexState(result) {
            if (!result.Freshness || (result.Freshness.Revision != null && typeof result.Freshness.Revision !== 'string') || (result.Continuation != null && typeof result.Continuation !== 'string')) throw new Error('Invalid index status');
            for (const item of result.Items) for (const owner of item.Users) if (owner.Reasons.includes('Watchlisted') && !Object.prototype.hasOwnProperty.call(owner, 'AddedAtUtc')) owner.AddedAtUtc = null;
            preparing = result.Preparing === true; combined = !preparing; requiresRefresh = false;
            continuation = result.Continuation || null; indexPopulating = Object.prototype.hasOwnProperty.call(result.Freshness, 'PopulationPending') ? result.Freshness.PopulationPending : !result.Freshness.DiscoveryFinished || result.Freshness.Pending > 0;
            if (Object.prototype.hasOwnProperty.call(result.Freshness, 'PopulationPending')) return;

        }
        function schedulePoll() {
            if (!options.indexedActivity || !active()) return;
            if (pollTimer) clearTimeout(pollTimer);
            pollTimer = setTimeout(async () => {
                if (!active()) return;
                if (document.hidden || pending) { schedulePoll(); return; }
                const revision = generation;
                if (preparing) { schedulePoll(); return; }
                const position = page.scrollTop;
                polling = true; pending = true; render(); page.scrollTop = position;
                try {
                    if (loadedPages === 1) {
                        const batch = await queryBatch(null, revision);
                        if (!batch) return;
                        firstPage(batch);
                    } else {
                        const batch = await queryBatch(checkCursor, revision, {check:true});
                        if (!batch) return;
                        const {result, waiting} = batch;
                        checkCursor = waiting ? result.Continuation : null;
                        // A successful comparison repairs only its transport state. It
                        // neither reloads retained playback nor clears other failures.
                        checkFailed = false;
                        if (result.Changed === true) updatesAvailable = true;

                    }
                } catch (failure) {
                    if (authorizationDenied(failure)) return;
                    if (active() && revision === generation) queryFailure(failure, loadedPages > 1);
                } finally {
                    if (active() && revision === generation) { polling = false; pending = false; render(); page.scrollTop = position; schedulePoll(); }
                }
            }, 30000);
            pollTimer.unref?.();
        }
        more.onclick = async () => {
            if (active() && !pending && requiresRefresh) return load(true);
            if (!active() || pending || !continuation) return;
            const revision = generation, cursor = continuation;
            pending = true; render();
            try {
                if (preparing) {
                    const batch = await queryBatch(cursor, revision);
                    if (!batch) return;
                    firstPage(batch);
                } else {
                    const result = await queryRequest(indexRoute(loadedScope, cursor), revision);
                    if (!active() || revision !== generation) return;
                    validateBrowser(result);
                    const merged = mergeInterest(automatic, result.Items);
                    indexState(result); automatic = merged; loadedPages++;
                    coverage = result.Notice; coverageLimited = result.LimitReached; coverageInfo = result.Coverage;
                }
            } catch (failure) { if (authorizationDenied(failure)) return; if (active() && revision === generation) {
                queryFailure(failure);
                failures = ['Could not continue this view; loaded results are retained. Use Refresh to restart with the same filters.'];
            } }
            finally { if (active() && revision === generation) { pending = false; render(); schedulePoll(); } }
        };
        page.updateFilters = (owner, interest, sorting, days, older, text = '') => {
            if (searchTimer) { clearTimeout(searchTimer); searchTimer = null; }
            const previousView = JSON.stringify([filter, kind, sort, range, includeOlder, searchText]);
            searchText = text.slice(0, 120); if (search.value !== searchText) search.value = searchText;
            const nextRange = [7,30,90].includes(Number(days)) ? Number(days) : 30, nextOlder = older !== 'false';
            const timeChanged = range !== nextRange || includeOlder !== nextOlder;
            range = nextRange; includeOlder = nextOlder;
            raw = {owner, interest, sort: sorting};
            const view = preferenceView(saved, owner, interest, sorting);
            filter = view.owner; kind = selectedStatuses(view.interest); sort = ['title', 'recent', 'added'].includes(view.sort) ? view.sort : 'title';
            if (previousView !== JSON.stringify([filter, kind, sort, range, includeOlder, searchText])) clearRemovalFeedback();
            const nextScope = !admin || filter === 'mine' || key(filter) === key(user) ? 'mine' : filter;
            if (options.indexedActivity ? viewGeneration !== generation || viewSignature !== requestedView() : !loadedScope || nextScope !== loadedScope || timeChanged) { generation++; explicit = []; automatic = []; continuation = null; combined = false; preparing = false; requiresRefresh = false; freshnessRevision = null; checkCursor = null; updatesAvailable = false; liveStale = false; queryFailed = false; checkFailed = false; loadedPages = 1; pending = true; render(); load(); } else render();
        };
        const change = () => { if (active()) { const args = [accountKnown ? select.value || 'mine' : filter, kind.join(',') || 'none', order.value]; if (options.indexedActivity) args.push(rangeSelect.value, String(olderToggle.checked), search.value); navigate(...args); } };
        search.oninput = () => {
            if (!active()) return;
            generation++; clearRemovalFeedback(); if (searchTimer) clearTimeout(searchTimer);
            continuation = null; polling = false; pending = true; refresh.setAttribute('aria-disabled', 'false'); render();
            searchTimer = setTimeout(() => { searchTimer = null; if (search.value === searchText) load(); else change(); }, 250);
        };
        select.onchange = change; order.onchange = change; rangeSelect.onchange = change; olderToggle.onchange = change;
        refresh.onclick = () => { if (refresh.getAttribute('aria-disabled') !== 'true') return load(true); };
        if (!signal.aborted) { render(); load(); }
        return page;
    }

/* Jellyfin 12.2 server approval adapter. Native default remains Web-only. */
function createServerAdapter(ask, log, check, contextValid, dependencies) {
    const deps = dependencies || {
        resolveScope, validateStatus,
        location: () => root.location.href,
        notice: text => confirmDeletion(document, text, false, lifetime.signal),
        status: enabled => { const title = document.getElementById('watchguard-delete-title'); if (title) { const line = document.createElement('p'); line.className = 'watchguard-server-status'; line.style.cssText = 'font-size:.85em;color:#bbb'; line.textContent = enabled ? 'Server approval required · native HTTP item deletion guard' : 'Web-only warning · server enforcement unavailable'; title.after(line); } },
        watchNavigation: callback => { root.addEventListener('hashchange', callback); root.addEventListener('popstate', callback); return () => { root.removeEventListener('hashchange', callback); root.removeEventListener('popstate', callback); }; },
        close: () => document.querySelector('dialog.watchguard-deletion-dialog')?.close()
    };
    const installed = new WeakMap();
    let enforcementExpected = /*WATCHGUARD_SERVER_EXPECTED*/false || deps.expected === true;
    let queue = Promise.resolve(), sequence = 0;
    const emit = (event, operation = 0) => { try { log?.(event, operation); } catch { /* Diagnostics never authorize deletion. */ } };
    const key = value => typeof value === 'string' ? value.replace(/-/g, '').toLowerCase() : '';
    const guid = value => /^[a-f0-9]{32}$/.test(key(value));
    const fail = code => Object.assign(new Error('WatchGuard approval requires a new explicit confirmation.'), { code, name: ['Cancelled','ContextChanged'].includes(code) ? 'AbortError' : 'Error' });
    const sameIds = (values, wanted) => Array.isArray(values) && values.length === wanted.length && values.every((v, i) => guid(v) && key(v) === key(wanted[i]));
    const reasons = people => JSON.stringify(people.map(p => [key(p.UserId), [...p.Reasons].sort()]).sort((a,b) => a[0].localeCompare(b[0])));
    const send = (api, route, body) => api.ajax({ url: api.getUrl('WatchGuard/ServerApproval/' + route),
        type: body === undefined ? 'GET' : 'POST', dataType: 'json', cache: false, timeout: 10000,
        ...(body === undefined ? {} : { contentType: 'application/json', data: JSON.stringify(body) }) });
    async function capability(api) {
        let c;
        try { c = await send(api, 'Capabilities'); }
        catch (error) { if (error?.status === 404 && !enforcementExpected) return null; throw error; }
        if (!c || c.Protocol !== 1 || typeof c.Expected !== 'boolean' || !['Enabled','Disabled','Unhealthy','Unsupported'].includes(c.State)) throw fail('ServerGuardUnsupported');
        if (c.Expected) enforcementExpected = true;
        if (c.State === 'Enabled' && c.Expected === true && /^[A-Fa-f0-9]{32}$/.test(c.Generation)) return c;
        if (c.Expected || enforcementExpected || !['Disabled','Unsupported'].includes(c.State)) throw fail('ServerGuardUnsupported');
        return null;
    }
    function install(api) {
        if (!api || typeof api.deleteItem !== 'function') return false;
        if (installed.has(api)) {
            const entry = installed.get(api);
            if (entry.method !== api.deleteItem && !entry.reported) { entry.reported = true; emit('adapter-replaced'); }
            return entry.method === api.deleteItem;
        }
        // The tab-wide expectation survives ApiClient/account changes; it never proves enforcement.
        const original = api.deleteItem, pending = new Map();
        function wrapped(...args) {
            const receiver = this, user = api.getCurrentUserId?.(), token = api.accessToken?.(), location = deps.location?.(), nativeUrl = api.getUrl('Items/' + args[0]);
            const identity = () => receiver === api && !!user && !!token && api.getCurrentUserId?.() === user && api.accessToken?.() === token && contextValid(api) && deps.location?.() === location && api.getUrl('Items/' + args[0]) === nativeUrl;
            const valid = () => { if (!identity()) throw fail('ContextChanged'); };
            const targetKey = key(args[0]);
            if (pending.has(targetKey)) return pending.get(targetKey);
            const operation = ++sequence; emit('intercepted', operation);
            const task = queue.then(async () => {
                let challenge, sent = false, completed = false, phase = 'capability';
                try {
                    valid();
                    const cap = await capability(api); valid();
                    phase = 'legacy-check';
                    const warning = await check(api, args[0], user); valid();
                    let captured;
                    if (cap && warning !== null) {
                        captured = await deps.resolveScope(api, args[0], user); valid();
                        if (!guid(args[0]) || args.length !== 1 || key(captured.item.Id) !== targetKey || key(warning.scopeId) !== key(captured.scope.Id) || warning.item.Type !== captured.item.Type || warning.item.Name !== captured.item.Name) throw fail('ApprovalInvalid');
                    }
                    phase = 'dialog';
                    if (warning !== null) {
                        emit('confirmation-opened', operation);
                        const unwatch = deps.watchNavigation?.(() => { if (!identity()) deps.close?.(); });
                        try { const decision = ask(warning); deps.status?.(!!cap); if (await decision !== true) throw fail('Cancelled'); }
                        catch { throw fail('Cancelled'); }
                        finally { unwatch?.(); }
                    }
                    valid();
                    if (!cap || warning === null) {
                        emit(warning === null ? 'clear' : 'override', operation); emit('native-called', operation);
                        sent = true;
                        const result = await Reflect.apply(original, receiver, args);
                        emit('native-resolved', operation); return result;
                    }
                    phase = 'protocol';
                    const prepared = await send(api, 'Prepare', {Action: 'DeleteItem', Targets: [args[0]]}); valid();
                    // A clear result after confirmation is a changed operation; do not silently reinterpret consent.
                    if (typeof prepared?.ChallengeId === 'string' && /^[a-fA-F0-9]{64}$/.test(prepared.ChallengeId)) challenge = prepared.ChallengeId;
                    const expiry = prepared?.ExpiresAt;
                    const matches = (r, state) => r?.State === state && r.Action === 'DeleteItem' && r.Generation === cap.Generation &&
                        sameIds(r.Targets, [args[0]]) && sameIds(r.Scopes, [captured.scope.Id]) &&
                        typeof r.ExpiresAt === 'string' && r.ExpiresAt === expiry && Number.isFinite(Date.parse(expiry)) && Date.parse(expiry) > Date.now();
                    if (!challenge || !matches(prepared, 'Created')) throw fail('ApprovalStateChanged');
                    const presentation = await send(api, 'Present', {ChallengeId: challenge}); valid();
                    if (!matches(presentation, 'Presented') || !Array.isArray(presentation.Protection) || presentation.Protection.length !== 1) throw fail('ApprovalStateChanged');
                    const users = deps.validateStatus(presentation.Protection[0], captured.scope.Id, user);
                    if (reasons(users) !== reasons(warning.users)) throw fail('ApprovalStateChanged');
                    const now = await deps.resolveScope(api, args[0], user); valid();
                    if (key(now.item.Id) !== targetKey || key(now.scope.Id) !== key(captured.scope.Id) || now.item.Type !== captured.item.Type || now.item.Name !== captured.item.Name) throw fail('ApprovalStateChanged');
                    const approval = await send(api, 'Approve', {ChallengeId: challenge, Decision: 'Approve'}); valid();
                    if (!matches(approval, 'Approved')) throw fail('ApprovalInvalid');
                    // Native jellyfin-apiclient 1.11.0 deleteItem transport, with one request-local header.
                    // No temporary replacement of ajax/fetch, no second invocation, and no retry.
                    emit('override', operation); emit('native-called', operation);
                    sent = true;
                    const result = await Reflect.apply(api.ajax, receiver, [{type:'DELETE', url: receiver.getUrl('Items/' + args[0]), headers:{'X-WatchGuard-Approval':challenge}}]);
                    completed = true; emit('native-resolved', operation);
                    return result;
                } catch (error) {
                    emit(sent ? 'native-rejected' : phase === 'legacy-check' ? 'check-failed' : 'cancelled', operation);
                    if (phase === 'legacy-check') throw Object.assign(new Error('WatchGuard: deletion cancelled.'), {name:'AbortError'});
                    if (identity() && phase !== 'legacy-check' && !['Cancelled','ContextChanged'].includes(error?.code)) {
                        const text = sent
                            ? 'WatchGuard: The deletion request failed or its outcome is uncertain. Check the library before trying again. No automatic retry was made.'
                            : 'WatchGuard: Server approval is unavailable, expired, or the title’s protection changed. Deletion was not sent. Check server status and permissions, reload this tab after guard changes, then start again and review a fresh confirmation. If the server is busy, wait a minute before trying again.';
                        try { await deps.notice?.(text); } catch { /* Feedback must not replace the original native error. */ }
                    }
                    throw error; // Preserve native rejection identity; never return fake success.
                } finally {
                    if (challenge && !completed && identity()) { try { await send(api, 'Revoke', {ChallengeId: challenge}); } catch { /* Expiry is the fallback; no retry. */ } }
                }
            });
            pending.set(targetKey, task);
            task.then(() => pending.delete(targetKey), () => pending.delete(targetKey));
            queue = task.catch(() => {});
            return task;
        }
        try { api.deleteItem = wrapped; } catch { emit('installation-failed'); return false; }
        if (api.deleteItem !== wrapped) { emit('installation-failed'); return false; }
        installed.set(api, {method: wrapped, reported: false}); emit('installed');
        return api.deleteItem === wrapped;
    }
    return {install, isInstalled: api => installed.get(api)?.method === api?.deleteItem};
}

    // Native viewshow precedes async item rendering. Require both the lifecycle
    // identity and native rendered controls; never infer readiness from the URL alone.
    function detailHandoffReady(view, params, hash, server) {
        const route = new URLSearchParams(hash.split('?')[1] || '');
        const id = key(route.get('id'));
        if (!/^#\/details(?:\?|$)/.test(hash) || !id || !key(server) || !view?.isConnected || view.id !== 'itemDetailPage' ||
            key(params?.id) !== id || (params?.serverId && key(params.serverId) !== key(server)) ||
            (route.get('serverId') && key(route.get('serverId')) !== key(server)) || view.classList.contains('hide')) return false;
        const control = view.querySelector('.mainDetailButtons .btnPlaystate[data-id][data-serverid]');
        return key(control?.getAttribute('data-id')) === id && key(control?.getAttribute('data-serverid')) === key(server) &&
            !!view.querySelector('.nameContainer')?.textContent.trim() && view.getClientRects().length > 0;
    }

    function createDeparture(document, window, currentIdentity) {
        let pending, notice;
        const same = values => { const current = currentIdentity(); return values.every((value, index) => value === current[index]); };
        function clear() {
            if (pending) {
                window.clearTimeout(pending.timer); pending.observer.disconnect();
                document.removeEventListener('focusin', pending.focus, true);
                pending.panel.remove(); pending = null;
            }
            notice?.remove(); notice = null;
        }
        function check() {
            const state = pending;
            if (!state) return;
            if (!same(state.identity) || window.location.hash !== state.hash) { clear(); return; }
            if (document.activeElement === document.body) state.back.focus();
            if (!detailHandoffReady(state.view, state.params, state.hash, state.identity[3])) return;
            const restore = state.panel.contains(document.activeElement);
            const focus = state.nativeFocus;
            clear();
            // Preserve the native focus manager's chosen destination. Never steal
            // focus from a header control used while the destination was loading.
            if (restore && focus?.isConnected && state.view.contains(focus)) focus.focus();
        }
        function route(hash, from) {
            if (pending?.hash === hash) { check(); return; }
            if (notice && notice.dataset.route !== hash) { notice.remove(); notice = null; }
            const previous = pending;
            const identity = currentIdentity().slice();
            const params = new URLSearchParams(hash.split('?')[1] || '');
            const eligible = /^#\/details(?:\?|$)/.test(hash) && params.get('id') && identity[1] && identity[2] && identity[3] &&
                (!params.get('serverId') || key(params.get('serverId')) === key(identity[3]));
            if (!eligible || (previous && !same(previous.identity))) { clear(); return; }
            if (!from && !previous) return;
            const origin = from || previous.origin;
            const deadline = previous?.deadline || window.performance.now() + 15000;
            clear();
            const panel = document.createElement('section'); panel.className = 'watchguard-outgoing';
            panel.setAttribute('aria-label', 'Item loading');
            const status = document.createElement('p'); status.setAttribute('role', 'status'); status.textContent = 'Loading item…';
            const back = document.createElement('a'); back.className = 'emby-button button-link focusable';
            back.href = origin; back.textContent = 'Back to Watchlists';
            panel.append(status, back); document.body.append(panel);
            const state = {hash, identity, origin, deadline, panel, back}; pending = state;
            state.focus = event => {
                if (!same(identity)) { clear(); return; }
                if (event.target.closest?.('.skinBody')) {
                    state.nativeFocus = event.target;
                    back.focus();
                }
            };
            document.addEventListener('focusin', state.focus, true);
            state.observer = new window.MutationObserver(check);
            state.observer.observe(document.body, {subtree:true, childList:true, attributes:true});
            state.timer = window.setTimeout(() => {
                if (pending !== state) return;
                const valid = same(identity) && window.location.hash === hash;
                const restore = panel.contains(document.activeElement) || document.activeElement === document.body;
                clear();
                if (!valid) return;
                // A deadline is failure recovery, never a readiness signal.
                status.textContent = 'Item loading did not finish.'; status.setAttribute('role', 'alert');
                panel.className = 'watchguard-outgoing-error'; panel.dataset.route = hash;
                document.body.append(panel); notice = panel; if (restore) back.focus();
            }, Math.max(0, deadline - window.performance.now()));
            if (document.querySelector('.watchguard-page')?.contains(document.activeElement)) back.focus();
        }
        function shown(event) {
            if (!pending || event.target?.id !== 'itemDetailPage') return;
            const params = event.detail?.params;
            const route = new URLSearchParams(pending.hash.split('?')[1] || '');
            // Native links may omit serverId to use the current ApiClient. The
            // rendered control must still identify the captured server in check().
            if (key(params?.id) !== key(route.get('id')) || (params?.serverId && key(params.serverId) !== key(pending.identity[3]))) return;
            pending.view = event.target; pending.params = params; check();
        }
        return {route, shown, clear};
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { createDeparture, detailHandoffReady, tvChoices, browserCapabilities, episodeProgress, createServerAdapter, coveragePresentation, renderSeriesActivity, createAdapter, confirmDeletion, message, protectionCheck, validateStatus, describe, resolveScope, selectInterest, mergeInterest, activityText, selectedStatuses, userLine, watchlistsPage, createMembership, preferenceView };
        return;
    }
    if (root.WatchGuardPoc) return;
    let diagnostic = /*WATCHGUARD_DIAGNOSTICS*/false;
    let identity, panel, detailButton, refreshDetailMembership, signature, membership, epoch = 0;
    let pagePanel, pageSignature, pageLifetime;
    const departure = createDeparture(document, root, () => {
        const api = root.ApiClient;
        return [api, api?.getCurrentUserId?.(), api?.accessToken?.(), api?.serverId?.()];
    });
    // The shell owns its identity fence; connecting the runtime must retain its nodes.
    const syncNavigation = () => root.WatchGuardNavigation?.update();
    let lifetime = new AbortController();
    function syncIdentity() {
        const api = root.ApiClient;
        const next = [api, api?.getCurrentUserId?.(), api?.accessToken?.()];
        if (!identity || next.some((v, i) => v !== identity[i])) {
            lifetime.abort(); lifetime = new AbortController();
            panel?.remove(); detailButton?.remove(); panel = null; refreshDetailMembership = null; signature = null; epoch++;
            departure.clear(); syncNavigation(); closePage();
            identity = next;
            membership = next[1] && next[2] ? createMembership(api, lifetime.signal, (id, present) => {
                // A native menu can change the same title. Refresh its state without
                // replacing the detail action or disrupting its native focus anchor.
                if (refreshDetailMembership) refreshDetailMembership(id, present);
                else { signature = null; updateDetail(); }
            }) : null;
            document.querySelectorAll('.watchguard-native-action').forEach(e => e.remove());
        }
        return next[1] && next[2] ? api : null;
    }
    const valid = (api, user) => syncIdentity() === api && api.getCurrentUserId() === user;
    const adapter = createServerAdapter(text => confirmDeletion(document, text, true, lifetime.signal), (event, operation) => {
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
        isInstalled: () => adapter.isInstalled(root.ApiClient),
        compatibility: () => browserCapabilities(root.ApiClient, document, root, adapter.isInstalled(root.ApiClient))
    });

    const style = document.createElement('style');
    style.textContent = `
        .watchguard-page :focus,.watchguard-toggle:focus,.watchguard-extra-button:focus,.watchguard-series-section :focus,.watchguard-deletion-dialog :focus,.watchguard-extras-dialog :focus {outline:2px solid var(--jf-palette-primary-main,#00a4dc)!important;outline-offset:3px}
        @supports selector(:focus-visible) {
            .watchguard-page :focus:not(:focus-visible),.watchguard-toggle:focus:not(:focus-visible),.watchguard-extra-button:focus:not(:focus-visible),.watchguard-series-section :focus:not(:focus-visible),.watchguard-deletion-dialog :focus:not(:focus-visible),.watchguard-extras-dialog :focus:not(:focus-visible) {outline:none!important}
        }
        .watchguard-no-flex-gap .watchguard-user-line>*,.watchguard-no-flex-gap .watchguard-interest>*,.watchguard-no-flex-gap .watchguard-progress>*,.watchguard-no-flex-gap .watchguard-status-icons>*,.watchguard-no-flex-gap .watchguard-viewer-states>*,.watchguard-no-flex-gap .watchguard-dialog-reasons>*,.watchguard-no-flex-gap .watchguard-dialog-actions>* {margin-right:.4em}
        .watchguard-choice-dialog {box-sizing:border-box;width:calc(100% - 2rem);max-width:30rem;max-height:calc(100vh - 2rem);overflow:auto;background:var(--jf-palette-background-paper,#202020);color:var(--jf-palette-text-primary,#eee);font:inherit;border:1px solid var(--jf-palette-divider,#888);border-radius:.3em;padding:1em}
        .watchguard-choice-dialog button {display:block;width:100%;min-height:44px;text-align:start;margin:.25em 0}
        .watchguard-choice-dialog button[aria-pressed="true"] {color:var(--jf-palette-secondary-main,#00a4dc)}
        .watchguard-choice-dialog::backdrop,.watchguard-deletion-dialog::backdrop {background:rgba(0,0,0,.65)}
        .watchguard-deletion-dialog button:focus-visible {outline:2px solid #fff;outline-offset:2px}

        body.watchguard-page-open .skinBody {display:none!important}
        .watchguard-outgoing,.watchguard-outgoing-error {position:fixed;top:var(--watchguard-top,64px);left:0;right:0;z-index:20;padding:1.25em;background:var(--jf-palette-background-default,#101010);color:var(--jf-palette-text-primary,#eee)}
        .watchguard-outgoing {bottom:0}
        .watchguard-outgoing a:focus,.watchguard-outgoing-error a:focus {outline:2px solid var(--jf-palette-primary-main,#00a4dc)!important;outline-offset:3px}
        .watchguard-page {position:fixed;top:var(--watchguard-top,64px);right:0;bottom:0;left:0;overflow:auto;z-index:10;padding-bottom:5em;box-sizing:border-box}
        .watchguard-page [hidden] {display:none!important}
        .watchguard-page select {min-width:0;max-width:100%}

        .watchguard-loading-status {display:flex;align-items:center;gap:.5em}
        .watchguard-spinner {font-size:1.2em;animation:watchguard-spin 1s linear infinite;color:var(--jf-palette-primary-main,#00a4dc)}
        @keyframes watchguard-spin {to {transform:rotate(360deg)}}
        @media(prefers-reduced-motion:reduce) {.watchguard-spinner {animation:none}.watchguard-nav {transition:none!important}}
        .watchguard-notice {font-size:.85em;margin-bottom:1.5em}
        .watchguard-grid {display:grid;grid-template-columns:repeat(auto-fill,minmax(135px,1fr));gap:1.5em 1em;margin:1em 0;align-items:start}
        @media(min-width:1100px) {.watchguard-grid {grid-template-columns:repeat(7,minmax(0,1fr))}}
        .watchguard-filter {position:relative}
        .watchguard-filter summary {cursor:pointer;white-space:nowrap;display:flex;align-items:center;gap:.35em;min-height:2.5em;box-sizing:border-box}
        .watchguard-filter summary .material-icons {font-size:1.4em}
        .watchguard-filter-options {position:absolute;top:100%;left:0;inset-block-start:100%;inset-inline-start:0;z-index:2;min-width:13em;padding:.5em;border:1px solid var(--jf-palette-divider,#8885);border-radius:.2em;box-shadow:0 .3em 1em #0008}

        .watchguard-card {position:relative;min-width:0}
        .watchguard-remove {position:absolute;top:.3em;right:.3em;background:rgba(0,0,0,.75);border-radius:50%;padding:.5em;color:white}
        @media(max-width:480px) {.watchguard-grid {grid-template-columns:repeat(2,minmax(0,1fr))}.watchguard-toolbar {gap:.5em;position:relative}.watchguard-filter {position:static}.watchguard-page select {min-width:0;max-width:100%}}
        .watchguard-card a {display:block;color:inherit;text-decoration:none}
        .watchguard-poster {position:relative;aspect-ratio:2/3;background:#292929;display:flex;align-items:center;justify-content:center;border-radius:.25em;overflow:hidden}
        .watchguard-poster>.material-icons {font-size:3em;color:#999}
        @supports not (aspect-ratio:2/3) {
            .watchguard-poster {height:0;padding-bottom:150%}
            .watchguard-poster>.material-icons {position:absolute;top:50%;left:50%;transform:translate(-50%,-50%)}
        }
        .watchguard-poster img {position:absolute;top:0;right:0;bottom:0;left:0;width:100%;height:100%;object-fit:cover}
        .watchguard-card a:hover .watchguard-poster {box-shadow:0 0 0 2px #00a4dc}
        .watchguard-card .cardText {padding-top:.5em;font-size:.9em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .watchguard-status {padding-top:.4em}
        .watchguard-status .watchguard-user-line {display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:0 .25em;margin-bottom:.35em}
        .watchguard-status-icons {display:inline-flex;align-items:center;gap:.1em;flex-shrink:0}
        .watchguard-status-icons .material-icons {font-size:1.1em}
        .watchguard-user-line .watchguard-user {flex-shrink:1;min-width:0}
        .watchguard-status .watchguard-user {max-width:100%}
        .watchguard-progress {white-space:nowrap;display:inline-flex;align-items:center;gap:.2em}
        .watchguard-extra-button {display:inline-flex;align-items:center;justify-content:center;min-width:2.75rem;min-height:2.75rem;padding:.25rem;margin:0 .15rem;border:1px solid #8886;border-radius:.4rem;color:var(--jf-palette-primary-main,#82c4ff);background:#8881;font:inherit;vertical-align:middle;cursor:pointer}
        .watchguard-extra-button:hover {background:#8883}
        .watchguard-extra-button:focus-visible,.watchguard-extras-dialog button:focus-visible {outline:2px solid #82c4ff;outline-offset:2px}
        .watchguard-extras-dialog {width:calc(100vw - 2rem);max-width:34rem;max-height:80vh;max-height:80dvh;box-sizing:border-box;overflow:auto;padding:1.2rem;border:1px solid #8888;border-radius:.6rem;background:var(--jf-palette-background-paper,#202020);color:var(--jf-palette-text-primary,#eee);white-space:normal;text-align:start;overflow-wrap:anywhere}
        .watchguard-extras-dialog::backdrop {background:#0009}
        .watchguard-extras-dialog h3 {font-size:1.1rem;margin:0 0 .6rem}
        .watchguard-extras-dialog p {font-size:.85rem;line-height:1.5;opacity:.85}
        .watchguard-extras-dialog ul {padding:0;list-style:none}
        .watchguard-extras-dialog li {display:grid;gap:.4rem;padding:.8rem 0;border-top:1px solid #8884;font-size:.9rem;line-height:1.5}
        .watchguard-extras-dialog li span {opacity:.85}
        .watchguard-extras-dialog button {min-height:2.75rem}
        .watchguard-user-line time {grid-column:1/-1;font-size:.9em;opacity:.85}
        .watchguard-status {font-size:.8em;line-height:1.5}
        .watchguard-page {color:var(--jf-palette-text-secondary,var(--jf-palette-text-primary,inherit))}
        .watchguard-page .watchguard-toolbar-field, .watchguard-page .watchguard-status {color:inherit}
        .watchguard-toolbar {gap:.75rem;align-items:flex-end;margin:1rem 0}
        .watchguard-older-interest {max-width:100%;margin-top:.5rem}
        .watchguard-toolbar-field {position:relative;display:flex;flex-direction:column;gap:.3rem;min-width:0;flex:0 1 15rem}
        .watchguard-toolbar-field>.selectArrowContainer {position:absolute;pointer-events:none;top:auto;bottom:.45em;right:.35em;inset-inline-end:.35em}
        .watchguard-toolbar .selectArrow {font-size:1.5em;vertical-align:middle}
        .watchguard-toolbar .emby-select {-webkit-appearance:none;appearance:none;padding-inline-end:1.9em}
        .watchguard-toolbar-field>.selectLabel,.watchguard-toolbar-field>.inputLabel {font-size:inherit;margin:0}
        .watchguard-toolbar-field select, .watchguard-toolbar-field input[type="search"] {width:100%;min-height:44px;margin:0;box-sizing:border-box}
        .watchguard-sort {margin-inline-start:auto;flex-basis:13rem}
        .watchguard-refresh {margin:0;min-width:44px;min-height:44px;display:inline-flex;align-items:center;justify-content:center}
        .watchguard-filter summary {min-height:44px;margin:0}
        .watchguard-filter-options {max-width:calc(100vw - 3rem);box-sizing:border-box;color:inherit}
        .watchguard-filter-options label, .watchguard-filter-options button {min-height:44px;box-sizing:border-box}
        .watchguard-filter-options .emby-button {display:flex;width:100%;margin:.25em 0;text-align:start}
        .watchguard-toolbar .emby-checkbox-label {height:auto;min-height:44px;padding-top:.4em;padding-bottom:.4em;padding-block:.4em}
        .watchguard-toolbar .emby-checkbox:focus~.checkboxOutline {outline:2px solid var(--jf-palette-primary-main,#00a4dc);outline-offset:3px}
        .watchguard-toolbar .checkboxOutline {top:50%;transform:translateY(-50%)}
        .watchguard-page button:focus-visible, .watchguard-page summary:focus-visible, .watchguard-page select:focus-visible, .watchguard-page input:focus-visible, .watchguard-page a:focus-visible, .watchguard-page [tabindex]:focus-visible {outline:2px solid var(--jf-palette-primary-main,#00a4dc)!important;outline-offset:3px}
        .watchguard-notice {font-size:.85em;line-height:1.5;margin:.6rem 0;overflow-wrap:anywhere}
        .watchguard-coverage-details summary {cursor:pointer;padding:.5rem 0;min-height:44px;box-sizing:border-box;opacity:.85}
        .watchguard-coverage-details p {margin:.25rem 0 .75rem;padding-inline-start:1rem;border-inline-start:2px solid #8888}
        .watchguard-coverage-warning {margin:.3rem 0 .7rem;padding:.65rem .8rem;border-inline-start:3px solid #b28b37;background:#8881;border-radius:.2rem;font-weight:500}
        .watchguard-card .cardText {font-weight:500;line-height:1.4;padding-top:.55rem}
        .watchguard-card a:focus-visible .watchguard-poster {box-shadow:0 0 0 2px #00a4dc}
        .watchguard-page .watchguard-status {max-height:10rem;overflow:auto;scrollbar-width:thin;padding:.2rem .15rem .1rem}
        .watchguard-page .watchguard-user-line {gap:.15rem .25rem;padding:.35rem 0;margin:0;border-bottom:1px solid #8883}
        .watchguard-page .watchguard-user-line:last-child {border-bottom:0}
        .watchguard-page .watchguard-user {overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
        .watchguard-page .watchguard-status-icons {flex-wrap:wrap;max-width:2.8rem;border-radius:.25rem;background:#252a30;padding:.15rem}
        .watchguard-page .watchguard-user-line time, .watchguard-page .watchguard-user-line .watchguard-added-unknown {grid-column:1/-1;font-size:.85em;opacity:.8;margin-inline-start:.15rem}
        .watchguard-page .watchguard-progress {font-variant-numeric:tabular-nums;font-size:.9em}
        .watchguard-page .watchguard-remove {width:44px;height:44px;min-width:44px;display:flex;align-items:center;justify-content:center;padding:0;box-sizing:border-box;border:1px solid #ffffff40}
        .watchguard-page .watchguard-remove:hover {background:#00668b}
        .watchguard-page .watchguard-remove:active {background:#004c68}
        @media(max-width:600px) {
            .watchguard-toolbar-field {flex:1 1 100%}
            .watchguard-sort {flex:1 1 8rem;margin:0}
            .watchguard-toolbar {gap:.6rem}
            .watchguard-page .watchguard-user-line {grid-template-columns:auto minmax(0,1fr)}
            .watchguard-page .watchguard-progress {grid-column:2}
        }
        .watchguard-page .sectionTitle {margin:.65rem 0;font-size:1.6rem}
        .watchguard-page .watchguard-toolbar {display:grid;grid-template-columns:minmax(10rem,1.3fr) minmax(8rem,1fr) auto minmax(10rem,1fr) 44px;gap:.5rem .75rem;margin:.6rem 0}
        .watchguard-search {grid-column:1;grid-row:1}
        .watchguard-owner {grid-column:2;grid-row:1}
        .watchguard-filter {grid-column:3;grid-row:1}
        .watchguard-sort {grid-column:4;grid-row:1;margin:0}
        .watchguard-refresh {grid-column:5;grid-row:1}
        .watchguard-secondary {grid-column:1/-1;font-size:.9rem;min-width:0}
        .watchguard-secondary>summary {cursor:pointer;min-height:44px;box-sizing:border-box;padding:.7rem 0}
        .watchguard-secondary[open] {padding-bottom:.5rem}
        .watchguard-secondary .watchguard-toolbar-field {max-width:18rem}
        .watchguard-loading-status {margin:.4rem 0;font-size:1rem;line-height:1.5}
        .watchguard-page .watchguard-notice {margin:.2rem 0;font-size:.9rem}
        .watchguard-page .watchguard-grid {margin:.5rem 0}
        .watchguard-page .watchguard-status {max-height:none;overflow:visible;font-size:1rem;line-height:1.5;padding:0}
        .watchguard-page .watchguard-user-line {display:flex;flex-wrap:wrap;gap:.2rem .4rem;padding:.5rem 0;min-width:0}
        .watchguard-page .watchguard-user {order:-1;flex-basis:100%;white-space:normal;overflow:visible;overflow-wrap:anywhere;font-weight:600}
        .watchguard-page .watchguard-status-icons {max-width:none;align-items:center}
        .watchguard-page .watchguard-progress {display:inline-flex;align-items:center;font-size:1em;gap:.2rem}
        .watchguard-page .watchguard-extra-button {min-width:44px;min-height:44px;margin:0}
        .watchguard-page .watchguard-live-stale {flex-basis:100%;font-size:.9rem;color:#e0c5ff;background:#29212f;border-radius:.2rem;padding:.2rem;line-height:1.4}
        .watchguard-dates {flex-basis:100%;font-size:.9rem;color:inherit;min-width:0}
        .watchguard-dates summary {cursor:pointer;min-height:44px;padding:.25rem 0;box-sizing:border-box}
        .watchguard-dates summary span {display:block;overflow-wrap:anywhere}
        .watchguard-dates summary span:first-child {display:inline}
        .watchguard-page .watchguard-dates time {display:block;font-size:inherit;opacity:1;margin:0;overflow-wrap:anywhere}
        .watchguard-more-owners {font-size:1rem;line-height:1.5}
        .watchguard-more-owners>summary {cursor:pointer;min-height:44px;padding:.6rem 0;box-sizing:border-box;color:inherit}
        .watchguard-page .watchguard-more-owners .watchguard-user-line {font-size:1rem}
        .watchguard-sr-only {position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
        .watchguard-page>p:empty {display:none}
        @media(max-width:700px) {
            .watchguard-page .watchguard-toolbar {grid-template-columns:minmax(0,1fr) minmax(0,1fr) 44px;gap:.4rem .5rem}
            .watchguard-search {grid-column:1/3;grid-row:1}
            .watchguard-refresh {grid-column:3;grid-row:1}
            .watchguard-owner {grid-column:1;grid-row:2}
            .watchguard-sort {grid-column:2/4;grid-row:2}
            .watchguard-filter {grid-column:1;grid-row:3;align-self:start}
            .watchguard-secondary {grid-column:2/4;grid-row:3;font-size:.8rem}
            .watchguard-secondary>summary {padding:.55rem 0;line-height:1.4}
            .watchguard-filter summary {padding-left:.35rem;padding-right:.35rem;padding-inline:.35rem}
            .watchguard-filter-options {inset-inline-start:0;max-width:calc(100vw - 2rem)}
            .watchguard-page .watchguard-grid {gap:1rem .75rem}
        }
        /* emby-select CSS is lazily loaded by native pages. Supply the same base
           contract for direct Watchlists entry; native theme rules own colors. */
        @layer watchguard-controls {
        .watchguard-page {background:var(--jf-palette-background-default,#101010)}
        .watchguard-filter-options {background:var(--jf-palette-background-paper,#202020)}
        .watchguard-toolbar .emby-select {display:block;font-family:inherit;font-size:110%;font-weight:inherit;border-radius:.2em;border-style:solid;border-width:.16em;border-color:var(--jf-palette-FilledInput-borderColor,#8882);background:var(--jf-palette-background-paper,#202020);color:inherit;padding:.5em;appearance:auto}
        }
        .watchguard-toolbar .emby-select:focus {border-color:var(--jf-palette-secondary-main,#00a4dc)}
        .watchguard-toolbar button[aria-disabled="true"],.watchguard-toolbar summary[aria-disabled="true"],.watchguard-toolbar button:disabled,.watchguard-toggle:disabled {opacity:.5;cursor:default}
        .watchguard-toggle:focus-visible {outline:2px solid var(--jf-palette-primary-main,#00a4dc)!important;outline-offset:2px}
        .watchguard-toggle .detailButton-icon {text-decoration:none;cursor:inherit}
        @media(prefers-reduced-motion:reduce) {.watchguard-toolbar .emby-button,.watchguard-toggle {transition:none}}
        .watchguard-state-Watchlisted {--wg-accent:#f3c66c}
        .watchguard-state-InProgress {--wg-accent:#82c4ff}
        .watchguard-state-CaughtUp {--wg-accent:#6edbd0}
        .watchguard-state-Watched {--wg-accent:#93d6a2}
        .watchguard-state-CurrentlyPlaying {--wg-accent:#c9a3f7}
        .watchguard-state-Unknown {--wg-accent:#bac0ca}
        .watchguard-chip {display:inline-flex;align-items:center;color:var(--wg-accent,#ccc);background:rgba(255,255,255,.08);background:color-mix(in srgb,var(--wg-accent,#ccc) 10%,transparent);border:1px solid var(--wg-accent,#ccc);border:1px solid color-mix(in srgb,var(--wg-accent,#ccc) 30%,transparent);border-radius:1em;padding:.15em .65em;font-size:.85em;line-height:1.5;max-width:100%;box-sizing:border-box;overflow-wrap:anywhere}
        .watchguard-status-icons [class*="watchguard-state-"] {color:var(--wg-accent)}
        .watchguard-series-activity {width:100%;box-sizing:border-box;border:1px solid #ffffff24;border-radius:.7rem;background:#ffffff03;overflow:hidden}
        .watchguard-series-activity summary {cursor:pointer;padding:.8rem 1rem;min-height:2.75rem;box-sizing:border-box;line-height:1.7;overflow-wrap:anywhere}
        .watchguard-series-activity summary::marker {color:#aab4bf}
        .watchguard-series-activity summary:focus-visible {outline:2px solid #82c4ff;outline-offset:-3px}
        .watchguard-series-activity summary>* {margin-inline-end:.5rem}
        .watchguard-activity-heading {font-weight:600;color:var(--jf-palette-text-primary,#eee)}
        .watchguard-series-viewers {list-style:none;padding:0 1rem;margin:0;max-height:28rem;overflow:auto}
        .watchguard-series-viewers>li {display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.3fr) minmax(0,1fr);gap:.4rem .8rem;padding:.9rem 0;border-top:1px solid #ffffff1c;align-items:center;overflow-wrap:anywhere}
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
            .detailPagePrimaryContent.watchguard-has-series {padding-left:5%;padding-right:5%;padding-inline:5%}
            .watchguard-series-viewers>li {grid-template-columns:minmax(0,1fr)}
            .watchguard-series-activity summary {padding:.7rem .8rem}
            .watchguard-series-viewers {padding:0 .8rem}
        }
        .watchguard-header {min-width:0;max-width:100%;margin:.4em 0;font-size:.8em;line-height:1.5;overflow-wrap:anywhere}
        .watchguard-header [hidden] {display:none!important}
        .watchguard-interest {display:flex;flex-wrap:wrap;gap:.15em 1em;max-height:4.5em;overflow:auto;color:var(--jf-palette-text-secondary,#aaa)}
        .watchguard-interest>span {display:inline-flex;align-items:baseline;gap:.35em;min-width:0;max-width:100%}
        .watchguard-user {flex-shrink:0;max-width:20ch;max-width:min(20ch,40vw);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        @media(max-width:50em) {
            .detailRibbon.watchguard-has-header, .detailPagePrimaryContainer.watchguard-has-series>.detailRibbon {display:block;width:100%;box-sizing:border-box;height:auto;min-height:7.2em}
        }
        .watchguard-error {color:inherit}
        .watchguard-error:empty,.watchguard-interest:empty {display:none}
        .watchguard-sr-only {position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
    `;
    // Older engines drop an entire unknown @layer block. These rules already
    // target only owned controls; flatten the single fallback layer there.
    if (!('CSSLayerBlockRule' in root)) style.textContent = style.textContent.replace(/@layer watchguard-controls \{([\s\S]*?)\n        \}/g, '$1');
    document.head.append(style);
    const gapProbe = document.createElement('div');
    gapProbe.style.cssText = 'position:absolute;visibility:hidden;display:flex;flex-direction:column;row-gap:1px';
    gapProbe.append(document.createElement('div'), document.createElement('div'));
    document.body.append(gapProbe);
    document.body.classList.toggle('watchguard-no-flex-gap', gapProbe.scrollHeight !== 1); gapProbe.remove();
    function detailLayout() {
        document.querySelectorAll('.watchguard-has-series,.watchguard-has-header').forEach(e => e.classList.remove('watchguard-has-series', 'watchguard-has-header'));
        document.querySelectorAll('.watchguard-series-section').forEach(e => {
            e.closest('.detailPagePrimaryContent')?.classList.add('watchguard-has-series');
            e.closest('.detailPagePrimaryContainer')?.classList.add('watchguard-has-series');
        });
        document.querySelectorAll('.watchguard-header').forEach(e => e.closest('.detailRibbon')?.classList.add('watchguard-has-header'));
    }
    function closePage() {
        pageLifetime?.abort(); pageLifetime = null; pagePanel?.remove(); pagePanel = null; pageSignature = null;
        document.body.classList.remove('watchguard-page-open');
    }
    function updateNavigation() {
        const api = syncIdentity();
        const hash = root.location.hash;
        // Never add a user-content entry to dashboard, login, video or setup screens.
        const eligible = api && /^#\/(?:home|details|movies|tv|list|search|music|livetv)(?:[/?]|$)/.test(hash);
        if (!eligible) { departure.clear(); syncNavigation(); closePage(); return; }
        const visible = element => element && element.getClientRects().length > 0;
        const legacy = document.querySelector('.skinHeader');
        root.WatchGuardNavigation?.update();
        const params = new URLSearchParams(hash.split('?')[1] || '');
        const open = /^#\/home(?:\?|$)/.test(hash) && params.get('watchguard') === 'watchlists';
        if (!open) {
            // Mount the neutral cover before revealing native layout. Abort the
            // live Watchlists view immediately; the cover owns no account data.
            departure.route(hash, pagePanel?.isConnected ? pageSignature : null);
            closePage(); return;
        }
        departure.clear();
        const header = visible(legacy) ? legacy : document.querySelector('header.MuiAppBar-root');
        if (header) document.body.style.setProperty('--watchguard-top', Math.max(0, header.getBoundingClientRect().bottom) + 'px');
        if (pagePanel?.isConnected) {
            if (pageSignature !== hash) pagePanel.updateFilters(params.get('owner'), params.get('interest'), params.get('sort'), params.get('days'), params.get('older'), params.get('search') || '');
            pageSignature = hash; return;
        }
        closePage(); pageSignature = hash;
        pageLifetime = new AbortController();
        pagePanel = watchlistsPage(document, api, pageLifetime.signal, params.get('owner'), (owner, interest, sort, days = 30, older = 'true', search = '') => {
            // Filters edit this view, not Jellyfin's route. Keep its history state
            // (including router keys/index) and replace only this entry's URL.
            // Back leaves Watchlists; Forward restores its latest filter values.
            // replaceState emits no navigation event, so apply the view ourselves.
            root.history.replaceState(root.history.state, '', '#/home?watchguard=watchlists&owner=' + encodeURIComponent(owner) + '&interest=' + encodeURIComponent(interest) + '&sort=' + encodeURIComponent(sort) + '&days=' + encodeURIComponent(days) + '&older=' + encodeURIComponent(older) + '&search=' + encodeURIComponent(search));
            updateNavigation();
        }, {interest: params.get('interest'), sort: params.get('sort'), days: params.get('days'), older: params.get('older'), search: params.get('search'), indexedActivity: true, preferences: true});
        document.body.classList.add('watchguard-page-open'); document.body.append(pagePanel);
        if (document.documentElement.classList.contains('layout-tv')) pagePanel.querySelector('select,button,input')?.focus();
        root.WatchGuardStartup?.finish();
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
        panel?.remove(); detailButton?.remove(); panel = null; refreshDetailMembership = null; detailLayout();
        if (!route) return;
        const user = api.getCurrentUserId();
        const current = () => valid(api, user) && revision === epoch && root.location.hash === hash;
        try {
            const { item, scope } = await resolveScope(api, id, user);
            if (!current()) return;
            const seriesLabel = scope === item ? '' : 'Series: ' + (scope.Name || scope.Id) + '. ';
            const scopeId = scope.Id;
            const toggle = document.createElement('button');
            toggle.type = 'button'; toggle.className = 'emby-button button-flat detailButton watchguard-toggle watchguard-controls'; toggle.disabled = true;
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
            anchor.insertBefore(toggle, anchor.querySelector('.btnMoreCommands')); panel = header; detailButton = toggle; detailLayout();
            let member, writing = false;
            const render = () => {
                label.textContent = member ? 'Remove from Watchlist' : 'Add to Watchlist';
                toggle.title = seriesLabel + label.textContent;
                icon.textContent = member ? 'bookmark_remove' : 'bookmark_add';
                // Native theme accent, including Legacy themes without palette variables.
                icon.classList.toggle('button-link', member);
                toggle.setAttribute('aria-pressed', String(member)); toggle.setAttribute('aria-busy', String(writing)); toggle.disabled = writing;
            };
            async function refreshInterest() {
                const account = await api.getCurrentUser();
                if (!current()) return;
                interest.textContent = '';
                if (account.Policy?.IsAdministrator !== true) return;
                interest.textContent = 'Loading interest…'; interest.setAttribute('aria-busy', 'true');
                try {
                    const series = scope.Type === 'Series';
                    const status = await request(api, (series ? 'SeriesActivity/' : 'Protection/') + encodeURIComponent(scopeId));
                    if (!series) validateStatus(status, scopeId, user);
                    if (current()) {
                        interest.textContent = '';
                        if (seriesLabel && status.Users.length) { const scopeText = document.createElement('span'); scopeText.textContent = seriesLabel; interest.append(scopeText); }
                        if (series) renderSeriesActivity(document, interest, status, scopeId, user, seriesLabel);
                        else for (const owner of status.Users) interest.append(userLine(document, owner));
                    }
                } catch { if (current()) interest.textContent = 'WatchGuard: Interest status unavailable.'; }
                finally { if (current()) interest.setAttribute('aria-busy', 'false'); }
            }
            toggle.onclick = async () => {
                if (!current() || toggle.disabled) return;
                const focused = document.activeElement === toggle;
                const restoreFocus = () => {
                    if (focused && current() && document.activeElement === document.body) toggle.focus({preventScroll:true});
                };
                const desired = !member; writing = true;
                toggle.disabled = true; toggle.setAttribute('aria-busy', 'true'); error.textContent = '';
                try {
                    // This action renders its own result; other entry points still notify.
                    await membership.set(scopeId, desired, false);
                    if (!current()) return;
                    writing = false; member = desired; render(); restoreFocus();
                    try { await refreshInterest(); } catch { if (current()) interest.textContent = 'WatchGuard: Could not verify this account.'; }
                } catch {
                    if (current()) { writing = false; error.textContent = 'WatchGuard: Could not update your watchlist. Please retry.'; toggle.setAttribute('aria-busy', 'false'); toggle.disabled = false; }
                } finally {
                    // Do not steal focus after the user navigates or focuses another control.
                    restoreFocus();
                }
            };
            refreshDetailMembership = async (changedId, present) => {
                if (!current() || key(changedId) !== key(scopeId)) return;
                member = present; error.textContent = ''; render();
                try { await refreshInterest(); } catch { if (current()) interest.textContent = 'WatchGuard: Could not verify this account.'; }
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

    // Legacy Home/Favorites switch local content without changing the URL.
    // While our overlay is open, let that native click run, then leave our route.
    // No tab indexes, selected classes, event handlers or history state are replaced.
    document.addEventListener('click', event => {
        const tab = event.target.closest?.('.headerTabs .emby-tab-button[data-index]');
        if (!tab || !pagePanel?.isConnected || !syncIdentity()) return;
        const index = tab.getAttribute('data-index');
        if (index === '0' || index === '1') root.location.hash = '/home' + (index === '1' ? '?tab=1' : '');
    });

    const bind = () => { syncIdentity(); adapter.install(root.ApiClient); };
    bind(); updateNavigation(); updateDetail();
    root.WatchGuardNavigation?.connect(updateNavigation);
    for (const name of ['viewbeforeshow', 'viewshow', 'pointerdown', 'keydown', 'click'])
        document.addEventListener(name, bind, true);
    // These added lifecycle hooks only prepare departure. Keep incoming
    // Watchlists mounting/query/preference timing on its existing route path.
    const prepareDeparture = () => { if (/^#\/details(?:\?|$)/.test(root.location.hash)) updateNavigation(); };
    document.addEventListener('viewbeforeshow', prepareDeparture, true);
    document.addEventListener('viewshow', event => { prepareDeparture(); departure.shown(event); signature = null; updateDetail(); }, true);
    root.addEventListener('pagehide', event => { if (event.target === root || event.target === document) departure.clear(); });
    root.addEventListener('hashchange', () => { updateNavigation(); updateDetail(); });
    setInterval(() => { bind(); updateNavigation(); updateDetail(); }, 500);
})(typeof window === 'undefined' ? globalThis : window);
