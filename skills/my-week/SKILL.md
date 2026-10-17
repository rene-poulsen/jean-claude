---
name: my-week
description: Show what the user actually did this week - every commit across the git repos in their configured folders, grouped by repo with date and time on each line, plus the Claude Code tokens and API-price cost spent on each commit. Use when they say /my-week, "hvad lavede jeg i denne uge", "what did I do this week", or ask for a weekly summary of their work.
---

# My week

Summarize the user's commits for the week, per repo, one commit per line with its date and the Claude Code tokens and cost spent on it.

## Steps

1. Run the collector. It scans the folders saved in `config.txt` next to the script, skips `node_modules` and `.worktrees`, and dedupes commits that appear on several branches:

   ```bash
   ~/.claude/skills/my-week/collect.sh                 # since Monday this week
   ~/.claude/skills/my-week/collect.sh 2026-10-05      # since a given date
   ```

   If the user gives a period ("last week", "since the 1st"), convert it to a start date and pass it as the first positional argument. The second positional argument is the author pattern (default: the global `git config user.name`).

   Output: `=== <repo path> (<count>)[ out=<n> in=<n> cached=<n> usd=<x.xx>]` headers (repo token and cost totals), then lines of `<Day DD Mon HH:MM>|<subject>|<tokens>`, and a final `TOTAL commits=<n> with-claude=<n> out=… in=… cached=… usd=…` line (plus `UNPRICED <models>` if a model is missing from the price table in `tokens.js`; those tokens count as $0, so say so). Use these totals as-is; don't add them up yourself.

   `<tokens>` comes from `tokens.js`, which reads the Claude Code transcripts in `~/.claude/projects` (or `$CLAUDE_CONFIG_DIR/projects`, incl. subagents), finds the `git commit` call that made each commit (subject match, same repo preferred, closest in time; a GitHub squash-merge `(#123)` suffix is ignored) and sums the session's usage since that session's previous commit:
   - `out=<n> in=<n> cached=<n> usd=<x.xx> session=<id8>`: output tokens, uncached input (input + cache writes), cache reads, and the cost in USD at Anthropic API list prices (per model; cache writes at 1.25x/2x for 5-minute/1-hour TTL, fast mode 2x, web searches $0.01 each)
   - `shared-with=<repo> session=<id8>`: same command committed in several repos; tokens are counted on `<repo>`
   - `claude-no-transcript`: has a Claude `Co-Authored-By` trailer but no matching transcript (deleted, another machine, or the subject was changed after the commit call)
   - `-`: no sign of Claude Code

   If the output ends with `NO_NODE`, Node.js isn't installed: the lines have no token column. Present the commits without tokens and mention that installing Node.js adds them.

   **First run:** if the output is `NO_CONFIG`, no folders are saved yet. Ask the user which folders their git repos live in (one or more parent folders, e.g. `D:\Projects`; subfolders are searched up to 7 levels deep). Save them with:

   ```bash
   ~/.claude/skills/my-week/collect.sh --set-roots "D:\Projects" "C:\Work"
   ```

   Then run the collector again. If the user later wants to change the folders, run `--set-roots` again with the full new list (it replaces the old one).

2. Present the result as markdown:
   - Start with one line: period, total commits, number of repos.
   - One `###` heading per repo, using the short repo name (last path segment) plus the commit count. Order repos by their first commit of the week.
   - Under each heading, one bullet per commit: `**Tue 13 Oct** 09:26 - <subject> · <tokens>` (keep PR numbers like `(#308)` as they are). Format tokens compactly as `🤖 8.8k out · 40k in · 0.95M cached · $1.23` (k/M, 2 significant digits; cost with 2 decimals), `🤖 shared with <repo>`, `🤖 no transcript`, or nothing for `-`.
   - Put the repo's Claude totals on the heading: `### my-repo (15) · 🤖 161k out · 476k in · 21M cached · $11.04` (omit when no commit used Claude).
   - End with a short "By day" section: one line per weekday with the repos touched that day.
   - Then a "Claude Code" line: commits made with Claude / total, plus week totals for out, in, cached and cost. The cost is what the tokens would cost on the API; on a Claude subscription it isn't what's actually billed. Tokens spent after a session's last commit (or in sessions with no commit) aren't counted.

3. Don't add commentary beyond that unless the user asks. Mention that uncommitted work and repos outside the configured folders aren't included.
