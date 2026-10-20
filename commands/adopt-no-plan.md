---
description: "Like sf:adopt, but skips the human plan gates: infers requirements.md/split.md from this session's context and runs straight through build, verify and review on that inferred contract."
---
Same seeding as `sf:adopt`, but the inferred contract is treated as final instead of draft-for-sign-off — the two Phase 1/2 **human** gates (requirements sign-off, split approval) are skipped. The Phase 3/4 **AI** gates (plan-review, build↔verify loop, pre-PR RELEASE, CI/bot loop) still run in full; this only removes the stop-and-ask-me steps. Use only when you'd rather trade that sign-off for speed — say so if the session hasn't actually scoped anything yet, since inferring from nothing is worse than asking.

Feature: $ARGUMENTS if given, else infer from this session's context.

1. **Frame + type + branch.** Same as `sf:adopt` steps 1–2: restate the work in one line, derive `<slug>`, classify the type (`feat`/`fix`/`chore`/`refactor`/`experiment`/`perf`/`docs`/`test`) from what it actually does, fetch a bare `PRE-####` title via the Linear MCP if given, then run `create-branch` (base `staging` for web-app) with that type + slug + Linear code. Honour its dirty-tree stop — never stash or discard without being told.

2. **Seed the contract as final, not draft.** Create `.scratch/<slug>/` and write, from the session context and any existing `openspec/changes/<slug>/`:
   - `requirements.md` — the numbered requirement list implied by what's already been decided this session. Header it **INFERRED — no human sign-off**, not "DRAFT", so `progress.md` and anyone reading it later know this run skipped that gate.
   - `split.md` — the slice list if one was already discussed this session, else one slice covering the whole feature.
   - `progress.md` — mark Phase 0 (frame) and Phase 1/2 (contract + split) **skipped (inferred)** — not pending, not signed-off. Record the OpenSpec change slug if one exists.
   Do not run `gather-requirements` or `grill-me` and do not ask for sign-off on either file — those steps are exactly what this command exists to skip. If the session gives you nothing to infer a feature from, say so and suggest `sf:start-feature` or `sf:adopt` instead.

3. **Continue the pipeline from Phase 3,** exactly as `sf:continue` would, feeding `requirements.md` and `split.md` from step 2 in as the contract every remaining gate tests against:
   - Phase 3: plan-review (3 models), build + test agents, verify loop — per slice, in dependency order from `split.md`, each slice after the first in a fresh session forked via `sf:fork-session` ("One fresh session per slice" in `start-feature`).
   - Phase 4: pre-PR gate, PR creation, CI/bot-comment loop.
   These gates are unchanged from `start-feature` — they're AI verdicts, not the human sign-off this command skips. A slice that fails plan-review or verify loops exactly as it would under `sf:build-verify`; don't relax it because the contract feeding it was inferred rather than signed off.

4. **Report** which requirements and split were inferred (one line each), alongside the usual per-slice/PR reporting, so it's traceable later that this run skipped human sign-off.

Per-role models follow `~/.claude/sf-models.json` (`/sf:models`) and the same per-run flags as `start-feature` (`--build-model`, `--test-model`, `--verify-model`, `--plan-model`, `--model`); worker vendor follows `/sf:model-provider`. Strip any such flag out of $ARGUMENTS before feature inference.
