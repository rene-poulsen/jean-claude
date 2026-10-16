// The frame loop and every shot-list step.
//
// Everything visible is advanced in whole frames: each frame sets the
// scroll position and cursor for that instant, advances the page's
// virtual clock by exactly 1/fps s, waits for paint, then screenshots.
// Motion is therefore perfectly even no matter how slow capture is.
const path = require('path');
const { SegmentWriter } = require('./encoder');
const { preparePage } = require('./page-setup');

const EASINGS = {
    linear: (t) => t,
    easeInOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
    easeInOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    easeInOutQuint: (t) => (t < 0.5 ? 16 * t ** 5 : 1 - Math.pow(-2 * t + 2, 5) / 2),
    easeOutCubic: (t) => 1 - Math.pow(1 - t, 3),
};

// Click feedback timings (seconds).
const PRESS_DOWN = 0.08;
const PRESS_UP = 0.16;
const RIPPLE = 0.5;

const STEP_TYPES = [
    'goto', 'wait', 'scrollTo', 'scrollBy', 'scrollToBottom', 'scrollToTop',
    'hover', 'click', 'moveCursor', 'showCursor', 'hideCursor', 'type',
];

class Recorder {
    constructor({ page, client, cfg, workDir, keepFrames, log }) {
        this.page = page;
        this.client = client;
        this.cfg = cfg;
        this.workDir = workDir;
        this.keepFrames = keepFrames;
        this.log = log;
        this.frameMs = 1000 / cfg.fps;
        this.frameNo = 0;
        this.segments = [];
        this.writer = null;
        this.click = null; // { frame, x, y } of the last click, for press/ripple
        this.mouseAt = null;
        this.cursor = {
            x: cfg.cursor.start[0],
            y: cfg.cursor.start[1],
            visible: cfg.cursor.show,
            size: cfg.cursor.size,
        };
    }

    // ---- segments ----------------------------------------------------------

    async startSegment() {
        await this.syncMouse();
        if (this.cfg.clock === 'virtual') await this.eachFrame(() => window.__vt && window.__vt.freeze());
        const i = this.segments.length;
        this.writer = new SegmentWriter(path.join(this.workDir, `seg_${String(i).padStart(3, '0')}.mkv`), {
            fps: this.cfg.fps,
            imageFormat: this.cfg.imageFormat,
            framesDir: this.keepFrames ? path.join(this.workDir, 'frames', `seg_${String(i).padStart(3, '0')}`) : null,
        });
    }

    async endSegment() {
        if (!this.writer) return;
        await this.writer.close();
        this.segments.push({ file: this.writer.file, frames: this.writer.frames });
        this.writer = null;
    }

    // Off-camera page change with a crossfade: hold the outgoing page,
    // switch pages (`change` does the actual navigation), let the new page
    // load and settle unrecorded, then hold its first frame so the
    // dissolve has something on both sides.
    async transition(change) {
        const fade = this.cfg.crossfade;
        if (fade > 0) await this.hold(fade);
        await this.endSegment();
        if (this.cfg.clock === 'virtual') await this.eachFrame(() => window.__vt && window.__vt.thaw());
        await change();
        await preparePage(this.page, this.cfg);
        this.mouseAt = null; // hover state belongs to the old page
        await this.startSegment();
        if (fade > 0) await this.hold(fade);
    }

    // ---- frames ------------------------------------------------------------

    cursorState() {
        const c = { ...this.cursor, scale: 1, ripple: null };
        if (this.click) {
            const since = (this.frameNo - this.click.frame) / this.cfg.fps;
            if (since < PRESS_DOWN) c.scale = 1 - 0.18 * (since / PRESS_DOWN);
            else if (since < PRESS_DOWN + PRESS_UP) c.scale = 0.82 + 0.18 * ((since - PRESS_DOWN) / PRESS_UP);
            if (since < RIPPLE) {
                c.ripple = { x: this.click.x, y: this.click.y, progress: EASINGS.easeOutCubic(since / RIPPLE) };
            }
        }
        return c;
    }

