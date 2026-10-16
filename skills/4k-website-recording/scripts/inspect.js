#!/usr/bin/env node
// Usage: node inspect.js <url> [--out dir] [--shots 10]
//
// Surveys a page the way record.js will see it (same viewport, cookie and
// popup handling) so a shot list can be written without guessing:
//   - internal links, section anchors, headings and toggles (accordions,
//     tabs, menus), each with a ready-to-use selector, how many elements
//     match it, and where it sits on the page (pageY)
//   - smooth-scroll libraries, inner scroll containers, embedded players
//   - fixed/sticky overlays still visible after cleanup (popups to `hide`)
//   - screenshots down the page, named by scroll position
// Writes inspect.json and the screenshots to the out dir, and prints a summary.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { DEFAULTS, LAUNCH_ARGS } = require('./lib/config');
const { preparePage } = require('./lib/page-setup');

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith('--'));
const opt = (name, def) => (args.includes(name) ? args[args.indexOf(name) + 1] : def);
if (!url) {
    console.log('Usage: node inspect.js <url> [--out dir] [--shots 10]');
    process.exit(1);
}
const host = new URL(url).hostname.replace(/^www\./, '');
const outDir = path.resolve(opt('--out', path.join(process.cwd(), 'recording-output', '_inspect', host + new URL(url).pathname.replace(/\/$/, '').replace(/\//g, '_'))));
const maxShots = Number(opt('--shots', 10));

(async () => {
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });
    const browser = await chromium.launch({ args: LAUNCH_ARGS });
    const { width, height } = DEFAULTS.viewport;
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'commit', timeout: 60000 });
    await preparePage(page, { ...DEFAULTS, preloadImages: true });

    const info = await page.evaluate(() => {
        const q = (s) => JSON.stringify(s);
        const count = (sel) => { try { return document.querySelectorAll(sel).length; } catch { return -1; } };
        const generated = (s) => /\d{3,}|^[0-9]|[:[\]]|^(css|sc|jsx|svelte|emotion)-/.test(s);
        const visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 2 && r.height > 2 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
        const pageY = (el) => Math.round(el.getBoundingClientRect().top + window.scrollY);
        const text = (el) => (el.innerText || el.getAttribute('aria-label') || el.getAttribute('title')
            || el.querySelector('img[alt]')?.alt || '').trim().replace(/\s+/g, ' ').slice(0, 60);
        const textSel = (el) => { const t = text(el); return t && t.length <= 50 ? `text=${q(t)}` : null; };

        const links = new Map();
        for (const a of document.querySelectorAll('a[href]')) {
            const href = a.getAttribute('href');
            if (/^(mailto:|tel:|javascript:)/.test(href) || !visible(a)) continue;
            let u; try { u = new URL(a.href); } catch { continue; }
            const internal = u.origin === location.origin;
            const samePage = internal && u.pathname === location.pathname && u.search === location.search;
            const sel = `a[href=${q(href)}]`;
            if (links.has(sel)) continue;
            links.set(sel, {
                selector: sel, matches: count(sel), text: text(a), pageY: pageY(a),
                kind: samePage ? 'anchor' : internal ? 'page' : 'external',
                opensNewTab: a.target === '_blank',
            });
        }

        const sections = [];
        for (const el of document.querySelectorAll('[id]')) {
            if (generated(el.id) || !visible(el) || el.closest('a,button')) continue;
            const r = el.getBoundingClientRect();
            if (r.height < 150 && !/^H[1-3]$/.test(el.tagName)) continue;
            sections.push({ selector: '#' + CSS.escape(el.id), tag: el.tagName.toLowerCase(), pageY: pageY(el), height: Math.round(r.height), text: text(el).slice(0, 40) });
        }
        const headings = [...document.querySelectorAll('h1,h2,h3')].filter(visible).map((h) => ({
            selector: h.id && !generated(h.id) ? '#' + CSS.escape(h.id) : textSel(h), tag: h.tagName.toLowerCase(), text: text(h), pageY: pageY(h),
        })).filter((h) => h.selector);

        const toggles = [...document.querySelectorAll('[aria-expanded],[aria-controls],summary,[role=tab]')].filter(visible).map((el) => {
            const sel = el.id && !generated(el.id) ? '#' + CSS.escape(el.id) : textSel(el);
            return sel && { selector: sel, matches: sel.startsWith('#') ? count(sel) : null, text: text(el), expanded: el.getAttribute('aria-expanded'), pageY: pageY(el) };
        }).filter(Boolean).slice(0, 40);

        const se = document.scrollingElement || document.documentElement;
        let scrollContainer = null;
        if (se.scrollHeight <= window.innerHeight + 10) {
            let best = null;
            for (const el of document.querySelectorAll('body *')) {
                const oy = getComputedStyle(el).overflowY;
                if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 200 && (!best || el.scrollHeight > best.scrollHeight)) best = el;
            }
            if (best) scrollContainer = best.id ? '#' + CSS.escape(best.id) : best.className ? '.' + [...best.classList].map(CSS.escape).join('.') : best.tagName.toLowerCase();
        }

        const overlays = [];
        for (const el of document.querySelectorAll('body *')) {
            const cs = getComputedStyle(el);
            if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
            if (!visible(el) || el.hasAttribute('data-recording-cursor')) continue;
            const r = el.getBoundingClientRect();
            const area = (r.width * r.height) / (window.innerWidth * window.innerHeight);
            if (area < 0.01) continue;
            overlays.push({
                tag: el.tagName.toLowerCase(), id: el.id || null, classes: [...el.classList].slice(0, 4).join(' '),
                position: cs.position, rect: [r.left, r.top, r.width, r.height].map(Math.round), text: text(el).slice(0, 50),
                likely: r.top < 10 && r.height < 160 ? 'header/nav (usually keep)'
                    : cs.position === 'sticky' ? 'sticky content (usually part of the design)'
                    : 'possible popup/banner (check the screenshots; consider "hide")',
            });
        }

        return {
            title: document.title,
            finalUrl: location.href,
            pageHeight: se.scrollHeight,
            viewportHeight: window.innerHeight,
            scrollContainer,
            smoothScroll: {
                lenis: !!(window.lenis || window.__lenis || document.documentElement.classList.contains('lenis')),
                gsapScrollSmoother: !!(window.ScrollSmoother && window.ScrollSmoother.get && window.ScrollSmoother.get()),
                locomotive: !!document.querySelector('[data-scroll-container]'),
                cssSmooth: getComputedStyle(document.documentElement).scrollBehavior === 'smooth',
            },
            iframes: [...document.querySelectorAll('iframe')].filter(visible).map((f) => { try { return new URL(f.src).hostname; } catch { return f.src.slice(0, 60); } }),
            videos: document.querySelectorAll('video').length,
            links: [...links.values()].slice(0, 80),
            sections, headings: headings.slice(0, 40), toggles, overlays,
        };
    });

    // Screenshots down the page, evenly spaced, at the recording's layout.
    const scroller = info.scrollContainer;
    const maxY = Math.max(0, (scroller ? await page.$eval(scroller, (e) => e.scrollHeight - e.clientHeight) : info.pageHeight - info.viewportHeight));
    const n = Math.max(1, Math.min(maxShots, Math.ceil(maxY / info.viewportHeight) + 1));
    info.screenshots = [];
    for (let i = 0; i < n; i++) {
        const y = n === 1 ? 0 : Math.round((maxY * i) / (n - 1));
        await page.evaluate(({ y, scroller }) => {
            const el = scroller ? document.querySelector(scroller) : null;
            (el || window).scrollTo({ top: y, behavior: 'instant' });
        }, { y, scroller });
        await page.waitForTimeout(700); // let scroll-triggered reveals run
        const file = path.join(outDir, `shot-${String(i).padStart(2, '0')}-y${y}.jpg`);
        await page.screenshot({ path: file, type: 'jpeg', quality: 80 });
        info.screenshots.push(file);
    }

    fs.writeFileSync(path.join(outDir, 'inspect.json'), JSON.stringify(info, null, 2));
    await browser.close();

    const s = info.smoothScroll;
    console.log(`${info.title}  (${info.finalUrl})`);
    console.log(`page height ${info.pageHeight}px = ${(info.pageHeight / info.viewportHeight).toFixed(1)} screens` +
        `${info.scrollContainer ? `, scrolls inside ${info.scrollContainer} -> set "scrollContainer"` : ''}`);
    console.log(`smooth scroll: ${Object.entries(s).filter(([, v]) => v).map(([k]) => k).join(', ') || 'none'}` +
        `; iframes: ${info.iframes.join(', ') || 'none'}; <video>: ${info.videos}`);
    const pages = info.links.filter((l) => l.kind === 'page');
    console.log(`\n${pages.length} links to other pages (first 25):`);
    for (const l of pages.slice(0, 25)) console.log(`  ${l.selector}${l.matches > 1 ? ` (x${l.matches})` : ''}  "${l.text}"  y=${l.pageY}`);
    console.log(`\nsections: ${info.sections.map((x) => `${x.selector}@${x.pageY}`).join('  ') || 'none with ids'}`);
    if (info.toggles.length) console.log(`toggles: ${info.toggles.map((t) => `${t.selector} "${t.text}"`).slice(0, 12).join(' | ')}`);
    if (info.overlays.length) {
        console.log('\nfixed/sticky overlays still visible:');
        for (const o of info.overlays) console.log(`  <${o.tag}${o.id ? '#' + o.id : ''}${o.classes ? ' .' + o.classes.replace(/ /g, '.') : ''}> ${o.rect.join(',')}  ${o.likely}`);
    }
    console.log(`\nfull details + ${info.screenshots.length} screenshots: ${outDir}`);
})().catch((e) => { console.error(e.message); process.exit(1); });
