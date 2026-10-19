---
name: size-change-impact
description: Size a code change's business impact with prod data BEFORE it ships, and plan the analytics the change must record so the impact can be measured AFTER it ships. Briefs the impact-analyst agent to measure the baseline, back-test the change on past data, price it, and write a measurement plan with default follow-up timing from a power calculation. Use when the user asks "what is the impact of this PR/change", "size this", "give me the data/evidence", "is this worth building", or at the planning step of a factory run (sf start-feature Phase 1). After the prod release, measure-change-impact runs the plan.
user_invocable: true
arguments: "[PR / ticket / feature / planned change]"
---

# size-change-impact

The "before" of a three-part loop: **size** (this skill) → **build with the measurement in it** → **measure** after the prod release (`sf:measure-change-impact`). The method lives in `method.md` beside this file (`${CLAUDE_PLUGIN_ROOT}/skills/size-change-impact/method.md`). The work runs in the `sf:impact-analyst` agent.

## 1. Tier the change

Decide how much sizing it deserves before spending queries on it:

- **None**: `chore:`, refactors, docs, tests, or a change nothing measurable reads. Write one line in the plan and stop: "No measurable business impact: <reason>". No follow-up.
- **Light**: a fix or feature with an obvious metric and data already recording it. Baseline for one week, primary metric, power-based follow-up. No back-test.
- **Full**: anything touching cost, billing, a funnel, a model's output, or a number someone reports. The whole method.

Say which tier and why in one sentence. The user can override it.

## 2. Brief the agent

Find the state dir: the folder holding the run's `progress.md`, which is `~/FyxerGh/build-room/<slug>/` after an orchestrate adopt, else `.scratch/<slug>/` in the worktree. Outside a factory run, use `.scratch/<slug>/` at the repo root (`git rev-parse --show-toplevel`).

Spawn the `sf:impact-analyst` agent (subagent_type `sf:impact-analyst`, run in the background unless the next step needs it). The brief must stand alone:

- the change: PR or ticket link, the requirements or diff, and what it is meant to change;
- the tier;
- the repo root, the slug, the report path `<state dir>/impact.md` and the log dir `<state dir>/impact/`, all absolute;
- the absolute path of `method.md` (expand `${CLAUDE_PLUGIN_ROOT}` above);
- any figures already claimed, so it reproduces them rather than repeats them;
- "Follow method.md; write the report in the output contract below."

## 3. Output contract (the report)

Sections, so the planner, the PR and the follow-up can lift them directly:

1. **Verdict**: what changes, for whom, how big, how sure. One paragraph.
2. **Gap / baseline table**: the primary metric today vs ground truth vs the change (back-test or projection), in units and dollars or users.
3. **Supporting metrics**: why the gap exists, who is affected, edge-case floors and ceilings.
4. **What this does not show**: limits, provisional prices, sources not checked, figures not measured and why.
5. **Measurement plan**:
   - primary metric: definition, query (inline SQL or log filter), pass threshold;
   - guardrails: each with a threshold;
   - **measurement requirements**: each signal the change must emit to be measurable (log code, product analytics event, usage event, metric), where it is emitted, and who reads it. Written as numbered requirements so the planner can paste them into `requirements.md`;
   - **follow-up timing**: `follow_up_days` and `follow_up_hours` from the power calculation in `method.md`, showing `m`, `s`, `d`, `n` and the lag source, plus concurrent releases that could confound a pre/post.

## 4. Use the result

- **In a factory run**: the measurement requirements join `requirements.md` before sign-off, so the build and its tests include them.
- **In the PR**: add `## Supporting evidence & Impact` between Testing and Risks. Include the gap table, a per-day table if there is one, the downstream effect, edge-case sizes, the limits, the measurement plan, and the primary query in a `<details>` block.

## After the prod release

Run `sf:measure-change-impact schedule` with the slug. It defaults the follow-up to the report's `follow_up_days` and `follow_up_hours`.
