// Runs Lighthouse (mobile + desktop) against a URL in Playwright's headless Chromium with a clean
// profile, writes a compact summary.json and takes screenshots of the flagged elements
// (outlined with a pink dashed line) plus the first viewport. While taking the screenshots it also
// records console errors and redirects (summary.json → <form>.functional).
//
// Usage: node ~/.claude/skills/lighthouse-test/scripts/run.mjs <url> [out-dir] [options]
//   out-dir                 where reports/, screenshots/ and summary.json go (default: docs/lighthouse-test)
//   --runs=3                Lighthouse runs per form factor; the run with the median performance score is kept
//                           (all scores are saved in reports/runs.json)
//   --skip-run              reuse the reports in <out-dir>/reports and only redo summary.json + screenshots
//   --shot-audits=a,b       audits whose flagged elements get a screenshot (default: color-contrast,link-name)
//   CHROME_PATH=<exe>       use another Chrome/Chromium instead of Playwright's
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { ensure } from './setup.mjs';

const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const opt = (name, def) => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') || def;
const TARGET_URL = args[0];
if (!TARGET_URL) {
    console.error('Usage: node run.mjs <url> [out-dir] [--runs=3] [--skip-run] [--shot-audits=a,b]');
    process.exit(1);
}
const OUT = path.resolve(args[1] || 'docs/lighthouse-test');
const SKIP_RUN = process.argv.includes('--skip-run');
const RUNS = Number(opt('runs', 3));
const SHOT_AUDITS = opt('shot-audits', 'color-contrast,link-name').split(',');
const REPORT_DIR = path.join(OUT, 'reports');
const SHOT_DIR = path.join(OUT, 'screenshots');
// Same viewports as Lighthouse's mobile (Moto G Power) and desktop presets
const FORMS = {
    mobile: { width: 412, height: 823, mobile: true },
    desktop: { width: 1350, height: 940, mobile: false }
};
const METRICS = ['first-contentful-paint', 'largest-contentful-paint', 'total-blocking-time', 'cumulative-layout-shift', 'speed-index', 'interactive', 'total-byte-weight', 'mainthread-work-breakdown'];

const { chromium, lighthouseCli } = ensure();
const CHROME = process.env.CHROME_PATH || chromium.executablePath();

fs.mkdirSync(REPORT_DIR, { recursive: true });
fs.mkdirSync(SHOT_DIR, { recursive: true });

// 1. Run Lighthouse. It launches the browser with a fresh temporary profile: no extensions, cookies or cache.
// Certificate errors are ignored so a local dev certificate (https://localhost) works.
if (!SKIP_RUN) {
    const runs = {};
    for (const form of Object.keys(FORMS)) {
        const results = [];
        for (let i = 1; i <= RUNS; i++) {
            console.log(`Running Lighthouse (${form}, run ${i}/${RUNS}) on ${TARGET_URL}`);
            const outPath = path.join(REPORT_DIR, `lh-${form}` + (RUNS > 1 ? `-run${i}` : ''));
            const flags = [
                lighthouseCli, TARGET_URL,
                '--chrome-flags=--headless=new --incognito --disable-extensions --no-first-run --ignore-certificate-errors',
                '--output=json', '--output=html',
                `--output-path=${outPath}`,
                '--quiet'
            ];
            if (form === 'desktop') flags.push('--preset=desktop');
            execFileSync(process.execPath, flags, { stdio: 'inherit', env: { ...process.env, CHROME_PATH: CHROME } });
            const report = JSON.parse(fs.readFileSync(outPath + '.report.json', 'utf8'));
            results.push({ outPath, scores: Object.fromEntries(Object.entries(report.categories).map(([k, c]) => [k, Math.round(c.score * 100)])) });
        }
        if (RUNS > 1) {
            // Keep the median run (by performance score) as lh-<form>.report.*, remove the others
            const median = [...results].sort((a, b) => a.scores.performance - b.scores.performance)[Math.floor(RUNS / 2)];
            for (const ext of ['.report.json', '.report.html']) fs.copyFileSync(median.outPath + ext, path.join(REPORT_DIR, `lh-${form}${ext}`));
            results.forEach(r => ['.report.json', '.report.html'].forEach(ext => fs.rmSync(r.outPath + ext)));
            runs[form] = { performance: results.map(r => r.scores.performance), scores: results.map(r => r.scores), keptRun: results.indexOf(median) + 1 };
        }
    }
    if (RUNS > 1) fs.writeFileSync(path.join(REPORT_DIR, 'runs.json'), JSON.stringify(runs, null, 4));
}

