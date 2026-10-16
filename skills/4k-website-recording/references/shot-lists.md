# Shot lists and recorder reference

The full reference for `scripts/record.js`: command-line flags, output
formats, every step and setting, the element picker, and troubleshooting.
In the commands below, `$S` stands for the skill's `scripts/` folder. Output
lands in `recording-output/<name>/` under the directory the command is run from.

## Why the motion is perfectly smooth

The site doesn't run in real time while it's recorded. Every page gets a
**virtual clock** that only moves forward exactly 1/60 s per frame, and one
screenshot is taken per step. It doesn't matter that a 4K screenshot takes a
few hundred ms: CSS animations and transitions, JavaScript animation (GSAP,
Lottie, WebGL, anything on `requestAnimationFrame`), timers, `<video>` and
embedded Vimeo/YouTube players all advance by exactly one frame's worth of
time per frame. Scrolling and the cursor are computed per frame from easing
curves, so there are never any dropped frames, jumps or stutters.

The cost: rendering is slower than real time. At 4K expect roughly
**1–3 frames per second**, so a 30-second clip takes about 10–30 minutes.
Use `--preview` while working out the steps.

## Command line

| | |
|---|---|
| `node $S/record.js <shots.json>` | Render at the shot list's settings (default: 4K, 60 fps, H.264 mp4). |
| `--format mp4\|prores\|both` | Which files to produce. |
| `--codec h264\|h265` | Codec for the mp4. |
| `--preview` | 1920×1080, 30 fps, mp4 only — much faster, for checking timing and selectors. Output is `<name>-preview.mp4`. |
| `--keep-frames` | Also keep every frame as a PNG in `recording-output/<name>/work/frames/`. |
| `--out <dir>` | Output folder instead of `recording-output/<name>/`. |

## Output formats

- **H.264 mp4** (default: CRF 12, High@5.2, 4:2:0): visually near-lossless,
  plays and edits anywhere. This is the default.
- **H.265 mp4** (`--codec h265`: CRF 14, 10-bit Main10): similar quality at a
  smaller file size, but heavier to decode while editing.
- **ProRes 422 HQ** (`--format prores`, `.mov`, 10-bit 4:2:2): an intra-frame
  editing master, very large at roughly 2 GB per minute at 4K60. Use `both`
  to get the mp4 alongside it.

Both are converted with the bt709 matrix and tagged bt709, so colours match
the live site once imported.

## Shot list

```json
{
  "name": "example-cases",
  "steps": [
    { "goto": "https://example.com" },
    { "wait": 1.5 },
    { "scrollTo": "a[href=\"/work/project\"]", "block": "center", "duration": 3 },
    { "hover": "a[href=\"/work/project\"]" },
    { "click": "a[href=\"/work/project\"]", "navigates": true },
    { "wait": 1.2 },
    { "scrollToBottom": true, "speed": 800 },
    { "wait": 1 }
  ]
}
```

The first step must be `goto`. Everything else is optional; see
[../examples/renepoulsen.json](../examples/renepoulsen.json) (hero → hover a
button → scroll to the intro → scroll to a section whose heading animates in →
open an accordion → scroll to the end, about 22 s).

### Steps

| Step | Options | What it does |
|---|---|---|
| `{ "goto": url }` | | Opens a page. Later `goto`s crossfade to the new page like a navigating click. |
| `{ "wait": seconds }` | | Holds the shot while the page keeps animating. |
| `{ "scrollTo": selector }` | `duration` or `speed` (px/s), `block` (`top`/`center`/`bottom`), `offset` (px, e.g. for a sticky header), `easing` | Scrolls smoothly to an element. |
| `{ "scrollBy": px }` | `duration`/`speed`, `easing` | Scrolls a set distance (negative = up). |
| `{ "scrollToBottom": true }` / `{ "scrollToTop": true }` | `duration`/`speed`, `easing` | Scrolls to the end or start of the page. |
| `{ "hover": selector }` | `duration` (cursor travel), `hold` (default 0.3 s), `position` | Cursor glides to the element; hover effects play. |
| `{ "click": selector }` | `navigates`, `transition`, `duration`, `hold`, `position` | Hover + press + ripple + real click. See below. |
| `{ "moveCursor": [x, y] }` or `{ "moveCursor": selector }` | `duration` | Moves the cursor somewhere without clicking. `[x, y]` is in 1920×1080 viewport pixels. |
| `{ "showCursor": true }` / `{ "hideCursor": true }` | | Shows or hides the cursor. |
| `{ "type": selector, "text": "..." }` | `cps` (chars/sec, default 12), `pressEnter`, `navigates` | Clicks an input and types into it. |

Hover, click and type scroll the element into view first if it isn't visible.
`position` is where on the element to aim, as fractions: `[0.5, 0.5]` is the centre (the default).

**Clicks:**
- `{ "click": "#menu-toggle" }`: the page reacts in-shot (menus, accordions, tabs, sliders).
- `{ "click": "a[href=\"/cases\"]", "navigates": true }`: goes to a new page. The press
  and ripple are recorded, the new page loads and settles off-camera, then it
  **crossfades** in (`crossfade` seconds). No white flashes or half-loaded frames.
  Links that open in a new tab are opened in the same tab instead.
