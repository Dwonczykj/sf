---
description: "Factory build: worktree + plan-review + build + tests for a slice (pre-review)."
---
Run the software-factory build phase for a slice (start-feature Phase 3, steps 1–3) via the `solve-in-worktrees` skill.

Feature: infer from the current branch / most-recent `.scratch/*/`, or the slug arg ($ARGUMENTS). Read `requirements.md` and `split.md`. Pick the slice: the arg names it, else the next unbuilt slice in dependency order (independent leaves may run in parallel).

Models (per role): resolve each role's model once — per-run flag → `~/.claude/sf-models.json` (set by `/sf:models`) → blanket `--model` → default. In this prose path the only spawned Claude sub-agents are `build` (the build agent, default `claude-opus-4-8`) and `tests` (T1/T2/T3, default `claude-sonnet-5`); plan review runs inline (vendor CLIs directly, no Claude driver), so its model is this chat session's, not a role. Per-run flags in the args (strip before slug inference): `--build-model`, `--test-model`, and `--model` as the blanket for both. (The `planReview`/`verify` role models apply to the deterministic `sf:build-verify` workflow, where those drivers are sub-agents.)

Provider: read `~/.claude/sf-model-provider` (missing = `anthropic`; set by `/sf:model-provider`) and route the build + test workers per its contract:
- **`anthropic`** — spawn via the `Agent` tool with each role's resolved model (build agent → `build`, test agents → `tests`), passed explicitly on every call, don't leave it unset.
- **`codex`** — run each worker through the `codex-agent` skill instead of the `Agent` tool: `node ${CLAUDE_PLUGIN_ROOT}/skills/codex-agent/scripts/run-agent.mjs --sandbox workspace-write --cwd <worktree>` (workspace-write so the build agent can edit; the test agents write test files the same way). The thin Claude driver still uses the role's resolved model.
- **`cursor`** — run each worker through the `cursor-agent` skill: `node ${CLAUDE_PLUGIN_ROOT}/skills/cursor-agent/scripts/run-agent.mjs --model claude-opus-5-high --cwd <worktree>`.

This does not affect the plan-review vendors (Codex/Gemini/Cursor) — those are pinned to their own external models regardless of the worker models above.

Follow `solve-in-worktrees`:
- one sibling worktree off `origin/staging` (branch per `create-branch`), `pnpm i`, then write the slice's requirements + solution;
- the 3-model plan review (Codex + Gemini `gemini-3.8-flash-high` (via cursor-agent) + Cursor `gpt-5.3-codex-high`) BEFORE building — ambiguity findings come back to me; the approved plan releases to the build agent AND the test agents at the same moment;
- build agent + 3 concurrent Codex test agents (tests exist before the code; the plan wins over a disagreeing plan-derived test unless the plan detail was wrong, which comes back to me);
- all sub-agents commit locally — they can't push.

Stay-hot — only if `--stay-hot` is in the args (strip it before slug inference; if the flag is absent, skip this whole paragraph). At plan-release, before the approved plan goes to the build agent, score every task in the plan 1–5 (whole number, 5 = "absolutely yes a human should write this by hand") on blast-radius (auth, money, migrations, shared/central code = high) + inverted build-agent confidence (the less sure the agent, the higher). Take the single highest-scoring task; only if it reaches 5, assign it to me instead of the build agent — pause and block the worktree until I've written that task myself, then release the rest of the plan and its tests to the agents as normal. At most one hand-off per run. Append one tab-separated line to `~/.claude/sf-stay-hot.log`: `<ISO-date>	<slug>	build	<score>	<task summary>`.

Stop when the branch is built and locally committed. Gating/review is `sf:review`. Update `progress.md`.
