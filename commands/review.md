---
description: "Factory review: gate a built branch pre-PR, then loop CI + bot comments to green."
---
Run the software-factory review phase via the `review-feature` skill.

Target: the current worktree/branch, or the PR number/URL / slug in the arg ($ARGUMENTS). Use `.scratch/<slug>/requirements.md` (scoped to this slice) as the acceptance contract.

`review-feature` owns the whole loop:
- Stage 1 — gate the branch pre-PR via `pre-pr-gate`: three passes (solution-vs-requirements, code quality, test-mock scrutiny), each run by Codex + Gemini + Cursor, plus the real checks (lint / prettier / targeted typecheck / jest), cap 4 rounds. The loop runs on the branch, not on a PR someone is watching.
- On Stage 1 RELEASE the main session opens the PR per `create-pr` (base `staging`, assignee Dwonczykj, four-heading body — Problem / Changes / Testing / Risks — plus the Linear line, or the `skip-template` label).
- Stage 2 — loop CI checks + `fix-bot-comments` until green with every thread resolved (or use `sf:ci-green` for just this stage).

Stay-hot — only if `--stay-hot` is in the args (strip it before target inference; if the flag is absent, skip this whole paragraph). Whenever a gate pass or bot-fix step surfaces a required code fix, score that fix 1–5 (whole number, 5 = "absolutely yes a human should write it") on blast-radius + inverted fix-confidence. Take the single highest-scoring fix in that pass; only if it reaches 5, I write the fix myself — pause and block the loop until I've done it, then continue. At most one hand-off per pass. Append one tab-separated line to `~/.claude/sf-stay-hot.log`: `<ISO-date>	<slug>	review	<score>	<fix summary>`.

Escalate out-of-diff or contested findings to `discussion-room` for options + a recommendation before choosing a fix. Anything the contract doesn't cover comes back to me. It never opens the PR by itself beyond the create-pr step above. Update `progress.md`.