// 2. Summary + collect flagged elements
const targets = [];
const summary = { url: TARGET_URL };
for (const form of Object.keys(FORMS)) {
    const report = JSON.parse(fs.readFileSync(path.join(REPORT_DIR, `lh-${form}.report.json`), 'utf8'));
    summary[form] = summarize(report);
    console.log(`\n=== ${form} (Lighthouse ${report.lighthouseVersion})`);
    for (const c of Object.values(report.categories)) console.log(`  ${c.title}: ${Math.round(c.score * 100)}`);

    targets.push({ form, name: `above-the-fold--${form}` });
    for (const id of SHOT_AUDITS) {
        findNodes(report.audits[id]?.details).forEach((node, n) => {
            targets.push({ form, name: `${id}--${form}--${n + 1}`, selector: node.selector, context: node.context });
        });
    }
}
const runsFile = path.join(REPORT_DIR, 'runs.json');
if (fs.existsSync(runsFile)) summary.runs = JSON.parse(fs.readFileSync(runsFile, 'utf8'));

// 3. Screenshots with Playwright, one fresh context per form factor
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--hide-scrollbars'] });
try {
    for (const form of Object.keys(FORMS)) {
        const vp = FORMS[form];
        const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, isMobile: vp.mobile, hasTouch: vp.mobile, ignoreHTTPSErrors: true });
        const page = await context.newPage();
        // Basic functional check while loading the page: JS errors, redirected and failed requests
        const functional = summary[form].functional = { consoleErrors: [], redirects: [], failedRequests: [] };
        page.on('pageerror', e => functional.consoleErrors.push(e.message.slice(0, 300)));
        page.on('console', m => m.type() === 'error' && functional.consoleErrors.push(`${m.text().slice(0, 300)} (${m.location().url || 'inline'})`));
        context.on('response', r => {
            if (r.status() >= 300 && r.status() < 400) functional.redirects.push(`${r.status()} ${r.url()}`);
            else if (r.status() >= 400) functional.failedRequests.push(`${r.status()} ${r.url()}`);
        });
        await page.goto(TARGET_URL, { waitUntil: 'load', timeout: 60000 });
        await page.waitForTimeout(5000);
        await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important;animation:none!important}' });

        for (const t of targets.filter(t => t.form === form)) {
            let clip;
            if (t.selector) {
                clip = await page.evaluate(({ selector, context }) => {
                    document.querySelectorAll('[data-lh-mark]').forEach(e => { e.style.outline = ''; e.removeAttribute('data-lh-mark'); });
                    const el = document.querySelector(selector);
                    if (!el) return null;
                    const ctx = (context && document.querySelector(context)) || el;
                    el.setAttribute('data-lh-mark', '');
                    // Hide fixed and sticky elements (headers, cookie bars, chat buttons) unless they contain the target,
                    // so they don't cover it
                    document.querySelectorAll('[data-lh-hidden]').forEach(e => { e.style.removeProperty('visibility'); e.removeAttribute('data-lh-hidden'); });
                    for (const f of document.querySelectorAll('body *')) {
                        if (f.contains(el) || !['fixed', 'sticky'].includes(getComputedStyle(f).position)) continue;
                        f.style.setProperty('visibility', 'hidden');
                        f.setAttribute('data-lh-hidden', '');
                    }
                    el.style.outline = '3px dashed #ff2d95';
                    el.style.outlineOffset = '3px';
                    // Reset first, so fixed elements (e.g. a fixed header) are measured at scroll position 0
                    scrollTo(0, 0);
                    if (ctx.getBoundingClientRect().bottom > innerHeight) ctx.scrollIntoView({ block: 'center' });
                    const a = el.getBoundingClientRect(), b = ctx.getBoundingClientRect();
                    const pad = 40;
                    const x = Math.max(0, Math.min(a.left, b.left) - pad), y = Math.min(a.top, b.top) - pad + scrollY;
                    return { x, y: Math.max(0, y), width: Math.min(innerWidth, Math.max(a.right, b.right) + pad) - x, height: Math.min(900, Math.max(a.bottom, b.bottom) - Math.min(a.top, b.top) + pad * 2) };
                }, { selector: t.selector, context: t.context || null });
                if (!clip) { console.log(`  ! not found: ${t.selector}`); continue; }
                await page.waitForTimeout(1500);
            } else {
                await page.evaluate(() => {
                    scrollTo(0, 0);
                    document.querySelectorAll('[data-lh-hidden]').forEach(e => { e.style.removeProperty('visibility'); e.removeAttribute('data-lh-hidden'); });
                });
                await page.waitForTimeout(1000);
            }
            await page.screenshot({ path: path.join(SHOT_DIR, t.name + '.png'), ...(clip ? { clip, fullPage: true } : {}) });
            console.log(`  screenshot ${t.name}.png`);
        }
        await context.close();
    }
} finally {
    await browser.close();
    fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
}
console.log(`\nSummary: ${path.join(OUT, 'summary.json')}\nReports: ${REPORT_DIR}\nScreenshots: ${SHOT_DIR}`);

