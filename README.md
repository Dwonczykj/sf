# sf — software factory

The `start-feature` pipeline as a namespaced set of `sf:` commands, so you can run the whole factory or enter at any phase and resume from saved state.

All commands share one state contract: `.scratch/<slug>/` holding `progress.md` (phase checklist + gate outcomes), `requirements.md` (the locked acceptance contract), and `split.md` (the slice plan). Commands that don't take a slug locate the feature by: slug arg → current git branch → most-recently-modified `.scratch/*/progress.md` → ask.

| Command | Does |
|---|---|
| `sf:start-feature <idea\|PRE-####>` | Full pipeline, idea → open PR. Delegates to the `start-feature` skill. |
| `sf:continue [slug]` | Read `progress.md`, resume from the first pending phase. |
| `sf:plan [idea\|PRE-####]` | Phases 0–2 only: frame, scope + lock `requirements.md`, split. Stops at split approval. |
| `sf:build [slug\|slice]` | Worktree + 3-model plan review + build + tests for a slice, as prose (model-driven). Commits locally, no push. |
| `sf:build-verify [slug]` | Same Phase 3 machine as a **deterministic Workflow**: schema'd `PLAN OK`/`RELEASE` verdicts, cross-vendor (Codex+Gemini+Cursor) `parallel()` thunks, capped build↔verify loop over a wave of independent slices, to pre-PR RELEASE. Halts back to you for width questions. Never pushes. |
| `sf:review [branch\|PR\|slug]` | `review-feature`: gate pre-PR (3 models), open PR on RELEASE, loop CI + bots to green. |
| `sf:ci-green [PR]` | Just the CI/bot loop: `fix-bot-comments` until all checks green + threads resolved, asking before any fix that adds more complexity than the feature warrants. |

The phase commands delegate to the existing skills (`gather-requirements`, `grill-me`, `pr-split-audit`, `solve-in-worktrees`, `review-feature`, `pre-pr-gate`, `fix-bot-comments`, `discussion-room`) — one implementation each, no forks.

## `sf:build` (prose) vs `sf:build-verify` (Workflow)

`start-feature` line 18 flags its own soft spot: the phase ordering and the 3-model vote are prose the model executes by hand, so it *can* skip ahead. `sf:build-verify` is the "promote the orchestrator to a script" answer to that — the Phase 3 machine (plan-review → build + 3 test agents → 3-pass × 3-model verify → capped build↔verify loop) as `workflows/build-verify-slice.js`, where the verdicts are schema-validated objects, the 2-of-3 reconciliation is real code, the loop cap is a real loop, and an interrupted run resumes via `resumeFromRunId` instead of re-running every verify.

What stays out of the script, on purpose (a Workflow is headless and can't call `AskUserQuestion`): the width-question gate (the script returns the questions and halts the slice), the plan-ambiguity gate, and push + PR + CI. Those are the human seams `start-feature` is built around; `sf:build-verify` runs the deterministic stretch *between* them. Cross-vendor diversity is preserved — each reviewer is the real Codex/Gemini/Cursor invoked from inside a thin Claude driver agent, not three Claude agents.

Use `sf:build` when you want to watch and steer a single slice; use `sf:build-verify` for a wave of independent slices you want run to RELEASE hands-off and resumable.

Editing the workflow: the script lives at `workflows/build-verify-slice.js`. Reinstall (or restart) after editing so the installed copy under `plugins/cache/` picks it up, same as the `.toml` commands.

## Stay-hot mode (`--stay-hot`)

Opt-in on `sf:build` and `sf:review` to keep your own coding skill from rusting while the factory does the typing. Off by default; only fires when you pass the flag.

- On `sf:build`, at plan-release each task is scored **1–5** (whole number, 5 = "absolutely yes a human should write this") on **blast-radius + inverted build-agent confidence**. The single highest task, only if it hits **5**, is handed to you: the worktree **pauses and blocks** until you've written it, then the agents build the rest and its tests. At most one hand-off per run.
- On `sf:review`, the same score is applied to required fixes; the single highest fix, only if a **5**, is yours to write, blocking the loop until done.

Frequency is the threshold, not a percentage — only a 5 fires, so hand-offs stay rare across features. Every decision is logged (date, slug, phase, score, summary) to `~/.claude/sf-stay-hot.log`. There's no tuner yet: eyeball the log and adjust by hand if 5s fire too often or too rarely.

Not yet honoured by `sf:build-verify` (the deterministic Workflow) — that path needs a new halt reason in `workflows/build-verify-slice.js`, so for now use `sf:build` when you want stay-hot on the build phase.

## Install

```
/plugin install sf@sf
```

If the marketplace isn't found, add it first: `/plugin marketplace add ~/.claude/local-plugins/sf`.

## Edit

Edit the `.toml` files in `commands/` directly, then reinstall (or restart) to pick up changes.
