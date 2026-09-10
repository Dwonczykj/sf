---
name: linear-update-issue-on-pr-merge
description: When a PR has been merged to staging, find the linked Linear issue (in the Context Pod Q2 2026 project) and update it — for Fyxer-AI/web-app a staging merge moves the issue to "Done", and add a comment with the PR link. Use when the user says "I merged the PR", "PR is in staging", "update the Linear ticket for this PR", or asks to sync a merged PR back to Linear.
---

# Update Linear issue when PR merged to staging

When a PR is merged (typically into `staging`), find the matching Linear issue in the Context Pod Q2 2026 project and update its status + add a comment with the PR link.

## Fixed context

- **Project**: Context Pod Q2 2026 (id `d87bb3b5-a155-485b-975b-f6c4bfabad5c`)
- **Team**: Product Engineering, key `PRE`

## How to find the Linear issue ID

Try in order, stop at first hit:

1. **PR title / branch name**: look for a `PRE-\d+` identifier. Branch names follow `<author-prefix>/<slug>` style — they often don't carry the ID, so prefer the PR title / body.
2. **PR body**: grep the PR description for `PRE-\d+` or a `linear.app/fyxer-ai/issue/PRE-...` URL.
3. **Recent commits on the branch**: `git log --format=%B origin/staging..HEAD` (or the merged range) and grep for `PRE-\d+`.
4. If still nothing, ask the user for the issue ID — do not guess.

If the user supplies the PR URL directly, fetch it with `gh pr view <url> --json title,body,headRefName,url,number,mergedAt,mergeCommit`.

## Steps

1. Resolve the PR (URL from user, or `gh pr view` on current branch) and extract `PRE-\d+`.
2. Call `get_issue` with that identifier to confirm it's in the Context Pod project. If the project id is **not** `d87bb3b5-a155-485b-975b-f6c4bfabad5c`, warn the user and ask before proceeding — this skill is scoped to Context Pod.
3. Decide target status:
   - **Fyxer-AI/web-app PR merged to `staging`** → **Done** (state id `c481e20d-b954-44f4-a793-52472cf48279`, type `completed`). Web-app deploys staging→production automatically, so a staging merge counts as done for this repo.
   - PR merged to `main` / production (any repo) → **Done** (state type `completed`).
   - Any other repo merged to `staging` → a `type: "started"` state ("Awaiting deploy", "Code Review") — list `list_issue_statuses` for team `PRE` and pick the closest; if unclear, ask the user.
4. Call `save_issue` with `id: <issue id>` and `state: <state id or name>`.
5. Call `save_comment` on the issue with a short body like:
   ```
   Merged to staging: [PR #1234](https://github.com/.../pull/1234)
   ```
   (Use real newlines, no escape sequences.)
6. Report the issue identifier, the new status, and link to both the issue and the PR.

## Notes

- Tool names on this machine are prefixed `mcp__ac8e4a0b-1ec5-4ab5-8b10-e46579796632__` — search with `ToolSearch` for `save_issue`, `get_issue`, `list_issue_statuses`, `save_comment` if not already loaded.
- For **Fyxer-AI/web-app**, a staging merge moves the issue to **Done** (staging auto-deploys to production). Do not hold issues in an intermediate state for this repo. For other repos, staging is not production — keep them in a `started` state and only move to Done on a `main`/production merge.
- Never move an issue to Cancelled automatically.
- If multiple `PRE-\d+` IDs appear in the PR, ask the user which one is primary rather than updating all silently.
