---
description: "Factory build+verify as a deterministic Workflow: plan-review -> build+tests -> capped verify loop for a WAVE of independent slices, to pre-PR RELEASE (never pushes)."
---
Run Phase 3 (build through pre-PR RELEASE) as a deterministic Workflow instead of prose. This is the "promote the orchestrator to a script" path from `start-feature` line 18 / `solve-in-worktrees`.

Preconditions (all human gates already passed in this interactive session):
- `requirements.md` signed off and `split.md` approved (i.e. `sf:plan` done).
- Slices in this run are INDEPENDENT (a single wave; disjoint files). Dependent slices go in a later wave after their dependency is pushed AND merged.

Models (per role): the script runs four roles on their own model — `build` (real work, default `claude-opus-4-8`), and the thin-driver roles `planReview` / `verify` and the `tests` agents (default `claude-sonnet-5`, since the drivers only parse vendor output). Resolve each role once: per-run flag → `~/.claude/sf-models.json` (set by `/sf:model`s) → blanket `--model` → default. Per-run flags in $ARGUMENTS: `--plan-model`, `--build-model`, `--test-model`, `--verify-model`, and `--model` as the blanket for all four; strip every one out of $ARGUMENTS before slug inference below. Pass the resolved map as `models` in the Workflow args (omit any role you're leaving at default). `--model` alone still works as a blanket override.

Worker provider: the build + test agents (not the review panel) can run on another vendor to spare Anthropic usage — same switch as the interactive `/sf:model-provider`. Resolve it once: if `--provider <anthropic|codex|cursor>` is in $ARGUMENTS use that (strip it out before slug inference), else read `~/.claude/sf-model-provider` (missing = `anthropic`). Pass the result as `provider` in the Workflow args below. `anthropic` spawns Claude agents directly; `codex`/`cursor` route each worker through the `codex-agent`/`cursor-agent` CLI (workspace-write), with a thin Claude driver committing the result so the verify diff sees it. `--model` still pins the driver/Anthropic model regardless of provider.

Setup, then hand off to the script:
1. Locate the feature: remaining slug arg ($ARGUMENTS after stripping `--model`) -> current branch -> most-recent `.scratch/*/progress.md` -> ask. Read `requirements.md` and `split.md`.
2. For each slice in the wave, ensure a sibling worktree exists off `origin/staging` (per `solve-in-worktrees` Phase 1 / `create-branch`), `pnpm i`, and that the slice's requirements + solution are written into `.scratch/<slug>/requirements.md`. Then run `repo-instructions` (consume step) for the worktree's repo — if it has a supplements file, append every rule whose **When** this slice's diff plausibly triggers under a `## Repo build-checks (sf:repo-instructions)` heading in that `requirements.md`, so the build/verify/test agents (including non-Claude vendors) both do it and are checked on it. Do NOT build here — the script does.
3. Call the Workflow tool with:
   `scriptPath: "${CLAUDE_PLUGIN_ROOT}/workflows/build-verify-slice.js"`
   `args: { pluginRoot: "${CLAUDE_PLUGIN_ROOT}", slices: [ { slug, worktree: "<abs path>", pkg: "<lint/typecheck filter, e.g. functions|app>", base: "staging" }, ... ], maxRounds: 4, provider: "<anthropic|codex|cursor, resolved above>", models: { planReview, build, tests, verify }, model: "<blanket --model, if given, else omit>" }`
   (`models` carries only the roles you resolved to a non-default; the script fills the rest. `model` is the blanket fallback; a per-role entry in `models` wins over it.)
   Leave `run_in_background` at its default; a task notification arrives on completion. The script has no filesystem access, so it can't resolve its own plugin path — `pluginRoot` is how it finds the bundled `cursor-agent`/`solve-in-worktrees`/`pre-pr-gate` skills it references in agent prompts. Always pass it, including on the `widthAnswered: true` re-invoke below.

Handle the return (`{ slices: [...] }`), per slice:
- `halted: "width-questions"` -> ask each `widthQuestions` entry with `AskUserQuestion` (three options: pin it / leave it / it's a bug — see `solve-in-worktrees` Phase 2b finding 7). Write the answers into `.scratch/<slug>/requirements.md`, then re-invoke the Workflow with the SAME args (including `provider`, `models` and `model`, if set) plus `widthAnswered: true`.
- `halted: "plan-ambiguity"` -> resolve `planChangesForUser` with the user (convene `discussion-room` if two readings build different products), edit the plan, re-invoke.
- `halted: "max-rounds"` -> report `contested` findings as not-converged (usually a wrong requirement on Pass A, or an over-fitting reviewer on Pass C P1/P2). Don't push.
- `halted: "budget"` -> report and ask whether to continue with more budget.
- `released: true` -> hand THIS slice to `sf:review` Stage 2 (push + open PR per `create-pr`, then loop CI + bots to green). Also surface any `needsHumanCheck` (single-vendor findings the script did not auto-act on) for a quick eyeball.

Update `progress.md` with the per-slice outcome. The script never pushes; push + PR + CI stay here.