    async syncMouse() {
        const { x, y } = this.cursor;
        if (this.mouseAt && this.mouseAt.x === x && this.mouseAt.y === y) return;
        await this.page.mouse.move(x, y);
        this.mouseAt = { x, y };
    }

    // Runs fn in every frame of the page, iframes included (embedded
    // Vimeo/YouTube players have their own clock and video to drive).
    // Frames that are detached or not ready are skipped.
    async eachFrame(fn, arg) {
        await Promise.all(this.page.frames().map((f) => f.evaluate(fn, arg).catch(() => {})));
    }

    async frame(opts = {}) {
        await this.syncMouse();
        const args = { ms: this.cfg.clock === 'virtual' ? this.frameMs : 0, scroll: opts.scroll || null, cursor: this.cursorState(), paint: true };
        const stepFn = (a) => {
            if (!window.__vt) throw new Error('__vt missing');
            if (!window.__vt.frozen && a.ms) window.__vt.freeze();
            // Returns where the viewport is in the document: the screenshot
            // clip below is in document coordinates, not viewport ones.
            return window.__vt.step(a.ms, { scroll: a.scroll, cursor: a.cursor, paint: a.paint })
                .then(() => [window.visualViewport.pageLeft, window.visualViewport.pageTop]);
        };
        const main = this.page.mainFrame();
        const children = this.page.frames().filter((f) => f !== main);
        // No paint wait in iframes: Chrome throttles rAF in off-screen
        // cross-origin iframes, so it may never fire. The main frame's paint
        // wait covers compositing them. The timeout guards against a stalled frame.
        // Stepped before the main frame, so its paint includes their new state.
        await Promise.all(children.map((f) => Promise.race([
            f.evaluate(stepFn, { ms: args.ms, paint: false }).catch(() => {}),
            new Promise((r) => setTimeout(r, 1500)),
        ])));
        let at;
        try {
            at = await this.page.evaluate(stepFn, args);
        } catch (e) {
            // A hard navigation mid-shot (only possible with transition:"live")
            // destroys the context; wait for the new document and retry.
            await this.page.waitForLoadState('domcontentloaded').catch(() => {});
            at = await this.page.evaluate(stepFn, args);
        }
        const shot = await this.client.send('Page.captureScreenshot', {
            format: this.cfg.imageFormat,
            ...(this.cfg.imageFormat === 'jpeg' ? { quality: 95 } : {}),
            optimizeForSpeed: true,
            fromSurface: true,
            captureBeyondViewport: false,
            // record.js sets the device metrics on this session, so a clip
            // scale of 1 already returns device pixels (3840x2160): a true
            // 2x render, ~3x faster than Playwright's own screenshot.
            // The clip is in document coordinates, so it follows the scroll.
            clip: { x: at[0], y: at[1], width: this.cfg.viewport.width, height: this.cfg.viewport.height, scale: 1 },
        });
        await this.writer.write(Buffer.from(shot.data, 'base64'));
        this.frameNo++;
        this.progressTick();
    }

    async hold(seconds) {
        const n = Math.round(seconds * this.cfg.fps);
        this.progressStart(n);
        for (let i = 0; i < n; i++) await this.frame();
    }

    // ---- progress ----------------------------------------------------------

    progressStart(total) {
        this.prog = { total, done: 0, t0: Date.now() };
    }

    progressTick() {
        const p = this.prog;
        if (!p || !process.stdout.isTTY) return;
        p.done++;
        const rate = p.done / ((Date.now() - p.t0) / 1000);
        const eta = p.total ? Math.max(0, (p.total - p.done) / rate) : 0;
        process.stdout.write(`\r    frame ${p.done}/${p.total}  ${rate.toFixed(1)} f/s  eta ${eta.toFixed(0)}s   `);
    }

    // ---- measuring ---------------------------------------------------------

    async scrollState() {
        return this.page.evaluate((container) => {
            const el = container ? document.querySelector(container) : document.scrollingElement || document.documentElement;
            const vh = container ? el.clientHeight : window.innerHeight;
            const y = container ? el.scrollTop : window.scrollY;
            return { y, max: Math.max(0, el.scrollHeight - vh), vh };
        }, this.cfg.scrollContainer);
    }

