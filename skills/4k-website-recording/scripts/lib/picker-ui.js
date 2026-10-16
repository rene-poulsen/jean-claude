// Injected into every page opened by pick.js. Outlines the element under
// the mouse and, on click, reports selector candidates for it to Node
// (window.__pickReport), which validates them with Playwright's own
// selector engine and copies a ready-made shot-list step.
//
//   click        -> { "click": ... }      (the page doesn't react)
//   S + click    -> { "scrollTo": ... }
//   H + click    -> { "hover": ... }
//   Alt + click  -> the click goes through to the page (navigate, open menus…)
(() => {
    if (window.top !== window || window.__picker) return;
    window.__picker = true;

    const held = new Set();
    let box, label, toast, hovered = null;

    const INTERACTIVE = 'a,button,[role=button],[role=link],[role=tab],input,select,textarea,summary,label,[onclick]';

    function targetFor(el) {
        if (held.has('s')) return el;
        return el.closest(INTERACTIVE) || el;
    }

    function ui() {
        if (box) return;
        const host = document.createElement('div');
        host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
        const root = host.attachShadow({ mode: 'closed' });
        root.innerHTML = `
          <style>
            .box { position: fixed; border: 2px solid #ff3d7f; background: rgba(255,61,127,.08); border-radius: 3px; display: none; }
            .label, .help, .toast { position: fixed; font: 12px/1.4 ui-monospace, Consolas, monospace; color: #fff; background: #1b1b1f; border-radius: 4px; padding: 4px 7px; }
            .label { display: none; max-width: 600px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .help { left: 10px; bottom: 10px; opacity: .85; }
            .toast { right: 10px; bottom: 10px; background: #0b7a43; display: none; max-width: 700px; white-space: pre-wrap; }
            b { color: #ff8fb4; font-weight: 600; }
          </style>
          <div class="box"></div><div class="label"></div>
          <div class="help"><b>click</b> click step · <b>S</b>+click scrollTo · <b>H</b>+click hover · <b>Alt</b>+click use the page</div>
          <div class="toast"></div>`;
        box = root.querySelector('.box');
        label = root.querySelector('.label');
        toast = root.querySelector('.toast');
        document.documentElement.appendChild(host);
    }

    function describe(el) {
        let s = el.tagName.toLowerCase();
        if (el.id) s += '#' + el.id;
        const cls = [...el.classList].slice(0, 3);
        if (cls.length) s += '.' + cls.join('.');
        return s;
    }

    function show(el) {
        ui();
        hovered = el;
        const r = el.getBoundingClientRect();
        Object.assign(box.style, { display: 'block', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
        label.textContent = describe(el);
        label.style.display = 'block';
        label.style.left = Math.max(4, r.left) + 'px';
        label.style.top = (r.top > 26 ? r.top - 24 : r.bottom + 4) + 'px';
    }

    // ---- selector candidates, most robust first ------------------------------
    const q = (s) => JSON.stringify(s);
    const looksGenerated = (s) => /\d{3,}|^[0-9]|[:[\]]|^(css|sc|jsx|svelte|emotion)-|[a-z]+-[a-zA-Z0-9]{6,}$/.test(s);

    function cssPath(el) {
        const parts = [];
        for (let n = el; n && n.nodeType === 1 && n !== document.documentElement && parts.length < 5; n = n.parentElement) {
            if (n.id && !looksGenerated(n.id)) { parts.unshift('#' + CSS.escape(n.id)); break; }
            let part = n.tagName.toLowerCase();
            const cls = [...n.classList].filter((c) => !looksGenerated(c)).slice(0, 2);
            if (cls.length) part += '.' + cls.map((c) => CSS.escape(c)).join('.');
            const parent = n.parentElement;
            if (parent) {
                const same = [...parent.children].filter((c) => c.tagName === n.tagName);
                if (same.length > 1) part += `:nth-of-type(${same.indexOf(n) + 1})`;
            }
            parts.unshift(part);
        }
        return parts.join(' > ');
    }

    function candidates(el) {
        const tag = el.tagName.toLowerCase();
        const out = [];
        if (el.id && !looksGenerated(el.id)) out.push('#' + CSS.escape(el.id));
        for (const a of ['data-testid', 'data-test', 'data-cy', 'data-id', 'data-name', 'name', 'aria-label']) {
            const v = el.getAttribute(a);
            if (v && v.length < 60) out.push(`${tag}[${a}=${q(v)}]`);
        }
        const href = el.getAttribute('href');
        if (tag === 'a' && href && !href.startsWith('javascript:')) out.push(`a[href=${q(href)}]`);
        const text = (el.innerText || '').trim().replace(/\s+/g, ' ');
        if (text && text.length <= 50) {
            out.push(`text=${q(text)}`);
            out.push(`${tag}:has-text(${q(text)})`);
        }
        out.push(cssPath(el));
        return [...new Set(out)];
    }

    function navigates(el) {
        const a = el.closest('a[href]');
        if (!a) return false;
        const href = a.getAttribute('href');
        if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) return false;
        try {
            const u = new URL(a.href);
            return !(u.pathname === location.pathname && u.search === location.search);
        } catch { return false; }
    }

    // ---- events ----------------------------------------------------------------
    const typing = (e) => e.target && (e.target.isContentEditable || /^(input|textarea|select)$/i.test(e.target.tagName));
    addEventListener('keydown', (e) => { if (!typing(e)) held.add(e.key.toLowerCase()); }, true);
    addEventListener('keyup', (e) => held.delete(e.key.toLowerCase()), true);
    addEventListener('blur', () => held.clear());

    addEventListener('mousemove', (e) => {
        if (e.altKey) { if (box) box.style.display = label.style.display = 'none'; return; }
        const el = document.elementFromPoint(e.clientX, e.clientY);
        if (el) show(targetFor(el));
    }, true);

    // pick.js sets __pickerOff while it dismisses cookie banners itself.
    const passThrough = (e) => e.altKey || window.__pickerOff;
    const block = (e) => {
        if (passThrough(e)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
    };
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'auxclick', 'dblclick']) addEventListener(type, block, true);

    addEventListener('click', async (e) => {
        if (passThrough(e)) return;
        block(e);
        const el = targetFor(document.elementFromPoint(e.clientX, e.clientY) || e.target);
        if (el === document.documentElement || el === document.body) return;
        window.__pickLast = el;
        const kind = held.has('s') ? 'scrollTo' : held.has('h') ? 'hover' : 'click';
        const res = await window.__pickReport({ kind, candidates: candidates(el), navigates: navigates(el) });
        ui();
        toast.textContent = res ? `Copied:\n${res}` : 'No working selector found — see terminal';
        toast.style.display = 'block';
        clearTimeout(toast._t);
        toast._t = setTimeout(() => { toast.style.display = 'none'; }, 3500);
    }, true);
})();
