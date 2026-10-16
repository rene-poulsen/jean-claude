---
name: plan-my-week
description: Plan the user's coming work week - reads their resource bookings in WorkBook and adds matching job events to their Outlook calendar, placed around existing meetings. Use when they say /plan-my-week, "planlæg min uge", "plan my week", or ask to put their WorkBook bookings into Outlook.
---

# Plan my week

Turns the week's WorkBook bookings into Outlook calendar events. Scripts do the fetching and the scheduling;
your job is to run them, show the preview, resolve questions with the user, and only write to Outlook after
they approve.

Requires a WorkBook personal API key, and one of:

- **Windows** with classic Outlook (the scripts use Outlook's COM interface).
- **macOS** with PowerShell 7 (`pwsh`), the Xcode Command Line Tools (`swift`), and the work calendar added
  to the Calendar app (System Settings > Internet Accounts). The scripts read and write it through
  `mac-calendar.swift` (EventKit), and the events sync to Outlook from there.

Scripts live in `~/.claude/skills/plan-my-week/scripts/`. Settings are in
`~/.claude/skills/plan-my-week/config.json`. On Windows run the scripts with the PowerShell tool, as shown
below. On a Mac run them with Bash through `pwsh`, e.g.
`pwsh ~/.claude/skills/plan-my-week/scripts/plan-week.ps1 -SkipFetch`.

## Rules the planner implements (for explaining and sanity-checking)

- Work days and hours come from `planning.days` in `config.json`. The default is a 37-hour week:
  Mon-Thu 7.5 h, Fri 7 h, starting 08:00.
- Lunch (default 12:00-12:30) is always free and comes on top of the hours (so Mon-Thu end 16:00, Fri 15:30).
- Booking dates in WorkBook don't matter - the week's hours are pooled per customer and the week is laid
  out from scratch.
- A meeting whose subject (before ':') matches a booked customer, or an alias in `config.json`, is
  overlapped by that customer's event: the customer's block is placed at the same time as the meeting, and
  the meeting time counts towards the customer's hours.
- Events marked Free, and subjects listed in `outlook.ignoreSubjects`, are ignored. All other events are busy
  and are never overlapped. An all-day Out-of-office event makes the day unavailable.
- As few events as possible: one block per customer, kept together; only split by lunch, meetings or day end.
- `gapMinutes` (default 15) between planned events, only while the week has spare time (gaps count as work
  time). Set it to 0 to turn gaps off.
- Events get the Outlook category from `outlook.category` (default "Workbook"). Re-running for the same week
  replaces those events and never touches anything else. On a Mac there are no categories: the skill's own
  events are recognised by the first line of their notes, "Planned from WorkBook (plan-my-week)".

## Steps

0. **First run.** If a script fails with `NO_CONFIG`, create `config.json` from `config.example.json` in the
   skill folder. Ask the user for:
   - `workbook.baseUrl` - their WorkBook address, e.g. `https://yourcompany.workbook.net`
   - `outlook.store` - the Outlook account/mailbox name whose calendar to use (usually their email address)
   - their work days and hours, if they differ from the 37-hour default

   The bookings read are the API key owner's. Only set `workbook.resourceId` to plan for another resource.

   If `WORKBOOK_API_KEY` isn't set, point them to "Create a WorkBook API key" in this skill's `README.md`:
   they create a personal API key in WorkBook and store it by running this **in their own PowerShell
   window** (it prompts for the key, so it can't run through your tools):
   ```powershell
   $k = Read-Host 'WorkBook API key' -AsSecureString
   [Environment]::SetEnvironmentVariable('WORKBOOK_API_KEY', [Net.NetworkCredential]::new('', $k).Password, 'User')
   ```
   The scripts read it from the user's environment settings directly, so no restart is needed. Never ask
   them to paste the key into the chat, and never print it.

   **On a Mac** the first-run steps are different:
   - If `pwsh` is missing: `brew install powershell`. If a script fails with `NO_SWIFT`: `xcode-select --install`.
   - The calendar comes from `mac` in `config.json` instead of `outlook.store`:
     `"mac": { "account": "<account name in Calendar>", "calendar": "<calendar name>" }`. To see the
     choices, run `swift ~/.claude/skills/plan-my-week/scripts/mac-calendar.swift list`, which prints
     `account | calendar` for every calendar on the Mac, and ask the user which one is their work calendar.
     If the work account isn't listed, they need to add it in System Settings > Internet Accounts with
     Calendars turned on. `calendar` can be left out when the account has only one writable calendar.
   - The first calendar access asks for permission. If it fails with `NO_CALENDAR_ACCESS`, they need to allow
     their terminal app under System Settings > Privacy & Security > Calendars (Full Access).
   - The API key is stored in the login keychain. They run this **in their own Terminal window** (it prompts
     for the key twice):
     ```bash
     security add-generic-password -U -a "$USER" -s WORKBOOK_API_KEY -w
     ```

1. **Pick the week.** Default is next week (the scripts compute it). If the user names another week, pass
   `-WeekStart yyyy-MM-dd` (any date in that week).

2. **Build the plan** (reads WorkBook and Outlook, writes nothing):
   ```powershell
   & "$HOME\.claude\skills\plan-my-week\scripts\plan-week.ps1"
   ```
   If it fails with a 401, the WorkBook API key has expired (they last max 3 months). Have the user create a
   new one and store it as in step 0.

3. **Show the preview** as a compact table per day (time, event), including the existing meetings so they
   can see what was planned around. Mention totals: booked hours, planned hours, free time.

4. **Resolve questions** printed as `QUESTION` / found in `plan.json` -> `questions`, using AskUserQuestion
   when there are choices:
   - `possibleMatch` - a meeting that looks like it belongs to a booked customer. If the user says yes, add
     the subject prefix as an alias in `config.json` (`"aliases": { "<prefix>": "<WorkBook customer name>" }`)
     so it is remembered, then re-plan.
   - `unplaced` - hours that don't fit in the week. Ask what to do (drop, reduce hours, or accept).
   - Free time - if the week has a lot of unbooked time (more than ~2 hours), mention it. They may want to
     leave it free, which is the default.
   Also ask if anything in the bookings looks odd (e.g. a customer they don't recognise, or very large hours).

5. **Adjustments** go in `overrides.json` in the WorkDir printed by the script (it only applies to that week):
   ```json
   { "excludeCustomers": ["Customer name"], "setHours": { "Customer name": 4 } }
   ```
   Permanent rule changes go in `config.json`. After any change, re-plan without re-fetching:
   ```powershell
   & "$HOME\.claude\skills\plan-my-week\scripts\plan-week.ps1" -SkipFetch
   ```
   For a one-off manual tweak the planner can't express (e.g. "move customer X to Thursday morning"), you
   may edit the `events` in `plan.json` directly - keep times on the quarter hour, inside the day window,
   and clear of lunch and busy meetings - then show the updated preview.

6. **Write to Outlook only after the user explicitly approves the preview:**
   ```powershell
   & "$HOME\.claude\skills\plan-my-week\scripts\apply-week.ps1"
   ```
   (pass the same `-WeekStart` if one was used). Report what it removed and created.

## Safety

- WorkBook is read-only for this skill. Only `fetch-workbook.ps1` talks to WorkBook, and it only issues GET
  requests. Never call the WorkBook API in any other way, and never with POST/PUT/PATCH/DELETE.
- Outlook writes happen only in `apply-week.ps1`, only after approval, and only touch events with the
  configured category in the planned week (on a Mac: events whose notes carry the plan-my-week marker).
