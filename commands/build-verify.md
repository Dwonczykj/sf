---
description: "Factory build+verify as a deterministic Workflow: plan-review -> build+tests -> capped verify loop for a WAVE of independent slices, to pre-PR RELEASE (never pushes)."
---
Run Phase 3 (build through pre-PR RELEASE) as a deterministic Workflow instead of prose. This is the "promote the orchestrator to a script" path from `start-feature` line 18 / `solve-in-worktrees`.

Preconditions (all human gates already passed in this interactive session):
- `requirements.md` signed off and `split.md` approved (i.e. `sf:plan` done).
- Slices in this run are INDEPENDENT (a single wave; disjoint files). Dependent slices go in a later wave after their dependency is pushed AND merged.

Setup, then hand off to the script:
1. Locate the feature: slug arg ($ARGUMENTS) -> current branch -> most-recent `.scratch/*/progress.md` -> ask. Read `requirements.md` and `split.md`.
2. For each slice in the wave, ensure a sibling worktree exists off `origin/staging` (per `solve-in-worktrees` Phase 1 / `create-branch`), `pnpm i`, and that the slice's requirements + solution are written into `.scratch/<slug>/requirements.md`. Do NOT build here — the script does.
3. Call the Workflow tool with:
   `scriptPath: "/Users/joey/.claude/local-plugins/sf/workflows/build-verify-slice.js"`
   `args: { slices: [ { slug, worktree: "<abs path>", pkg: "<lint/typecheck filter, e.g. functions|app>", base: "staging" }, ... ], maxRounds: 4 }`
   Leave `run_in_background` at its default; a task notification arrives on completion.

Handle the return (`{ slices: [...] }`), per slice:
- `halted: "width-questions"` -> ask each `widthQuestions` entry with `AskUserQuestion` (three options: pin it / leave it / it's a bug — see `solve-in-worktrees` Phase 2b finding 7). Write the answers into `.scratch/<slug>/requirements.md`, then re-invoke the Workflow with the SAME args plus `widthAnswered: true`.
- `halted: "plan-ambiguity"` -> resolve `planChangesForUser` with the user (convene `discussion-room` if two readings build different products), edit the plan, re-invoke.
- `halted: "max-rounds"` -> report `contested` findings as not-converged (usually a wrong requirement on Pass A, or an over-fitting reviewer on Pass C P1/P2). Don't push.
- `halted: "budget"` -> report and ask whether to continue with more budget.
- `released: true` -> hand THIS slice to `sf:review` Stage 2 (push + open PR per `create-pr`, then loop CI + bots to green). Also surface any `needsHumanCheck` (single-vendor findings the script did not auto-act on) for a quick eyeball.

Update `progress.md` with the per-slice outcome. The script never pushes; push + PR + CI stay here.
