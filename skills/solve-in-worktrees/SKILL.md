---
name: solve-in-worktrees
description: Take the fixes already identified in this session and deliver each one as its own worktree + PR, driven by a build-agent ↔ Codex-verifier loop. Creates one worktree per split off `origin/staging` with Joey's branch naming, plans requirements + solution per worktree, reviews that plan with Codex, Gemini, and Cursor before any code, spawns a build agent plus three concurrent test agents that work from the approved plan rather than the built code (test-requirement gathering, test create, test update), then runs three verify passes (solution-vs-requirements, code quality, test-mock scrutiny — see `pre-pr-gate`) with Codex, Gemini, and Cursor on each, loops until all release, opens the PR, then keeps looping on CI checks and bot comments. Use when the session already knows what needs fixing and the user says "solve in worktrees", "/solve-in-worktrees", "split this into worktrees and ship it", "build and verify each fix in its own branch".
user_invocable: true
---

# solve-in-worktrees

Turn the fixes this session has already identified into shipped PRs, one worktree
each, with a build agent and three independent verifiers (Codex, Gemini, Cursor)
ping-ponging until all three are happy — then until CI and the review bots are happy
too.

**Precondition:** the session already contains the context of what needs fixing. If it
doesn't, stop and ask for it rather than inventing work.

## Phase 0 — Read the splits out of the session

Prior recommendations win. If the session (or a plan/spec/`pr-split-audit` output it
produced) already says how to split the work and how to solve each part, use that
verbatim — don't re-derive it. Only decide the split yourself when nothing in the
session says.

When you do split: one worktree per independently-reviewable, independently-compiling
change; disjoint files across worktrees (overlapping files → merge them into one
worktree, or sequence them and say so). Watch compile-time coupling — a change the
type system won't let you split (shared enum/union + its exhaustive `switch`es) is one
worktree, not two.

Then present a short table — slug, branch name, one-line goal, files it will touch —
and get a single go-ahead covering the whole run (worktrees, commits, PRs). Opening
PRs is outward-facing; don't start without that yes.

## Phase 1 — One worktree per split

