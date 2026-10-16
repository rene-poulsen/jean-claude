// Everything that happens off-camera when a page first appears, whether
// from `goto` or from a navigating click: wait for it to load and settle,
// get rid of cookie banners, hide unwanted elements, and preload lazy
// images, so nothing pops in once recording starts.

// 'load' first (fast, always fires), then best-effort 'networkidle' on
// top — some sites (chat widgets, analytics beacons, live polling) never
// go network-idle at all, so a timeout there just means "proceed".
async function waitForLoad(page, cfg) {
    await page.waitForLoadState('load', { timeout: 60000 }).catch(() => {});
    await page.waitForLoadState('networkidle', { timeout: cfg.networkIdleTimeout }).catch(() => {});
}

// Best-effort cookie-consent dismissal. Prefers declining over accepting:
// Cookie Information's CMP (used by many Danish sites) exposes a reliable
// id="declineButton" regardless of banner language. Falls back to
// decline wording, then — only as a last resort — accept wording, which
// still beats a banner stuck over every frame of the video.
async function dismissCookies(page, cfg) {
    if (cfg.cookieButton === false) return;
    const candidates = [];
    if (cfg.cookieButton) candidates.push(page.locator(cfg.cookieButton).first());
    candidates.push(
        page.locator('#declineButton'),
        page.getByRole('button', {
            name: /afvis alle|kun n[øo]dvendige|decline all|reject all|^decline$|^reject$/i,
        }).first(),
        page.getByRole('button', {
            name: /accepter alle|accepter alt|tillad alle|godkend alle|accept all|allow all|i agree|^accept$|^ok$/i,
        }).first(),
    );
    for (const btn of candidates) {
        try {
            if ((await btn.count()) === 0 || !(await btn.isVisible())) continue;
            await btn.click({ timeout: 5000 });
            // Banners often fade out rather than vanish in the same tick —
            // wait until it's actually gone so it isn't baked into frame 1.
            await btn.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
            await page.waitForTimeout(500);
            return;
        } catch {
            // Try the next candidate.
        }
    }
}

// Marketing popups and chat launchers that float over every frame.
// Selectors are hidden by CSS; tag-name prefixes (widgets that render as
// custom elements with generated names, e.g. <sleeknote-ruw03n-bottom>)
// are removed by a MutationObserver, so late-appearing popups are caught too.
const KNOWN_WIDGETS = {
    selectors: [
        '#intercom-container', '.intercom-lightweight-app', '#hubspot-messages-iframe-container',
        'iframe#launcher', '#tidio-chat', '.crisp-client', '#drift-widget-container',
        '#chat-widget-container', '.tawk-min-container',
    ],
    tagPrefixes: ['sleeknote-'],
};

async function hideWidgets(page, cfg) {
    const tagPrefixes = [...(cfg.hideKnownWidgets ? KNOWN_WIDGETS.tagPrefixes : []), ...cfg.hideTagPrefixes];
    if (!tagPrefixes.length) return;
    await page.evaluate((prefixes) => {
        const test = (el) => el.nodeType === 1 && prefixes.some((p) => el.tagName.toLowerCase().startsWith(p));
        // Removed rather than hidden: these widgets style their own host from
        // inside shadow DOM (`:host { display: flex !important }`), which
        // beats even an inline `display: none !important`.
        const sweep = (root) => {
            if (test(root)) { root.remove(); return; }
            if (root.querySelectorAll) root.querySelectorAll('*').forEach((el) => test(el) && el.remove());
        };
        sweep(document.documentElement);
        new MutationObserver((muts) => {
            for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) sweep(n);
        }).observe(document.documentElement, { childList: true, subtree: true });
    }, tagPrefixes.map((p) => p.toLowerCase())).catch(() => {});
}

async function injectCss(page, cfg) {
    const rules = [
        // --hide-scrollbars covers the window; this covers inner scroll areas.
        '*{scrollbar-width:none !important}',
        '*::-webkit-scrollbar{display:none !important}',
    ];
    const hide = [...(cfg.hideKnownWidgets ? KNOWN_WIDGETS.selectors : []), ...cfg.hide];
    // visibility too: some widgets set an inline `display: block !important`,
    // which beats any stylesheet rule, but leave visibility alone.
    if (hide.length) rules.push(`${hide.join(',')}{display:none !important;visibility:hidden !important}`);
    if (cfg.css) rules.push(cfg.css);
    await page.addStyleTag({ content: rules.join('\n') }).catch(() => {});
}

// Loading="lazy" images would otherwise start downloading only as they
// scroll into view and could pop in mid-shot. Load them all up front.
async function preloadImages(page) {
    await page.evaluate(async () => {
        for (const img of document.querySelectorAll('img[loading="lazy"]')) img.loading = 'eager';
        const pending = [...document.images].filter((i) => !i.complete);
        await Promise.race([
            Promise.all(pending.map((i) => new Promise((r) => { i.onload = i.onerror = r; }))),
            new Promise((r) => setTimeout(r, 10000)),
        ]);
        await document.fonts.ready;
    }).catch(() => {});
}

// Runs after every page appears. The virtual clock is still running in
// real time here; the caller freezes it afterwards.
async function preparePage(page, cfg) {
    await waitForLoad(page, cfg);
    await dismissCookies(page, cfg);
    await injectCss(page, cfg);
    await hideWidgets(page, cfg);
    if (cfg.preloadImages) await preloadImages(page);
    // Some sites still run a hero/nav blur-in or fade after load. A frame
    // captured mid-transition shows a hazy, half-rendered state that never
    // reappears. Set "settle": 0 to record the intro animation instead.
    await page.waitForTimeout(cfg.settle * 1000);
}

module.exports = { preparePage, dismissCookies };
