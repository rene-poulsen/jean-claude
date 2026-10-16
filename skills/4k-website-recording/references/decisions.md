# Decisions and lessons

Why the recorder works the way it does. Each entry covers what was
decided, why, and who decided. Pitfalls found along the way are at the bottom,
so nobody has to rediscover them. Add to this file whenever a choice is made or
something surprising turns up.

For how to use the tool, see [../SKILL.md](../SKILL.md) and
[shot-lists.md](shot-lists.md).

## Packaging

### The tool lives inside the skill (2026-09-25, renamed from `website-showreel` to `4k-website-recording` on 2026-10-16)
- **Decided by:** René.
- **Choice:** the recorder code moved from `showreel-recorder/` into
  the skill's `scripts/` folder, which is now its only home. The
  skill carries everything it needs, so the folder can be moved elsewhere
  (to a personal or team skills folder) as it is.
- **Consequence:** renders go to `recording-output/<name>/` (originally `showreel-output/`) under the directory the
  command is run from, never into the skill folder. `node_modules` is installed
  per machine (`npm install` in `scripts/`) and is not committed.
- **Not chosen:** a skill that only points at `showreel-recorder/` (breaks when
  moved), and a second copy of the code in the skill (the copies would drift apart).

## Output

### H.264 mp4 is the default; ProRes and H.265 stay available (2026-09-25)
- **Decided by:** a video editor, after trying the options.
- **Choice:** `"format": "mp4"` with `"codec": "h264"` is the default, at CRF 12,
  High@5.2, 4:2:0.
- **Why:** it's visually near-lossless at 4K60, files are small (tens of MB rather
  than GB), and it plays and edits anywhere.
- **Kept as options:**
  - `--format prores` (or `both`): ProRes 422 HQ `.mov`, 10-bit 4:2:2, about 2 GB
    per minute at 4K60. Use it if an edit needs an intra-frame master, for heavy
    grading, speed ramps or lots of scrubbing.
  - `--codec h265`: 10-bit Main10, smaller at similar quality, but heavier to
    decode in an editing timeline.
- **Before this:** until the editor gave feedback, the tool produced both
  ProRes and mp4 on every render, so either could be evaluated.

### 4K = the 1920×1080 layout rendered at 2x (2026-09-25)
- **Decided by:** René.
- **Choice:** viewport 1920×1080 with `deviceScaleFactor: 2`, which gives
  3840×2160 pixels.
- **Why:** the viewer sees the normal desktop layout with retina-sharp text and
  images. A real 3840-px-wide viewport would show the site's huge-screen layout
  with tiny content.
- **Not chosen:** 2560×1440 @1.5x (the wider layout) and a mobile recording. Both
  are still possible through `viewport` in a shot list.

### 60 fps (2026-09-25)
- **Decided by:** René.
- **Why:** smoothest scrolling, and it conforms cleanly to a 30 fps timeline.
  `fps` can be set per shot list for 25/50 fps (PAL) timelines.

### bt709 colour, tagged explicitly
- Screenshots are sRGB. The encoder converts with the bt709 matrix to limited
  range and stamps bt709 primaries, transfer and matrix on the stream, so
  Premiere and DaVinci show the same colours as the browser. Chrome is also
  launched with `--force-color-profile=srgb`, so the capturing machine's own
  display profile has no effect.

## Look and feel

### Visible animated cursor with a click ripple
- **Decided by:** René.
- A cursor glides along a gentle arc to each target, presses (scales down), and
  leaves a ripple. It's drawn by the tool, because headless Chrome has no
  pointer, and it is fully deterministic frame by frame. The real mouse is moved
  along with it, so the site's hover effects play.

### Page changes: short crossfade, loading hidden
- **Decided by:** René.
- The press and ripple are recorded; the new page then loads and settles
  **off-camera**, and a 0.4 s dissolve joins the two pages (`crossfade`). This
  means no white flashes or half-loaded frames.
- `"crossfade": 0` gives hard cuts instead. `"transition": "live"` records straight
  through, for single-page-app sites with their own page-transition animation.

