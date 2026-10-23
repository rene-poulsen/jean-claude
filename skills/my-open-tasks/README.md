# my-open-tasks

Keeps track of the loose ends from your Claude Code sessions, so nothing gets lost when you jump between
tasks and repos. Per repo it lists:

- **❓ Questions** Claude asked that you never answered ("Want me to push it?", "Which URL is staging?")
- **🧪 Things to test** that Claude made but couldn't check itself, with the URL, page or command to test
- **⏸ Where unfinished tasks stopped**: half done, blocked, interrupted or parked, with branch and PR link

Every item gets a number that stays the same, so you can tick items off ("done 3 5", "4: yes, push it") and
they're gone next time. Run it as often as you like: each run only reads the sessions since the previous one
and carries over what's still open.

## What you need

- Claude Code
- Node.js
- Git, for the branch and uncommitted-changes info on each repo (optional)

## Install

Copy the `my-open-tasks` folder to your Claude skills folder:

```bash
cp -r skills/my-open-tasks ~/.claude/skills/
```

On Windows that folder is `C:\Users\<you>\.claude\skills\`.

## First use

Type `/my-open-tasks` in Claude Code. The first time, Claude asks which folders your repos live in, e.g.
`D:\Projects`. Sessions started in those folders or below are included. They're saved in `config.txt` in the
skill folder.

To change them later, just tell Claude, e.g. "my-open-tasks should also look in C:\Work".

The first run looks at the last 24 hours.

## Use

Type `/my-open-tasks`, or ask in your own words:

- "What's open?"
- "What do I need to test?"
- "Where did I leave off yesterday?" (reads further back with a time window)

You get one section per repo, with numbered items under each task, and a `claude -r <session id>` line for
tasks that need Claude again. Then tick items off by replying:

- `done 3 5` (or "3 and 5 are tested")
- `4: yes, push it` (answers a question; the answer is kept with the item)
- `drop 9` (no longer relevant)
- `reopen 2`

A failed test ("7 doesn't work, the button is missing") stays open, and Claude tells you which session to
resume.

## Where things are saved

- `config.txt` (skill folder): the folders to scan
- `state.json` (skill folder): when it last ran, and the next item number
- `open-tasks.json` in each repo's folder under `~/.claude/projects`: that repo's items

Sessions outside your saved folders aren't included.
