// Serializable browser probe, shared by Chromium 79 and current Chromium.
// Data/focus readiness does not imply that Jellyfin has restored its tab row.
module.exports = function returnPositionLayout(options) {
    const rect = element => {
        if (!element) return null;
        const r = element.getBoundingClientRect();
        return {top:r.top, bottom:r.bottom, left:r.left, width:r.width, height:r.height};
    };
    const visible = element => !!element && !!element.getClientRects().length &&
        getComputedStyle(element).visibility !== 'hidden' && getComputedStyle(element).display !== 'none';
    const panel = document.querySelector('.watchguard-page');
    const anchor = panel && panel.querySelector('.watchguard-card a.button-link[href*="' + options.id + '"]');
    const card = anchor && anchor.closest('.watchguard-card');
    const header = Array.from(document.querySelectorAll('.skinHeader,header.MuiAppBar-root')).find(visible);
    const tabs = header && header.querySelector('.headerTabs');
    const nativeTabsVisible = visible(tabs) && ['0', '1'].every(index =>
        visible(tabs.querySelector('.emby-tab-button[data-index="' + index + '"]')));
    // Observe the actual native layout, not elapsed frames, card offset, or
    // hidden Home content. A missing tab row must time out and fail.
    const layoutReady = !!panel && !!header &&
        (!options.requireTabs || nativeTabsVisible) &&
        Math.abs(panel.getBoundingClientRect().top - header.getBoundingClientRect().bottom) < 1;
    if (options.readyOnly) return layoutReady;
    return {
        at:performance.now(), found:!!anchor, top:anchor && anchor.getBoundingClientRect().top,
        scroll:panel && panel.scrollTop, focused:document.activeElement === anchor,
        focusLabel:document.activeElement && document.activeElement.getAttribute('aria-label'),
        count:panel && panel.querySelectorAll('.watchguard-card').length,
        viewState:panel && panel.getAttribute('data-view-state'),
        returnState:panel && panel.getAttribute('data-return-state'), layoutReady,
        geometry:{title:rect(card && card.querySelector('.cardText')), anchor:rect(anchor), card:rect(card),
            panel:rect(panel), header:rect(header), visibleHeaderHeight:header ? header.getBoundingClientRect().height : 0,
            tabs:rect(tabs), tabsVisible:visible(tabs), nativeTabsVisible}
    };
};