### Cookie banners dismissed automatically; popups and chat widgets hidden
- **Decided by:** René (cookies). Widget hiding was added after testing on gotcha.dk.
- Cookie banners: decline first (Cookie Information's `#declineButton`, then
  "afvis alle" / "reject all" wording), and accept only as a last resort.
  `cookieButton` overrides this per site.
- Known popups and chat launchers (Sleeknote, Intercom, HubSpot, Zendesk, Tidio,
  Crisp, Drift, Tawk) are hidden by default (`hideKnownWidgets`), including ones
  that appear later. `hide` and `hideTagPrefixes` cover anything else.

### Shot lists in JSON, plus a click-to-pick helper
- **Decided by:** René.
- **Why JSON:** a shot list is easy to review, tweak and re-render, and a site
  change only means fixing a selector.
- **Why the picker:** `pick.js` removes the need to read HTML to find selectors.
- **Not chosen:** "record by doing", where you navigate yourself and it replays.
  It was more work to build and gives less precise timing.

## Engine

### A virtual clock, rendered one frame at a time
- The original Instagram recorder captured in real time, so timing depended
  on how fast each screenshot happened to be. That led to hitches and a
  speed that varied by page.
- Here every page, and every iframe, runs on a clock that only moves forward exactly
  1/fps per frame. This covers `performance.now`, `Date`, timers,
  `requestAnimationFrame`, CSS and Web Animations, and `<video>`.
- **Result:** motion is perfectly even, however slow 4K capture is. The cost is
  that rendering is slower than real time, at roughly 3 frames per second at 4K.
- `"clock": "realtime"` is the escape hatch if a site misbehaves.

### Frames go straight into a lossless intermediate
- Each page is piped into ffmpeg as lossless RGB (`libx264rgb -qp 0`) while it's
  captured, so tens of GB of PNGs never touch the disk. The final encode
  crossfades the pages together. `--keep-frames` keeps the PNGs if needed.

## Pitfalls found (and fixed)

- **Raw CDP screenshots ignore the pixel ratio.** `Page.captureScreenshot`
  returned 1920×1080 at `deviceScaleFactor: 2`. You must pass
  `clip.scale = deviceScaleFactor`. This was checked against Playwright's own 4K
  screenshot: the result is a true 2x render (PSNR 89 dB versus 42 dB for an upscale),
  and it's ~3x faster.
  **Superseded 2026-09-29 (Claude, while recording a customer site; Playwright
  1.63 / Chromium 153):** on that site, captures from the recorder's own CDP
  session painted Chromium's default 800×600 surface (mobile layout) into the
  top-left corner of a mostly blank 4K frame. Page JS still reported 1920×1080,
  and gotcha.dk was unaffected. The fix: `record.js`
  now sends `Emulation.setDeviceMetricsOverride` on its own session too. With
  that in place, `clip.scale` must be **1**: the session already returns device
  pixels, so `scale: 2` gives 7680-px frames. Both sites were verified at
  3840×2160 afterwards.
- **A selector's first match can be an invisible nav link** (2026-09-29, Claude).
  Steps act on the *first* match. `a[href="…/page"]`
  matched a link inside a closed mega-menu dropdown before the section's own
  button. The cursor aimed there and the click landed on nothing, so the log
  showed "no URL change". When `inspect.js` shows `(x2)`/`(x3)`, scope the
  selector to its section (here `.text-media__content a[href=…]`) and check
  the log for that warning.
- **That clip is in document coordinates.** A fixed `{x:0, y:0}` clip gave
  **blank white frames as soon as the page scrolled**. The clip must start
  at `visualViewport.pageLeft/pageTop` for every frame. It was caught by a
  suspiciously small output file (2 Mbps at 4K) and a white frame on a
  contact sheet, so always look at frames, not just `ffprobe` output.
- **`-color_trc`/`-color_primaries` flags alone didn't stick.** Filtered frames
  carry their own (unset) colour properties. `setparams=` in the filter chain fixes it.
- **Embedded Vimeo/YouTube players are iframes with their own clock.** They
  need stepping too, or their video plays at the wrong speed. Their
  `requestAnimationFrame` never fires while off screen, because Chrome throttles
  it, so iframes are stepped without waiting for paint.
