---
name: 4k-website-recording
description: Produce smooth, frame-perfect 4K (3840×2160, 60 fps) screen recordings of websites for showreels, portfolios and case videos, including navigation — scrolling to specific sections, hovering, clicking through to other pages and continuing there, with an animated cursor and crossfades between pages. Use this whenever someone wants a video/recording/capture of a website or web page (their own site, a client's site, a case page, a local dev server), a "scroll-through", "walkthrough", "site tour" or "showreel clip" of a URL, or high-quality footage of a site for a video editor — even if they don't say "4K" or "showreel". Not for editing or compressing an existing video file.
---

# 4K website recordings

This skill turns "make a video of this site that scrolls down to X and clicks into Y" into a finished 4K 60 fps mp4. The recorder in `scripts/` renders the site **frame by frame on a virtual clock**: the page only ever sees exactly 1/60 s pass between frames, however long a 4K screenshot takes. The result is perfectly even motion, with every CSS/JS animation, `<video>` and embedded Vimeo/YouTube player playing at its true speed. Scrolling and the cursor follow easing curves computed per frame, and page changes crossfade with the loading hidden off-camera.

Your job is the choreography. Understand what the person wants to show, survey the site, write a shot list, check a quick preview, render the 4K version, and verify it before handing it over.

`$S` below means this skill's `scripts/` folder (e.g. `~/.claude/skills/4k-website-recording/scripts`). Run commands from the user's working directory: output goes to `recording-output/<name>/` there, never into the skill folder.

## 1. Setup (first use on a machine)

Check these and fix only what's missing:

- Node 18+: `node -v`
- A full ffmpeg with libx264 on PATH: `ffmpeg -hide_banner -encoders | grep libx264`. If it's missing: `winget install --id Gyan.FFmpeg -e` on Windows (open a new shell afterwards), `brew install ffmpeg` on macOS, or set `FFMPEG`/`FFPROBE` env vars to the binaries.
- Dependencies: if `$S/node_modules` doesn't exist, run `npm install` in `$S`.
- Browser: if Chromium fails to launch, run `npx playwright install chromium` in `$S`.

## 2. Pin down the shot

You need a start URL and what the viewer should see: which sections, what to click, which page to land on, and what to show there. If the request is vague ("a showreel clip of example.com"), pick a strong default journey rather than interrogating: a short look at the hero, a scroll to the work/cases, hover and click into one case, and a scroll through that case. Tell the user what you chose.

Things worth confirming only when they matter:
- **Length.** Showreel clips are usually 10–25 s; editors cut them down anyway. Longer is fine if they ask.
- **Format.** Default is H.264 mp4: near-lossless, small, and it plays and edits anywhere. ProRes 422 HQ (`--format prores` or `both`) and H.265 (`--codec h265`) exist for editors who need them.
- **Pages or elements to avoid.** Examples: staging banners, a specific popup.

## 3. Survey the site

```bash
node $S/inspect.js https://example.com
```

It loads the page exactly as the recorder will (1920×1080 layout, cookie banner declined, known popups and chat widgets removed). It prints:
- links to other pages, with ready-made selectors and how many elements match
- section ids and headings, with their page positions
- toggles (accordions, tabs)
- smooth-scroll libraries, inner scroll containers, embedded players
- any fixed overlays still visible

It also saves screenshots down the page to `recording-output/_inspect/<host>/`. **Look at the screenshots** (Read the images). They show what's visually strong and worth stopping on, and whether a popup survived. Inspect each page you'll navigate to as well.

Selectors: prefer ones with 1 match. `a[href="/cases/foo"]` and `#section-id` are the most robust, and `text="Kontakt"` is fine for labelled buttons. If the person wants to click elements themselves, `node $S/pick.js <url>` opens a real browser window where clicking an element copies a ready-made step. This only helps when a human is at the keyboard.

## 4. Write the shot list

Save it as `recording-output/<name>/<name>.json`, with `"name": "<name>"` in kebab-case, e.g. `example-case-page`. The first step must be `goto`.

```json
{
  "name": "example-case-page",
  "steps": [
    { "goto": "https://example.com" },
    { "wait": 1.5 },
    { "scrollTo": "a[href=\"/work/project\"]", "block": "center", "duration": 3 },
    { "hover": "a[href=\"/work/project\"]" },
    { "wait": 0.6 },
    { "click": "a[href=\"/work/project\"]", "navigates": true },
    { "wait": 1.2 },
    { "scrollBy": 2500, "duration": 4 },
    { "wait": 1 }
  ]
}
```

**Steps:**

| Step | What it does |
| --- | --- |
| `goto` | Opens a URL. A later `goto` crossfades like a navigating click. |
| `wait` | Holds the shot; the page keeps animating. |
| `scrollTo` | Scrolls to a selector. Options: `block` top/center/bottom, `offset`, `duration` or `speed`. |
| `scrollBy` | Scrolls by a number of pixels. |
| `scrollToBottom` / `scrollToTop` | Scrolls to the end or start of the page. |
| `hover` | The cursor glides to the element and hover effects play. |
| `click` | Clicks the element. Add `"navigates": true` when it loads a new page. |
| `type` | Types into an input, e.g. `{ "type": "#search", "text": "…" }`. |
| `moveCursor` | Moves the cursor to a position or element. |
| `showCursor` / `hideCursor` | Shows or hides the cursor. |

Every step option and shot-list setting is in [references/shot-lists.md](references/shot-lists.md). That includes `hide` for leftover popups, `cookieButton`, `scrollContainer`, `settle`, easings, `crossfade` and the escape hatches. Read it when you need anything beyond the steps above.

**Choreography that reads well on a reel.** The viewer has to register each moment, so give motion room to breathe:
- Open with a `wait` of 1–1.5 s so the hero registers.
- Scroll at about 2–4 s per scroll step, or a `speed` of 700–1000 px/s for long runs. Faster looks frantic at 60 fps; much slower drags.
- Before a click, `hover` first and add a short `wait` (0.4–0.8 s), so hover effects show and the click feels deliberate.
- After landing on a new page, `wait` 1–1.5 s before moving on.
- End on a 1–1.5 s hold, which gives the editor a clean out-point.
- `"block": "center"` frames a card or element nicely. `"block": "top"` with an `offset` equal to the sticky header's height suits section headings.

## 5. Preview, then render 4K

The preview renders at 1080p30 and takes about 1–2 minutes. It catches wrong selectors, popups and bad timing cheaply:

```bash
node $S/record.js recording-output/<name>/<name>.json --preview
node $S/check-video.js recording-output/<name>/<name>-preview.mp4
```

Look at the contact sheet the checker writes (`<name>-preview-contact.png`), fix the shot list, and repeat until it's right. Then render 4K:

```bash
node $S/record.js recording-output/<name>/<name>.json
```

A 4K render takes about **35 s of wall time per second of video**, roughly 8 minutes for a 13 s clip. It's slow on purpose: it's frame-perfect. Run it in the background, tell the user the rough ETA, and don't poll in a tight loop. If you tell the user it's still running, don't claim a result before it finishes.

### Keep the user posted while it renders

Many people using this skill aren't technical, and a silent 10-minute wait looks like a hang. **Always** give progress updates during the 4K render without being asked:

1. Send the render's output to a log and run it in the background, chaining the check so it runs when the render finishes:
   ```bash
   node $S/record.js recording-output/<name>/<name>.json > recording-output/<name>/render.log 2>&1 && node $S/check-video.js recording-output/<name>/<name>.mp4
   ```
2. Start a watcher on the log (the Monitor tool, `timeout_ms` 1800000; re-arm it if it expires before the render ends). Each line it prints becomes an update, and failures print too:
   ```bash
   tail -n +1 -f recording-output/<name>/render.log | grep -E --line-buffered "^\[|Captured|Done|[Ee]rror|failed|Timeout|not found"
   ```
3. For every event, reply with one short line in plain language: which step just finished and what's rendering now, e.g. "Step 7 of 14 done: clicked 'Our work' and faded to that page. Now: a short pause on the new page." Describe what the viewer sees, not selectors or frame counts. When frames are captured, say it's encoding; when the check finishes, move on to section 6.
4. When the render ends or is stopped, stop the watcher (TaskStop).

The same goes for the preview and the other waits: before any command that takes more than a minute, say in one line what's happening and roughly how long it will take.

## 6. Verify before handing over

```bash
node $S/check-video.js recording-output/<name>/<name>.mp4
```

It checks for 3840×2160, 60 fps and bt709 colour tags, plus blank frames, frozen frames mid-motion and single-frame jumps. It writes a contact sheet and a 4-frame strip around each flagged spot. **Look at the images**, not just the summary: renders have passed the numbers while showing a popup, and have also looked broken to a naive check while being fine.

How to read the flags:
- A **jump** inside an embedded video is usually that video's own scene cut, which is fine.
- A jump or **frozen frame** in the middle of the page's own scrolling is a real problem.
- **Blank frames** are always a problem.

If something's wrong, fix the shot list and re-render. [references/decisions.md](references/decisions.md) lists every pitfall found so far and how it was solved.

## 7. Report back

Give the path to the mp4 and its specs (resolution, fps, duration, size), describe the journey in one or two lines, and mention anything you chose on the user's behalf or couldn't do (e.g. "the newsletter popup is hidden", "the case page has no video, so it's a still hero").

## When something goes wrong

- **Element not found:** re-run `inspect.js` on that page. The element may render only after an earlier interaction, or only at another width.
- **A popup or chat bubble in the frames:** add its selector to `hide`. Widgets that live in shadow DOM on generated tag names go in `hideTagPrefixes`.
- **The page doesn't move when scrolled:** the site scrolls an inner element, so set `scrollContainer` (`inspect.js` detects this).
- **Scroll-linked effects misbehave:** try `"scrollMode": "wheel"`.
- **The site hangs or behaves oddly under the virtual clock:** set `"clock": "realtime"`. Motion stays smooth, but the site's own animations will look sped up.

When you learn something new about a site or the tool (a new pitfall, a changed default, a choice the user made), add it to [references/decisions.md](references/decisions.md) with the date and who decided. That way the history stays with the skill instead of getting lost in chat.
