# terminal-title

Sets the terminal window title to the GitHub repo you're working in, so you can tell your Claude Code
windows apart at a glance.

- Inside a git repo: the repo name from the `origin` remote (e.g. `jean-claude`), or the repo folder name
  if there's no remote.
- Outside a repo: the folder name (e.g. `aigu`).
- If you mention a Jira key in a prompt (e.g. `RT-436`), it's added to the title for the rest of the
  session: `jean-claude - RT-436`. If you mention a new key, it replaces the old one. Lookalikes such as
  `UTF-8` and `SHA-256` are ignored.

The title updates when the session starts, when the working folder changes, when you send a prompt and
when Claude finishes replying.

## What you need

- [Node.js](https://nodejs.org) and git on your `PATH`.
- Windows: Windows PowerShell (built in). Works in Windows Terminal and the classic console.
- macOS / Linux: any terminal that understands the standard title escape sequence.

## Install

1. Copy this folder to `~/.claude/hooks/terminal-title/` (Windows:
   `C:\Users\<you>\.claude\hooks\terminal-title\`).
2. Merge [settings.json](settings.json) into `~/.claude/settings.json`. Replace `C:/Users/<you>` with
   your home folder (on macOS / Linux, use `~/.claude/hooks/terminal-title/terminal-title.js`). If you
   already have hooks on these events, add the entries to their lists.

   `CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1` turns off Claude Code's own title updates. Without it, Claude
   Code overwrites the title.
3. Start a new Claude Code session.

## How it works

- `terminal-title.js` works out the title and sets it.
- On Windows, a hook runs in its own hidden console, so a title escape sequence never reaches your
  window. Instead, `set-console-title.ps1` finds the `claude.exe` process, attaches to its console and
  calls `SetConsoleTitle`. Starting PowerShell takes about 0.4 s, so the hook skips it when the title
  hasn't changed.
- Per-session state (the Jira key, the `claude.exe` pid and the last title) is saved in
  `.title-state/<session id>.json` next to the script. Files older than 7 days are deleted when a session
  starts.

To test it, pipe in a hook event with `TITLE_DEBUG=1` set, and the hook prints the title it would set:

```bash
echo '{"hook_event_name":"UserPromptSubmit","cwd":".","prompt":"RT-1"}' | TITLE_DEBUG=1 node terminal-title.js
```