// Compact version of a Lighthouse report: scores, key metrics, what was downloaded and every failing audit
function summarize(report) {
    const audit = id => report.audits[id];
    const categoryOf = {};
    for (const [key, c] of Object.entries(report.categories)) c.auditRefs.forEach(r => (categoryOf[r.id] ??= []).push(key));

    const requests = audit('network-requests')?.details?.items || [];
    const byType = {};
    for (const r of requests) {
        const t = (byType[r.resourceType || 'Other'] ??= { requests: 0, transferKiB: 0 });
        t.requests++;
        t.transferKiB += (r.transferSize || 0) / 1024;
    }
    Object.values(byType).forEach(t => t.transferKiB = Math.round(t.transferKiB));

    const failing = Object.values(report.audits)
        .filter(a => a.score !== null && a.score < 0.9 && !['notApplicable', 'manual', 'informative'].includes(a.scoreDisplayMode) && !METRICS.includes(a.id))
        .map(a => ({
            id: a.id,
            title: a.title,
            categories: categoryOf[a.id] || [],
            score: a.score,
            displayValue: a.displayValue,
            savings: a.metricSavings,
            items: flattenItems(a.details).slice(0, 15).map(compactItem)
        }));

    return {
        lighthouseVersion: report.lighthouseVersion,
        fetchTime: report.fetchTime,
        userAgent: report.environment?.hostUserAgent,
        benchmarkIndex: report.environment?.benchmarkIndex,
        throttling: report.configSettings?.throttling,
        scores: Object.fromEntries(Object.entries(report.categories).map(([k, c]) => [k, Math.round(c.score * 100)])),
        metrics: Object.fromEntries(METRICS.map(id => [id, { value: audit(id)?.displayValue, numeric: audit(id)?.numericValue, score: audit(id)?.score }])),
        requests: { count: requests.length, transferKiB: Math.round(requests.reduce((s, r) => s + (r.transferSize || 0), 0) / 1024), byType },
        largestRequests: [...requests].sort((a, b) => (b.transferSize || 0) - (a.transferSize || 0)).slice(0, 10).map(r => ({ url: r.url, type: r.resourceType, transferKiB: Math.round((r.transferSize || 0) / 1024) })),
        failing
    };
}

function flattenItems(details) {
    if (!details) return [];
    if (details.type === 'list') return details.items.flatMap(flattenItems);
    // Some detail types (e.g. network trees, checklists) have an object instead of an items array
    return Array.isArray(details.items) ? details.items : [];
}

function compactItem(item) {
    const out = {};
    for (const [k, v] of Object.entries(item)) {
        if (v && typeof v === 'object' && v.type === 'node') out[k] = { selector: v.selector, snippet: v.snippet?.slice(0, 200), label: v.nodeLabel };
        else if (v && typeof v === 'object' && v.type === 'source-location') out[k] = `${v.url}:${v.line}`;
        else if (k === 'subItems') out.subItems = (v.items || []).slice(0, 5).map(compactItem);
        else if (typeof v === 'string') out[k] = v.slice(0, 300);
        else if (typeof v !== 'object' || v === null) out[k] = v;
    }
    return out;
}

// Finds all flagged nodes in an audit's details (tables can be nested in lists)
function findNodes(details) {
    if (!details) return [];
    if (details.type === 'list') return details.items.flatMap(findNodes);
    return (Array.isArray(details.items) ? details.items : []).filter(i => i.node?.selector).map(i => ({
        selector: i.node.selector.replace(/^body[^>]*>\s*/, ''),
        context: i.subItems?.items?.[0]?.relatedNode?.selector?.replace(/^body[^>]*>\s*/, '')
    }));
}
