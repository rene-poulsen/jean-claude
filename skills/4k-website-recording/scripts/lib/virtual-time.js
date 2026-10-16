// Injected into every page via addInitScript (runs before any site script).
//
// Gives the page a controllable clock so a recording can be rendered one
// frame at a time: however long a 4K screenshot takes in real time, the
// page only ever sees exactly 1/fps seconds pass between frames. Result:
// perfectly even motion, and every animation plays at its true speed.
//
// Lifecycle:
//   - pass-through (default): the page loads and runs in real time, but
//     every timer / rAF it schedules is tracked, so it can be taken over.
//   - __vt.freeze(): switch to the virtual clock. Pending real timers and
//     rAF callbacks are moved onto the virtual queue; CSS/Web Animations
//     and <video> elements are paused and driven from the virtual clock.
//   - __vt.step(ms, opts): advance the clock by ms, run due timers and one
//     round of rAF callbacks, sync animations/videos, then wait for the
//     browser to actually paint — after which a screenshot is safe.
//   - __vt.thaw(): hand everything back to real time (used before a
//     navigating click, so page-transition code that waits on timers can
//     finish off-camera).
(() => {
    if (window.__vt) return;

    const RealDate = Date;
    const real = {
        perfNow: performance.now.bind(performance),
        dateNow: RealDate.now,
        raf: window.requestAnimationFrame.bind(window),
        caf: window.cancelAnimationFrame.bind(window),
        setTimeout: window.setTimeout.bind(window),
        clearTimeout: window.clearTimeout.bind(window),
        setInterval: window.setInterval.bind(window),
        clearInterval: window.clearInterval.bind(window),
        play: HTMLMediaElement.prototype.play,
        pause: HTMLMediaElement.prototype.pause,
    };

    let frozen = false;
    let vNow = 0;       // virtual performance.now()
    let dateBase = 0;   // Date.now() at the moment of freezing
    let perfBase = 0;   // performance.now() at the moment of freezing
    let nextId = 1;

    // id -> { fn, args, at, interval, realId }  (at = performance.now()-based)
    const timers = new Map();
    // id -> { cb, realId }
    let rafs = new Map();

    const now = () => (frozen ? vNow : real.perfNow());
    const dateNow = () => (frozen ? dateBase + (vNow - perfBase) : real.dateNow());

    // ---- clock -------------------------------------------------------------
    performance.now = now;

    function VDate(...args) {
        if (!new.target) return new RealDate(dateNow()).toString();
        return args.length ? new RealDate(...args) : new RealDate(dateNow());
    }
    VDate.prototype = RealDate.prototype;
    VDate.now = dateNow;
    VDate.parse = RealDate.parse;
    VDate.UTC = RealDate.UTC;
    window.Date = VDate;

    // ---- timers ------------------------------------------------------------
    function runTimer(id) {
        const t = timers.get(id);
        if (!t) return;
        if (t.interval != null) {
            t.at += Math.max(t.interval, 1);
            if (!frozen) t.realId = real.setTimeout(() => runTimer(id), Math.max(t.interval, 1));
        } else {
            timers.delete(id);
        }
        try {
            typeof t.fn === 'function' ? t.fn(...t.args) : (0, eval)(String(t.fn));
        } catch (e) {
            setTimeoutImmediateThrow(e);
        }
    }
    function setTimeoutImmediateThrow(e) {
        // Re-throw asynchronously so errors surface like normal timer errors
        // without breaking our own loop.
        real.setTimeout(() => { throw e; }, 0);
    }

    function addTimer(fn, delay, args, isInterval) {
        const id = nextId++;
        delay = Math.max(0, Number(delay) || 0);
        const t = { fn, args, at: now() + delay, interval: isInterval ? delay : null, realId: null };
        timers.set(id, t);
        if (!frozen) t.realId = real.setTimeout(() => runTimer(id), delay);
        return id;
    }
    function removeTimer(id) {
        const t = timers.get(id);
        if (!t) return;
        if (t.realId != null) real.clearTimeout(t.realId);
        timers.delete(id);
    }
    window.setTimeout = (fn, delay, ...args) => addTimer(fn, delay, args, false);
    window.setInterval = (fn, delay, ...args) => addTimer(fn, delay, args, true);
    window.clearTimeout = removeTimer;
    window.clearInterval = removeTimer;

    // ---- requestAnimationFrame ---------------------------------------------
    window.requestAnimationFrame = (cb) => {
        const id = nextId++;
        const r = { cb, realId: null };
        rafs.set(id, r);
        if (!frozen) {
            r.realId = real.raf((ts) => {
                if (!rafs.has(id)) return;
                rafs.delete(id);
                cb(ts);
            });
        }
        return id;
    };
    window.cancelAnimationFrame = (id) => {
        const r = rafs.get(id);
        if (!r) return;
        if (r.realId != null) real.caf(r.realId);
        rafs.delete(id);
    };

    // ---- animations (CSS animations, transitions, element.animate) -----------
    // Each running animation is paused when first seen and from then on its
    // currentTime is set from the virtual clock. Scroll-driven animations
    // (animation-timeline: scroll()/view()) are left alone — they follow
    // scroll position, which we already drive frame by frame.
    let anims = new Map(); // Animation -> { base, v0, rate, done }

    // Where a newly seen animation should start. Those already running when
    // the clock is frozen keep their real progress. Anything that appears
    // later starts *now* in virtual time, however long it has really been
    // running: it may have been created while a slow 4K screenshot rendered
    // its frame (screenshots run the rendering step too, which fires
    // IntersectionObserver scroll-reveals), and it would otherwise show up
    // most of the way through its transition. A negative delay is kept.
    let freezing = false;
    function startOffset(a) {
        if (freezing) return a.currentTime || 0;
        let delay = 0;
        try { delay = a.effect ? a.effect.getTiming().delay || 0 : 0; } catch {}
        return Math.max(0, -delay);
    }

    function syncAnimations() {
        let list;
        try { list = document.getAnimations(); } catch { return; }
        for (const a of list) {
            if (a.timeline && a.timeline !== document.timeline) continue;
            let s = anims.get(a);
            if (!s) {
                if (a.playState !== 'running') continue; // paused by the site, or finished
                s = { base: startOffset(a), v0: vNow, rate: a.playbackRate || 1, done: false };
                anims.set(a, s);
                a.pause();
            }
            if (s.done) continue;
            const t = s.base + (vNow - s.v0) * s.rate;
            let end = Infinity;
            try { end = a.effect ? a.effect.getComputedTiming().endTime : Infinity; } catch {}
            if (s.rate > 0 && t >= end) {
                // Let it finish properly so animationend/transitionend fire.
                s.done = true;
                try { a.finish(); } catch { a.currentTime = end; }
            } else {
                a.currentTime = Math.max(0, t);
            }
        }
    }

    // ---- <video> -----------------------------------------------------------
    // Playing videos are paused and seeked frame by frame instead.
    const videos = new Map(); // HTMLVideoElement -> { t0, v0 }

    HTMLMediaElement.prototype.play = function () {
        if (!frozen || !(this instanceof HTMLVideoElement)) return real.play.call(this);
        if (!videos.has(this)) videos.set(this, { t0: this.currentTime, v0: vNow });
        return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function () {
        videos.delete(this);
        return real.pause.call(this);
    };

    function syncVideos() {
        const seeks = [];
        for (const v of document.querySelectorAll('video')) {
            if (!videos.has(v) && !v.paused) {
                videos.set(v, { t0: v.currentTime, v0: vNow });
                real.pause.call(v);
            }
            const s = videos.get(v);
            if (!s || !(v.duration > 0)) continue;
            let t = s.t0 + (vNow - s.v0) / 1000;
            t = v.loop ? t % v.duration : Math.min(t, v.duration);
            if (Math.abs(v.currentTime - t) < 0.0005) continue;
            seeks.push(new Promise((resolve) => {
                const done = () => { v.removeEventListener('seeked', done); resolve(); };
                v.addEventListener('seeked', done);
                real.setTimeout(done, 500);
            }));
            v.currentTime = t;
        }
        return Promise.all(seeks);
    }

    // ---- paint -------------------------------------------------------------
    const nextPaint = () => new Promise((r) => real.raf(() => real.raf(r)));

    // ---- public API --------------------------------------------------------
    window.__vt = {
        get frozen() { return frozen; },
        now,

        freeze() {
            if (frozen) return;
            perfBase = real.perfNow();
            dateBase = real.dateNow();
            vNow = perfBase;
            frozen = true;
            for (const t of timers.values()) {
                if (t.realId != null) { real.clearTimeout(t.realId); t.realId = null; }
            }
            for (const r of rafs.values()) {
                if (r.realId != null) { real.caf(r.realId); r.realId = null; }
            }
            for (const v of document.querySelectorAll('video')) {
                if (!v.paused) { videos.set(v, { t0: v.currentTime, v0: vNow }); real.pause.call(v); }
            }
            freezing = true;
            syncAnimations();
            freezing = false;
        },

        thaw() {
            if (!frozen) return;
            const drift = real.perfNow() - vNow; // real time is ahead of virtual
            frozen = false;
            for (const [id, t] of timers) {
                t.at += drift;
                t.realId = real.setTimeout(() => runTimer(id), Math.max(0, t.at - real.perfNow()));
            }
            for (const [id, r] of rafs) {
                r.realId = real.raf((ts) => {
                    if (!rafs.has(id)) return;
                    rafs.delete(id);
                    r.cb(ts);
                });
            }
            for (const [a, s] of anims) { if (!s.done) try { a.play(); } catch {} }
            anims = new Map();
            for (const v of videos.keys()) real.play.call(v).catch(() => {});
            videos.clear();
        },

        // One frame. opts.before runs first (e.g. scroll/cursor updates) so
        // scroll listeners and ScrollTrigger see the new position in this
        // frame's rAF round.
        async step(ms, opts = {}) {
            if (opts.scroll) window.__srScroll(opts.scroll);
            if (opts.cursor && window.__cursor) window.__cursor.set(opts.cursor);
            if (frozen) {
                const target = vNow + ms;
                // Due timers, in time order (bounded so a 0ms interval can't hang us).
                for (let guard = 0; guard < 10000; guard++) {
                    let dueId = null, dueAt = Infinity;
                    for (const [id, t] of timers) {
                        if (t.at <= target && t.at < dueAt) { dueAt = t.at; dueId = id; }
                    }
                    if (dueId == null) break;
                    vNow = Math.max(vNow, dueAt);
                    runTimer(dueId);
                    await Promise.resolve(); // let promise callbacks from the timer run
                }
                vNow = target;
                const round = rafs;
                rafs = new Map();
                for (const r of round.values()) {
                    try { r.cb(vNow); } catch (e) { setTimeoutImmediateThrow(e); }
                }
                syncAnimations();
                await Promise.race([syncVideos(), new Promise((r) => real.setTimeout(r, 1000))]);
            }
            if (opts.paint !== false) await nextPaint();
            // Animations can also start *during* the paint we just waited for:
            // IntersectionObserver callbacks (the usual scroll-reveal trigger)
            // and style recalcs run inside the rendering step. Left alone, such
            // a transition would run in real time during the slow screenshot
            // and could finish before the next frame (a reveal that "jumps").
            // Take control of it now, a few ms in, while it's still at the start.
            if (frozen) syncAnimations();
        },

        nextPaint,
    };

    // ---- scrolling ---------------------------------------------------------
    // Sets the scroll position for this frame. Uses a smooth-scroll
    // library's own API when one is present, so its internal state doesn't
    // fight the position we set; otherwise a native instant scroll.
    window.__srScroll = ({ y, mode, container }) => {
        const el = container ? document.querySelector(container) : null;
        if (el) { el.scrollTo({ top: y, behavior: 'instant' }); return; }
        if (mode === 'auto') {
            const lenis = window.lenis || window.__lenis;
            if (lenis && typeof lenis.scrollTo === 'function') {
                lenis.scrollTo(y, { immediate: true, force: true });
                return;
            }
            const SS = window.ScrollSmoother;
            const smoother = SS && typeof SS.get === 'function' ? SS.get() : null;
            if (smoother) { smoother.scrollTop(y); return; }
        }
        window.scrollTo({ top: y, behavior: 'instant' });
    };
})();
