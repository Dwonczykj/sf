---
name: start-feature
description: Orchestrate a whole feature from idea to open PR through a left-shifted, gated pipeline — scope → lock a requirements contract → split → review the plan with three models → build + test agents in worktrees → gate locally with three models BEFORE the PR opens → mop up → final report. Escalates genuinely contested calls to a grounded advisory panel (discussion-room) at scope, plan and review. Chains your existing skills (gather-requirements, grill-me, pr-split-audit, solve-in-worktrees, review-feature, discussion-room) in order, holding a progress/state file in .scratch/<slug>/ and stopping at named human gates. Use when starting a new feature and you want the review caught before the PR, not after — "start a feature", "/start-feature", "kick off <feature> the proper way".
user_invocable: true
---

# start-feature

One command to run a feature through the whole factory, in order, with the review moved **left** — every miss (scope, correctness, bot-catchable stuff) is caught before the PR opens, so the human review is a formality.

## What this is and isn't

This is a **thin orchestrator**. It doesn't re-implement any phase — it invokes existing skills and checks a real gate at each seam. It owns two things those skills don't:

1. **A locked requirements contract** (`requirements.md`), frozen with your sign-off before any code, and used as the acceptance target for every later gate.
2. **Ordering + state.** A `progress.md` checklist in `.scratch/<slug>/` records which phase is done. Phases run in order; a phase starts only when the one before it is signed off.

**Honest limit:** a skill is a prompt, so the sequencing prose is soft — the model *can* skip ahead. What makes it hold is that the expensive gates are real tool calls (Codex verdict, lint exit codes, jest), not self-assessment, and the human gates below are hard stops. If it ever drifts in practice, that's the signal to promote this orchestrator to a small script (the SSSF pattern) — not before.

## State layout

```
.scratch/<slug>/
  progress.md        # phase checklist: pending / done, with the gate outcome per phase
  requirements.md    # the locked contract (Phase 1 output) — the acceptance target
  split.md           # the slice plan (Phase 2 output; pr-split-audit also writes ~/.claude/plans/<slug>.md)
```

`<slug>` is a kebab feature name (from the Linear code + title if given). Create the dir and an initial `progress.md` before Phase 1. Update `progress.md` at every gate so a resumed session knows where it is.

## Phase 0 — Frame

Restate the feature in one line and derive `<slug>`. If given a bare `PRE-1234`, fetch the issue title via the Linear MCP rather than guessing. Create `.scratch/<slug>/` and write `progress.md` with all phases pending.

## Phase 1 — Scope and lock the contract  🔒 human gate

