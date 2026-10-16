// Shot-list defaults and loading, shared by record.js and inspect.js so a
// page is always loaded and cleaned up the same way.
const fs = require('fs');
const path = require('path');
const { STEP_TYPES } = require('./steps');

const DEFAULTS = {
    viewport: { width: 1920, height: 1080, deviceScaleFactor: 2 },
    fps: 60,
    format: 'mp4',           // mp4 | prores | both
    codec: 'h264',           // mp4 codec: h264 | h265
    crossfade: 0.4,          // seconds; 0 = hard cut between pages
    cursor: { show: true, start: [960, 640], size: 28 },
    scrollMode: 'auto',      // auto | native | wheel
    scrollContainer: null,   // CSS selector, if the site scrolls an inner element instead of the window
    scrollSpeed: 900,        // px/s when a scroll step gives neither duration nor speed
    easing: 'easeInOutCubic',
    cookieButton: null,      // selector to click instead of auto-detection; false = don't touch banners
    hide: [],                // selectors hidden in every frame (chat widgets, promo bars…)
    hideTagPrefixes: [],     // hide custom elements whose tag starts with one of these
    hideKnownWidgets: true,  // hide common popups/chat launchers (Sleeknote, Intercom, HubSpot, …)
    css: '',                 // extra CSS injected into every page
    settle: 3,               // seconds to let a freshly loaded page settle before recording it
    networkIdleTimeout: 15000,
    preloadImages: true,
    clock: 'virtual',        // virtual | realtime (escape hatch if a site misbehaves)
    imageFormat: 'png',      // png | jpeg
    userAgent: null,
    locale: null,            // e.g. "da-DK" — browser language, for sites that pick a language from it
};

// Chrome flags used for every capture.
const LAUNCH_ARGS = [
    '--hide-scrollbars',
    '--force-color-profile=srgb',   // colours as authored, independent of this machine's display profile
    '--font-render-hinting=none',
    '--disable-lcd-text',            // no colour fringing on text edges
    '--autoplay-policy=no-user-gesture-required',
];

function loadConfig(file, flags = {}) {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const cfg = {
        ...DEFAULTS,
        ...raw,
        viewport: { ...DEFAULTS.viewport, ...raw.viewport },
        cursor: { ...DEFAULTS.cursor, ...raw.cursor },
    };
    cfg.name = raw.name || path.basename(file, '.json');
    if (flags.format) cfg.format = flags.format;
    if (flags.codec) cfg.codec = flags.codec;
    if (!['h264', 'h265'].includes(cfg.codec)) throw new Error(`codec must be h264 or h265 (got "${cfg.codec}")`);
    if (!['prores', 'mp4', 'both'].includes(cfg.format)) throw new Error(`format must be prores, mp4 or both (got "${cfg.format}")`);
    if (!Array.isArray(cfg.steps) || !cfg.steps.length || !('goto' in cfg.steps[0])) {
        throw new Error('The shot list needs a "steps" array whose first step is { "goto": "<url>" }');
    }
    // Fail now, not twenty minutes into a 4K render.
    cfg.steps.forEach((step, i) => {
        if (!STEP_TYPES.some((t) => t in step)) {
            throw new Error(`Step ${i + 1} is not a known step: ${JSON.stringify(step)}. Known steps: ${STEP_TYPES.join(', ')}`);
        }
    });
    if (flags.preview) {
        // Quick check of the choreography: 1080p30 JPEG frames, one mp4.
        cfg.viewport.deviceScaleFactor = 1;
        cfg.fps = 30;
        cfg.imageFormat = 'jpeg';
        cfg.format = 'mp4';
    }
    cfg.formats = cfg.format === 'both' ? ['prores', 'mp4'] : [cfg.format];
    return cfg;
}

module.exports = { DEFAULTS, LAUNCH_ARGS, loadConfig };
