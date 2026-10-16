---
name: my-week
description: Show what the user actually did this week - every commit across the git repos in their configured folders, grouped by repo with date and time on each line. Use when they say /my-week, "hvad lavede jeg i denne uge", "what did I do this week", or ask for a weekly summary of their work.
---

# My week

Summarize the user's commits for the week, per repo, one commit per line with its date.

## Steps

1. Run the collector. It scans the folders saved in `config.txt` next to the script, skips `node_modules` and `.worktrees`, and dedupes commits that appear on several branches:

   ```bash
   ~/.claude/skills/my-week/collect.sh                 # since Monday this week
   ~/.claude/skills/my-week/collect.sh 2026-10-05      # since a given date
   ```

   If the user gives a period ("last week", "since the 1st"), convert it to a start date and pass it as the first positional argument. The second positional argument is the author pattern (default: the global `git config user.name`).

   Output: `=== <repo path> (<count>)` headers, then lines of `<Day DD Mon HH:MM>|<subject>`.

   **First run:** if the output is `NO_CONFIG`, no folders are saved yet. Ask the user which folders their git repos live in (one or more parent folders, e.g. `D:\Projects`; subfolders are searched up to 7 levels deep). Save them with:

   ```bash
   ~/.claude/skills/my-week/collect.sh --set-roots "D:\Projects" "C:\Work"
   ```

   Then run the collector again. If the user later wants to change the folders, run `--set-roots` again with the full new list (it replaces the old one).

2. Present the result as markdown:
   - Start with one line: period, total commits, number of repos.
   - One `###` heading per repo, using the short repo name (last path segment) plus the commit count. Order repos by their first commit of the week.
   - Under each heading, one bullet per commit: `**Tue 13 Oct** 09:26 - <subject>` (keep PR numbers like `(#308)` as they are).
   - End with a short "By day" section: one line per weekday with the repos touched that day.

3. Don't add commentary beyond that unless the user asks. Mention that uncommitted work and repos outside the configured folders aren't included.
