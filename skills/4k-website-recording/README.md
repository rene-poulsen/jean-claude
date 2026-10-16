# 4k-website-recording

Makes smooth 4K video recordings of websites for showreels, portfolios and case videos: scrolling to
sections, hovering, clicking through to other pages, with an animated cursor and soft crossfades between
pages.

You describe what the video should show. Claude looks at the site, plans the shots, makes a quick preview,
then renders the final video and checks it.

The video is 3840×2160 at 60 fps, as an H.264 mp4 that plays and edits anywhere. Every frame is rendered
on its own, so motion is perfectly even and the site's animations and videos play at their real speed.

## What you need

- Claude Code
- [Node.js](https://nodejs.org) 18 or newer. Check with `node -v`.
- [ffmpeg](https://ffmpeg.org). On Windows: `winget install --id Gyan.FFmpeg -e`. On macOS:
  `brew install ffmpeg`.

## Install

1. Copy the folder to your Claude skills folder:

   ```bash
   cp -r skills/4k-website-recording ~/.claude/skills/
   ```

   On Windows that folder is `C:\Users\<you>\.claude\skills\`.

2. Install its dependencies once:

   ```bash
   cd ~/.claude/skills/4k-website-recording/scripts
   npm install
   npx playwright install chromium
   ```

Claude also checks these on first use and fixes what's missing.

## Use

Open Claude Code in the folder where you want the video, and ask for it in your own words:

- "Make a 4K recording of renepoulsen.dk"
- "Record a showreel clip of example.com: scroll to the cases, click the first one and scroll through it"
- "Make a 20-second walkthrough of https://localhost:5173"

If you don't say what to show, Claude picks a sensible journey and tells you what it chose.

The preview takes a minute or two. The final 4K video takes about 30–40 seconds per second of video, so
around 10 minutes for a 15-second clip. Claude posts progress while it renders.

The finished video and its shot list end up in `recording-output/<name>/` in the folder you started from.
To re-record later, e.g. after the site changes, ask Claude to render that shot list again.

See [examples/renepoulsen.json](examples/renepoulsen.json) for a shot list.
