---
description: Open a release PR from development/develop/dev into main/master with release notes built from the PRs merged since the last release, grouped into features, bug fixes and maintenance, and show it in the browser. Run as /release-pr, optionally with a version or notes.
argument-hint: [version or notes, e.g. "v2.4.0" or "includes the new checkout flow"]
disable-model-invocation: true
---

# Release PR

Extra input from the user (may be empty): **$ARGUMENTS**

Open (or update) a pull request that releases everything on the development branch to the production branch, with release notes. Nothing is committed; this works on the remote branches only. Running this command is the user's go-ahead to create the PR, so don't ask for confirmation unless something below says to stop.

## 1. Inspect

```bash
git fetch origin --prune --tags
git remote get-url origin
git status --porcelain=v1
```

- **Find the development branch**: the first of `development`, `develop`, `dev` that exists on origin (`git rev-parse --verify --quiet origin/<name>`). **Find the production branch**: `main` or `master`, whichever exists on origin. If either is missing, stop and ask.
- **Uncommitted or unpushed work** doesn't go into the release. If the working tree is dirty, or the local development branch is ahead of `origin/<dev>`, mention it in the report so the user knows it's not included. Don't touch it.
- **Anything to release?** `git log --oneline origin/<prod>..origin/<dev>`. If empty, stop and say production is already up to date.
- **Existing release PR**: `gh pr list --base <prod> --head <dev> --state open --json number,url`. If one is open, update it (step 4) instead of creating a new one.

## 2. Collect what's in the release

List the first-parent history that isn't on production yet, with full messages:

```bash
git log origin/<prod>..origin/<dev> --first-parent --format='%H%x1f%s%x1f%b%x1e'
```

Turn each entry into a release-note line:

- **Merge commit** (`Merge pull request #N from <owner>/<branch>`): the PR title is the first line of the body. Note the PR number and branch.
- **Squash merge** (`<title> (#N)`): the title and number are in the subject. Get the branch with `gh pr view N --json headRefName` if needed for grouping.
- **Direct commit** (no PR): use the subject as-is.

Group by branch prefix, falling back to the title wording when there's no branch:

| Group | Branches / titles |
| --- | --- |
| **Features** | `feature/`, `feat/` |
| **Bug fixes** | `bugfix/`, `fix/`, titles starting with `Fix` / `fix:` |
| **Maintenance** | `chore/`, `refactor/`, `docs/`, `deps/`, dependency bumps |
| **Already on production** | `hotfix/` back-merges: list them, but they're not new to production |
| **Other** | anything else |

Write each line as `- <PR title> (#N)`, cleaned up so it reads well for someone who wasn't in the PR: no branch names or `<area>:` noise unless that's useful context. Drop merge commits of `<prod>` into `<dev>`.

**Deploy heads-up**: scan `git diff --stat origin/<prod>...origin/<dev>` for changes that need care when deploying and list them: database migrations, config or settings files (`appsettings*.json`, `.env.example`, `web.config`, etc.), dependency manifests (`package.json`, `*.csproj`, `composer.json`, ...), CI/CD or infrastructure files. Leave the section out if there is nothing.

## 3. Version and title

- If `$ARGUMENTS` contains a version, use it.
- Otherwise, if the repo has version tags (`git tag --list --sort=-v:refname | head -5`), suggest the next one from the latest: **minor** bump if there are any features, **patch** if only fixes and maintenance, keeping the tag's format (`v1.2.3` vs `1.2.3`). Major bumps are never automatic.
- No version tags: use the date, `Release <YYYY-MM-DD>`.

Title: `Release <version>`. Use any other text in `$ARGUMENTS` as a one-line summary at the top of the body.

## 4. Create or update the PR

Body:

```markdown
<one-line summary of the release, if any>

## Features
- ...

## Bug fixes
- ...

## Maintenance
- ...

## Already on production
- ...

## Other
- ...

## Deploy heads-up
- ...

## After merging
Merge with a **merge commit** (not squash or rebase) so <prod> and <dev> keep a shared history.
Then tag the release: `git tag <version> origin/<prod> && git push origin <version>`
```

Leave out empty sections, and the tag line when there's no version.

**GitHub remote**: create with `gh pr create --base <prod> --head <dev> --title "<title>" --body-file -`, or update an existing release PR with `gh pr edit <N> --title "<title>" --body-file -`. Add `--label release` if the repo has that label. If gh isn't installed or authenticated, tell the user to install the [GitHub CLI](https://cli.github.com) and run `! gh auth login`.

**Azure DevOps remote** (`dev.azure.com` or `visualstudio.com`): PR titles come from the merge commit subjects there (`Merged PR N: <title>`). If `az repos` is available, use `az repos pr create --source-branch <dev> --target-branch <prod> --title ... --description ... --output json` (or `az repos pr update` for an existing one). Otherwise use the create page `<repo web url>/pullrequestcreate?sourceRef=<dev>&targetRef=<prod>` and give the user the title and description to paste.

**Other hosts** (Bitbucket, GitLab): open the host's "create PR/MR" page from `<dev>` into `<prod>` and give the user the title and description to paste.

## 5. Open in the browser

Open the PR URL in the default browser:

- **Windows**: `powershell.exe -NoProfile -Command "Start-Process '<pr url>'"`
- **macOS**: `open "<pr url>"`
- **Linux**: `xdg-open "<pr url>" >/dev/null 2>&1 &`

## 6. Report

Short summary: `<dev>` → `<prod>`, version, how many PRs per group, the deploy heads-ups, PR URL (and whether it was created or updated). Mention any local work that isn't included.