- `"transition": "live"`: for single-page-app sites with their own page-transition
  animation. Recording continues through the click, and `hold` sets how long (default 1.5 s).

**Easings:** `easeInOutCubic` (default: slow start, faster middle, slow end),
`easeInOutSine` (gentler), `easeInOutQuint` (more dramatic), `easeOutCubic`, `linear`.

### Selectors

Playwright selector syntax: any CSS selector (`#about`, `a[href="/cases"]`,
`.case-card:nth-of-type(2)`), `text="Kontakt"` (exact visible text), or
`button:has-text("Læs mere")`. If several elements match, the first one is used.
Remember to escape the inner quotes in JSON: `"a[href=\"/cases\"]"`.

### Settings

All optional. Defaults are shown.

```jsonc
{
  "name": "my-video",                 // output file name (default: the shot list's file name)
  "viewport": { "width": 1920, "height": 1080, "deviceScaleFactor": 2 },  // 1920×1080 layout rendered at 2x = 4K
  "fps": 60,
  "format": "mp4",                    // mp4 | prores | both
  "codec": "h264",                    // mp4 codec: h264 | h265
  "crossfade": 0.4,                   // seconds between pages; 0 = hard cut
  "cursor": { "show": true, "start": [960, 640], "size": 28 },
  "scrollSpeed": 900,                 // px/s for scroll steps without duration/speed
  "easing": "easeInOutCubic",
  "scrollMode": "auto",               // auto | native | wheel (see Troubleshooting)
  "scrollContainer": null,            // selector, if the site scrolls an inner element instead of the page
  "cookieButton": null,               // selector of the button to click; false = leave banners alone
  "hide": [],                         // selectors to hide in every frame, e.g. [".promo-bar"]
  "hideTagPrefixes": [],              // hide custom elements whose tag name starts with these
  "hideKnownWidgets": true,           // hide Sleeknote, Intercom, HubSpot chat, Zendesk, Tidio, Crisp, Drift, Tawk
  "css": "",                          // extra CSS injected into every page
  "settle": 3,                        // seconds each new page settles before recording; 0 = record the intro animation
  "preloadImages": true,              // load lazy images up front so nothing pops in
  "clock": "virtual",                 // virtual | realtime (see Troubleshooting)
  "imageFormat": "png",               // png (lossless) | jpeg
  "locale": null,                     // e.g. "da-DK", for sites that pick a language from the browser
  "userAgent": null
}
```

## Element picker

```bash
node $S/pick.js https://renepoulsen.dk [--viewport 1920x1080]
```

Opens a browser window at the recording's viewport, with cookie banners
dismissed the same way. Hover to see what would be picked, then:

- **click**: a `click` step (the page doesn't react)
- **S + click**: a `scrollTo` step for exactly the element under the mouse
- **H + click**: a `hover` step
- **Alt + click**: use the page normally, for example to follow a link and keep picking on the next page

Each step is printed in the terminal and copied to the clipboard, ready to
paste into `steps`. Links to other pages get `"navigates": true` automatically.
Selectors are checked with the recorder's own engine: an id first, then a data
attribute, the link's `href`, its visible text, and finally a CSS path.

## Troubleshooting

- **A popup or chat bubble covers the video.** Add its selector to `hide`. To find it,
  right-click the element in the picker window and choose Inspect. Widgets that
  render as custom elements with generated names go in `hideTagPrefixes`.
- **The cookie banner isn't dismissed.** Set `cookieButton` to the button's selector.
- **"Element not found".** Check the selector in the picker. Elements that only appear
  after an interaction need that interaction as a step first.
- **Scroll-linked effects don't play, or smooth scrolling fights the recorder.**
  `auto` drives Lenis or GSAP ScrollSmoother through their own APIs when they're
  exposed, and otherwise sets the scroll position directly. Try
  `"scrollMode": "wheel"`, which sends mouse-wheel events like a real user.
- **The site scrolls inside a container, not the page** (the page stays still).
  Set `scrollContainer` to that element's selector.
- **Something freezes or behaves oddly on one site.** Set `"clock": "realtime"`. The page
  then runs in real time; scrolling and the cursor stay perfectly smooth, but the
  site's own animations will look sped up, because capture is slower than real time.
- **The first frame shows a half-finished fade-in.** Raise `settle`. To record the
  intro on purpose, set `"settle": 0`.

## Files

- [decisions.md](decisions.md): why things are the way they are (formats, 4K, crossfade…) and the pitfalls found so far. Read it before changing defaults.
- `scripts/record.js`: command-line entry point
- `scripts/inspect.js`: site survey (links, sections, toggles, overlays, screenshots)
- `scripts/check-video.js`: render verification (specs, frozen/jumping/blank frames, contact sheet)
- `scripts/pick.js`, `lib/picker-ui.js`: the element picker
- `lib/config.js`: defaults, Chrome flags, shot-list loading and validation
- `lib/steps.js`: frame loop, scroll and cursor motion, all steps
- `lib/virtual-time.js`: the virtual clock injected into every page and iframe
- `lib/cursor.js`: the cursor and click-ripple overlay
- `lib/page-setup.js`: loading, cookie banners, hiding widgets, preloading images
- `lib/encoder.js`: ffmpeg per-page intermediates, crossfades, final encodes
