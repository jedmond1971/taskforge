# Release controls — branch protection on `main` (SECH-102)

`main` is a protected branch. Railway auto-deploys every commit that lands on `main`, so protection is what stops a red build from reaching production.

## What is enforced

Classic branch protection on `jedmond1971/taskforge` → `main`:

| Setting | Value | Why |
|---|---|---|
| Required status checks | `Verify`, `Integration (cross-tenant)`, `Secret scan` (GitHub Actions app, id 15368) | Jobs in `.github/workflows/ci.yml`. Job `name:` values **are** the check contexts — renaming a job silently un-requires it until protection is updated. `Dependency audit` (SECH-104) also runs on every PR but is **not yet required** — see below. |
| Require branch up to date (`strict`) | on | The checks must have run against the current `main`, not a stale base. |
| Require a pull request | on, 0 approvals | Solo developer — an approval requirement would make every PR unmergeable. The PR exists so checks run *before* the commit reaches `main`. |
| Include administrators (`enforce_admins`) | **on** | Claude Code pushes as `jedmond1971`, the repo admin. With this off, protection would apply to nobody. |
| Force pushes / deletion | blocked | |

When a new CI job becomes a release gate, add its job name to the required contexts. `PATCH …/required_status_checks` **replaces** the list, so pass every existing context too:

```bash
gh api -X PATCH repos/jedmond1971/taskforge/branches/main/protection/required_status_checks \
  -F strict=true -f 'contexts[]=Verify' -f 'contexts[]=Integration (cross-tenant)' -f 'contexts[]=Secret scan' -f 'contexts[]=<New job name>'
```

A job can only be added to the required list **after it has run at least once on `main`** — GitHub will not accept a context it has never seen. So a new gate ships in two steps: merge the PR that adds the job, then patch protection.

### Pending: `Dependency audit` (SECH-104)

The job exists in `ci.yml` and runs on every PR, but it is **not** in the required contexts yet, so a red audit does not currently block a merge. To finish the gate:

```bash
gh api -X PATCH repos/jedmond1971/taskforge/branches/main/protection/required_status_checks \
  -F strict=true -f 'contexts[]=Verify' -f 'contexts[]=Integration (cross-tenant)' -f 'contexts[]=Secret scan' -f 'contexts[]=Dependency audit'
```

Then confirm with `gh api repos/jedmond1971/taskforge/branches/main/protection --jq .required_status_checks.contexts`. Changing branch protection is a repo-admin action — Claude Code must have Jamie's approval in the session before running it.

Inspect current state: `gh api repos/jedmond1971/taskforge/branches/main/protection`.

## Normal workflow (replaces direct `git push` to `main`)

```bash
git switch -c <issue-key-lowercase>-<short-slug>      # e.g. sech-104-audit-gate
# ...commit as usual, pre-commit checklist unchanged...
git push -u origin HEAD
gh pr create --base main --fill                         # title/body: issue key + summary
gh pr checks --watch                                     # wait for Verify + Integration
gh pr merge --squash --delete-branch                     # refused by GitHub until checks are green
git switch main && git pull --ff-only
```

- `git push origin main` is rejected (`GH006: Protected branch update failed`). That's expected — open a PR.
- If `main` moved while the PR was open, `strict` blocks the merge until the branch is updated: `gh pr update-branch` (re-runs CI), then merge.
- **`gh pr edit --body` silently fails on this repo** (it prints a classic-Projects GraphQL deprecation error and doesn't save). Edit a PR body with `gh api -X PATCH repos/jedmond1971/taskforge/pulls/<n> -F body=@body.md` instead. `create`, `ready`, `checks` and `merge` work normally.
- Dependabot PRs go through the same gate; merge them with `gh pr merge --squash` once green.
- Railway deploys from the merge commit on `main`, so the "After pushing" CI/Railway monitoring in CLAUDE.md applies after `gh pr merge`, not after the branch push.

## Break-glass (emergency only)

Use only when production is broken and the fix can't wait for CI (e.g. CI itself is broken by an outside outage) — never to skip a failing test.

1. Temporarily lift admin enforcement:
   `gh api -X DELETE repos/jedmond1971/taskforge/branches/main/protection/enforce_admins`
2. Push or merge the fix.
3. **Immediately** re-enable it:
   `gh api -X POST repos/jedmond1971/taskforge/branches/main/protection/enforce_admins`
   and confirm `gh api repos/jedmond1971/taskforge/branches/main/protection --jq .enforce_admins.enabled` prints `true`.
4. Record the exception as a comment on the related SECH/JFR issue: time window, commit SHA(s), reason, who approved (Jamie), and a follow-up issue if CI still needs repair.
5. Let CI run on the resulting `main` commit and fix forward if it goes red.

Claude Code must not use break-glass without Jamie's explicit approval in the current session.