Branch names follow `/create-branch`: `<prefix>/<type>-<LINEAR-CODE>-<kebab-title>`
(drop the code segment if there's no issue). `<prefix>` is the plugin's configured
author prefix, resolved below. Base is `origin/staging` for web-app,
`origin/main` for `Fyxer-AI/eval`.

```bash
git fetch origin
# Author prefix: the plugin's branchPrefix option, else your shell username (see /create-branch).
PREFIX='${user_config.branchPrefix}'
case "$PREFIX" in ''|*user_config.branchPrefix*) PREFIX="$(whoami)" ;; esac
# Siblings live next to the repo's MAIN worktree, wherever it's checked out — no hardcoded home path.
TREES_ROOT=$(dirname "$(git worktree list --porcelain | sed -n 's/^worktree //p' | head -1)")
git worktree add "$TREES_ROOT/<slug>" -b "$PREFIX/<type>-<CODE>-<title>" origin/staging
cd "$TREES_ROOT/<slug>" && pnpm i --prefer-offline
```

- Worktrees are **siblings** of the main worktree. Never nest one under
  `.claude/` or any gitignored path — prettier/oxlint silently skip those files and
  `pnpm lint` reports a false clean (see `lint-in-ignored-worktree`).
- `node_modules` is per-worktree; the install is needed before any lint runs.
- Env/secret files are only needed if something must actually run the app locally —
  then use `setup-worktree-webapp` instead of hand-copying.
- Never do this work in the shared `fyxer-web-app/` main tree; concurrent agents
  branch-switch it out from under you.

## Phase 2 — Plan each worktree

Per worktree, write two things (inline, short):

1. **Requirements** — a numbered list of one-sentence, checkable statements. This is
   the contract the verifier tests against, so each one must be observable in the code
   or in behaviour. What's absent is out of scope; say so explicitly.
2. **Solution** — a few sentences: which files change, which existing
   helper/pattern is being reused or mirrored, and the root cause it fixes (not the
   symptom the report named).

Both go verbatim into the build agent's prompt and the verifier's prompt. Keep the
requirements text identical between them — divergence there is what makes the loop
spin forever.

## Phase 2b — Review the plan before anyone builds it  (Codex + Gemini + Cursor, concurrent)

The cheapest finding is the one caught while the plan is still a paragraph. Before the
build agent is spawned, hand the **requirements + solution** from Phase 2 to three
reviewers at once, same prompt to all three:

```
mcp__codex__codex { cwd: "<worktree path>", sandbox: "read-only",
                    approval-policy: "never", prompt: "<the plan-review prompt>" }
```

```bash
echo "<the same plan-review prompt, verbatim>" | node ${CLAUDE_PLUGIN_ROOT}/skills/cursor-agent/scripts/run-agent.mjs \
  --model gemini-3.1-pro --cwd <worktree path> --timeout 900
```

```bash
echo "<the same plan-review prompt, verbatim>" | node ${CLAUDE_PLUGIN_ROOT}/skills/cursor-agent/scripts/run-agent.mjs \
  --model claude-opus-5-high --cwd <worktree path> --timeout 900
```

The plan-review prompt asks, against the real codebase and nothing else:

1. Does the solution actually satisfy every numbered requirement, or does a requirement
   have no step that delivers it?
2. Is it fixing the **root cause** or a symptom — grep the callers of every function the
   plan touches and name any sibling caller left broken.
3. Does the plan reinvent something that already exists? Cite `file:line` for the
   existing helper, util, type, or pattern it should reuse instead.
4. What will the plan break: callers, callers' types, data shape, indexes, rules.
5. Which requirement is ambiguous enough that two builders would build two different
   things?
6. Is the plan specific enough to **write tests against before the code exists** — does
   it name the units, their inputs, and the observable outcome of each? T1 builds the
   test list straight from this plan, so vagueness here surfaces as a test nobody can
   write, and that is a plan defect to fix now rather than a test gap to discover later.
7. **How wide should the tests be — what behaviour will this slice freeze?** A test pins
   behaviour for everyone, so writing one is a scope decision, not a mechanical step. For
   each production unit the plan touches, sort the behaviour the tests would pin into
   three buckets, judged only from the code:
   - **intended** — a guard, a named branch, an `assertNever`, or a comment deliberately
     implements it → pin it, no question;
   - **incidental** — nothing observes it and no caller depends on it → leave it unpinned,
     no question;
   - **undecidable from the code** — observable and plausibly depended on, but nothing in
     the code says whether it is a promise or an accident.

   Output only the third bucket, as a numbered **width questions** list: one line each,
   naming the behaviour, the `file:line` that produces it, and what pinning it would stop
   anyone changing later. **Empty is the normal answer** — zero to three on a typical
   slice; more than about five means the slice touches too much, and say so. Do not
   resolve these yourself.

End with a single verdict line, `PLAN OK` or `PLAN CHANGES`, then a numbered list.
Review only — write no files.

Reconcile as in `pre-pr-gate` (three-way, canonical there — don't fork a second copy).
**Findings 1, 3 and 5 change the plan text; finding 5 usually comes back to the user,
not to you.**

**Finding 7 always comes back to the user, and it gates the verdict.** Ask each width
question with `AskUserQuestion`, three options: *pin it* (it is a contract, freeze it),
*leave it* (real but not promised, don't constrain it), *it's a bug* (don't freeze it —
fix it in this slice or file it). The third option is why the gate exists: without it the
step can only ever ratify current behaviour, and accidents get cemented into tests. Write
the answers into the plan. `PLAN OK` does not release until every width question is
answered, because `PLAN OK` is the same moment T1 starts — an answer that arrives after it
is too late to shape the tests it was meant to shape.

Cap at 2 plan-review rounds. If the reviewers split on a design call, or two or more land on the same ambiguity,
that is not a third review round: convene **`discussion-room`** (default 2 senior-engineer
+ 2 PM seats, one round, advisory) and act on its recommendation, or take its
`Needs human` question to the user. Then build with whatever is still contested written
down. The revised plan is what goes into the build agent's prompt — never the pre-review draft — **and into T1's
prompt at the same moment** (Phase 3b): the approved plan, not the build agent's code,
is what the tests are specified from.

## Phase 3 — Build agent

One agent per worktree, all spawned in a single message so they run concurrently
(`tech-lead` for TypeScript work in this repo, otherwise `general-purpose`).

Its prompt must carry:

- The absolute worktree path, with the instruction that **every** file edit and git
  command targets that path (`git -C <path> …`) and nothing outside it.
- The requirements list and the solution plan, unedited.
- Repo standards: minimal diff, reuse existing helpers over new abstractions,
  functional style, no thrown errors, `assertNever` on closed unions —
  `coding-standards` / `backend-standards` / `frontend-standards`.
- **Comments — stricter than the repo default.** A comment survives only if it
  explains *why the code must be this way* for a reason that cannot be put into the
  code by any renaming or restructuring **and** cannot go stale: an external
  constraint, a provider quirk, a deliberately non-obvious choice a future engineer
  would otherwise "simplify" and break, or the `as` / `TODO(owner|issue)`
  justifications the repo already sanctions. Its only job is to stop the next
  engineer removing the reason the code is shaped this way. Any comment describing
  *what* the code does or its present behaviour fails on both counts — the code
  already says it, and it drifts the moment the code changes. Default is zero.
- Checks to run before reporting done: `pnpm --filter <pkg> lint`,
  `npx prettier --check <changed files>`, targeted `pnpm --filter <pkg> typecheck`,
  and any relevant `npx jest <paths>`. **Never** `tsc --noEmit` anywhere in this repo
  (transitive imports pull in broken code → hang/OOM); verify types by reading the diff.
- Commit locally with a conventional prefix; **do not push** (sub-agents are blocked
  from `git push` by hook — the main session does the pushing).
- Flag back rather than invent: if a requirement can't be met as written, say which and
  why instead of widening scope.
- **It does not touch test files.** Tests are owned by the Phase 3b agents; overlapping
  writes are the only way these concurrent agents can collide.
- **It builds to the planned interface.** T2 is already writing tests against the plan's
  import paths, signatures and return shapes while the build agent works, and the plan
  wins a disagreement. If a planned signature can't be implemented as written, say so and
  stop — don't quietly change it, because that lands as a wave of failing tests nobody
  asked for.

## Phase 3b — Test agents, from the plan, concurrent with the build

Three Codex agents, each its own `mcp__codex__codex` invocation and `threadId`, each with
one job. They run **alongside** the build agent, and their source of truth is the
**approved plan from Phase 2b — not the build agent's code**. Tests reverse-engineered
from an implementation can only confirm what it already does; tests written from the plan
are an independent oracle for whether it does what was promised.

House rule first (`coding-standards`): we don't add unit tests by default, and this trio
does not change that. T1 is allowed to conclude that a slice needs no new test; T2 and T3
only ever write tests that a T1 requirement names. No coverage-chasing, no getter-level
tests, no fixtures for their own sake.

**File ownership, so the concurrency is safe:** build agent → source files only;
T2 → new test files only; T3 → existing test files only. Nobody writes another's files.

**T1 — test-requirement gathering** (read-only). Three feeds, in this order:

*Feed 0, the pinning decisions — already made, not re-derived.* The plan carries the
answers to Phase 2b's width questions. Take them as given: pin what the user said to pin,
leave what they said to leave, and skip anything they called a bug. On top of those, pin
whatever the code itself marks as **intended** — a guard, a named branch, an `assertNever`,
a comment defending it — since that needed no question. Everything else about the units
this slice touches stays unpinned. This feed decides *what* is in scope for a test; feeds 1
and 2 decide what each test asserts. It is deliberately not a licence to go and map the
whole contract yourself — behaviour that is merely what today's code happens to do is not a
contract, and freezing it blocks legitimate change later.

*Feed 1, the plan — starts the moment Phase 2b returns `PLAN OK`, the same moment the
build agent is spawned.* Given the numbered requirements and the approved plan: for each
requirement, state whether an existing test already covers it (cite the test `file:line`),
whether an existing test will now assert the wrong thing, or whether it is uncovered and
worth covering. Output a numbered **test-requirements list**, each entry one checkable
sentence naming the unit, the realistic input that would break it, and the observable
outcome — including the cardinality cases `pre-pr-gate` Pass C hunts for (absent /
more-than-one / stale / mis-attributed), since a test written for those is cheaper than a
Pass C finding about a mock that hides them. Mark each `NEW`, `UPDATE`, or `COVERED`.

*Feed 2, the diff — runs when the build agent reports its first working diff, before the
Phase 4 verify calls fire.* Re-run T1 over `git diff origin/<base>...HEAD` for behaviour
the plan never named: a branch the plan didn't anticipate, an error path the
implementation invented, a caller it had to touch. Append these to the list as a second
block so plan-derived and diff-derived entries stay distinguishable — the first block is
the oracle, the second is coverage.

```
mcp__codex__codex { cwd: "<worktree path>", sandbox: "read-only",
                    approval-policy: "never", prompt: "<T1 prompt>" }
```

**T2 — test create** (`sandbox: "workspace-write"`; starts as soon as T1's feed-1 list
lands, in parallel with the build agent — it does **not** wait for a diff). Writes the
`NEW` entries against the interface the plan promised: the planned import path, the
planned signature, the planned return shape. Mirror the nearest existing test file's shape
and helpers; no new test framework, no new fixture layer, no mock of a function the diff
didn't touch.

The suite is **red until the build agent lands**, and that is the expected state, not a
failure — a plan-derived test failing before the code exists is the oracle working. Two
things T2 must never do to make red go away: stub the planned module into existence, or
soften an assertion. When feed 2 arrives, T2 writes those entries too.

**T3 — test update** (`sandbox: "workspace-write"`; concurrent with T2). Takes only the
`UPDATE` entries: existing tests whose assertions or mocks the diff has invalidated. A test
that now fails is either a real regression — report it back, don't relax the assertion — or
an assertion about behaviour the contract deliberately changed, which is the only case
where it gets rewritten. Never delete a failing test to make the suite green.

**Precedence when a plan-derived test disagrees with the implementation: the plan wins.**
The approved plan is the interface contract, so a mismatch is a **build** finding — send it
to the build agent via `SendMessage`; T2 does not rewrite the test to match the code. The
one exception is a mismatch that shows the *plan detail itself* was wrong: that is a plan
defect, and it comes back to the user in one line rather than being absorbed by either
agent.

Both write agents finish by running the relevant `npx jest <paths>` in the worktree and
committing locally (no push). Their output feeds Phase 4's Pass C, which then critiques
tests written by a different agent than the one that wrote the code — the point of
splitting them.

## Phase 4 — Verify: three passes, three models each

Once the build agent and the Phase 3b test agents report done, verify that worktree with
**three separate passes, each run by Codex, Gemini, and Cursor** — nine concurrent
calls. Codex keeps a `threadId` per pass (for `mcp__codex__codex-reply` on later
rounds); Gemini and Cursor re-run fresh each round.

```
mcp__codex__codex  { cwd: "<worktree path>", sandbox: "read-only",
                     approval-policy: "never", prompt: "<see below>" }
```

```bash
echo "<the same pass prompt, verbatim>" | node ${CLAUDE_PLUGIN_ROOT}/skills/cursor-agent/scripts/run-agent.mjs \
  --model gemini-3.1-pro --cwd <worktree path> --timeout 900
```

```bash
echo "<the same pass prompt, verbatim>" | node ${CLAUDE_PLUGIN_ROOT}/skills/cursor-agent/scripts/run-agent.mjs \
  --model claude-opus-5-high --cwd <worktree path> --timeout 900
```

Reconciliation (2+/3-raised → act, exactly-one-raised → check it yourself,
contradiction → read the code and decide, pass releases only when all three models
release) is canonical in `pre-pr-gate`; don't fork a second copy.

**Pass A — solution-vs-requirements** (this skill's original job): review
`git diff origin/<base>...HEAD` against **the requirements only** — does the diff
satisfy each numbered requirement, and does it break anything it touches. Per
requirement: met / not met / met-but-broken, each with `file:line` evidence. Plus any
correctness or edge-case defect (unhandled null/empty, wrong branch on an error path,
off-by-one, missed caller of a changed function), unclear naming, and dead code. Not
its job: design taste, DRY, concurrency, or test quality — those are Pass B and C.

**Pass B — code-quality verifier** and **Pass C — test-critique reviewer**: same
prompts as `pre-pr-gate`'s Pass B and Pass C (the canonical text lives there — don't
fork a second copy here, it drifts). Pass B ignores business-case correctness entirely
and owns reuse/DRY, concurrency (sequential `await`s that should be `Promise.all`,
unbounded `Promise.all` over rate-limited calls), and mechanical design. Pass C finds
the business scenarios this PR's own tests hid: every mock checked against what the
real function can actually return, a cardinality check (absent / more-than-one / stale
/ mis-attributed) on every externally-sourced value a mock stands in for, and a
justification requirement on every `first()`/`[0]`/`.find()` over an external
collection. Findings ranked P0/P1/P2; only P0 gates `RELEASE`.

Each pass ends with a single verdict line, `RELEASE` or `CHANGES REQUIRED`, and when
it's the latter, a numbered list of concrete findings.

No model is an oracle on any of the three — if a finding contradicts the
code you've read, check it before forwarding, same discipline as `fix-bot-comments`.

## Phase 5 — The loop

```
plan → plan-review (3 models) → PLAN OK ─┬→ build agent ──────────┐
                                         └→ T1 (plan) → T2/T3 ────┤
   first diff → T1 (diff feed) → T2/T3 → verify (3 passes × 3 models)
   → (any P0/CHANGES REQUIRED? → build → verify) → RELEASE → push + PR → CI/bots
```

Send findings back to the *same* build agent with `SendMessage` (its context is intact
and cheaper than a fresh spawn), one finding per line, each with the verifier's
`file:line` and which pass raised it. Test findings go to T2/T3, not to the build
agent. Then re-verify each pass with its own `codex-reply` plus fresh Gemini and Cursor
runs.

Cap at 4 build↔verify rounds per worktree. If it hasn't released by then, stop that
worktree and report what's contested — a loop that won't converge on Pass A is usually
a requirement that's wrong, not code that's wrong; unconverged Pass C P1/P2s usually
mean the reviewer is over-fitting, not the code — report those as left-deliberately,
not as a blocker. Worktrees run independently; one stalling doesn't block the others.

## Phase 6 — PR

The main session pushes (sub-agents can't) and opens the PR, following `create-pr`:
base `staging`, assignee `Dwonczykj`. When a worktree's PR depends on another open PR's
branch, register the chain as a native `gh stack` (`gh stack link`, see `create-pr`
Phase 6b) rather than hand-chaining `--base` — it sets the bases and auto-retargets on
merge.

```bash
git -C <worktree path> push -u origin <branch>
```

PR description follows `create-pr`. For `Fyxer-AI/web-app` the CI check "Description
follows template" requires each of `Problem`, `Changes`, `Testing`, `Risks` as its own
markdown heading — the `skip-template` label is the escape hatch:

```
## Problem
<what was wrong or missing, and why>

## Changes
<what this worktree does; call out provider-call changes and removed behaviour>

## Testing
<what was run / verified; "None" is valid for a trivial change>

## Risks
<blast radius, rollback; "None" if genuinely none>

Linear: <url>   ← omit if no issue
```

Keep it minimal — no diff narration, no restating the requirements as prose.

## Phase 7 — CI checks and bot comments

Hand the open PR to **`/review-feature`** Stage 2 — it owns this loop (verify each check
failure and bot claim against the real code first, fix only the real ones, push,
re-check, resolve threads) and the list of known non-failures not worth chasing. Don't
fork a second copy of that text here; it drifts.

A well-verified PR should arrive with no bot findings at all. Findings mean a verify pass
missed something, so treat them as signal about the loop, not just as chores.

## Phase 8 — Report and clean up

One line per worktree: branch, PR URL, requirements met, verify rounds used, CI state,
anything deliberately left. Keep the worktrees until the PRs merge, then
`prune-merged-worktrees`.

## Gotchas

- Sub-agents cannot `git push` (hook-denied) but branches they create live in the
  shared `.git` ref store, so the main session pushes them by name.
- Dependent worktrees: if B needs A's code, A must be **pushed** before B is branched
  (agents can't see each other's local-only commits) — but A need not be *merged*. Branch
  B off `origin/<A-branch>` and open it stacked on A's PR via `gh stack link` (see Phase 6);
  the native stack retargets B to `staging` when A merges.
- `git commit` here can hang on pre-commit hooks; `commit-hang-guard` covers the 3-minute
  kill + `pnpm i` recovery.
- Don't mix a refactor into a feature worktree. That's a separate worktree and PR.
