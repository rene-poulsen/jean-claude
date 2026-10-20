# jean-claude

A collection of [Claude Code](https://claude.com/claude-code) skills, commands, agents and hooks.

## Skills

| Skill | What it does |
| --- | --- |
| [my-week](skills/my-week/README.md) | Lists every commit you made this week across your local git repos, grouped by repo, with the Claude Code tokens and cost behind each commit. |
| [plan-my-week](skills/plan-my-week/README.md) | Turns your WorkBook bookings into Outlook calendar events, placed around your existing meetings. Windows + classic Outlook. |
| [4k-website-recording](skills/4k-website-recording/README.md) | Smooth 4K 60 fps screen recordings of websites (scrolling, hovering, clicking through pages) for showreels, portfolios and case videos. |
| [lighthouse-test](skills/lighthouse-test/README.md) | Lighthouse test on mobile and desktop, with a report that traces each problem to your code and suggests fixes. |

Each skill's README explains what you need, how to set it up and how to use it.

## Commands

| Command | What it does |
| --- | --- |
| [feature-pr](commands/feature-pr.md) | `/feature-pr <what you fixed and why>` moves your uncommitted changes to a new branch off `development`/`develop`/`dev`, commits with a generated branch name and message, pushes, opens a PR and shows it in Chrome. Needs the [GitHub CLI](https://cli.github.com) for GitHub repos. |

Copy a command's `.md` file to `~/.claude/commands/` (Windows: `C:\Users\<you>\.claude\commands\`) and
start a new Claude Code session.

## Getting started

1. Download this repo: `git clone https://github.com/rene-poulsen/jean-claude.git`, or use **Code >
   Download ZIP** on GitHub.
2. Copy the skill folder you want into your Claude skills folder:

   ```bash
   cp -r jean-claude/skills/my-week ~/.claude/skills/
   ```

   On Windows that folder is `C:\Users\<you>\.claude\skills\`. You can also copy it in File Explorer.
   To use a skill in one project only, copy it to that project's `.claude/skills/` folder instead.
3. Start a new Claude Code session. Use the skill by typing `/` and its name (e.g. `/my-week`), or just
   ask for what it does ("what did I do this week?").

Some skills need a one-time setup, such as installing a tool or creating an API key. It's in their README.

To update a skill, copy the new version over the old folder. Your settings (`config.txt` /
`config.json`) are only in your copy, so copy the new files in rather than deleting the folder first.

## Repo layout

| Folder | Contents | Install to |
| --- | --- | --- |
| `skills/` | One folder per skill: `SKILL.md` (instructions for Claude), `README.md` (for you) and any scripts | `~/.claude/skills/` |
| `commands/` | Slash commands (`.md` files) | `~/.claude/commands/` |
| `agents/` | Subagent definitions (`.md` files) | `~/.claude/agents/` |
| `hooks/` | Hook scripts and the `settings.json` snippets to wire them up | see each hook |

## License

[MIT](LICENSE)
