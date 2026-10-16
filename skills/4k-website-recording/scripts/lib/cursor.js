// Injected into every page via addInitScript. A purely visual cursor:
// headless Chrome draws no pointer, so this overlay stands in for one.
// It holds no timing of its own. Node computes position, press scale and
// ripple progress per frame and passes them to __cursor.set(), so it's as
// deterministic as the rest of the frame.
(() => {
    if (window.__cursor) return;

    // Classic arrow pointer; the hotspot (tip) is at (5.5, 3.2) in a 24-unit box.
    const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="100%" height="100%">
      <path d="M5.5 3.2v16.1c0 .4.5.6.8.3l3.9-3.8 2.6 6c.1.3.5.4.8.3l2.1-.9c.3-.1.4-.5.3-.8l-2.6-5.9h5.4c.4 0 .6-.5.3-.8L6.3 2.9c-.3-.3-.8-.1-.8.3z"
        fill="#111" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
    const TIP_X = 5.5 / 24, TIP_Y = 3.2 / 24;

    let host, pointer, ripple;

    function ensure() {
        if (host && host.isConnected) return true;
        if (!document.documentElement) return false;
        host = document.createElement('div');
        host.setAttribute('data-recording-cursor', '');
        host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;contain:strict;';
        const root = host.attachShadow({ mode: 'closed' });
        root.innerHTML = `
          <style>
            .p, .r { position: absolute; left: 0; top: 0; will-change: transform, opacity; }
            .p { filter: drop-shadow(0 1px 2px rgba(0,0,0,.35)); transform-origin: ${TIP_X * 100}% ${TIP_Y * 100}%; }
            .r { border-radius: 50%; background: rgba(20,20,20,.22); border: 1.5px solid rgba(255,255,255,.7); opacity: 0; }
          </style>
          <div class="r"></div>
          <div class="p">${SVG}</div>`;
        pointer = root.querySelector('.p');
        ripple = root.querySelector('.r');
        document.documentElement.appendChild(host);
        return true;
    }

    window.__cursor = {
        // state: { x, y, visible, size, scale, ripple: null | { x, y, progress, radius } }
        set(s) {
            if (!ensure()) return;
            host.style.display = s.visible ? 'block' : 'none';
            const size = s.size || 28;
            pointer.style.width = pointer.style.height = size + 'px';
            pointer.style.transform =
                `translate(${s.x - size * TIP_X}px, ${s.y - size * TIP_Y}px) scale(${s.scale ?? 1})`;
            const rp = s.ripple;
            if (rp && rp.progress < 1) {
                const r = (rp.radius || 26) * (0.25 + 0.75 * rp.progress);
                ripple.style.width = ripple.style.height = r * 2 + 'px';
                ripple.style.transform = `translate(${rp.x - r}px, ${rp.y - r}px)`;
                ripple.style.opacity = String((1 - rp.progress) * 0.9);
            } else {
                ripple.style.opacity = '0';
            }
        },
    };
})();
