---
description: "Resume the software factory from wherever progress.md left off."
---
Resume the software-factory run.

Locate the feature's state dir. An orchestrated build keeps it in `~/FyxerGh/build-room/<slug>/`; a run before its build, or an orchestrated run started before that move, keeps it in `.scratch/<slug>/` of its checkout. If a slug arg is given ($ARGUMENTS) use `~/FyxerGh/build-room/<slug>/` when it exists, else `.scratch/<slug>/`; else derive `<slug>` from the current git branch and look in the same two places, in that order; else use the most-recently-modified `progress.md` among `~/FyxerGh/build-room/*/` and `.scratch/*/`. If none exists, say so and suggest `sf:start-feature`. If it's ambiguous, list the candidate dirs and ask which.

If `progress.md` has a `## State board` section, the run is orchestrated: run `sf:orchestrate <slug>` and stop here. If Phase 3 is next and `split.md` has more than two slices, do the same.

Read `progress.md` (the phase checklist + last gate outcome) and `requirements.md` (the locked contract). Report in one line: feature, current phase, next pending step.

Then continue the `start-feature` pipeline from the first pending phase — do NOT redo phases already signed off. Honour every human gate that phase carries (contract sign-off, split approval, spec sign-off if one was requested, plan-review verdict, pre-PR RELEASE). Update `progress.md` at each gate so the run stays resumable. The mapping of phases to the underlying skills is in the `start-feature` skill; follow it. Build each slice in a fresh context window: at the start of every slice after the first, hand the run to a new session via `fork-session`, per "One fresh session per slice" in the `start-feature` skill's Phase 3. If you are resuming into a Phase 3 slice other than the first, this session is that slice's fresh session: build only that slice, then fork the next. A slice `progress.md` records as routed by `build-route` keeps its route: for one sent to the factory and not yet merged, resume its watch (the `build-route` skill's step 4) rather than asking again.

Per-role models follow `~/.claude/sf-models.json` (`/sf:models`) and the same per-run flags as `start-feature` (`--build-model`, `--test-model`, `--verify-model`, `--plan-model`, `--model`); worker vendor follows `/sf:model-provider`. Strip any such flag out of $ARGUMENTS before slug/feature inference.