0. **Ask clarifying questions first.** Before any tracing, ask the user whatever you need to understand the ask — use `AskUserQuestion` for the decisions with a small set of answers, plain prose for the open ones. Ask only where different answers change what gets built; make routine calls yourself and state the assumption. Skip this step only if the run already began with a `grill-me` pass.
1. Run **`gather-requirements`** — read-only trace + resolve every scope decision *with the user*. This is where "stuff we hadn't considered" gets surfaced while it's a one-line edit, not a PR round-trip. Where a requirement could reasonably be drawn two ways and the two readings build different products, convene **`discussion-room`** (2 senior-engineer + 2 PM seats, grounded in `icp` / `product-philosophy` / `product-overview`, one round, advisory) for options and a recommendation before you decide. It never decides for you.
2. Run **`grill-me`** on the resulting requirement list to pressure-test it before it's frozen.
3. **Freeze** the final numbered list to `.scratch/<slug>/requirements.md`. (The orchestrator writes this file; `gather-requirements` is read-only and won't.) The list is the scope boundary: not listed = not built.
4. **Stop and get explicit sign-off** on `requirements.md`. This is the contract every later gate tests against; an incomplete contract is faithfully shipped incomplete (see `feedback-verifier-contract-scope`). Do not proceed without a yes.

## Phase 2 — Split  🔒 human gate

Run **`pr-split-audit`** against `requirements.md`. It plans slices so the bulk auto-approves in Bugbot and only the feature core needs human domain review; it writes the plan to `~/.claude/plans/<slug>.md`. Copy the slice list + merge order into `.scratch/<slug>/split.md`. Present it and get a single go-ahead (or "one slice, no split"). Opening PRs is outward-facing — the go-ahead covers the whole run.

## Phase 3 — Build + gate each slice, PRE-PR

Per slice, in dependency order (independent leaves in parallel):

1. **Worktree + plan** — follow **`solve-in-worktrees`** Phases 1–2: one sibling worktree off `origin/staging` (branch per `create-branch`), `pnpm i`, then the slice's requirements + solution written out.
2. **Review the plan before building** 🔒 — **`solve-in-worktrees`** Phase 2b: Codex, Gemini (`gemini-3.1-pro` via cursor-agent), and Cursor (`claude-opus-5-high`) review the same plan concurrently against the real codebase — requirement coverage, root cause vs symptom, reuse it's reinventing, blast radius, ambiguity. Cap 2 rounds. It also checks the plan is concrete enough to write tests against, since the approved plan — not the built code — is what the test agents work from. Ambiguity findings come back to you; the approved plan goes to the build agent **and** to T1 at the same moment.
3. **Build + tests, concurrently** — **`solve-in-worktrees`** Phases 3 and 3b: a build agent carrying the approved plan + repo standards (source files only), running alongside three Codex test agents (test files only) — T1 test-requirement gathering, T2 create, T3 update. T1 and T2 work from the **plan**, so tests exist before the code and the suite is deliberately red until the build lands; T1 re-runs over the first diff for behaviour the plan never named, before the verify passes fire. A plan-derived test that disagrees with the implementation is a build finding — the plan wins — unless the plan detail itself was wrong, which comes back to you. All commit locally; sub-agents can't push.
4. **Review until releasable** — run **`/review-feature`** on that worktree with `.scratch/<slug>/requirements.md` (scoped to the slice) as the contract. It owns the whole loop and its two stages: gate the branch pre-PR via `pre-pr-gate` — three passes, each run by Codex, Gemini, and Cursor, cap 4 rounds — then, once you've pushed and opened the PR, loop CI checks + bot comments via `fix-bot-comments` until green with every thread resolved. The loop happens on the branch first, not on a PR someone is watching.
5. **Answer what it surfaces.** `/review-feature` escalates anything the contract doesn't cover back to you; those answers are yours to give. Scope changes go into `requirements.md` (re-sign-off if material); bugs ruled out of scope get one line in `progress.md`.
6. **Open the PR only on Stage 1 RELEASE** — main session pushes and opens it per `create-pr` (base `staging`, assignee `Dwonczykj`, and the web-app four-heading body — Problem / Changes / Testing / Risks — plus the Linear line, or the `skip-template` label to bypass the check), then `/review-feature` continues into Stage 2.

## Phase 4 — Close out

`/review-feature` has already left CI green and every bot thread resolved. On merge, run **`linear-update-issue-on-pr-merge`**. Keep worktrees until merge, then `prune-merged-worktrees`.

## Phase 5 — Final report

**Trigger: every PR in the run passes all CI checks with no unresolved bot comments.** Not before, and not per-slice. If one slice is still contested, say so and hold the report.

Gather the real state first rather than reciting it from memory; each row below is a fact with a command behind it.

```bash
gh pr list --repo Fyxer-AI/web-app --head <branch> --state all   --json number,title,url,state,statusCheckRollup
gh api repos/Fyxer-AI/web-app/pulls/<PR>/comments --paginate   -q '[.[] | select(.user.login | test("bugbot|codex|coderabbit"; "i"))] | length'
```

Then emit three things, in this order.

**1. One paragraph: how much of the feature is built.** Measured against `requirements.md`, not against the slices: which numbered requirements are now live, which were deliberately left out and why, and anything a follow-up owes. Prose, no bullets, no restating the table below.

**2. A table, one row per PR:**

| PR | Title | Status | Unresolved bot comments | Linear |
|---|---|---|---|---|
| [#11091](https://github.com/Fyxer-AI/web-app/pull/11091) | fix: … | merged \| open, checks green \| open, blocked | 0 | [PRE-2761](…) |

PR and Linear cells are hyperlinks, never bare numbers. The bot-comment column counts threads still **requiring attention**, so a thread answered-and-resolved counts 0 and a real open finding counts 1; if any row is non-zero the trigger above was not met, so recheck rather than reporting it. `Typecheck` and `Build` sitting queued behind the staging→main guard is green, not blocked.

**3. A session log, one line per turn**, in order, pairing each of the user's messages with what came back:

```
- **You:** <the ask, one line>  →  **Me:** <what was done or decided, one line>
```

Cover every turn including the ones that changed direction or corrected an earlier assumption; a turn that reversed a decision is the most useful line in the log. No commentary on the log itself.

## Gate summary

| Seam | Gate | Kind |
|---|---|---|
| start of Phase 1 | clarifying questions answered | human |
| after Phase 1 | contract signed off | human |
| after Phase 2 | split approved | human |
| during plan review, before `PLAN OK` | width questions answered — which behaviour of the touched code the tests will freeze (pin / leave / it's a bug) | human |
| after the plan, before the build | plan review `PLAN OK` from Codex, Gemini, **and** Cursor — releases the plan to the build agent *and* to T1 | tool (3 models) |
| plan-derived test vs implementation | plan wins → build finding; wrong plan detail → your call | tool + human |
| any agent-surfaced bug or ambiguity | answered by the user, contract updated | human |
| before each PR opens | `/review-feature` Stage 1 RELEASE (3 passes × Codex + Gemini + Cursor) | tool (Codex + Gemini + Cursor + lint/jest) |
| any complex or out-of-diff finding | `discussion-room` options + recommendation, then decide | tool (panel) + human |
| before merge | `/review-feature` Stage 2: CI green + threads resolved | tool + human |
| all PRs green, no unresolved bot comments | Phase 5 final report emitted | tool |

Update `progress.md` at each row so the run is resumable.
