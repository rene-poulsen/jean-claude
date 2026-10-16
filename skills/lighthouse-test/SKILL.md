---
name: lighthouse-test
description: Lighthouse test (mobile + desktop) of a page in headless Playwright Chromium with a clean profile. Runs several times and keeps the median, screenshots the flagged elements, traces every failing audit back to the code (templates, CSS, JS, build config, server and CMS settings) and writes a report with fixes ordered by impact. Use when asked for a Lighthouse test, performance/page speed test, Core Web Vitals check or a re-test after Lighthouse fixes.
argument-hint: "[initial|after] <url>"
allowed-tools: Bash(node ~/.claude/skills/lighthouse-test/scripts/setup.mjs:*), Bash(node ~/.claude/skills/lighthouse-test/scripts/run.mjs:*)
---

# Lighthouse test

Runs Lighthouse on one page for mobile and desktop, and writes a report the team can act on.

- **Mode:** `$ARGUMENTS`. The first word is `initial` (the default) or `after` (a re-test after fixes), followed by the URL. If there's no URL, ask for one. A deployed dev or staging URL gives the most realistic result. `https://localhost` works too, because certificate errors are ignored.
- **Browser:** always headless Playwright Chromium through the script below, for Lighthouse, screenshots and functional checks. Never open a visible browser, and never use another browser tool.
- **Scope:** this skill tests and reports. It doesn't change code unless the user asks.

## Steps

1. **Tools.** Run `node ~/.claude/skills/lighthouse-test/scripts/setup.mjs` (needs Node 22+). The first run installs Playwright + Chromium and Lighthouse 12.8.2 (pinned) into `~/.cache/claude-web-tests`.

2. **Same environment.** In `after` mode, test the same URL and environment as the original report, e.g. the dev domain in both, never dev before and localhost after. If the fixes aren't deployed there yet, stop and tell the user.

3. **Run.** From the repo root:
   - initial: `node ~/.claude/skills/lighthouse-test/scripts/run.mjs <url> docs/lighthouse-test --runs=3`
   - after: `node ~/.claude/skills/lighthouse-test/scripts/run.mjs <url> docs/lighthouse-test/after --runs=3`

   It takes about 3–5 minutes, so run it in the background. Output:
   - `reports/lh-<form>.report.{html,json}`: the median run of the 3.
   - `reports/runs.json`: the scores of all runs.
   - `summary.json`: scores, metrics, requests by type, the largest requests, every failing audit with its items, and `functional` (console errors, redirects and failed requests seen while loading the page).
   - `screenshots/`: `above-the-fold--<form>.png`, plus `<audit>--<form>--<n>.png` for flagged elements (default audits `color-contrast,link-name`, change with `--shot-audits=`).

   Use `--skip-run` to redo the summary and screenshots from saved reports.

4. **Review.** Read `summary.json`. Don't read the full report JSON unless you need details for one audit, and then extract just that audit with `node -e`. Look at the screenshots.

5. **Find the cause** of every failing audit in the code and settings, with file and line: templates and views, the main layout, JS/TS, CSS/SCSS, the build config (e.g. `vite.config.ts`), image helpers, server middleware, and CMS content/settings (meta description, site name, tag manager ID). Find where these live in the project first. Look for a common cause behind many audits, e.g. autoplaying third-party embeds, and describe it as a "General finding".

6. **Accepted exceptions and expected findings.**
   - Read the earlier reports in `docs/lighthouse-test/` and any other test reports in `docs/`. Findings marked there as intentional (e.g. decorative low-contrast headline) show as 🎨 "Known and accepted", with a link.
   - `noindex` / `X-Robots-Tag` on a dev or staging domain is usually intentional. Check with the user if unsure. Say that it lowers SEO, and don't suggest removing it.
   - Performance varies by a few points between runs. Report the median and the spread from `runs.json`.
   - Errors from third-party frames (Vimeo, YouTube, Cloudflare challenges) in `functional` can be bot protection reacting to headless Chromium. Report them only if Lighthouse flags them too (`errors-in-console`, `inspector-issues`).

7. **Fix suggestions**, ordered by expected impact, using Lighthouse's estimated savings. Each one says where the problem is, gives the concrete change (a short code snippet) and the expected result. Name follow-up checks, e.g. "check that the background video still autoplays after lazy-loading".

8. **Write the report** using [references/report-template.md](references/report-template.md):
   - initial: `docs/lighthouse-test/REPORT.md`
   - after: `docs/lighthouse-test/REPORT-AFTER-FIXES.md`. Compare every number with the original, list the changes made with commit hashes from `git log`, add "Remaining issues and suggestions", and add a functional check (see below). **Never edit the original REPORT.md.**

   If the target file already exists, ask before overwriting it.

9. Tell the user the headline scores (mobile / desktop, before → after in `after` mode) and where the report is. Don't commit unless asked.

## Functional check (after mode)

Fixes to loading (lazy iframes, code splitting, deferred images) can break things that Lighthouse doesn't notice. Check the deployed page with a short Playwright script in the scratchpad (headless, both viewports). Import `chromium` via `ensure()` from `~/.claude/skills/lighthouse-test/scripts/setup.mjs`. Verify what the fixes touched, for example:
- no JS errors
- scripts that were split or deferred still run, and run only once
- client-side components (Vue, React, etc.) render
- the mobile menu opens and its images load
- videos initialize when scrolled into view
- no redirects on fonts
- the header image uses a sensible `srcset` candidate

List each check as ✅/❌ in a table, and say what wasn't covered.

## How it was tested (facts for the report)

- Lighthouse version and date: `summary.<form>.lighthouseVersion` / `fetchTime`. Browser: `userAgent` (HeadlessChrome = Playwright Chromium, unless `CHROME_PATH` was set).
- Mobile: Lighthouse default (Moto G Power, 412 × 823, simulated slow 4G at 1.6 Mbps / 150 ms RTT, 4× CPU slowdown). Desktop: `--preset=desktop` (1350 × 940, 10 Mbps / 40 ms RTT, no CPU slowdown).
- Fresh temporary profile (`--incognito --disable-extensions`): no extensions, cookies or cache.
- `--runs=3`, the median by performance score is kept.
- Metrics are simulated. Mention that unthrottled timings (e.g. real FCP on the test machine, server response time) can be far better, when that helps explain a low score.
- Not covered: other pages, logged-in / consent-given states, and real-user data (CrUX). A dev domain has no field data.
