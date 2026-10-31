/* Static, anonymous-safe entry handoff. Runs during parsing, before deferred Web/bootstrap scripts. */
(function () {
    'use strict';
    const onRoute = () => /^#\/home(?:\?|$)/.test(location.hash) &&
        new URLSearchParams(location.hash.split('?')[1] || '').get('watchguard') === 'watchlists';
    function start() {
        if (!onRoute() || window.WatchGuardPoc || window.WatchGuardStartup?.active()) return;
        let finished = false;
        const style = document.createElement('style');
        style.textContent = '#watchguard-startup{position:fixed;top:0;right:0;bottom:0;left:0;z-index:2147483647;background:#101010;color:#eee;font:1rem/1.5 system-ui,sans-serif;padding:1.25rem;padding:clamp(1.25rem,5vw,3rem);box-sizing:border-box}#watchguard-startup a{color:#82c4ff;display:inline-block;padding:.75rem 0}#watchguard-startup a:focus{outline:2px solid currentColor;outline-offset:4px}';
        document.head.append(style);
        const panel = document.createElement('section'); panel.id = 'watchguard-startup'; panel.setAttribute('aria-label', 'Watchlists loading');
        const status = document.createElement('p'); status.setAttribute('role', 'status'); status.textContent = 'Loading Watchlists…';
        const home = document.createElement('a'); home.href = '#/home'; home.textContent = 'Go to Home';
        panel.append(status, home);
        function finish() {
            if (finished) return;
            finished = true; clearTimeout(timeout); observer.disconnect();
            removeEventListener('hashchange', route); removeEventListener('popstate', route);
            removeEventListener('pagehide', leaveDocument); document.removeEventListener('viewbeforeshow', route, true);
            document.removeEventListener('error', scriptError, true);
            panel.remove(); style.remove();
        }
        // Legacy also bubbles a pagehide event from its outgoing DIV. Only a
        // document lifecycle event ends this handoff; native view changes do not.
        function leaveDocument(event) { if (event.target === document || event.target === window) finish(); }
        function route() { if (!onRoute()) finish(); }
        function mount() {
            route();
            if (!finished && document.body && !panel.isConnected) document.body.append(panel);
        }
        function scriptError(event) { if (event.target?.id === 'watchguard-standalone-loader') finish(); }
        // Bound the handoff independently of both network requests and runtime execution.
        // Fail open to native Web; never alter its nodes, styles, history or auth state.
        const timeout = setTimeout(finish, 20000);
        const observer = new MutationObserver(mount); observer.observe(document.documentElement, {childList:true,subtree:true});
        addEventListener('hashchange', route); addEventListener('popstate', route); addEventListener('pagehide', leaveDocument);
        document.addEventListener('viewbeforeshow', route, true); document.addEventListener('error', scriptError, true);
        window.WatchGuardStartup = Object.freeze({finish, active: () => !finished});
        mount();
    }
    window.WatchGuardStartWatchlists = start;
    start();
})();