    locate(selector) {
        return this.page.locator(selector).first();
    }

    async rectOf(selector) {
        const loc = this.locate(selector);
        await loc.waitFor({ state: 'attached', timeout: 15000 }).catch(() => {
            throw new Error(`Element not found: ${selector}`);
        });
        return loc.evaluate((el) => {
            const r = el.getBoundingClientRect();
            return { left: r.left, top: r.top, width: r.width, height: r.height };
        });
    }

    // ---- scrolling ---------------------------------------------------------

    // getTarget() is re-evaluated every frame, so layout shifts and pages
    // that grow while scrolling (lazy sections) are absorbed smoothly.
    async scrollWith(getTarget, { duration, speed, easing }) {
        const ease = EASINGS[easing || this.cfg.easing];
        if (!ease) throw new Error(`Unknown easing "${easing}". Use one of: ${Object.keys(EASINGS).join(', ')}`);
        const start = (await this.scrollState()).y;
        let target = await getTarget();
        const distance = Math.abs(target - start);
        if (distance < 1) return;
        const seconds = duration ?? Math.max(0.6, distance / (speed || this.cfg.scrollSpeed));
        const n = Math.max(1, Math.round(seconds * this.cfg.fps));
        const mode = this.cfg.scrollMode;
        let lastY = start;
        this.progressStart(n);
        for (let i = 1; i <= n; i++) {
            const y = start + (target - start) * ease(i / n);
            if (mode === 'wheel') {
                await this.page.mouse.wheel(0, y - lastY);
                await this.frame();
            } else {
                await this.frame({ scroll: { y, mode, container: this.cfg.scrollContainer } });
            }
            lastY = y;
            if (i < n) target = await getTarget();
        }
    }

    // Absolute scroll position that puts `selector` where `block` asks.
    async scrollTargetFor(selector, block = 'top', offset = 0) {
        const [r, s] = await Promise.all([this.rectOf(selector), this.scrollState()]);
        let y = r.top + s.y - offset;
        if (block === 'center') y -= (s.vh - r.height) / 2;
        else if (block === 'bottom') y -= s.vh - r.height;
        return Math.min(Math.max(0, y), s.max);
    }

    // ---- cursor ------------------------------------------------------------

