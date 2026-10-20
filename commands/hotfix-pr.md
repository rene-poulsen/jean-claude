---
description: Ship an urgent fix to production - move the current changes onto a hotfix branch cut from main/master, commit with a message that explains the bug and the fix, push, open a PR to main plus a back-merge PR to development, and show them in the browser. Run as /hotfix-pr <the bug and what caused it>.
argument-hint: <bug description, e.g. "payment page crashes for logged-out users because the session is read before the null check">
disable-model-invocation: true
---

# Hotfix PR

Bug description from the user: **$ARGUMENTS**

Take the uncommitted changes in the current repo (an urgent fix for what's live), put them on a hotfix branch based on the production branch, commit, push, and open two PRs: one into production and one that brings the fix back into the development branch, so it isn't lost at the next release. Running this command is the user's go-ahead to push and create the PRs, so don't ask for confirmation unless something below says to stop.

## 1. Inspect

Run these together:

```bash
git status --porcelain=v1 -uall
git branch --show-current
git remote get-url origin
git fetch origin --prune
git log -10 --format='%s'
```

- **No changes** (empty status): stop and tell the user there is nothing to put in a PR.
- **Find the production branch**: `main` or `master`, whichever exists, checking `origin/<name>` first (`git rev-parse --verify --quiet origin/<name>`), then the local branch. If neither exists, stop and ask which branch is live.
- **Find the development branch**: the first of `development`, `develop`, `dev` that exists, the same way. If none exists, skip the back-merge PR in step 6 and mention it in the report.
- **Local commits**: if the current branch has commits that aren't on the production branch (`git log --oneline origin/<prod>..HEAD`) and aren't pushed anywhere, list them and ask whether they belong in the hotfix. Don't decide this alone. Commits that are only on the development branch must not be carried into a hotfix.
- **Look at what is being committed**: read `git diff HEAD` and the untracked files. If something looks like it doesn't belong (`.env`, credentials, secrets, build output, large binaries, debug leftovers such as `console.log` added while hunting the bug, stray scratch files), stop and ask before including it. A hotfix should be as small as possible: if the changes go beyond fixing this bug, point that out and ask whether to include them.
- **Understand the fix**: from the description and the diff, work out (1) the symptom, what users saw, (2) the cause, and (3) what the change does about it. If the diff doesn't seem to address the described bug, say so and ask before going on.

## 2. Name things

Use the bug description **and** the actual diff. If `$ARGUMENTS` is empty, infer the bug from the diff alone.

- **Branch**: `hotfix/<short-kebab-summary>` naming the bug. 3-6 lowercase words, ASCII only (æ→ae, ø→oe, å→aa, ü→ue, etc.), max ~50 chars. E.g. `hotfix/payment-page-crash-logged-out`. If the name already exists locally or on origin, add a short distinguishing word rather than a number.
- **Commit subject**: imperative, max 72 chars, no trailing period, starts with `Fix` and names the symptom (e.g. `Fix payment page crash for logged-out users`). Follow the repo's existing convention if `git log` shows one (Conventional Commits `fix:`, ticket prefixes, `<area>: ` prefixes, etc.).
- **Commit body**: blank line, then 2-6 short lines: the symptom, the cause, and what was changed to fix it. Wrap at 72 chars. No filler.
- **Language**: English, unless the repo's recent commit history is clearly written in another language.
- End the commit message and the PR bodies with the attribution lines from the current system-reminder, if any.

## 3. Branch and carry the changes over

```bash
git stash push --include-untracked -m "hotfix-pr: <branch>"
git switch -c <branch> origin/<prod>      # or <prod> if it only exists locally
git stash pop
```

If `stash pop` reports conflicts (the fix was written against code that isn't live yet), stop: leave the stash in place (it isn't dropped on conflict), tell the user which files conflict and which branch they were on, and don't commit. The fix needs to be redone against the production code.

## 4. Commit

Stage the files reviewed in step 1 (`git add -A` if everything belongs, otherwise the specific paths) and commit with a heredoc so the body keeps its line breaks:

```bash
git commit -F - <<'EOF'
<subject>

<body>
EOF
```

If a pre-commit hook fails, fix the reported issue if it is trivial and caused by these changes, otherwise stop and report. Never use `--no-verify`.

## 5. Push

```bash
git push -u origin <branch>
```

## 6. Create the PRs

**GitHub remote** (`github.com` in the origin URL). Add `--label bug` to both if the repo has that label (`gh label list --search bug`).

The hotfix PR into production:

```bash
gh pr create --base <prod> --head <branch> --title "Hotfix: <commit subject>" --body-file - <<'EOF'
## Bug
<what went wrong for users in production>

**Steps to reproduce**
1. <where / which device or browser>
2. <what to do>
3. <what happens instead of the expected result>

## Cause
<why it happened, pointing at the code>

## Fix
<what changed, bullets; keep it small>

## How to verify
<repeat the steps above and what should happen now>

## After merging
Deploy <prod>, then merge the back-merge PR into <dev> so the fix is in the next release.
EOF
```

The back-merge PR (skip if there is no development branch). It uses the same hotfix branch, so both PRs carry exactly the same commit:

```bash
gh pr create --base <dev> --head <branch> --title "Back-merge: <commit subject>" --body-file - <<'EOF'
Brings hotfix #<hotfix PR number> into <dev> so it isn't lost at the next release. Same commit as the hotfix PR; review there.
EOF
```

If GitHub reports the back-merge PR has conflicts, keep it and tell the user they need to resolve the conflicts in that PR (GitHub's editor or locally) before merging it.

Leave out a reproduction step you can't work out from the description and the diff rather than inventing it. `gh pr create` prints each PR URL. If gh isn't installed or authenticated, tell the user to install the [GitHub CLI](https://cli.github.com) and run `! gh auth login`.

**Azure DevOps remote** (`dev.azure.com` or `visualstudio.com`): if `az repos` is available, use `az repos pr create --source-branch <branch> --target-branch <prod|dev> --title ... --description ... --output json` for each PR and take the web URLs from the results. Otherwise use the create pages: `<repo web url>/pullrequestcreate?sourceRef=<branch>&targetRef=<prod|dev>`, and give the user the titles and descriptions to paste.

**Other hosts** (Bitbucket, GitLab): open the host's "create PR/MR" pages for the branch into each target and give the user the titles and descriptions to paste.

## 7. Open in the browser

Open the hotfix PR in the default browser:

- **Windows**: `powershell.exe -NoProfile -Command "Start-Process '<pr url>'"`
- **macOS**: `open "<pr url>"`
- **Linux**: `xdg-open "<pr url>" >/dev/null 2>&1 &`

## 8. Report

Short summary: production branch, hotfix branch, commit subject, both PR URLs. Remind the user to merge the back-merge PR after the hotfix is deployed. Mention anything that was left out or needs attention.
