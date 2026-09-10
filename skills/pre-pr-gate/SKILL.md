---
name: pre-pr-gate
description: Left-shifted acceptance gate for a feature branch or worktree — runs everything the human reviewer and Cursor Bugbot would otherwise catch, locally, BEFORE the PR opens. Verifies the diff against a locked requirements contract, code quality (design/DRY/concurrency), and test-mock scrutiny — three separate passes, each reviewed by three independent models (Codex, Gemini, Cursor), not one bundled call — plus diff-review and the real code checks (lint / prettier / targeted typecheck / jest), looping build↔verify until every pass RELEASEs. Emits "ready to PR" — never opens the PR itself. Use when the user says "gate this before I push", "pre-pr gate", "/pre-pr-gate", "is this ready to open", or as the acceptance step inside /start-feature and solve-in-worktrees.
user_invocable: true
---

# pre-pr-gate

The point of this skill: **move review left**. Everything a human or Bugbot would flag on an open PR gets caught here, on the branch, before anyone is watching. A PR that passes this gate should arrive with nothing left to catch.

The gate is only as trustworthy as its checks being **real tool calls** — lint exit codes, a Codex verdict, jest pass/fail — not your own read of the code. Never declare a phase green because it "looks right". Run the command; read its result.

## Preconditions

- **A worktree or branch with the change already built.** Default target is the cwd; take an explicit `<worktree path>` if given and run every command with `git -C <path>` / `pnpm --filter … -C <path>`.
- **A locked requirements contract.** This is the acceptance target and the gate is meaningless without it. Resolve it in this order:
  1. A path passed in (e.g. `.scratch/<slug>/requirements.md`) — read it.
  2. A numbered requirements list already in the session — use it verbatim.
  3. Neither → **stop and ask**. Offer to derive a provisional contract by reading the branch name + `git log <base>..HEAD` into a one-sentence feature intent, but make the user confirm it before gating. Do not invent scope.

Keep the contract text identical everywhere it's quoted — divergence between the build prompt and the verifier prompt is what makes the loop spin forever.

## The checks (one round)

Run all of these; collect findings before fixing.

1. **Code gates (deterministic, hard).** These have exit codes — a non-zero is a fail, full stop.
   - `pnpm --filter <pkg> lint`
   - `npx prettier --check <changed files>`
   - relevant `npx jest <paths>` for behaviour the diff touches. If the branch came
     through `solve-in-worktrees` Phase 3b, plan-derived tests were written *before* the
     implementation and the suite was legitimately red for a while — the gate runs after
     that has converged, so here a red test is a real failure, and the fix goes to the
     build agent, not to the test.
   - types: read the diff; run `pnpm --filter <pkg> typecheck` **only if it returns quickly**. Where the repo's `CLAUDE.md` forbids it (the Fyxer web-app does), **never** `tsc --noEmit` (any tsconfig — it hangs/OOMs on transitive imports).
   - Worktree caveat: if the worktree path contains a gitignored segment (`.claude/…`), lint/prettier silently skip files and report a false clean — see `lint-in-ignored-worktree`.
