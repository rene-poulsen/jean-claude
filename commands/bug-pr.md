---
description: Move the current bug-fix changes onto a fresh bugfix branch cut from development/develop/dev, commit them with a message that explains the bug and the fix, push, open a pull request and show it in the browser. Run as /bug-pr <the bug and what caused it>.
argument-hint: <bug description, e.g. "checkout button does nothing on Safari because the click handler uses optional chaining on an old target">
disable-model-invocation: true
---

# Bug PR

Bug description from the user: **$ARGUMENTS**

Take the uncommitted changes in the current repo (a bug fix), put them on a new branch based on the team's development branch, commit, push, open a PR and show it in the browser. Running this command is the user's go-ahead to push and create the PR, so don't ask for confirmation unless something below says to stop.

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
- **Find the base branch**: the first of `development`, `develop`, `dev` that exists, checking `origin/<name>` first (`git rev-parse --verify --quiet origin/<name>`), then the local branch. If none exist, stop and ask which branch to use.
- **Local commits**: if the current branch is not the base and has commits that aren't on the base (`git log --oneline origin/<base>..HEAD`) and aren't pushed anywhere, list them and ask whether they should be cherry-picked onto the new branch too. Don't decide this alone.
- **Look at what is being committed**: read `git diff HEAD` and the untracked files. If something looks like it doesn't belong (`.env`, credentials, secrets, build output, large binaries, debug leftovers such as `console.log` added while hunting the bug, stray scratch files), stop and ask before including it. If changes clearly go beyond fixing this bug, point that out and ask whether to include them all.
- **Understand the fix**: from the description and the diff, work out (1) the symptom, what the user saw, (2) the cause, why it happened, and (3) what the change does about it. If the diff doesn't seem to address the described bug, say so and ask before going on.

## 2. Name things

Use the bug description **and** the actual diff. If `$ARGUMENTS` is empty, infer the bug from the diff alone.

- **Branch**: `bugfix/<short-kebab-summary>` naming the bug, not the fix. 3-6 lowercase words, ASCII only (æ→ae, ø→oe, å→aa, ü→ue, etc.), max ~50 chars. E.g. `bugfix/safari-checkout-button-dead`. If the name already exists locally or on origin, add a short distinguishing word rather than a number.
- **Commit subject**: imperative, max 72 chars, no trailing period, starts with `Fix` and names the symptom (e.g. `Fix checkout button not responding in Safari`). Follow the repo's existing convention if `git log` shows one (Conventional Commits `fix:`, ticket prefixes, `<area>: ` prefixes, etc.).
- **Commit body**: blank line, then 2-6 short lines: the symptom, the cause, and what was changed to fix it. Wrap at 72 chars. No filler.
- **Language**: English, unless the repo's recent commit history is clearly written in another language.
- End the commit message and the PR body with the attribution lines from the current system-reminder, if any.

## 3. Branch and carry the changes over

```bash
git stash push --include-untracked -m "bug-pr: <branch>"
git switch -c <branch> origin/<base>      # or <base> if it only exists locally
git stash pop
```

If `stash pop` reports conflicts (the changes don't apply cleanly on the base), stop: leave the stash in place (it isn't dropped on conflict), tell the user which files conflict and which branch they were on, and don't commit.

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

## 6. Create the PR

**GitHub remote** (`github.com` in the origin URL). Add `--label bug` if the repo has that label (`gh label list --search bug`):

```bash
gh pr create --base <base> --head <branch> --title "<commit subject>" --body-file - <<'EOF'
## Bug
<what went wrong, from the user's point of view>

**Steps to reproduce**
1. <where / which device or browser>
2. <what to do>
3. <what happens instead of the expected result>

## Cause
<why it happened, pointing at the code>

## Fix
<what changed, bullets>

## How to verify
<repeat the steps above and what should happen now; note anything nearby worth a regression check>
EOF
```

Leave out a reproduction step you can't work out from the description and the diff rather than inventing it. `gh pr create` prints the PR URL. If gh isn't installed or authenticated, tell the user to install the [GitHub CLI](https://cli.github.com) and run `! gh auth login`.

**Azure DevOps remote** (`dev.azure.com` or `visualstudio.com`): if `az repos` is available, use `az repos pr create --source-branch <branch> --target-branch <base> --title ... --description ... --output json` and take the web URL from the result. Otherwise skip creating it and use the create page: `<repo web url>/pullrequestcreate?sourceRef=<branch>&targetRef=<base>`, and give the user the title and description to paste.

**Other hosts** (Bitbucket, GitLab): open the host's "create PR/MR" page for the branch and give the user the title and description to paste.

## 7. Open in the browser

Open the PR URL in the default browser:

- **Windows**: `powershell.exe -NoProfile -Command "Start-Process '<pr url>'"`
- **macOS**: `open "<pr url>"`
- **Linux**: `xdg-open "<pr url>" >/dev/null 2>&1 &`

## 8. Report

Short summary: base branch, new branch, commit subject, PR URL. Mention anything that was left out or needs attention.
