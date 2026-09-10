---
name: review-feature
description: Drive an already-built change from "code exists" to "green and releasable" — a build↔verify loop that gates the branch before the PR opens (via pre-pr-gate, three passes reviewed by Codex, Gemini, and Cursor), then keeps looping on CI checks and review-bot comments (via fix-bot-comments) until checks pass and every thread is resolved. Takes a worktree/branch, or an already-open PR number/URL. Use when the user says "review this feature", "/review-feature", "loop on this until it's green", "get this PR releasable", or as the review phase of /start-feature and solve-in-worktrees. Never opens the PR itself.
user_invocable: true
---

# review-feature

The review half of the factory, on its own: something is built, and this loops on it
until it is releasable. Two stages, same loop shape — verify, hand the real findings to
whoever can fix them, re-verify.

**This skill owns the loop, not the checks.** `pre-pr-gate` owns the pre-PR gate
(code gates, comments review, `diff-review`, the three verify passes run by Codex, Gemini, and Cursor) and
`fix-bot-comments` owns bot-claim triage. Don't restate either here; invoke them.

## Inputs

Resolve the target and the contract before looping.

1. **Target** — one of:
   - a worktree path or branch with the change built and committed → start at Stage 1;
   - a PR number/URL → the gate has effectively been skipped, so still run Stage 1
     against `origin/<base>...origin/<head>`, then Stage 2. Say you're doing that.
   - nothing given → default to cwd's branch.
2. **Contract** — the numbered requirements list every finding is judged against.
   `.scratch/<slug>/requirements.md` if it exists, else a list already in the session,
   else **stop and ask** (offer to derive a provisional one from the branch name +
   `git log <base>..HEAD` for the user to confirm). Do not invent scope —
   an incomplete contract is faithfully shipped incomplete
   (`feedback-verifier-contract-scope`).
3. **Fixer** — a build agent still running from the build phase (fix via `SendMessage`,
   its context is intact and cheaper than a fresh spawn), or inline edits if there
   isn't one. Sub-agents can't `git push`; the main session pushes.

## Stage 1 — Gate the branch (pre-PR)

Run **`/pre-pr-gate`** on the target with the contract. It loops
checks → 3 passes × 3 models (Codex + Gemini + Cursor, 9 concurrent) → reconcile → fix →
re-check, capped at 4 rounds, and emits either a readiness report or a list of what's
contested.

If the target arrived without the test work — no `solve-in-worktrees` Phase 3b run, or a
branch handed straight to this skill — run that trio (T1 test-requirement gathering, T2
create, T3 update) before Stage 1's first verify, so Pass C is critiquing tests rather
than their absence. Note the weaker oracle and say so in the report: on a branch that
already exists, T1 has only the diff feed, so its tests are shaped by the implementation
they check, which is exactly what running them from the plan is meant to avoid.

Two things this skill adds around it:

- **Route complex findings through `discussion-room` first.** A finding whose fix would
  change scope beyond this PR's diff, or that has several defensible approaches, gets
  options and a recommendation from the room before anyone edits code. The room is
  advisory: it never blocks, and a `Needs human` verdict comes to you as a question.
- **Surface ambiguities and out-of-contract bugs back to the user.** Sub-agents and
  verifiers talk only to you. Anything the contract doesn't answer — a real bug in
  existing code, a requirement readable two ways, a slice that can't be built as
  scoped — comes back as a clarifying question before the next round. Don't let an
  agent guess and don't silently pick for it. Answers that change scope get written
  into `requirements.md` (re-sign-off if material) so every later pass tests the same
  contract; bugs ruled out of scope get one line saying so.
- **On RELEASE, stop for the push.** Opening a PR is outward-facing: the main session
  pushes and opens it per `create-pr` (base `staging`, assignee `Dwonczykj`) once the
  user has given the go-ahead. If the PR is already open, push the fixes and continue.

## Stage 2 — Loop until green with no bot comments

Per PR, keep going until `gh pr checks` passes and every bot thread is fixed-or-answered
and resolved.

```bash
gh pr checks <PR> --repo Fyxer-AI/web-app
gh api repos/Fyxer-AI/web-app/pulls/<PR>/comments --paginate \
  -q '.[] | "ID:\(.id)\nUSER:\(.user.login)\nPATH:\(.path):\(.line)\nBODY:\(.body)\n---"'
gh api repos/Fyxer-AI/web-app/issues/<PR>/comments --paginate \
  -q '.[] | "USER:\(.user.login)\nBODY:\(.body[0:800])\n---"'
```

For every failing check or bot comment, run **`fix-bot-comments`**' method: verify the
claim against the real code first (real / not worth fixing / stale / wrong, with
evidence), hand only the real ones to the fixer, re-run the relevant code gates, push,
re-check, reply per thread with the verdict, resolve.

"Not worth fixing" is a legitimate resolution, not a comment to eliminate by fixing.
Green means every thread is fixed-or-answered-and-resolved, not that every finding was
coded. If guarding a flagged edge case costs more code than the edge case costs in
practice, decline it with a one-line reason and resolve — don't grow the PR to zero out
the bot.

A gated PR should arrive with **no** bot findings. Ones that appear are signal that a
Stage 1 pass missed something — note which pass (A contract, B quality, C tests) and which model would
have caught it (or that none of the three did) in the final report, so the gate gets better rather than just the PR.

Known non-failures — don't chase:

- `Typecheck` and `Build` sit **queued** behind the `Block if staging → main PR is open`
  guard. Queued or missing is expected, not failed; `Test all workspaces` +
  `Integration tests` are the ones that must pass.
- Pre-existing lint warnings in files the PR doesn't touch.

Cap at 4 push↔recheck rounds. Beyond that, stop and report what's contested rather than
grinding — a check that won't go green after four honest fixes is usually flaky
infrastructure or a wrong requirement, not code.

## Done

```
✅ releasable — <branch> / PR <url>
- gate: RELEASE (Pass A <n>/<n>, B, C — Codex + Gemini + Cursor)  |  rounds <k>/4
- checks: <green | which are queued-by-design>
- bot threads: <n> real fixed, <n> refuted+answered, all resolved
- gate misses: <none | "<finding> — Pass C should have caught this; no model raised it">
- left deliberately: <none | …>
```

On merge, run `linear-update-issue-on-pr-merge`; keep worktrees until merged, then
`prune-merged-worktrees`.
