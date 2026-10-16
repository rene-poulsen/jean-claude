# plan-my-week

Turns your WorkBook bookings for the coming week into events in your Outlook calendar. It plans around
lunch and your existing meetings. When a meeting is with a customer you're booked on, that customer's
block is placed at the same time as the meeting.

Claude always shows you the plan first. Nothing is written to Outlook until you say yes, and WorkBook is
only ever read, never changed.

## What you need

- A WorkBook account
- Claude Code
- On **Windows**: **classic Outlook** (the desktop app, not "new Outlook" or the web version), running and
  signed in to the account whose calendar you want to use
- On a **Mac**:
  - your work calendar in the Calendar app. Add the account in **System Settings > Internet Accounts**
    with Calendars turned on. For Microsoft 365, choose "Microsoft Exchange". The events sync to Outlook
    from there, so it works whether you use Outlook or not.
  - PowerShell 7: `brew install powershell`
  - the Xcode Command Line Tools: `xcode-select --install`

  The first time, macOS asks whether your terminal may access your calendars. Choose **Allow**.

## Install

Copy the `plan-my-week` folder to your Claude skills folder:

```bash
cp -r skills/plan-my-week ~/.claude/skills/
```

On Windows that folder is `C:\Users\<you>\.claude\skills\`.

## Create a WorkBook API key

The skill reads your bookings with a personal API key. You only do this once, and again when the key
expires (keys last at most 3 months).

1. Log in to WorkBook.
2. Go to **Mine indstillinger > Login-indstillinger > Personlige API-nøgler** (your settings > login
   settings > personal API keys).
3. Create a new key and copy it.
4. Open **PowerShell** (Start menu > type "PowerShell") and run:

   ```powershell
   $k = Read-Host 'WorkBook API key' -AsSecureString
   [Environment]::SetEnvironmentVariable('WORKBOOK_API_KEY', [Net.NetworkCredential]::new('', $k).Password, 'User')
   ```

5. Paste the key when it asks, and press Enter. You won't see the key while you paste, which is on
   purpose.

On a Mac, do step 4 in **Terminal** instead, and run:

```bash
security add-generic-password -U -a "$USER" -s WORKBOOK_API_KEY -w
```

Paste the key twice when it asks. It's saved in your login keychain.

The key is saved only on your own computer: as a Windows environment variable, or in the macOS keychain.
Don't paste it into the chat with Claude.

If planning fails with "WorkBook rejected the API key (401)", the key has expired. Create a new one and
repeat steps 1–5.

## First use

Type `/plan-my-week` in Claude Code. The first time, Claude asks for:

- your WorkBook address, e.g. `https://yourcompany.workbook.net`
- the Outlook account to use (usually your email address). On a Mac, Claude lists the calendars in the
  Calendar app and asks which one is your work calendar.
- your working hours, if they differ from the default 37-hour week (Mon–Thu 7.5 h, Fri 7 h, from 08:00,
  lunch 12:00–12:30)

They're saved in `config.json` in the skill folder.

## Use

Type `/plan-my-week`, or say "plan my week". Claude then:

1. reads next week's bookings from WorkBook and your Outlook calendar
2. shows you a day-by-day plan
3. asks about anything unclear, e.g. "Does the meeting 'Acme: status' belong to the customer Acme A/S?"
   (your answer is remembered)
4. writes the events to Outlook once you approve

For another week, say e.g. "plan the week of November 2nd". You can adjust before approving: "leave out
Contoso" or "only 4 hours for Acme this week".

The events get the Outlook category **Workbook**. Running it again for the same week replaces those
events and never touches anything else in your calendar. On a Mac the events have no category. They're
recognised by the first line of their notes, "Planned from WorkBook (plan-my-week)", so leave that line in
place.
