#!/usr/bin/env node
// Usage: node pick.js <url> [--viewport 1920x1080]
//
// Opens a real browser window for building a shot list. Click elements
// to get ready-to-paste steps (printed here and copied to the clipboard):
//   click        -> { "click": ... }
//   S + click    -> { "scrollTo": ... }
//   H + click    -> { "hover": ... }
//   Alt + click  -> uses the page normally (follow links, open menus)
const path = require('path');
const { chromium } = require('playwright');
const { dismissCookies } = require('./lib/page-setup');

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith('--'));
const vpArg = args.includes('--viewport') ? args[args.indexOf('--viewport') + 1] : '1920x1080';
const [width, height] = vpArg.split('x').map(Number);

if (!url) {
    console.log('Usage: node pick.js <url> [--viewport 1920x1080]');
    process.exit(1);
}

function stepFor(kind, selector, navigates) {
    if (kind === 'scrollTo') return { scrollTo: selector, block: 'top', offset: 80, duration: 2.5 };
    if (kind === 'hover') return { hover: selector };
    return navigates ? { click: selector, navigates: true } : { click: selector };
}

// Picks the best candidate: it must resolve (via .first(), as the recorder
// does) to the very element that was clicked. Unique matches win.
async function choose(frame, candidates) {
    let fallback = null;
    for (const sel of candidates) {
        try {
            const loc = frame.locator(sel);
            const count = await loc.count();
            if (!count) continue;
            const same = await loc.first().evaluate((el) => el === window.__pickLast);
            if (!same) continue;
            if (count === 1) return sel;
            fallback = fallback || sel;
        } catch {
            // Invalid for Playwright's engine — skip.
        }
    }
    return fallback;
}

(async () => {
    const browser = await chromium.launch({ headless: args.includes('--headless'), args: [`--window-size=${width + 16},${height + 140}`] });
    const context = await browser.newContext({ viewport: { width, height } });
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    await context.exposeBinding('__pickReport', async ({ frame }, { kind, candidates, navigates }) => {
        const selector = await choose(frame, candidates);
        if (!selector) {
            console.log(`\n(no selector resolved uniquely — candidates were:\n  ${candidates.join('\n  ')})`);
            return null;
        }
        const text = JSON.stringify(stepFor(kind, selector, navigates)) + ',';
        console.log(text);
        await frame.page().evaluate((t) => navigator.clipboard.writeText(t), text).catch(() => {});
        return text;
    });
    await context.addInitScript({ path: path.join(__dirname, 'lib', 'picker-ui.js') });

    const page = await context.newPage();
    page.on('framenavigated', (f) => {
        if (f === page.mainFrame()) console.log(`\n// now on ${f.url()}`);
    });
    // Same banner handling as the recorder, so you pick on what gets recorded.
    // The picker is paused meanwhile, or it would swallow the click.
    page.on('load', async () => {
        await page.evaluate(() => { window.__pickerOff = true; }).catch(() => {});
        await dismissCookies(page, { cookieButton: null }).catch(() => {});
        await page.evaluate(() => { window.__pickerOff = false; }).catch(() => {});
    });
    page.on('close', () => browser.close().then(() => process.exit(0)));

    console.log('Picker open. click = click step · S+click = scrollTo · H+click = hover · Alt+click = use the page.');
    console.log('Steps are printed below and copied to the clipboard. Close the window to quit.\n');
    console.log(JSON.stringify({ goto: url }) + ',');
    await page.goto(url);
})();
