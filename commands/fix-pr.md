---
description: "Greenify a PR: pre-emptive Codex+Cursor review before each push wrapped around fix-bot-comments, looping to fully green."
---
Drive an open PR to fully green with fewer commit→wait-for-bot round-trips, by reviewing the diff with independent models *before* each push instead of only reacting to bot comments after.

Target PR: the arg ($ARGUMENTS), else the PR for the current branch (`gh pr view`).

## What this wraps

`fix-bot-comments` owns the mechanics — workspace + sync, per-comment verify/decide/fix, reply, resolve, and the green gate. This command adds a **pre-push review pass** in front of it so the diff is already clean when the bots run, cutting the number of loops.

## Flow

1. **Setup + sync.** Run `fix-bot-comments` Phase 0: find-or-create the worktree for the PR branch, sync remote ↔ local (ask before anything destructive), merge the base and resolve conflicts, push.

2. **Pre-push review (the point of this command).** Before the first commit and before every later push, review the current diff vs the PR base with two independent models, read-only, in parallel. Diff to hand them: `git diff origin/<baseRef>...HEAD`.

   Codex — `mcp__codex__codex { cwd: "<worktree>", sandbox: "read-only", approval-policy: "never", prompt: "<review prompt>" }` (keep the `threadId` for `codex-reply` on later rounds).

   Cursor — `echo "<the same review prompt, verbatim>" | node ${CLAUDE_PLUGIN_ROOT}/skills/cursor-agent/scripts/run-agent.mjs --model claude-opus-5-high --cwd <worktree> --timeout 900`

   The prompt asks each model to find the correctness bugs, unhandled cases, and reuse/simplification issues Cursor Bugbot / Codex-connector would flag, and to end with a verdict line. Append, verbatim (Cursor isn't sandboxed): *review only — do not edit, create, or delete any file; do not run build/test/typecheck/lint commands or execute code to test a hypothesis; if a shell command is rejected, don't retry it, just note that and continue with what's already visible; output findings and a verdict line.* On later rounds re-run Cursor fresh against the updated diff; continue Codex on `codex-reply`.

   Reconcile: raised by **both** → treat as real; raised by **one** → verify against the code yourself before acting (models are reviewers, not oracles — same discipline as `fix-bot-comments`). Then apply the Phase 3 decision rule from `fix-bot-comments` (redesign in scope > fix if the trade-off is worth it > decline), fix the real ones, commit, and push once — so the diff the bots see is already addressed.

3. **fix-bot-comments loop.** Now run `fix-bot-comments` on the PR for whatever the bots still post: it verifies each claim, decides, fixes, replies, resolves, re-checks, and loops. Before each of *its* pushes, re-run the step-2 pre-push review on the new diff.

4. **"Too-long — did not fix" comment.** Every finding you verified as **real** but deliberately did **not** fix (out of scope for this PR, or the fix's complexity isn't worth the maintenance/review cost) goes into a single top-level PR comment, created once and updated as the list grows:

   ```bash
   gh pr comment <PR> --repo <OWNER>/<REPO> --body-file <file>
   ```

   Body starts with the heading `## Too-long - did not fix`, then one bullet per item: `file:line — <the finding> — <why not fixed: out-of-scope / trade-off too costly>`. This is the honest audit trail of real-but-declined findings; the per-thread replies still explain each decline individually.

5. **Green gate.** Stop only when every PR check is green and no thread needs attention (`Typecheck`/`Build` queued behind the staging→main guard counts as green). The PR must be green by the end.

## Judgement rule

When you're unsure whether a real finding is worth fixing — the fix adds more code/complexity than this PR warrants — don't silently fix and don't silently skip. Show me the finding and the trade-off and ask, then record the decline in the "Too-long — did not fix" comment if we skip it. Escalate genuinely contested or out-of-diff calls to `discussion-room` for options + a recommendation. Update `progress.md` if this is part of a factory run.
