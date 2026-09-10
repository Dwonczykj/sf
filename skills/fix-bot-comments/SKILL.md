---
name: fix-bot-comments
description: Verify, fix, and resolve automated bot review comments on a GitHub PR (Cursor Bugbot, ChatGPT Codex connector, CodeRabbit, etc.). Independently confirms each bot claim against the actual code before fixing — never trusts the bot — then classifies each as real / not-worth-fixing / stale, fixes the real ones, verifies, pushes, replies per comment, and resolves the threads. Use when the user asks to "check/verify/fix the bot comments on this PR", pastes a PR URL with bot review comments, or asks whether a PR's automated review findings are real.
user_invocable: true
---

# fix-bot-comments

Triage automated review-bot comments on a PR. **The core discipline: verify every claim against the real code before acting. Bots produce confident false positives — treat each comment as a hypothesis to confirm or refute, not an instruction.**

## When to use

- "Are the bot comments on this PR real? If so, fix them and push."
- A PR URL is shared with comments from `cursor[bot]`, `chatgpt-codex-connector[bot]`, `coderabbitai[bot]`, `github-actions[bot]`, etc.
- "Resolve the Bugbot findings."

## Inputs

A PR number or URL. Derive `OWNER`, `REPO`, `PR` (e.g. `Fyxer-AI/web-app` #`10071`). If only a diff anchor URL is given, the PR number is in the path (`/pull/<PR>/`).

## Goal

**Greenify the PR.** By the end of the run every bot comment is addressed and resolved, and every PR check is green. This is a loop, not a single pass — keep going until done.

## Phase 0 — Workspace + sync (do this before touching comments)

Get onto a clean, up-to-date checkout of the PR branch, in its own worktree, synced with the base.

1. **Find or create the worktree.** Check whether a worktree for `<headRef>` already exists:

   ```bash
   git worktree list | grep -F <headRef>
   ```

   - If one exists, use it (`cd` into that path). Don't switch branches inside a shared/primary worktree — other agents may be on it.
   - If none, create a dedicated sibling worktree:

     ```bash
     git fetch origin <headRef> <baseRef>
     git worktree add <repo-parent>/<short-slug> <headRef>
     ```

   If the worktree has no `node_modules`, install (pnpm shares a store, usually fast): `pnpm install --prefer-offline`.

2. **Sync remote ↔ local.** In the worktree, fetch and compare local `<headRef>` to `origin/<headRef>`:

   ```bash
   git fetch origin
   git rev-list --left-right --count <headRef>...origin/<headRef>   # "<behind>  <ahead>" — local vs remote
   git status --porcelain                                            # uncommitted work?
   ```

   - Behind only (remote ahead) → `git pull --ff-only`.
   - Ahead only (local ahead) → note it; you'll push at the end.
   - **Diverged, uncommitted changes present, or a force-push looks needed → stop and ask the user** how to reconcile before doing anything destructive. Never force-push, hard-reset, or discard local commits without explicit confirmation.

3. **Resolve conflicts vs the PR base.** Merge the base into the branch so the PR is conflict-free before you start fixing:

   ```bash
   git merge origin/<baseRef>
   ```

   - Clean merge → keep going.
   - Conflicts → resolve them minimally, preserving the PR's intent. If a conflict's correct resolution is genuinely ambiguous (both sides changed the same logic in incompatible ways), **stop and ask the user** rather than guessing. After resolving: commit the merge and push.

Only once the branch is synced, conflict-free, and pushed do you move to the comment loop.

## Phase 1 — Gather PR + all bot comments

```bash
gh pr view <PR> --repo <OWNER>/<REPO> --json title,headRefName,baseRefName,state,url,body
# Inline review comments (where the bots usually post), with comment IDs + file:line:
gh api repos/<OWNER>/<REPO>/pulls/<PR>/comments --paginate \
  -q '.[] | "ID:\(.id)\nUSER:\(.user.login)\nPATH:\(.path):\(.line)\nBODY:\(.body)\n---"'
# Top-level issue comments (some bots post summaries here):
gh api repos/<OWNER>/<REPO>/issues/<PR>/comments --paginate \
  -q '.[] | "USER:\(.user.login)\nBODY:\(.body[0:800])\n---"'
```

Keep each comment's **numeric ID**, **author**, and **path:line** — you need the ID to reply/resolve. Bot comments are signed (e.g. "Reviewed by Cursor Bugbot"). Ignore the `Fix in Cursor/Web` link blobs.

## The greenify loop (Phases 2–6)

Phases 2–6 are one iteration. Run them, re-check the PR (checks + unresolved threads), and repeat until **every** comment is addressed and resolved and **every** check is green. A new push can trigger a fresh bot pass — new comments join the next iteration.

## Phase 2 — Verify each claim (do NOT skip)

For every unaddressed bot comment, independently confirm whether it is real:

1. Read the **diff** for the cited file: `git fetch origin <headRef>` then `git diff origin/<baseRef>...origin/<headRef> -- <path>`.
2. Read the **surrounding + supporting code** the claim depends on — the functions it names, callers, callees, types, and any framework seam (e.g. "the model only receives X" → find where X is assembled and confirm what's passed). A claim about runtime behavior must be traced to the code that produces that behavior.
3. Decide and write a one-line verdict per comment:
   - **Real** — reproduced from the code; explain the issue and *why it affects the product/feature*.
   - **Not worth fixing** — weigh the fix against the code it adds. Decline when guarding the edge case costs more code than the edge case costs in practice: a branch, null-guard, or config toggle added for an input that can't occur, or whose failure is trivial and self-correcting. A PR that grows to satisfy a linter-bot is a worse PR. Say why (intentional / can't-occur / cost outweighs benefit).
   - **Stale** — already fixed in a later commit, or refers to code no longer present.
   - **Wrong** — the bot misread the code; cite the evidence that refutes it.

Watch for claims that **interact**: one bot may want behavior broadened while another wants it narrowed — make sure your fix satisfies both, or note the tension.

State the verdicts to the user before (or alongside) fixing.

## Phase 3 — Decide what to do with each real comment

You already have the workspace from Phase 0. For each comment confirmed **real**, choose one of three outcomes in this order of preference:

1. **Redesign in scope (preferred).** Can the PR be reshaped — still within the PR's own requirements and scope — so that it is *simpler* and the issue simply doesn't arise? A smaller, cleaner design that dissolves the bug beats a guard bolted onto a more complex one. If the redesign changes the PR's shape in a way the user would want to weigh in on, **ask for confirmation** before doing it.
2. **Fix if the trade-off is worth it.** If no in-scope redesign removes the issue, weigh the fix against the complexity it adds: the added code has to be easy to maintain and simple to review. If the fix is worth that cost, apply it. If unsure whether the trade-off is worth it, **stop and ask the user** — show the comment and the trade-off.
3. **Don't fix.** Decline when **both** hold: the confirmed issue is only an **edge case** (a rare input, a path that seldom runs, a failure that's trivial or self-correcting), **and** the fix adds complexity that's genuinely costly to maintain and review (per option 2's bar). When the equation lands that far on the "extra complexity for an edge case → leave it out" side, leave it out. A real-but-edge-case finding whose fix is cheap still gets fixed; a real finding on a path that actually runs is not an edge case — fix it. A PR that grows to satisfy a linter-bot is a worse PR.