- **Sleeknote popups render in shadow DOM on generated tag names**
  (`<sleeknote-ruw03n-bottom>`, and the name changes between visits). No CSS
  selector reaches them, so tag-prefix matching was needed. **Hiding them doesn't
  work either:** their shadow styles set `:host { display: flex !important }`,
  which wins over even an inline `display: none !important`, because in the cascade the
  shadow context beats the page for important declarations. So they are
  *removed* from the DOM, and a MutationObserver keeps removing them when
  re-added. The first 4K render still showed the popup even though the element
  "had" `display:none`, so check `getComputedStyle`, not just the style attribute.
- **The picker's click-blocking also blocked its own cookie dismissal.**
  Playwright clicks with real mouse events. The picker pauses itself while it
  dismisses banners.
- **Scroll reveals that start mid-paint used to run in real time (found 2026-09-29).**
  The full-screen image reveal (a 0.5 s CSS `clip-path` transition, started by
  an IntersectionObserver when the image scrolls into view) jumped from a thin
  strip to full width in one frame of the 4K render, while the 1080p preview
  looked fine. IntersectionObserver callbacks and style recalcs run *inside*
  the browser's rendering step, which comes after the virtual clock has already
  synced that frame's animations. So the new transition ran in real time during the
  ~600 ms 4K screenshot and was finished by the next frame. Preview frames
  capture ~4× faster, which hid it.
  - **First fix (not enough):** `__vt.step()` syncs animations again right after
    the paint wait. The re-render still jumped ~70% of the way in one frame.
  - **Why:** *the screenshot itself* renders a fresh frame. The observer fired
    there, in the ~600 ms between two steps, where no sync can reach.
  - **Real fix:** an animation first seen *after* the clock is frozen is
    started at the current virtual moment (`startOffset()` in
    `virtual-time.js`), however long it has already run in real time. A
    negative delay is kept. Only animations already running at freeze time keep
    their real progress.
  - **Verified** on a short 4K clip: the reveal goes 5% → full over 26 frames,
    matching the site's 0.5 s ease-in-out.
  - **Takeaways:** a clean preview doesn't prove the 4K render is clean.
    `check-video.js`'s jump flag caught this both times, so always look at the
    flagged strips. To confirm a fix, measure the property per frame (here, the
    visible width across one pixel row), not just the thumbnails.
- **Checking smoothness: parse numbers properly.** ffmpeg's `signalstats`
  prints tiny values in scientific notation (`9.97e-05`), and `awk` on this
  machine reads that as `9.97`. That produced fake "spikes" every 4th frame,
  which happened to line up with x264's P-frames, where the faint grain texture
  is refreshed by at most 2/255. Parse with a real float parser (e.g. Python's `float()`).
  To verify a render, measure the per-frame luma difference
  (`tblend=all_mode=difference,signalstats`). During motion no frame should be
  ~0 (a frozen frame) and none should be more than 3× its neighbours (a jump).
- **The bundled Chromium does play H.264.** An "empty video" on gotcha.dk's
  case page turned out to be a hidden Webflow placeholder, not a codec
  problem, so no Chrome or Edge channel is needed.
- **Chat widgets that set an inline `display: block !important` ignore `hide`**
  (2026-09-29, found on a Karla Chat widget, `iframe.karlachat--window`).
  An inline `!important` beats any stylesheet rule, so the injected
  `display:none !important` did nothing. These widgets leave `visibility` alone,
  so `hide` now also sets `visibility:hidden !important` (`lib/page-setup.js`).
  If a widget ever forces visibility inline too, it will need to be removed from the DOM
  like Sleeknote. `inspect.js` still lists it as a visible overlay, because it checks
  layout boxes, so confirm on the preview contact sheet instead.
- **Always post plain-language progress updates during renders** (2026-09-29,
  decided by Rene Poulsen). The skill is often used by non-technical people, and a
  silent 10+ minute 4K render looks like a hang. The render now writes to
  `render.log`, a Monitor watches it, and each finished step gets a one-line
  update ("Step 7 of 14 done: …") that describes what the viewer sees, without
  selectors. See SKILL.md § 5 "Keep the user posted while it renders".
