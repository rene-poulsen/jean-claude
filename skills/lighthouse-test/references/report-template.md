# Lighthouse report template

Write for developers on the project. Keep it plain and specific, with numbers, file paths and line numbers, and short code snippets. Explain *why* an audit fails, not just what Lighthouse says. Use `–` (en dash) in headings.

Score colors: 🟢 90–100 · 🟠 50–89 · 🔴 0–49. Metrics: ✅ good · 🟠 needs improvement · ❌ poor (Lighthouse's thresholds for the form factor).

---

## Initial report (`docs/lighthouse-test/REPORT.md`)

~~~markdown
# Lighthouse report – `<path>`

Lighthouse audit of [<url>](<url>) on mobile and desktop. This report lists every failing audit with its cause in the code and a suggested fix.

## Contents

- [How it was tested](#how-it-was-tested)
- [Overview](#overview)
- [General finding: <title>](#...)            ← only if one cause dominates
- [Suggested fixes (summary)](#suggested-fixes-summary)
- Issues per category: [Performance](#performance) · [Accessibility](#accessibility) · [Best practices](#best-practices) · [SEO](#seo)

## How it was tested

- **Lighthouse <version>** (CLI) in headless Playwright Chromium <version>, run on <date>. Fresh temporary profile (`--incognito --disable-extensions`), so no extensions, cookies or cache affected the result.
- **Mobile:** Lighthouse default (Moto G Power, 412 × 823, simulated slow 4G at 1.6 Mbps / 150 ms RTT and 4× CPU slowdown).
- **Desktop:** `--preset=desktop` (1350 × 940, 10 Mbps / 40 ms RTT, no CPU slowdown).
- Lighthouse ran 3 times per form factor and the run with the median performance score was kept (mobile <a / b / c>, desktop <a / b / c>).
- The full reports are in [`reports/`](reports/). Open `lh-mobile.report.html` / `lh-desktop.report.html` in a browser for all details, including passed audits.
- Flagged elements are outlined with a **pink dashed line** in the screenshots.
- **Not covered:** other pages, logged-in/consent-given states, and real-user data (Chrome UX Report).

To re-run after fixes, ask Claude for `/lighthouse-test after <url>`.

## Overview

| Category | Mobile | Desktop |
|---|:-:|:-:|
| Performance | 🟠 **58** | 🟠 **58** |
| Accessibility | … | … |
| Best practices | … | … |
| SEO | … ¹ | … ¹ |

¹ <footnote, e.g. noindex on the dev domain is intentional>

### Metrics

| Metric | Mobile | Desktop | Good is below |
|---|:-:|:-:|:-:|
| First Contentful Paint | ❌ 7.3 s | ❌ 3.7 s | 1.8 s / 0.9 s |
| Largest Contentful Paint | | | 2.5 s / 1.2 s |
| Total Blocking Time | | | 200 ms / 150 ms |
| Cumulative Layout Shift | | | 0.1 |
| Speed Index | | | 3.4 s / 1.3 s |
| Total page weight | | | ~1.6 MB |

**Note:** <simulated vs. real timings, server response time, if relevant>

What is already good: <short list – so the team knows what not to touch>

## General finding: <title>

<The one cause behind many failing audits, with a table of where it happens and its share of the page weight/time.>

## Suggested fixes (summary)

Ordered by expected impact. Savings are Lighthouse's estimates from this run.

| # | Problem | Where | Suggested fix | Expected result |
|---|---|---|---|---|
| 1 | … | `templates/video.html` | … | −10 MB on first load |

### Code suggestions

**1 – <title>** (`<file>` line <n>):

```html
<snippet>
```

<Follow-up checks after the change.>

---

<a id="performance"></a>

## Performance (<mobile> / <desktop>)

### <Audit title> – <key numbers>

**Element:** `<selector>` (<what it is>)      ← when the audit points to an element

**Issue:**

- **<Short name>** – <explanation with numbers>

**Suggested fix:** fixes #1, #4.

**Screenshot (mobile):**

![...](screenshots/above-the-fold--mobile.png)

### Other performance findings

- **<Audit> (<savings>)** – <one line each for small findings>

---

<a id="accessibility"></a>

## Accessibility (<mobile> / <desktop>)

### <Audit title>

**Elements:** …

**Issue:** …

**Suggested fix:** …   (or **Known and accepted** with a link to where it was decided)

**Screenshots:**

![...](screenshots/link-name--mobile--1.png)

---

<a id="best-practices"></a>

## Best practices (<mobile> / <desktop>)

…

---

<a id="seo"></a>

## SEO (<mobile> / <desktop>)

…
~~~

---

## After-fixes report (`docs/lighthouse-test/REPORT-AFTER-FIXES.md`)

Output is in `docs/lighthouse-test/after/`. Reference `after/reports/…` and `after/screenshots/…`.

~~~markdown
# Lighthouse report – `<path>` – after fixes

Re-test of [<url>](<url>) after deploying the fixes from the [original report](REPORT.md). The original report is kept unchanged for reference.

- **Before:** performance **58 / 58** (mobile / desktop), <page weight>.
- **After:** performance **83 / 100**, <page weight>. <other headline changes>

Same test setup as the original report: <recap>. <Differences, e.g. number of runs, and the spread of the runs.>

## Contents
…

## Overview

| Category | Mobile before | Mobile after | Desktop before | Desktop after |
|---|:-:|:-:|:-:|:-:|

### Metrics

| Metric | Mobile before | Mobile after | Desktop before | Desktop after |
|---|:-:|:-:|:-:|:-:|

### What the page downloads

| | Mobile before | Mobile after | Desktop before | Desktop after |
|---|--:|--:|--:|--:|
| **Total page weight** | 11,992 KiB | **559 KiB** (−95 %) | … | … |
| Requests | | | | |
| <biggest category, e.g. third-party video> | | | | |
| Own images / JavaScript / fonts | | | | |

## Changes made

The numbers refer to the [suggested fixes](REPORT.md#suggested-fixes-summary) in the original report. Commit(s): `<hash>` on branch `<branch>`.

| # | Problem (before) | Fix | Files |
|---|---|---|---|

## General finding: <title> – fixed

## New finding: <anything found while fixing> – fixed

## Performance (<before> → <after> mobile, <before> → <after> desktop)

### <Audit title> – ✅ Fixed / ✅ Mostly fixed / unchanged / ⚠️ Needs content / 🎨 Intentionally low contrast

<before → after numbers, what changed, screenshots before | after side by side>

## Accessibility / Best practices / SEO (same pattern)

## Remaining issues and suggestions

Ordered by expected impact.

| # | Issue | Suggestion |
|---|---|---|

## Functional check

The fixes change how <…> is loaded, so the deployed page was also checked in headless Playwright Chromium (desktop 1350 px and mobile 412 px):

| Check | Result |
|---|:-:|
| No JavaScript errors in the console | ✅ |

Not covered: <…>
~~~
