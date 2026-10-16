/* Experimental Stage B, inserted inside the unchanged v0.4.8 Web module only by explicit disposable opt-in. */
function createServerAdapter(ask, log, check, contextValid, dependencies) {
    const deps = dependencies || {
        resolveScope, validateStatus,
        location: () => root.location.href,
        notice: text => confirmDeletion(document, text, false, lifetime.signal),
        status: enabled => { const title = document.getElementById('watchguard-delete-title'); if (title) { const line = document.createElement('p'); line.className = 'watchguard-server-status'; line.style.cssText = 'font-size:.85em;color:#bbb'; line.textContent = enabled ? 'Server approval required · native HTTP item deletion guard' : 'Web-only warning · server enforcement unavailable'; title.after(line); } },
        watchNavigation: callback => { root.addEventListener('hashchange', callback); root.addEventListener('popstate', callback); return () => { root.removeEventListener('hashchange', callback); root.removeEventListener('popstate', callback); }; },
        close: () => document.querySelector('dialog.watchguard-deletion-dialog')?.close()
    };
    const installed = new WeakMap(), expected = new WeakSet();
    let queue = Promise.resolve();
    const key = value => typeof value === 'string' ? value.replaceAll('-', '').toLowerCase() : '';
    const guid = value => /^[a-f0-9]{32}$/.test(key(value));
    const fail = code => Object.assign(new Error('WatchGuard approval requires a new explicit confirmation.'), { code });
    const sameIds = (values, wanted) => Array.isArray(values) && values.length === wanted.length && values.every((v, i) => guid(v) && key(v) === key(wanted[i]));
    const reasons = people => JSON.stringify(people.map(p => [key(p.UserId), [...p.Reasons].sort()]).sort((a,b) => a[0].localeCompare(b[0])));
    const send = (api, route, body) => api.ajax({ url: api.getUrl('WatchGuard/ExperimentalApproval/' + route),
        type: body === undefined ? 'GET' : 'POST', dataType: 'json', cache: false, timeout: 10000,
        ...(body === undefined ? {} : { contentType: 'application/json', data: JSON.stringify(body) }) });
    async function capability(api) {
        let c;
        try { c = await send(api, 'Capabilities'); }
        catch (error) { if (error?.status === 404 && !expected.has(api)) return null; throw error; }
        if (!c || c.Protocol !== 1 || typeof c.Expected !== 'boolean' || !['Enabled','Disabled','Unhealthy','Unsupported'].includes(c.State)) throw fail('ServerGuardUnsupported');
        if (c.Expected) expected.add(api);
        if (c.State === 'Enabled' && c.Expected === true && /^[A-Fa-f0-9]{32}$/.test(c.Generation)) return c;
        if (c.Expected || expected.has(api) || !['Disabled','Unsupported'].includes(c.State)) throw fail('ServerGuardUnsupported');
        return null;
    }
    function install(api) {
        if (!api || typeof api.deleteItem !== 'function') return false;
        if (installed.has(api)) return installed.get(api).method === api.deleteItem;
        // This server-supplied expectation only tightens failure behavior; it never proves enforcement.
        if (/*STAGE_B_EXPECTED*/false || deps.expected === true) expected.add(api);
        const original = api.deleteItem, pending = new Map();
        function wrapped(...args) {
            const receiver = this, user = api.getCurrentUserId?.(), token = api.accessToken?.(), location = deps.location?.(), nativeUrl = api.getUrl('Items/' + args[0]);
            const identity = () => !!user && !!token && api.getCurrentUserId?.() === user && api.accessToken?.() === token && contextValid(api) && deps.location?.() === location && api.getUrl('Items/' + args[0]) === nativeUrl;
            const valid = () => { if (!identity()) throw fail('ContextChanged'); };
            const targetKey = key(args[0]);
            if (pending.has(targetKey)) return pending.get(targetKey);
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
                        const unwatch = deps.watchNavigation?.(() => { if (!identity()) deps.close?.(); });
                        try { const decision = ask(warning); deps.status?.(!!cap); if (await decision !== true) throw fail('Cancelled'); }
                        finally { unwatch?.(); }
                    }
                    valid();
                    if (!cap || warning === null) {
                        sent = true;
                        return await Reflect.apply(original, receiver, args);
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
                    sent = true;
                    const result = await Reflect.apply(api.ajax, receiver, [{type:'DELETE', url: receiver.getUrl('Items/' + args[0]), headers:{'X-WatchGuard-Approval':challenge}}]);
                    completed = true;
                    return result;
                } catch (error) {
                    if (identity() && phase !== 'legacy-check' && !['Cancelled','ContextChanged'].includes(error?.code)) {
                        const text = sent
                            ? 'WatchGuard: The deletion request failed or its outcome is uncertain. Check the library before trying again. No automatic retry was made.'
                            : 'WatchGuard: Server approval is unavailable, expired, or the title’s protection changed. Deletion was not sent. Check server status and permissions, then start again and review a fresh confirmation.';
                        await deps.notice?.(text);
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
        api.deleteItem = wrapped;
        installed.set(api, {method: wrapped});
        return api.deleteItem === wrapped;
    }
    return {install, isInstalled: api => installed.get(api)?.method === api?.deleteItem};
}
if (typeof module !== 'undefined' && module.exports) module.exports = {createServerAdapter};
