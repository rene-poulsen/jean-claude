# my-week

Shows every commit you made this week, across all your local git repos, grouped by repo with the date and
time on each line. Handy for timesheets and weekly status updates.

## What you need

- Claude Code
- Git, with your name set: `git config --global user.name "Your Name"` (that's how your commits are found)
- Bash. On Windows, Claude Code uses Git Bash, which comes with Git for Windows.

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

Uncommitted work and repos outside your saved folders aren't included.
