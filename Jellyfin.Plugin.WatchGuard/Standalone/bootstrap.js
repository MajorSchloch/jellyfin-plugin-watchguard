/* Authenticated standalone bootstrap. No user data, tokens or generated credentials. */
(function () {
    'use strict';
    if (window.WatchGuardStandalone) return;
    const endpoint = new URL('script.js', document.currentScript.src);
    let pending = false, done = false, generation = 0, identity = [], nextAttempt = 0;
    let state = 'waiting-for-login';
    window.WatchGuardStandalone = Object.freeze({ status: () => state, buildId: "WATCHGUARD_BUILD_ID" });
    async function check() {
        if (done) return;
        const api = window.ApiClient;
        const current = [api, api?.getCurrentUserId?.(), api?.accessToken?.()];
        if (current.some((v, i) => v !== identity[i])) { identity = current; generation++; nextAttempt = 0; }
        if (!current[1] || !current[2]) { state = 'waiting-for-login'; return; }
        if (window.WatchGuardPoc) { state = 'existing-adapter'; done = true; clearInterval(timer); return; }
        if (pending || Date.now() < nextAttempt) return;
        const target = new URL(api.getUrl('WatchGuard/Standalone/script.js'), location.href);
        if (target.href !== endpoint.href || target.origin !== location.origin) { state = 'unsupported-server'; return; }
        pending = true;
        const revision = generation;
        const valid = () => revision === generation && window.ApiClient === api && api.getCurrentUserId() === current[1] && api.accessToken() === current[2];
        try {
            state = 'loading';
            const source = await api.ajax({url: endpoint.href, type:'GET', dataType:'text', cache:false});
            if (!valid()) return;
            const url = URL.createObjectURL(new Blob([source], {type:'application/javascript'}));
            const script = document.createElement('script'); script.src = url;
            try {
                await new Promise((resolve, reject) => { script.onload = resolve; script.onerror = reject; document.head.append(script); });
                state = window.WatchGuardPoc ? 'loaded' : 'failed'; done = !!window.WatchGuardPoc;
                if (done) clearInterval(timer);
            } finally { script.remove(); URL.revokeObjectURL(url); }
        } catch { state = 'failed-or-csp-blocked'; }
        finally { pending = false; nextAttempt = Date.now() + 10000; }
    }
    // Web has no supported global auth-ready event; bounded frequency until the adapter loads.
    const timer = setInterval(check, 1000);
    check();
})();
