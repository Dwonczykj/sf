---
description: "Factory build: worktree + plan-review + build + tests for a slice (pre-review)."
---
Run the software-factory build phase for a slice (start-feature Phase 3, steps 1–3) via the `solve-in-worktrees` skill.

Feature: infer from the current branch / most-recent `.scratch/*/`, or the slug arg ($ARGUMENTS). Read `requirements.md` and `split.md`. Pick the slice: the arg names it, else the next unbuilt slice in dependency order (independent leaves may run in parallel).

Follow `solve-in-worktrees`:
- one sibling worktree off `origin/staging` (branch per `create-branch`), `pnpm i`, then write the slice's requirements + solution;
- the 3-model plan review (Codex + Gemini `gemini-3.1-pro-high` + Cursor `claude-opus-5-high`) BEFORE building — ambiguity findings come back to me; the approved plan releases to the build agent AND the test agents at the same moment;
- build agent + 3 concurrent Codex test agents (tests exist before the code; the plan wins over a disagreeing plan-derived test unless the plan detail was wrong, which comes back to me);
- all sub-agents commit locally — they can't push.

Stay-hot — only if `--stay-hot` is in the args (strip it before slug inference; if the flag is absent, skip this whole paragraph). At plan-release, before the approved plan goes to the build agent, score every task in the plan 1–5 (whole number, 5 = "absolutely yes a human should write this by hand") on blast-radius (auth, money, migrations, shared/central code = high) + inverted build-agent confidence (the less sure the agent, the higher). Take the single highest-scoring task; only if it reaches 5, assign it to me instead of the build agent — pause and block the worktree until I've written that task myself, then release the rest of the plan and its tests to the agents as normal. At most one hand-off per run. Append one tab-separated line to `~/.claude/sf-stay-hot.log`: `<ISO-date>	<slug>	build	<score>	<task summary>`.

Stop when the branch is built and locally committed. Gating/review is `sf:review`. Update `progress.md`.
