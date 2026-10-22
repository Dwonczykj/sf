---
description: "Greenify a PR: turns on Auto-fix, runs a two-seat review (and Qodo's CLI on Qodo PRs) before each push around fix-bot-comments, and loops with stricter rounds until green with no open Qodo High or Medium."
---
Drive an open PR to fully green with fewer commit→wait-for-bot round-trips, by reviewing the diff with independent models *before* each push instead of only reacting to bot comments after.

Target PR: the arg ($ARGUMENTS), else the PR for the current branch (`gh pr view`).

## What this wraps

`fix-bot-comments` owns the mechanics — workspace + sync, per-comment verify/decide/fix, reply, resolve, and the green gate. This command adds a **pre-push review pass** in front of it so the diff is already clean when the bots run, cutting the number of loops.

## Flow

1. **Setup + sync.** Run `fix-bot-comments` Phase 0: find-or-create the worktree for the PR branch, sync remote ↔ local (ask before anything destructive), merge the base and resolve conflicts, push.

   **Turn on Auto-fix.** In the desktop app, call `mcp__ccd_pr__get_status`; if it doesn't report this PR, `mcp__ccd_pr__bind_pr` it, then `mcp__ccd_pr__set_monitor` to turn Auto-fix on, so the app wakes this session on CI failures, conflicts and new review comments. Skip it, and say so, when the PR is already bound to another session or the `ccd_pr` tools aren't there (CLI). Once it's on, don't poll CI or schedule wake-ups yourself.

   **Is this a Qodo PR?** It is when `qodo-code-review[bot]` has commented on this PR, or on the repo recently (it will review this one):

   ```bash
   gh api "repos/<OWNER>/<REPO>/issues/comments?sort=created&direction=desc&per_page=100" \
     --jq '[.[] | select(.user.login == "qodo-code-review[bot]")] | length'
   ```

   Non-zero, or a "Code Review by Qodo" comment on this PR → Qodo PR: the Qodo rules below apply. Otherwise skip every Qodo step.

2. **Pre-push review (the point of this command).** Before the first commit and before every later push, review the current diff vs the PR base with two independent models, read-only, in parallel: seats 1 and 3 of the **`review-seat`** panel (Codex and Cursor where installed; `review-seat` falls back to Claude models and says so). Diff to hand them: `git diff origin/<baseRef>...HEAD`. For a high-stakes fix, pass `--reviewCursor claude-sonnet-5-high` to its resolver.

   The prompt asks each seat to find the correctness bugs, unhandled cases, and reuse/simplification issues Cursor Bugbot / Codex-connector would flag, and to end with a verdict line; `review-seat` appends the read-only fence. On later rounds re-run both fresh against the updated diff.

   Reconcile: raised by **both** → treat as real; raised by **one** → verify against the code yourself before acting (models are reviewers, not oracles — same discipline as `fix-bot-comments`). Then apply the Phase 3 decision rule from `fix-bot-comments` (redesign in scope > fix if the trade-off is worth it > decline), fix the real ones, commit, and push once — so the diff the bots see is already addressed.

   **Qodo pre-push check (Qodo PRs only).** After committing and before pushing, run the local Qodo reviewer, the same engine as the PR bot, exactly as `pre-pr-gate` Pass E sets out (probe `command -v qodo` and `qodo read whoami --json`; `--base origin/<baseRef>`; context on stdin; nothing written inside the worktree; long timeout or background). Don't push while it reports an introduced or still-open **High or Medium** finding that you haven't either fixed or refuted against the code (a finding with no severity counts as Medium). Low findings follow the normal decision rule. Fix, commit, re-run (it is incremental), repeat. If the CLI is missing, logged out or errors (`repo_not_connected`, `closed_preview`, rate limit), quote the reason, push anyway, and rely on the post-push check in step 5.

3. **fix-bot-comments loop.** Now run `fix-bot-comments` on the PR for whatever the bots still post: it verifies each claim, decides, fixes, replies, resolves, re-checks, and loops. Before each of *its* pushes, re-run the step-2 pre-push review on the new diff.

4. **"Too-long — did not fix" comment.** Every finding you verified as **real** but deliberately did **not** fix (out of scope for this PR, or the fix's complexity isn't worth the maintenance/review cost) goes into a single top-level PR comment, created once and updated as the list grows:

   ```bash
   gh pr comment <PR> --repo <OWNER>/<REPO> --body-file <file>
   ```

   Body starts with the heading `## Too-long - did not fix`, then one bullet per item: `file:line — <the finding> — <why not fixed: out-of-scope / trade-off too costly>`. This is the honest audit trail of real-but-declined findings; the per-thread replies still explain each decline individually.

5. **Green gate.** Stop only when every PR check is green and no thread needs attention (`Typecheck`/`Build` queued behind the staging→main guard counts as green). The PR must be green by the end.

   On a Qodo PR, also wait for Qodo's review of the latest push: it edits one "Code Review by Qodo" comment per commit, grouping issues under High / Medium / Low badges and striking through resolved ones. The PR is not done while that comment lists an unresolved **High or Medium** issue, unless you refuted it against the code and replied on its thread with the evidence (never hand-resolve a Qodo thread; Qodo marks that "Dismissed"). Each unresolved one sends you round the loop again.

## Escalating rounds

A round is one push. Every extra round costs a full bot pass, so each round past the second is stricter than the last. Count rounds from this command's first push and say the round number in each status line.

- **Rounds 1–2:** the flow as written.
- **Round 3:** add seat 2 to the pre-push review (the full three-seat panel), and run Qodo with `--full` once so it re-reviews the whole diff, not only what changed.
- **Round 4:** before touching code, write down, per finding still open, why the last fix didn't hold. A finding that came back, or a new finding on lines you just changed, means patching is the wrong move: redesign that part (Phase 3, option 1) instead of adding another guard.
- **Round 5:** send the findings still open to `discussion-room` for redesign options and a recommendation, apply the one it picks, and push only once all three seats and Qodo pass the diff.
- **Round 6 and on:** show me each finding still open, what was tried, and the options, and ask, then carry on with my answer. Round count alone never ends the loop; it ends only at the green gate.

## Judgement rule

When you're unsure whether a real finding is worth fixing — the fix adds more code/complexity than this PR warrants — don't silently fix and don't silently skip. Show me the finding and the trade-off and ask, then record the decline in the "Too-long — did not fix" comment if we skip it. Escalate genuinely contested or out-of-diff calls to `discussion-room` for options + a recommendation. Update `progress.md` if this is part of a factory run.