    async moveCursor(x, y, duration) {
        const from = { x: this.cursor.x, y: this.cursor.y };
        const dx = x - from.x, dy = y - from.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 0.5) return;
        const seconds = duration ?? Math.min(1.3, Math.max(0.5, 0.45 + dist / 1800));
        const n = Math.max(1, Math.round(seconds * this.cfg.fps));
        // Quadratic bezier with the control point pushed off to one side,
        // so the path is a gentle arc like a real hand, not a ruler line.
        const cx = from.x + dx / 2 - dy * 0.12;
        const cy = from.y + dy / 2 + dx * 0.12;
        this.progressStart(n);
        for (let i = 1; i <= n; i++) {
            const t = EASINGS.easeInOutCubic(i / n);
            const u = 1 - t;
            this.cursor.x = u * u * from.x + 2 * u * t * cx + t * t * x;
            this.cursor.y = u * u * from.y + 2 * u * t * cy + t * t * y;
            await this.frame();
        }
    }

    // Point on the element to aim at, scrolling it into view first if needed.
    async aimAt(selector, position = [0.5, 0.5]) {
        let r = await this.rectOf(selector);
        const { vh } = await this.scrollState();
        const margin = 40;
        if (r.top < margin || r.top + Math.min(r.height, vh - 2 * margin) > vh - margin) {
            await this.scrollWith(() => this.scrollTargetFor(selector, 'center'), {});
            r = await this.rectOf(selector);
        }
        return { x: r.left + r.width * position[0], y: r.top + r.height * position[1] };
    }

    // ---- steps ---------------------------------------------------------------

    describe(step) {
        const type = STEP_TYPES.find((t) => t in step);
        const v = step[type];
        return `${type}${v === true ? '' : ' ' + (typeof v === 'string' ? v : JSON.stringify(v))}`;
    }

    async run(step) {
        const type = STEP_TYPES.find((t) => t in step);
        if (!type) throw new Error(`Unknown step: ${JSON.stringify(step)}. Known steps: ${STEP_TYPES.join(', ')}`);
        await this[`step_${type}`](step);
    }

    async step_goto(s) {
        const go = () => this.page.goto(s.goto, { waitUntil: 'commit', timeout: 60000 });
        if (!this.writer) {
            await go();
            await preparePage(this.page, this.cfg);
            await this.startSegment();
        } else {
            await this.transition(go);
        }
    }

    async step_wait(s) {
        await this.hold(s.wait);
    }

    async step_scrollTo(s) {
        await this.scrollWith(() => this.scrollTargetFor(s.scrollTo, s.block, s.offset || 0), s);
    }

    async step_scrollBy(s) {
        const { y, max } = await this.scrollState();
        const target = Math.min(Math.max(0, y + s.scrollBy), max);
        await this.scrollWith(async () => target, s);
    }

    async step_scrollToBottom(s) {
        await this.scrollWith(async () => (await this.scrollState()).max, s);
    }

    async step_scrollToTop(s) {
        await this.scrollWith(async () => 0, s);
    }

    async step_moveCursor(s) {
        const t = s.moveCursor;
        const pt = Array.isArray(t) ? { x: t[0], y: t[1] } : await this.aimAt(t, s.position);
        await this.moveCursor(pt.x, pt.y, s.duration);
    }

    async step_showCursor() {
        this.cursor.visible = true;
    }

    async step_hideCursor() {
        this.cursor.visible = false;
    }

    async step_hover(s) {
        const pt = await this.aimAt(s.hover, s.position);
        await this.moveCursor(pt.x, pt.y, s.duration);
        // A beat for hover transitions to play before the next step.
        await this.hold(s.hold ?? 0.3);
    }

    async press() {
        this.click = { frame: this.frameNo, x: this.cursor.x, y: this.cursor.y };
        await this.page.mouse.down();
        await this.hold(PRESS_DOWN);
        await this.page.mouse.up();
    }

    async step_click(s) {
        const pt = await this.aimAt(s.click, s.position);
        await this.moveCursor(pt.x, pt.y, s.duration);
        if (s.navigates && (s.transition || 'crossfade') === 'crossfade') {
            // Links opening a new tab would navigate a popup, not this page.
            await this.locate(s.click).evaluate((el) => el.closest('a')?.removeAttribute('target')).catch(() => {});
            // Show the press + ripple, then click for real off-camera.
            this.click = { frame: this.frameNo, x: this.cursor.x, y: this.cursor.y };
            await this.hold(PRESS_DOWN + PRESS_UP);
            await this.transition(async () => {
                const before = this.page.url();
                await this.page.mouse.down();
                await this.page.mouse.up();
                await this.page.waitForURL((u) => u.href !== before, { timeout: 20000, waitUntil: 'commit' })
                    .catch(() => this.log(`    (no URL change after clicking ${s.click} — continuing)`));
            });
            return;
        }
        await this.press();
        // Live: keep recording through a single-page-app route change.
        await this.hold(s.navigates ? s.hold ?? 1.5 : s.hold ?? RIPPLE - PRESS_DOWN);
    }

    async step_type(s) {
        const pt = await this.aimAt(s.type, s.position);
        await this.moveCursor(pt.x, pt.y, s.duration);
        await this.press();
        const perChar = 1 / (s.cps || 12);
        for (const ch of s.text || '') {
            await this.page.keyboard.type(ch);
            await this.hold(perChar);
        }
        if (s.pressEnter) {
            if (s.navigates) {
                await this.transition(async () => {
                    const before = this.page.url();
                    await this.page.keyboard.press('Enter');
                    await this.page.waitForURL((u) => u.href !== before, { timeout: 20000, waitUntil: 'commit' }).catch(() => {});
                });
            } else {
                await this.page.keyboard.press('Enter');
                await this.hold(0.5);
            }
        }
    }
}

module.exports = { Recorder, STEP_TYPES, EASINGS };
