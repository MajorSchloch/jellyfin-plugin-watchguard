/* Static navigation only. No user data, network requests, auth hooks or native event handlers. */
(function (root) {
    'use strict';
    if (root.WatchGuardNavigation) return;
    const document = root.document, entries = new Map();
    let identity = [], changed = () => {}, focused;
    const css = document.createElement('style');
    css.id = 'watchguard-navigation-style';
    css.textContent = `
        .watchguard-nav:focus {outline:2px solid var(--jf-palette-primary-main,currentColor)!important;outline-offset:-2px}
        @supports selector(:focus-visible) {.watchguard-nav:focus:not(:focus-visible) {outline:none!important}}
        .watchguard-nav {box-sizing:border-box;white-space:nowrap;text-decoration:none}
        .watchguard-nav:focus-visible {outline:2px solid var(--jf-palette-primary-main,currentColor)!important;outline-offset:-2px}
        .watchguard-nav-row {display:flex;list-style:none;padding:0;margin:0;min-width:0}
        .watchguard-nav-modern {flex:1;min-width:0}
        .watchguard-nav-modern[aria-current="page"] {background:var(--jf-palette-action-selected,rgba(255,255,255,.16))}
        .watchguard-nav-header-fallback {display:inline-flex;align-items:center;justify-content:center;vertical-align:middle;border:0;background:transparent;color:inherit;cursor:pointer}
        @media(hover:hover) {.watchguard-nav-header-fallback:hover {background:var(--jf-palette-action-hover,rgba(255,255,255,.08))}}
        .watchguard-nav-header[aria-current="page"] {color:var(--jf-palette-primary-main,#00a4dc)}
        @media(hover:hover) {.watchguard-nav-header[aria-current="page"]:hover {background:rgba(var(--jf-palette-primary-mainChannel,0 164 220) / var(--jf-palette-action-hoverOpacity,.08))}}
        .watchguard-nav-legacy {display:flex;width:100%}
        .mainDrawer:not(.drawer-open) .watchguard-nav-legacy {visibility:hidden}
        body.watchguard-page-open .mainDrawer a[href="#/home"].navMenuOption-selected {background:transparent!important;color:inherit}
        body.watchguard-page-open .mainDrawer a[href="#/home"].navMenuOption-selected:hover {background:var(--jf-palette-action-hover,rgba(255,255,255,.08))!important}
        .headerTabs.watchguard-has-tab {display:flex;justify-content:center;align-items:center}
        .headerTabs.watchguard-has-tab>.tabs-viewmenubar {flex:0 1 auto;width:auto;min-width:0}
        .watchguard-nav.watchguard-nav-tab {flex:none;transition:color .15s;padding:1.5em;border:0;border-radius:0;margin:0;background:transparent;box-shadow:none;color:var(--jf-palette-text-secondary,rgba(255,255,255,.7))}
        .watchguard-nav.watchguard-nav-tab[aria-current="page"] {color:var(--jf-palette-text-primary,#fff)}
        .watchguard-nav.watchguard-nav-tab:hover {background:transparent;color:var(--jf-palette-secondary-main,#00a4dc)}
        .watchguard-nav.watchguard-nav-tab:focus-visible {background:transparent;color:var(--jf-palette-secondary-main,#00a4dc)}
        body.watchguard-page-open .headerTabs.watchguard-has-tab .emby-tab-button-active:not(:hover):not(:focus) {color:var(--jf-palette-text-secondary,rgba(255,255,255,.7))}
        @media(prefers-reduced-motion:reduce) {.watchguard-nav {transition:none!important}}
    `;
    document.head.append(css);
    const assign = (element, name, value) => { if (element.getAttribute(name) !== value) element.setAttribute(name, value); };
    // Only presentation classes from a verified semantic MUI slot; never clone
    // IDs, React handlers, data attributes, tabindex, transient states or ripples.
    const presentation = source => [...source.classList].filter(c => /^(Mui|css-)/.test(c) && !/^Mui-/.test(c) && !/-loading(?:$|[A-Z])/.test(c)).join(' ');
    const classes = (element, source, own) => assign(element, 'class', own + ' ' + presentation(source));
    const span = name => { const e = document.createElement('span'); e.className = name; return e; };
    function make(kind) {
        const link = document.createElement('a'); link.href = '#/home?watchguard=watchlists'; link.dataset.layout = kind;
        link.addEventListener('click', event => {
            if (root.WatchGuardPoc || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
            // hashchange is asynchronous. Start the existing route handoff in
            // this click task, before a Legacy Home frame can paint. Native hash
            // routing and drawer click delegation still run; modified clicks
            // retain their ordinary browser behavior.
            event.preventDefault(); root.location.hash = link.hash;
            root.WatchGuardStartWatchlists?.();
        });
        const icon = span('watchguard-nav-icon'), text = span('watchguard-nav-text'); text.textContent = 'Watchlists';
        const row = kind === 'modern' ? document.createElement('li') : link;
        if (row !== link) { row.className = 'watchguard-nav-row'; row.append(link); link.addEventListener('keydown', e => { if (e.key === 'Enter') e.stopPropagation(); }); }
        if (kind.startsWith('legacy')) {
            link.className = kind === 'legacy-header' ? 'watchguard-nav headerButton headerButtonLeft paper-icon-button-light watchguard-nav-legacy-header' :
                'watchguard-nav emby-button ' + (kind === 'legacy-tabs' ? 'button-flat watchguard-nav-tab' : 'navMenuOption watchguard-nav-legacy');
            icon.className = 'material-icons bookmarks' + (kind === 'legacy-drawer' ? ' navMenuOptionIcon' : ''); icon.setAttribute('aria-hidden','true');
            text.className = kind === 'legacy-tabs' ? 'watchguard-nav-text' : 'navMenuOptionText';
            if (kind !== 'legacy-tabs') link.append(icon);
        } else {
            const svg = document.createElementNS('http://www.w3.org/2000/svg','svg'), path = document.createElementNS(svg.namespaceURI,'path');
            svg.setAttribute('viewBox','0 0 24 24'); svg.setAttribute('focusable','false'); svg.setAttribute('aria-hidden','true');
            path.setAttribute('d','M19 18l2 1V3c0-1.1-.9-2-2-2H8c-1.1 0-2 .9-2 2h11c1.1 0 2 .9 2 2v13zm-4-13H5c-1.1 0-2 .9-2 2v16l7-3 7 3V7c0-1.1-.9-2-2-2z');
            svg.append(path); icon.append(svg); link.append(icon);
            if (kind === 'modern') { const label = span(''); label.textContent = 'Watchlists'; text.textContent = ''; text.append(label); }
        }
        if (kind === 'legacy-header') { link.setAttribute('aria-label','Watchlists'); link.title = 'Watchlists'; } else link.append(text);
        const entry = {link,row,icon,text}; entries.set(kind,entry); return entry;
    }
    function place(kind, native, container, anchor) {
        if (!native || !container) return;
        const entry = entries.get(kind) || make(kind), {link,row,icon,text} = entry;
        if (kind === 'header' || kind === 'modern') {
            const nativeIcon = native.querySelector(kind === 'header' ? '.MuiButton-startIcon' : '.MuiListItemIcon-root');
            const svg = nativeIcon?.querySelector('.MuiSvgIcon-root');
            if (!nativeIcon || !svg || !native.matches(kind === 'header' ? '.MuiButton-root' : '.MuiListItemButton-root')) { row.remove(); return; }
            if (kind === 'header') {
                // Native active navigation changes Button color variants AND its
                // generated class. Never copy that route state to our inactive
                // link. Prefer an actually rendered, neutral button of the same
                // semantic variant; a library-free Favorites page uses a scoped
                // theme fallback until a neutral native button is available.
                const neutral = native.matches('.MuiButton-colorInherit') ? native :
                    [...container.querySelectorAll('a[href^="#/"].MuiButton-text.MuiButton-sizeMedium.MuiButton-colorInherit:not(.watchguard-nav)')]
                        .find(e => e.querySelector('.MuiButton-startIcon .MuiSvgIcon-root'));
                if (neutral) {
                    classes(link,neutral,'watchguard-nav watchguard-nav-header');
                    if (link.hasAttribute('style')) link.removeAttribute('style');
                } else {
                    assign(link,'class','watchguard-nav watchguard-nav-header watchguard-nav-header-fallback');
                    const style = root.getComputedStyle(native);
                    for (const property of ['font','padding','lineHeight','letterSpacing','textTransform','borderRadius','minWidth'])
                        if (link.style[property] !== style[property]) link.style[property] = style[property];
                }
            } else classes(link,native,'watchguard-nav watchguard-nav-modern');
            classes(icon,nativeIcon,'watchguard-nav-icon'); classes(icon.firstElementChild,svg,'');
            if (kind === 'modern') {
                const nativeText = native.querySelector('.MuiListItemText-root'), primary = nativeText?.querySelector('.MuiListItemText-primary');
                if (!nativeText || !primary) { row.remove(); return; }
                classes(text,nativeText,'watchguard-nav-text'); classes(text.firstElementChild,primary,'');
            }
        } else if (kind === 'legacy-tabs') {
            if (!container.classList.contains('watchguard-has-tab')) container.classList.add('watchguard-has-tab');
            const style = root.getComputedStyle(native);
            for (const property of ['font','padding','lineHeight','textTransform']) if (link.style[property] !== style[property]) link.style[property] = style[property];
        }
        if (row.parentElement !== container || (anchor && anchor.nextElementSibling !== row)) {
            const restore = focused === link && document.activeElement === document.body;
            if (anchor) anchor.after(row); else container.append(row);
            if (restore && link.getClientRects().length) link.focus({preventScroll:true});
        }
        const open = /^#\/home(?:\?|$)/.test(root.location.hash) && new URLSearchParams(root.location.hash.split('?')[1]).get('watchguard') === 'watchlists';
        assign(link,'aria-current',open ? 'page' : 'false');
        if (kind === 'legacy-drawer') link.classList.toggle('navMenuOption-selected',open);
        if (kind === 'modern') link.classList.toggle('Mui-selected',open);
    }
    function clear() { document.querySelectorAll('.watchguard-has-tab').forEach(e => e.classList.remove('watchguard-has-tab')); for (const {row} of entries.values()) row.remove(); entries.clear(); focused = null; }
    function update() {
        document.querySelectorAll('.watchguard-has-tab').forEach(e => { if (!e.querySelector('.watchguard-nav-tab')) e.classList.remove('watchguard-has-tab'); });
        const api = root.ApiClient, next = [api,api?.getCurrentUserId?.(),api?.accessToken?.()];
        if (next.some((v,i) => v !== identity[i])) { clear(); identity = next; }
        if (!next[1] || !next[2] || !/^#\/(?:home|details|movies|tv|list|search|music|livetv)(?:[/?]|$)/.test(root.location.hash)) { clear(); return; }
        const header = document.querySelector('header.MuiAppBar-root'), favorite = header?.querySelector('a[href="#/home?tab=1"].MuiButton-root');
        place('header',favorite,favorite?.parentElement,null);
        const drawer = document.querySelector('.MuiDrawer-root .MuiDrawer-paper'), drawerFavorite = drawer?.querySelector('a[href="#/home?tab=1"]'), nativeRow = drawerFavorite?.closest('li');
        if (nativeRow?.parentElement?.tagName === 'UL') place('modern',drawerFavorite,nativeRow.parentElement,nativeRow);
        const legacyHeader = document.querySelector('.skinHeader'), legacy = legacyHeader?.getClientRects().length ? legacyHeader : null, tabs = /^#\/home(?:\?|$)/.test(root.location.hash) ? legacy?.querySelector('.headerTabs:not(.hide)') : null;
        place('legacy-tabs',tabs?.querySelector('.emby-tab-button[data-index="1"]'),tabs,null);
        // Detail/library pages have no Home/Favorites tab row. Keep the existing
        // shortcut there, using the native icon-button presentation beside Home
        // or the drawer/back button, without relocating the Home tab anchor.
        const detailHeader = legacy && !/^#\/home(?:\?|$)/.test(root.location.hash) ? legacy.querySelector('.headerLeft') : null;
        const nativeHeaderButton = detailHeader && ['.headerHomeButton','.mainDrawerButton','.headerBackButton'].map(s => detailHeader.querySelector(s)).find(e => e?.getClientRects().length);
        place('legacy-header',nativeHeaderButton,detailHeader,nativeHeaderButton);
        const home = legacy && document.querySelector('.mainDrawer .scrollContainer > a[href="#/home"]');
        place('legacy-drawer',home,home?.parentElement,home);
        // Native surfaces can disappear on responsive/layout changes. Retain the
        // owned node for the replacement surface instead of recreating it.
        for (const [kind,{row}] of entries) if ((kind === 'header' && !favorite) || (kind === 'modern' && !nativeRow) || (kind === 'legacy-tabs' && !tabs) || (kind === 'legacy-drawer' && !home) || (kind === 'legacy-header' && !nativeHeaderButton)) row.remove();
    }
    const nativeSurface = 'header,.skinHeader,.mainDrawer,.MuiDrawer-root';
    const owned = e => e?.nodeType === 1 && (e.matches('.watchguard-nav,.watchguard-nav-row,#watchguard-navigation-style') || e.closest('.watchguard-nav,.watchguard-nav-row'));
    const relevant = record => {
        if (owned(record.target)) return false;
        if (record.type === 'attributes') return record.target.matches('html') || !!record.target.closest(nativeSurface);
        return [...record.addedNodes,...record.removedNodes].some(n => n.nodeType === 1 && !owned(n) && (n.matches(nativeSurface) || n.querySelector(nativeSurface) || record.target.closest?.(nativeSurface)));
    };
    const reconcile = () => { update(); changed(); };
    const observer = new MutationObserver(records => { if (records.some(relevant)) reconcile(); });
    observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['class','style','hidden','href']});
    document.addEventListener('focusin',e => { focused = e.target.closest?.('.watchguard-nav') || null; });
    const route = () => { root.WatchGuardStartWatchlists?.(); reconcile(); };
    root.addEventListener('hashchange',route); root.addEventListener('popstate',route); root.addEventListener('resize',reconcile);
    document.addEventListener('viewbeforeshow',reconcile,true); document.addEventListener('viewshow',reconcile,true);
    root.WatchGuardNavigation = Object.freeze({update,clear,connect:callback => { changed = callback; reconcile(); }});
    update();
})(window);
