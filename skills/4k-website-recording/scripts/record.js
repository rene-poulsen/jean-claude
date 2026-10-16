#!/usr/bin/env node
// Usage: node record.js <shotlist.json> [--format mp4|prores|both] [--codec h264|h265] [--preview] [--keep-frames]
//
// Renders a scripted walkthrough of a website — scroll to elements, hover,
// click through to other pages — as a frame-perfect 4K 60fps video.
// See ../references/shot-lists.md for the shot list format.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { Recorder } = require('./lib/steps');
const { finalize } = require('./lib/encoder');
const { LAUNCH_ARGS, loadConfig } = require('./lib/config');

function parseArgs(argv) {
    const out = { flags: {} };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--preview') out.flags.preview = true;
        else if (a === '--keep-frames') out.flags.keepFrames = true;
        else if (a === '--format') out.flags.format = argv[++i];
        else if (a === '--codec') out.flags.codec = argv[++i];
        else if (a === '--out') out.flags.out = argv[++i];
        else if (!a.startsWith('--') && !out.shotlist) out.shotlist = a;
        else throw new Error(`Unknown argument: ${a}`);
    }
    return out;
}

(async () => {
    const { shotlist, flags } = parseArgs(process.argv.slice(2));
    if (!shotlist) {
        console.log('Usage: node record.js <shotlist.json> [--format mp4|prores|both] [--codec h264|h265] [--preview] [--keep-frames] [--out dir]');
        process.exit(1);
    }
    let cfg;
    try {
        cfg = loadConfig(shotlist, flags);
    } catch (e) {
        console.error(`Shot list problem: ${e.message}`);
        process.exit(1);
    }
    // Renders go next to where the command is run, never inside the skill folder.
    const outDir = path.resolve(flags.out || path.join(process.cwd(), 'recording-output', cfg.name));
    const workDir = path.join(outDir, flags.preview ? 'work-preview' : 'work');
    fs.rmSync(workDir, { recursive: true, force: true });
    fs.mkdirSync(workDir, { recursive: true });

    const px = `${cfg.viewport.width * cfg.viewport.deviceScaleFactor}x${cfg.viewport.height * cfg.viewport.deviceScaleFactor}`;
    console.log(`Recording "${cfg.name}" at ${px} ${cfg.fps}fps${flags.preview ? ' (preview)' : ''} -> ${outDir}`);

    const browser = await chromium.launch({
        args: LAUNCH_ARGS,
    });
    const context = await browser.newContext({
        viewport: { width: cfg.viewport.width, height: cfg.viewport.height },
        deviceScaleFactor: cfg.viewport.deviceScaleFactor,
        ...(cfg.locale ? { locale: cfg.locale } : {}),
        reducedMotion: 'no-preference',
        ...(cfg.userAgent ? { userAgent: cfg.userAgent } : {}),
    });
    await context.addInitScript({ path: path.join(__dirname, 'lib', 'virtual-time.js') });
    await context.addInitScript({ path: path.join(__dirname, 'lib', 'cursor.js') });
    const page = await context.newPage();
    const client = await context.newCDPSession(page);
    // Playwright's viewport emulation lives on its own CDP session. On some
    // sites captures from this session then paint Chromium's
    // default 800x600 surface into a corner. Emulating here too pins it down;
    // captures from this session are then in device pixels (clip scale 1).
    await client.send('Emulation.setDeviceMetricsOverride', {
        width: cfg.viewport.width,
        height: cfg.viewport.height,
        deviceScaleFactor: cfg.viewport.deviceScaleFactor,
        mobile: false,
    });

    const recorder = new Recorder({
        page, client, cfg, workDir,
        keepFrames: !!flags.keepFrames,
        log: (m) => console.log(m),
    });

    const t0 = Date.now();
    try {
        for (let i = 0; i < cfg.steps.length; i++) {
            const step = cfg.steps[i];
            console.log(`\n[${i + 1}/${cfg.steps.length}] ${recorder.describe(step)}`);
            const f0 = recorder.frameNo;
            await recorder.run(step);
            if (process.stdout.isTTY) process.stdout.write('\r\x1b[K');
            console.log(`    ${recorder.frameNo - f0} frames`);
        }
        await recorder.endSegment();
    } catch (e) {
        console.error(`\nFailed: ${e.message}`);
        await recorder.endSegment().catch(() => {});
        await browser.close();
        process.exit(1);
    }
    await browser.close();

    const captureSecs = (Date.now() - t0) / 1000;
    console.log(`\nCaptured ${recorder.frameNo} frames in ${captureSecs.toFixed(0)}s across ${recorder.segments.length} page(s). Encoding ${cfg.formats.join(' + ')}...`);

    const outBase = path.join(outDir, flags.preview ? `${cfg.name}-preview` : cfg.name);
    const { files, seconds } = await finalize({
        segments: recorder.segments,
        fps: cfg.fps,
        crossfade: cfg.crossfade,
        outBase,
        formats: cfg.formats,
        preview: !!flags.preview,
        codec: cfg.codec,
    });
    if (!flags.keepFrames) fs.rmSync(workDir, { recursive: true, force: true });
    console.log(`\nDone: ${seconds.toFixed(2)}s of video in ${((Date.now() - t0) / 1000).toFixed(0)}s total`);
    for (const f of files) console.log(`  ${f}`);
})();
