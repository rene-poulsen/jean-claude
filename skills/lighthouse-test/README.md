# lighthouse-test

Runs a Lighthouse test of a web page, on mobile and desktop, and writes a report you can act on. The
report says why each problem happens, where it is in your code, and how to fix it, with the biggest wins
first.

Each test runs 3 times and keeps the middle result, because Lighthouse scores vary a little between runs.
It uses a clean browser, with no extensions, cookies or cache.

## What you need

- Claude Code
- [Node.js](https://nodejs.org) 22 or newer. Check with `node -v`.

The first run installs Lighthouse and a browser by itself (into `~/.cache/claude-web-tests`, not into
your project).

## Install

Copy the folder to your Claude skills folder:

```bash
cp -r skills/lighthouse-test ~/.claude/skills/
```

On Windows that folder is `C:\Users\<you>\.claude\skills\`.

## Use

Open Claude Code in your website's project folder, so Claude can trace problems back to the code.

**First test:**

```
/lighthouse-test https://staging.example.com/
```

The report goes to `docs/lighthouse-test/REPORT.md`, with screenshots and the full Lighthouse reports
next to it. A test takes 3–5 minutes.

**After fixing things**, test the same URL again:

```
/lighthouse-test after https://staging.example.com/
```

This writes a separate `REPORT-AFTER-FIXES.md` comparing before and after, and checks that the fixes
didn't break anything on the page. The first report is left unchanged.

Tips:

- Test a deployed dev or staging site rather than localhost if you can. It gives more realistic numbers.
  `https://localhost` works too.
- Test the same environment both times, so the before and after numbers can be compared.
- Claude only tests and reports. It won't change your code unless you ask it to.
