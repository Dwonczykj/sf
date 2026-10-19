---
description: "Factory build+verify as a deterministic Workflow: plan-review -> build+tests -> capped verify loop for a WAVE of independent slices, to pre-PR RELEASE (never pushes)."
---
Run Phase 3 (build through pre-PR RELEASE) as a deterministic Workflow instead of prose. This is the "promote the orchestrator to a script" path from `start-feature` line 18 / `solve-in-worktrees`.

Preconditions (all human gates already passed in this interactive session):
- `requirements.md` signed off and `split.md` approved (i.e. `sf:plan` done).
- Slices in this run are INDEPENDENT (a single wave; disjoint files). Dependent slices go in a later wave after their dependency is pushed AND merged.
- Each wave runs in its own fresh session: at the start of every slice after the first, hand the run to a new session via `sf:fork-session`, per "One fresh session per slice" in the `start-feature` skill's Phase 3.

Models (per role): the script runs four roles on their own model — `build` (real work, default `claude-opus-5-5`), and the thin-driver roles `planReview` / `verify` and the `tests` agents (default `claude-sonnet-5-5`, since the drivers only parse vendor output). Resolve each role once: per-run flag → `~/.claude/sf-models.json` (set by `/sf:models`) → blanket `--model` → default. Per-run flags in $ARGUMENTS: `--plan-model`, `--build-model`, `--test-model`, `--verify-model`, and `--model` as the blanket for all four; strip every one out of $ARGUMENTS before slug inference below. Pass the resolved map as `models` in the Workflow args (omit any role you're leaving at default). `--model` alone still works as a blanket override.

Worker provider: the build + test agents (not the review panel) can run on another vendor to spare Anthropic usage — same switch as the interactive `/sf:model-provider`. Resolve it once: if `--provider <anthropic|codex|cursor>` is in $ARGUMENTS use that (strip it out before slug inference), else read `~/.claude/sf-model-provider` (missing = `anthropic`). If it is `codex` or `cursor`, check that CLI with `python3 ${CLAUDE_PLUGIN_ROOT}/skills/review-seat/scripts/seats.py probe <codex|cursor>`; on `"ok": false` use `anthropic` and tell me why. Pass the result as `provider` in the Workflow args below. `anthropic` spawns Claude agents directly; `codex`/`cursor` route each worker through the `codex-agent`/`cursor-agent` CLI (workspace-write), with a thin Claude driver committing the result so the verify diff sees it. `--model` still pins the driver/Anthropic model regardless of provider.

Review seats: the script has no filesystem access, so resolve the panel here, once per run, with `review-seat`'s resolver: `python3 ${CLAUDE_PLUGIN_ROOT}/skills/review-seat/scripts/seats.py`, adding `--reviewGemini <slug>` / `--reviewCursor <slug>` for the per-run flags `--gemini-review-model` / `--cursor-review-model` (strip both before slug inference). It reads `~/.claude/sf-tools.json` and `sf-models.json`, checks each chosen vendor now, and prints three seats; a vendor that is missing or logged out becomes a Claude seat on its own model. Pass its `seats` and `singleVendor` straight into the Workflow args. If any seat has a `fallback`, or `singleVendor` is true, tell me in one line before the run starts. The Gemini and Cursor seats bill Cursor, so they default cheap (`gemini-3.8-flash-high`, `gpt-5.3-codex-high`), and the re-verify rounds run on the lead seat only, so most spend is round 1.

Setup, then hand off to the script:
1. Locate the feature: remaining slug arg ($ARGUMENTS after stripping `--model`) -> current branch -> most-recent `.scratch/*/progress.md` -> ask. Read `requirements.md` and `split.md`.
2. For each slice in the wave, ensure a sibling worktree exists off `origin/staging` (per `solve-in-worktrees` Phase 1 / `create-branch`), `pnpm i`, and that the slice's requirements + solution are written into `.scratch/<slug>/requirements.md`. Then run `repo-instructions` (consume step) for the worktree's repo — if it has a supplements file, append every rule whose **When** this slice's diff plausibly triggers under a `## Repo build-checks (sf:repo-instructions)` heading in that `requirements.md`, so the build/verify/test agents (including non-Claude vendors) both do it and are checked on it. Do NOT build here — the script does.
3. Call the Workflow tool with:
   `scriptPath: "${CLAUDE_PLUGIN_ROOT}/workflows/build-verify-slice.js"`
   `args: { pluginRoot: "${CLAUDE_PLUGIN_ROOT}", slices: [ { slug, worktree: "<abs path>", pkg: "<lint/typecheck filter, e.g. functions|app>", base: "staging" }, ... ], maxRounds: 2, provider: "<anthropic|codex|cursor, resolved above>", models: { planReview, build, tests, verify }, seats: <seats.py's seats>, singleVendor: <seats.py's flag>, model: "<blanket --model, if given, else omit>" }`
   (`models` carries only the roles you resolved to a non-default; the script fills the rest. `model` is the blanket fallback; a per-role entry in `models` wins over it.)
   Leave `run_in_background` at its default; a task notification arrives on completion. The script has no filesystem access, so it can't resolve its own plugin path — `pluginRoot` is how it finds the bundled `review-seat`/`solve-in-worktrees`/`pre-pr-gate` skills it references in agent prompts. Always pass it, including on the `widthAnswered: true` re-invoke below.

Handle the return (`{ slices: [...] }`), per slice:
- `halted: "width-questions"` -> ask each `widthQuestions` entry with `AskUserQuestion` (three options: pin it / leave it / it's a bug — see `solve-in-worktrees` Phase 2b finding 7). Write the answers into `.scratch/<slug>/requirements.md`, then re-invoke the Workflow with the SAME args (including `provider`, `models`, `seats`, `singleVendor` and `model`, if set) plus `widthAnswered: true`, and copy that slice's returned `planReview` onto its entry in `slices` (`{ slug, worktree, pkg, base, planReview }`) so the re-run skips plan review.
- `halted: "plan-ambiguity"` -> resolve `planChangesForUser` with the user (convene `discussion-room` if two readings build different products), edit the plan, re-invoke.
- `halted: "max-rounds"` -> report `contested` findings as not-converged (usually a wrong requirement on Pass A, or an over-fitting reviewer on Pass C P1/P2). Don't push.
- `halted: "budget"` -> report and ask whether to continue with more budget.
- `halted: "build-failed"` / `"empty-diff"` -> the build agent errored or committed nothing. Report it, check the worktree, and don't push.
- `released: true` -> hand THIS slice to `sf:review` Stage 2 (push + open PR per `create-pr`, then loop CI + bots to green). Also surface any `needsHumanCheck` (single-seat P1/P2 findings; any P0 blocks) for a quick eyeball.

Report the returned `panel` once for the run: its seats, every `fallbacks` line, and `single-vendor (Claude only)` when `singleVendor` is true.

Update `progress.md` with the per-slice outcome. The script never pushes; push + PR + CI stay here.