Not-worth-fixing / stale / wrong comments skip straight to a reply in Phase 5.

## Phase 4 — Apply the fix

- Apply the **minimal** change (or the in-scope redesign) that resolves the confirmed issue; match surrounding style and the repo's coding standards.
- Add or extend a **regression test** that fails without the fix and passes with it — one per distinct issue.

## Phase 5 — Verify

Run the project's checks for the changed area, e.g. for `Fyxer-AI/web-app` functions:

```bash
npx jest <changed test paths>            # targeted unit tests
pnpm tools:check                         # if registry/CI-validation code changed
pnpm --filter functions lint             # 0 errors (pre-existing warnings in other files are fine)
npx prettier --check <changed files>     # CI gates on "lint produced file changes"
```

Do **not** run `tsc --noEmit` manually in web-app worktrees (it pulls in broken wider-repo code and hangs/OOMs); the pre-commit hook runs a scoped typecheck. Verify types by reading the diff.

## Phase 6 — Commit, push, respond

Commit (conventional prefix; web-app: `fix:`/`chore:`) ending with:

```
Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

Push to the PR branch. Then **reply to each bot comment** and **resolve its thread**.

Reply to an inline review comment (use the comment's numeric ID):

```bash
gh api repos/<OWNER>/<REPO>/pulls/<PR>/comments/<COMMENT_ID>/replies \
  -f body='Real issue — fixed in <short-sha>. <one-line what was wrong> <one-line the fix + the regression test name>.'
```

Reply with the outcome you chose in Phase 3: `Redesigned in scope — <what changed> so the issue no longer arises`, `Real issue — fixed in <short-sha>. <what was wrong> <the fix + regression test name>`, or, for declined / not-worth-fixing / stale / wrong, that verdict and the evidence instead of a fix.

Resolve the threads via GraphQL (map comment IDs → thread node IDs, then resolve):

```bash
gh api graphql -f query='
{ repository(owner:"<OWNER>", name:"<REPO>") { pullRequest(number:<PR>) {
  reviewThreads(first:50) { nodes { id isResolved comments(first:1){ nodes { databaseId } } } } } } }'
# For each thread whose first comment databaseId matches a comment you handled:
gh api graphql -f query='mutation { resolveReviewThread(input:{threadId:"<THREAD_NODE_ID>"}) { thread { isResolved } } }'
```

Resolve every thread you addressed — fixed, redesigned, *or* declined with a reason. A declined comment is still "addressed": the reply is the resolution. Only leave a thread open if you genuinely need the human to decide and they haven't yet.

## Phase 6.5 — Re-check and loop

After pushing and responding, re-check the PR:

```bash
gh pr checks <PR> --repo <OWNER>/<REPO>          # every check green?
# re-list unresolved bot threads (Phase 1 queries) — any new or still-open?
```

- Any check red, or any thread still needing attention (including fresh comments from the new push) → **loop back to Phase 2** with the outstanding items.
- `Typecheck` / `Build` sitting queued behind the staging→main guard counts as green — don't loop on it.
- Stop only when **every check passes and no thread needs attention**. The PR must be green before you finish.

## Phase 7 — Clean up + report

- Remove the temporary worktree if you created one: `git worktree remove <path>` (only after the final push succeeds and the PR is green).
- Report to the user: per-comment verdict and outcome (redesigned / fixed / declined, with commit SHA + file:line), what was deliberately left and why, confirmation that replies were posted and threads resolved, and that all checks are green.

## Principles

- **Verify, don't trust.** A bot's confidence is not evidence. Reproduce from the code or refute it.
- **Minimal, tested fixes.** Each fix gets a regression test; don't expand scope beyond the confirmed issue.
- **Preserve the PR's invariants.** If the PR claims e.g. "coverage can only grow / no passing case newly fails," confirm your fix keeps that true.
- **Be honest about non-issues.** Saying "this isn't worth fixing because…" with evidence is a valid, valuable outcome.
