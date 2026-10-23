---
name: my-open-tasks
description: List the user's loose ends from their Claude Code sessions - per repo in their configured folders, the questions and confirmations Claude is waiting on, what they need to test and how, and where each unfinished task stopped - as numbered items they can tick off ("done 3", "4: yes push it") so they're gone next time. Use when they say /my-open-tasks, "hvad mangler jeg", "hvad er åbent", "what's open", "what do I need to test", "where did I leave off", ask for the state of their tasks, or mark items from that list done/answered. Can run several times a day; each run only reads the sessions since the previous run and carries over what's still open.
---

# My open tasks

Keep a list of what is waiting on the user across their Claude Code sessions: unanswered questions, things to test and the state of unfinished tasks. Each item has a permanent number. It stays open until they tick it off or a later session resolves it. Each repo's items are saved in its Claude project folder: `~/.claude/projects/<repo path with non-alphanumerics as "-">/open-tasks.json`.

Three scripts are in this folder: `collect.js` reads the transcripts, `items.js` stores the items, and `config.js` holds what they share (the folders to scan, saved in `config.txt`).

## A. The user ticks items off

If they're replying to a list, or call the skill with `done`/`answer` arguments, update the items and don't run a new collect. Examples: "done 3 5", "3 og 5 er testet", "4: yes, push it", "/my-open-tasks done 7", "drop 9", "reopen 2".

```bash
node ~/.claude/skills/my-open-tasks/items.js done 3 5 [--note "tested on staging"]
node ~/.claude/skills/my-open-tasks/items.js answer 4 "yes, push it"     # a question; the answer is kept as its note
node ~/.claude/skills/my-open-tasks/items.js reopen 2
node ~/.claude/skills/my-open-tasks/items.js list                        # the open list without a new collect
```

Confirm in one or two lines what you closed. For an answered question, or a test that failed ("7 doesn't work, the button is missing"), the task usually needs Claude again. Give the `claude -r <session id>` line and the answer to paste, but don't act on it in that session yourself. A failed test isn't done: leave it open and say so. "Drop 9" (not relevant any more) is `done 9 --note dropped`.

## B. A new run

1. Collect (only sessions in folders under the ones saved in `config.txt`):

   ```bash
   node ~/.claude/skills/my-open-tasks/collect.js                      # since the last run
   node ~/.claude/skills/my-open-tasks/collect.js --since 2d           # since a time: 3h, 2d, 2026-10-20, 2026-10-20T08:00
   node ~/.claude/skills/my-open-tasks/collect.js --again              # the previous window again
   ```

   If the user gives a period ("since this morning", "the whole week"), convert it to `--since`. Use `--again` when they want the last window read again. A normal run (and `--since`) moves the "last run" marker in `state.json` to now; `--again` and `--dry` don't. The first run ever covers the last 24 hours.

   **First run:** if the output is `NO_CONFIG`, no folders are saved yet. Ask the user which folders their repos live in (one or more parent folders, e.g. `D:\Projects`; every session started in that folder or below counts). Save them with:

   ```bash
   node ~/.claude/skills/my-open-tasks/collect.js --set-roots "D:\Projects" "C:\Work"
   ```

   Then run the collector again. If the user later wants to change the folders, run `--set-roots` again with the full new list (it replaces the old one).

   Output: a `WINDOW <from> -> <to> (<source>) | roots=…` line, then per repo `=== <repo> | branch=<current> | uncommitted=<n> files|clean|no-git`, and per session in it:
   - `--- session <session id> "<title>" | <start>-<end> | msgs=<n> | ended=USER|CLAUDE[ | flags]`. Flags: `waiting on AskUserQuestion` / `waiting on ExitPlanMode` (Claude asked and got no answer), `interrupted by the user`, `ended on the user's message (Claude may not have finished)`, `session branch=<b>`.
   - `TASK: <first prompt>` when the session started before the window.
   - `DID: …`: commits (subject), push, `gh pr create/merge`, deploy commands, files edited.
   - The conversation in the window: `[time] USER: …` / `[time] CLAUDE: …`, head and tail (middle skipped), the last Claude message nearly in full. Times without a date are today.

   At the end: `OPEN ITEMS FROM EARLIER RUNS`, one per line: `<no>. #<id> | <repo> | [<kind>] <task> :: <text> | session=… | since …`. The current run of this skill is left out automatically.

2. Work out the items. Look especially at Claude's last messages in each session:
   - `question`: something Claude asked that the user didn't answer, a choice it offered ("Want me to …?"), a confirmation it needs (push, deploy, delete, a plan to approve), or info it asked for (URL, credentials, a client decision).
   - `test`: something Claude made but didn't verify itself ("I haven't checked it in the browser"), with the concrete how in the text: URL, page, command, what to look for. A PR to review/merge or a deploy to check counts too.
   - `state`: where an unfinished task stopped: partly done (what's left), blocked (on what), interrupted, or parked ("I'll leave it for now"). Include branch, uncommitted changes and PR link.

   A finished session with nothing pending gets no item; it goes in the "Done" line. Don't invent items. Write each `text` so it can be acted on without opening the session (one or two lines). Use the same `task` name for the items of one task.

   Check the earlier open items against the new sessions. If a session resolved one (the user answered it, tested it, merged it), close it with `status: "done"` and a short `note`. If the same open end shows up again, update the earlier item (pass its `id`) instead of adding a duplicate. Later sessions win over earlier ones.

3. Save them. Write a JSON array to a file in your scratchpad dir, then run `items.js save <file>`:

   ```json
   [
     {"repo": "D:\\Projects\\shop-site", "kind": "test", "task": "Shop online filter", "text": "Open https://localhost:15277/machines/used: no \"Shop online\" toggle; /machines/new: toggle still there", "session": "84f0450b-…"},
     {"id": "a1b2c3", "status": "done", "note": "answered in session 51d5fc9a"}
   ]
   ```

   `repo` is the path from the `===` header and is required for new items. An entry with an `id` updates that item, and `repo` may be left out then. The output is the full open list, `<no>. [<kind>] <task> :: <text> | #<id> | session=… | since …` per repo, plus `DONE …` lines for what you closed. Use the numbers from this output.

4. Present it as markdown, in the language the user asked in:
   - First line: the window (`Since 11:42` / `Since Wed 21 Oct 14:06`), and counts: open questions, tests, tasks in progress, plus how many are new since last time.
   - One `###` heading per repo with open items: short repo name (last path segment), branch, and `· N uncommitted` when not clean. Repos with questions come first.
   - Under it, per task, a bold task name with the time of its last activity, then one bullet per item: `**3** ❓ …` / `**4** 🧪 …` / `**5** ⏸ …`, with the item number in bold first. Mark items added in this run with `🆕`. Put URLs, commands and PR links in. End the task block with `resume: claude -r <session id>` only when the task needs Claude again.
   - `**Done since last time:**` lists the tasks finished in the window and the items closed by new sessions, briefly (`shop-site: Shop online filter → PR #334`).
   - Last line: how to tick items off, e.g. `Reply "done 3 4", "5: yes, push it" or "drop 7".`
   - If nothing is open: say so in one line, plus the Done line.

5. Don't add commentary beyond that. Mention that sessions outside the configured folders (e.g. the home folder) aren't included.
