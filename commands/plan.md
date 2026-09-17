---
description: "Factory phases 0–2 only: frame, scope + lock the requirements contract, split, then an optional spec."
---
Run the software-factory planning phases only (start-feature Phases 0–2), then stop.

Feature: $ARGUMENTS (or infer from the current branch / most-recent `.scratch/*/`). Create or keep `.scratch/<slug>/`.

1. Frame — one-line restatement, derive `<slug>`; if given a bare PRE-#### fetch the title via the Linear MCP rather than guessing. Write/update `progress.md` with all phases pending. Also run `repo-instructions` (load step) for this repo — if it has a supplements file, hold its rules for the Scope step.
2. Scope — run `gather-requirements` (read-only trace + resolve every scope decision WITH me; surface what we hadn't considered while it's still a one-line edit). Among the scope decisions, raise every `repo-instructions` rule whose **When** the planned diff plausibly triggers (e.g. a Firestore model change obliging a `sync-functions` update); a yes becomes a numbered requirement. Escalate genuinely two-way readings to `discussion-room` for options + a recommendation before deciding. Then `grill-me` the resulting list. Freeze the final numbered list to `requirements.md` and get my explicit sign-off — this is the acceptance contract every later gate tests against; do not proceed without a yes.
3. Split — run `pr-split-audit` against `requirements.md`; copy the slice list + merge order into `split.md`; present it and get one go-ahead (or "one slice, no split").
4. Spec (optional) 🔒 — once the plans are done and **always** before building anything substantial, ask me plainly whether this needs a spec. If I say no, skip. If I say yes, spawn one **Opus 4.8 (High reasoning)** agent to write it:
   - It first `grill-me`s me on the approved plan (`requirements.md` + `split.md`) until there is **zero** ambiguity about the requirements the design will encode. The grilling result is the spec's only input.
   - It then writes `design.md`, and after that `plan.md`, into the repo spec tree, following `specs/README.md` (placement, numbering-at-promotion) and `specs/_templates/{design.md,plan.md}` exactly — same shape and headings as the existing `specs/` examples.
   - The spec must be **shorter and more concise than the examples**, exceptionally short, and use **no vernacular** — plain words that senior leadership can read. Cut anything the templates don't require.
   - Get my sign-off on `design.md` before it writes `plan.md`, and on `plan.md` before finishing.
   - The spec files ride the **first code PR in the stack**, not a PR of their own: leave them in the repo spec tree for now; the build phase commits them onto the first slice in merge order. Don't add a spec PR to `split.md`.

Stop after the split (and, if requested, the spec) is approved. Mark phases done in `progress.md`. Building is `sf:build`.