2. **Comments review (runs straight after the code gates pass).** Scan every comment the diff adds or touches against the **stricter comment bar in Pass B below** — not the laxer `coding-standards` "warranted in practice" list. Delete any that record change history or a decision that belongs in the PR description (`// PR-1 did X`, `// kept for now, remove after Y`), restate the next line, are JSDoc repeating the signature, or describe *what* the code currently does. Keep a comment only if it survives Pass B's test — it explains *why* the code must be this way for a reason that can't be expressed in code and can't go stale. One exception to the delete: a would-be "external constraint" comment whose fact could quietly become false is the divergent class — **flag it for the user, don't delete it** (Pass B's flag tier). Track a temporary-scaffolding cleanup as `TODO(<ISSUE>)`, never as prose narrating the plan. This is the cheap deterministic first catch; Pass B's three code-quality models are the backstop.
3. **diff-review.** Run the `diff-review` skill against the base (default `staging`): correctness → minimality → dead-code, auto-applying safe fixes. This shrinks the diff and removes what Bugbot would otherwise comment on.
4. **Three separate verify passes, each run by three models — nine concurrent calls, never one bundled call.** Each pass has its own narrow job and its own `RELEASE` / `CHANGES REQUIRED` verdict. Each pass is reviewed independently by Codex, by Gemini, *and* by Cursor, with the **identical prompt** — three models on the same narrow job, from three different underlying model families, is the cheapest way to catch the finding any one model's blind spot drops.

   Codex side — its own `threadId` per pass (kept for `codex-reply` on later rounds):

   ```
   mcp__codex__codex { cwd: "<worktree path>", sandbox: "read-only",
                       approval-policy: "never", prompt: "<see pass below>" }
   ```

   Gemini side — via `cursor-agent`, pinned to `gemini-3.1-pro` (antigravity/`agy` is unreliable, so Gemini is routed through the Cursor CLI instead — same wrapper shape):

   ```bash
   echo "<the same pass prompt, verbatim>" | node ${CLAUDE_PLUGIN_ROOT}/skills/cursor-agent/scripts/run-agent.mjs \
     --model gemini-3.1-pro --cwd <worktree path> --timeout 900
   ```

   Cursor side — `cursor-agent`, pinned to `claude-opus-5-high`:

   ```bash
   echo "<the same pass prompt, verbatim>" | node ${CLAUDE_PLUGIN_ROOT}/skills/cursor-agent/scripts/run-agent.mjs \
     --model claude-opus-5-high --cwd <worktree path> --timeout 900
   ```

   Neither `agy` (Gemini) nor `agent` (Cursor) run sandboxed read-only, so the pass prompt must end with: *review only — do not edit, create, or delete any file; do not run build/test/typecheck/lint commands or execute code to test a hypothesis; if a shell command is rejected, don't retry it, just note that and continue with what's already visible; output findings and a verdict line.* Neither has thread resume: on later rounds re-run both fresh against the current diff, while Codex continues on `codex-reply`.

   **Reconciling the three.** Merge findings by `file:line` + claim, then:
   - raised by **two or more** → treat as real, fix first;
   - raised by **exactly one** → check it against the code yourself before forwarding (all three are reviewers, not oracles — same discipline as `fix-bot-comments`);
   - two **contradict** a third, or all three disagree, on the same line → read the code, decide, and record the call in the readiness report;
   - a pass is `RELEASE` only when **all three** models release it — an unresolved P0 from any one keeps the pass open.

   Why three passes instead of one: a single prompt asking for contract compliance *and* design quality *and* test scrutiny grades the model on the first and starves the other two — that's the exact mechanism that let a sequential-await bug and a hidden-mock bug both ship in a PR whose one Codex-shaped review pass already asked for reuse/DRY. Splitting the job is what makes each pass actually get done. **No model is an oracle** on all three: if a finding contradicts code you've read, check it before acting — same discipline as `fix-bot-comments`.

   **Pass A — contract verify.** Review `git diff origin/<base>...HEAD` against **each numbered requirement** (met / not met / met-but-broken, `file:line` evidence), plus any correctness or edge-case defect, unclear naming, and dead code. Explicitly not its job: design taste, DRY, concurrency, test quality, or comments — those are Pass B and Pass C. Not scope it wasn't asked for.

   **Pass B — code-quality verifier.** Explicitly **not** business-case correctness (that's Pass A) — this pass owns:
   - **Reuse / DRY against the whole codebase, not just the diff:** for each new helper, util, type, constant, or logic block, does an equivalent already exist? Cite `file:line`. Reuse-first, not extract-happy — don't propose a new abstraction just to merge two similar blocks the diff itself just added (`diff-review` Pass 2 already handles genuine in-diff redundancy; `coding-standards` bans premature abstraction).
   - **Concurrency:** independent `await`s in sequence that should be `Promise.all`; unbounded `Promise.all` over a rate-limited API where `Bluebird.map` with a concurrency cap is the house pattern (`backend-standards`); any read-then-write over a store with no compare-and-set, flagged as a race even if low-probability.
   - **Design:** object args over positional, early returns over nesting, exhaustive switches with `assertNever` — the mechanical parts of `coding-standards` a correctness-focused pass tends to skim past.
   - **Comments — stricter than the repo default, and this pass owns them.** The one surviving form is a comment that explains *why the code must be this way* for a reason that (a) cannot be expressed in the code by any renaming or restructuring **and** (b) cannot go stale — an external constraint, a provider quirk, a deliberately non-obvious choice a future engineer would otherwise "simplify" and break, or the `as` / `TODO(owner|issue)` justifications the repo sanctions. Its sole job is to stop the next engineer removing the reason the code is shaped this way. Two tiers of finding:
     - **Penalise (fix = delete).** Any comment `coding-standards` *also* rejects: one describing *what* the code does or its present behaviour, change history, a decision that belongs in the PR description, a restatement of the next line, or JSDoc repeating the signature. The code already says it and it drifts the moment the code changes.
     - **Flag, don't delete (human decides).** The class where this bar and the shared rule diverge: a comment the repo's "warranted in practice" list would keep (a genuine external-constraint note) but whose stated fact could silently become false — it passes (a) but fails (b). Surface it as a finding for the user with the `file:line` and the specific fact that could go stale; do not remove it as part of the loop. This is the only comment class the pass flags rather than fixes.
     Rank a penalise-tier finding P1 unless the comment actively misdescribes live code, which is P0. A flag-tier finding is P2 and never gates `RELEASE`.

   **Pass C — test-critique reviewer.** The highest-value pass, and the one most likely to be skipped if only one Codex call runs. Job: **find the business scenarios this PR's own tests hid from the build agent.** For every diff touching tests:
   - **Enumerate every `jest.mock()` / stub / fake the diff's tests add or touch.** For each: name the real function it replaces, and ask "does this mock's return value match what the real function can actually return?" A mock is a claim about code the reviewer must check, not code that's exempt from review because it's "just a test."
   - **Cardinality check on every externally-sourced value a mock stands in for** (provider API, third-party call, DB read): can it be *absent*? can it be *more than one*? can it be *stale*? can it be *mis-attributed*? If the mock only ever returns one clean value and the code doesn't visibly handle the other three, that's a finding — "more than one" is the case builders skip most.
   - **Justify every reduction over an externally-sourced collection:** `first()`, `[0]`, `.find()`, any implicit "pick one." No inline justification for the pick → flag it.
   - **Mutation survivorship on the pins the slice agreed to.** Mock hygiene tells you a test is honest; it does not tell you the test asserts anything. This check is **not** a way to discover new behaviour worth pinning — that was settled at the plan-review width gate (`solve-in-worktrees` Phase 2b, finding 7) and reopening it here is scope creep. Its only job is verifying the agreed pins are actually asserted. For each behaviour the slice agreed to pin, name a concrete one-line edit to the **production** file that would break it — swap two branches, delete a guard, fold two separately-computed fields into one, `.find` → `.findLast`, drop a `filter` — and state whether an existing test would fail. A pin nothing would catch is a **P0**: the agreement wasn't honoured, and the missing assertion goes to T2. Cap at 6. Do not apply the edits as part of the review; name them and check by reading. Where the slice is small the calling session may apply each in a scratch copy and run the suite, which turns the pass from an opinion into a result — but a mutation that *passes* is ambiguous, either a test gap or an edit that didn't actually change behaviour, so confirm which before recording a survivor.
   - If the PR touches a spec/design doc in the same diff, cross-check the diff's code against facts stated in *that same doc* — a build agent's own spec is disconfirming evidence it wrote and didn't check against its own code.
   - **Not its job:** suggesting more tests for coverage's sake, or flagging trivial/getter-level gaps (`coding-standards`: don't introduce unit tests by default). Only findings where an existing mock or fixture is actively hiding an incorrect behavior count.
   - If the diff has **no** test covering a requirement this pass believes needs one, that is a build-side gap, not a gate finding: hand it to the test agents (`solve-in-worktrees` Phase 3b) rather than fixing it here. Findings about a test itself go to T2/T3; findings about the code the test exposes go to the build agent.
   - Tests it is reading may have been written from the plan before the code existed. That makes a test/implementation disagreement a **build** finding by default (the plan is the interface contract), not a reason to soften the test.
   - Rank each finding **P0** (breaks correctness on a realistic input), **P1** (real edge case, lower likelihood), or **P2** (style/coverage nit). Only P0 findings gate `RELEASE`; log P1/P2 for the readiness report without blocking the loop on them.

## The loop

```
checks → verify (3 passes × 3 models = 9 concurrent) → reconcile → (any P0/CHANGES REQUIRED? → fix → checks → verify) → RELEASE → ready-to-PR
```

- **Sort findings by kind before dispatching.** A finding that is complex, reaches outside
  this PR's diff, or has several defensible fixes is not a build task yet: convene
  **`discussion-room`** on it (options, trade-offs, a recommendation, and a `Needs human`
  flag) and dispatch only once an approach is chosen. Fixing the narrow symptom because it
  is the smaller diff is how scope creep gets deferred into the next PR instead of decided.
  Everything else goes straight to the fixer.
- Send findings back to the **same** build agent via `SendMessage` if one is running (its context is intact and cheaper than a fresh spawn); otherwise apply the fixes inline. One finding per line, each with its `file:line` and which pass raised it.
- Re-run the code gates and re-verify: `codex-reply` on each Codex pass's own thread, and fresh `cursor-agent` runs per pass (both the `gemini-3.1-pro` and `claude-opus-5-high` pins) against the updated diff.
- **Cap at 4 rounds.** If it hasn't released by then, stop and report what's contested — a loop that won't converge on Pass A is usually a requirement that's wrong, not code that's wrong; a loop that won't converge on Pass C's P1/P2s usually means the reviewer is over-fitting, not that the code is — cap those the same way and report them as left-deliberately, not as a blocker.

## On RELEASE

Emit a short readiness report and **stop** — opening the PR is the caller's job (a human-authorised, outward-facing step), never this skill's:

```
✅ ready to PR — <branch>
- requirements: <n>/<n> met (Pass A)
- checks: lint ✓  prettier ✓  jest ✓  types ✓ (read)  comments ✓  diff-review ✓
- code quality (Pass B): RELEASE  |  P1/P2 left deliberately: <none | …>
- test critique (Pass C): RELEASE  |  P1/P2 left deliberately: <none | …>
- model agreement: <n> findings raised by 2+/3, <n> by Codex only, <n> by Gemini only, <n> by Cursor only, <n> contradictions resolved (<how>)
- verify rounds: <k>/4
```

The caller (you, or `/start-feature`, or `solve-in-worktrees`) pushes and opens the PR per `create-pr`.

## Appendix — fyxer web-app checklist

`diff-review` and Codex catch the generic defects (bugs, `any`/`as`, dead code, minimality, mixed refactor+feature). These are the **repo-specific** traps a generic reviewer misses — scan the added/modified lines for them in every round, on top of the checks above. Apply the sanctioned fix; don't just flag.

**Shared / sensitive files touched:**
- `firestore.indexes.json` — a new index must correspond to a new compound query, and vice versa: any Firestore query with multiple `where` clauses (or `where` + `orderBy`) needs a matching index here or it fails at runtime.
- `firestore.rules` — rules match the new data-access pattern.
- root `package.json` / `pnpm-lock.yaml` — dependency changes are intentional, not stray.
- env config / `.github/` workflows — no secrets or local-only values leaked, CI changes deliberate.

**Frontend (`app/src/**`):**
- className uses `cn()` from `app/src/lib/utils.ts`, never a template literal `` className={`…`} ``.
- new data-fetching components handle loading, empty, and error states.
- new UI reuses `app/src/routes/design-system/` components (confirm props via the Storybook MCP, don't guess).

**Backend (`functions/src/**`):**
- significant operations have structured log calls, and **no PII in logs** (no email, name, or user data).
- I/O (API calls) sits in separate functions from business logic.
- parallel calls to rate-limited APIs use `Bluebird.map` with a concurrency limit, not unbounded `Promise.all`.

**Debug / temp left in:** `console.*` (outside logging infra), `debugger`, `.only`, `@ts-ignore` / `@ts-expect-error` / `eslint-disable` without justification, commented-out blocks.

**Product surface:** if the change alters user-facing behaviour, the PR body should suggest a `product-overview` update.
