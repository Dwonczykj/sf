---
description: "Seed the factory from THIS session's context (+ any existing spec), cut a branch, then run start-feature from the first unmet gate."
---
Adopt work already scoped in the current session into the software factory. Unlike `sf:start-feature` (cold start) and `sf:continue` (resume persisted `.scratch/` state), this one **synthesises the conversation you're already in** — plus any `specs/<n>-<slug>/` design+plan already written — into a draft contract, cuts the branch, and hands to the `start-feature` pipeline entering at the first gate the seed doesn't already satisfy.

Feature: $ARGUMENTS if given, else infer from this session's context.

1. **Frame + type.** Restate the work in one line and derive `<slug>`. Classify the work from what it actually does — `feat` / `fix` / `chore` / `refactor` / `experiment` / `perf` / `docs` / `test` — using the same problem-framing the web-app PR template expects; state the type you picked and why. If a bare `PRE-####` is in play, fetch the title via the Linear MCP.

2. **Cut the branch.** Run the `create-branch` skill (base `staging` for web-app), passing the type + slug + any Linear code from step 1. Honour its dirty-tree stop: never stash or discard without being told.

3. **Seed the contract.** Create `.scratch/<slug>/` and synthesise, from the session context and any existing `specs/<n>-<slug>/{design,plan}.md`:
   - `requirements.md` — the numbered requirement list implied by what's already been decided this session. Mark it **DRAFT — not signed off**.
   - `split.md` — if a plan already names slices/PRs, copy them in; else leave a note that the split is pending.
   - `progress.md` — the start-feature phase checklist, with each phase the seed already covers marked **seeded (draft)**, everything else **pending**. Record the spec path if one exists.
   Seeding never counts as sign-off. A seeded phase is a draft to confirm, not a gate to skip.

4. **Report the gap in one line:** which phases are seeded-draft, which are still open, and the first gate that needs you (usually the Phase 1 contract sign-off).

5. **Hand to the pipeline.** Continue the `start-feature` pipeline (see its skill) from that first unmet gate:
   - At Phase 1, do **not** re-grill from zero. Grill only to close the gaps in the seeded `requirements.md`, then get explicit sign-off — the seeded contract is a starting draft, the sign-off gate is still hard.
   - Phase 2 split, optional Phase 2.5 spec, then Phase 3 build+verify per slice, through `create-pr`, exactly as `start-feature` defines. Honour every human gate; update `progress.md` at each.

The point is to not throw away scoping the session already did, while keeping every start-feature gate intact. If nothing in the session is actually scoped yet, say so and suggest `sf:start-feature` instead.
