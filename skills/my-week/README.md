# my-week

Shows every commit you made this week, across all your local git repos, grouped by repo with the date and
time on each line. Handy for timesheets and weekly status updates.

If Claude Code helped make a commit, the line also shows how many tokens it took and what they would cost
at Anthropic's API prices.

## What you need

- Claude Code
- Git, with your name set: `git config --global user.name "Your Name"` (that's how your commits are found)
- Bash. On Windows, Claude Code uses Git Bash, which comes with Git for Windows.
- Node.js, for the token and cost numbers (optional: without it you just get the commits)

## Install

Copy the `my-week` folder to your Claude skills folder:

```bash
cp -r skills/my-week ~/.claude/skills/
```

On Windows that folder is `C:\Users\<you>\.claude\skills\`.

## First use

Type `/my-week` in Claude Code. The first time, Claude asks which folders your repos live in, e.g.
`D:\Projects`. List the parent folders: subfolders are searched automatically, up to 7 levels deep.
They're saved in `config.txt` in the skill folder.

To change them later, just tell Claude, e.g. "my-week should also look in C:\Work".

## Use

Type `/my-week`, or ask in your own words:

- "What did I do this week?"
- "Show my commits since October 1st"
- "What did I work on last week?"

You get one section per repo with a line per commit, and a short "By day" overview at the end.

## Tokens and cost

Claude Code keeps a log of every session in `~/.claude/projects`. The skill finds the `git commit` that made
each commit in those logs and adds up the tokens the session used since its previous commit, so the work
leading up to a commit counts toward it. A line looks like this:

```
**Tue 13 Oct** 11:30 - Fix Lighthouse findings (#113) · 🤖 32k out · 94k in · 6.7M cached · $4.52
```

- **out**: tokens Claude wrote
- **in**: new input tokens (incl. writes to the prompt cache)
- **cached**: input read from the prompt cache, the biggest number but by far the cheapest
- **$**: what those tokens cost at Anthropic's API list prices, per model. On a Claude Pro/Max plan that's
  not what you pay, but it's a good measure of how much work went into the commit.

Commits with a Claude `Co-Authored-By` line but no matching log show "no transcript" (log deleted, made on
another machine, or the message was changed afterwards). Commits without any sign of Claude get no token note.
Tokens used after a session's last commit, or in sessions that never committed, aren't counted.

Prices live in `PRICES` at the top of `tokens.js`. If a model is missing there, the summary says so.

Uncommitted work and repos outside your saved folders aren't included.
