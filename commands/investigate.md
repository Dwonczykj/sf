---
description: "Investigate a reported issue first — grill, root-cause, problems + requirements, decide on a spec — then run the factory."
---
Run the software factory starting from an **investigation**, not a feature brief. Use this when the input is a reported problem/bug ("X is broken", a support incident, a screenshot of a failure) rather than a clean feature ask. It front-loads Phases I0–I3 below, then hands into the normal `start-feature` pipeline from Split onward.

Issue: $ARGUMENTS (or infer from the current branch / most-recent `.scratch/*/`). Derive a kebab `<slug>` (from the Linear code + title if a bare `PRE-####` is given — fetch the title via the Linear MCP). Create `.scratch/<slug>/` and write `progress.md` with all phases below pending, then the standard `start-feature` phases (Split → Build+gate → Close-out → Final report) pending after them.

## Phase I0 — Frame + grill  🔒 human gate
Restate the reported issue in one line: symptom, who hit it, expected vs actual. **If the problem statement is unclear, ambiguous, or missing the expected behaviour, run `grill-me` on it BEFORE investigating** — never trace code against a fuzzy problem. Pin down: what's actually broken, what "correct" looks like, and how far the blast radius is thought to reach. Skip the grill only if the report is already unambiguous; say so in one line if you skip it.

## Phase I1 — Investigate (read-only)
Trace the codebase to **root cause**, changing nothing. Spawn parallel read-only `Explore` agents (and `Plan` for the fix shape) to map the data model, the failing paths, and the actual logic/authorisation producing the symptom — as many as the surface needs, in one message. Reconcile their findings yourself; verify the load-bearing file:line claims directly before relying on them. Freeze the result to `.scratch/<slug>/problems.md`: a numbered problem list, each entry = symptom → mechanism → `file:line`, with the single shared root cause called out where several symptoms share one. Distinguish the reported problem from adjacent findings (own-PR candidates). Do NOT fix anything here.

## Phase I2 — Requirements  🔒 human gate
Turn the problems into the acceptance contract. Resolve every design fork **with the user** — `AskUserQuestion` for closed decisions (copy vs share, snapshot vs sync, which capabilities, orphan handling…), prose for the open ones; ask only where different answers build different products, and state the assumption where you make a routine call yourself. Then run `grill-me` on the resulting list to pressure-test it. **Freeze** the final numbered, outcome-phrased list to `.scratch/<slug>/requirements.md` (the orchestrator writes this file) and get explicit sign-off — this is the contract every later gate tests against; an incomplete contract ships faithfully incomplete. Do not proceed without a yes.

## Phase I3 — Spec decision  🔒 human gate
Decide **with the user** whether this warrants a spec folder before building. Lead with one opinionated recommendation, not a menu (per `specs/README.md`). Recommend a spec when any `specs/README.md` "big or irreversible" trigger is hit — schema / data-model change or migration, auth / billing / stored-customer-data / retention, a public API or contract change, a net-new service, spans 3+ workspaces — or the approach is genuinely contested; recommend skipping it for a contained fix or in-package refactor.
- **Spec warranted →** create the folder per `specs/README.md`: co-located (one workspace → `<workspace>/specs/NNN-slug/`, else root `specs/NNN-slug/`), next free `NNN` at that path. Write `design.md` (problem + the frozen requirements + high-level design, grounded in the investigation) and `plan.md` (files, tasks, verification). `requirements.md` stays the machine contract; `design.md` is the human-aligned narrative. If the user would rather keep the design/plan out of the repo, mirror them to `docs-private` instead and leave a pointer in `.scratch/<slug>/`.
- **Not warranted →** record "no spec — <reason>" in `progress.md` and go straight on.

## Hand into the factory
From here run the **`start-feature`** skill from **Phase 2 (Split) onward** — `pr-split-audit` against `requirements.md` → build + gate each slice pre-PR in worktrees (3-model plan review, build + Codex test agents) → `review-feature` (pre-PR gate, then CI + bot-comment loop) → close-out → final report. Do not re-run scope: I0–I2 already produced the signed contract that `start-feature` Phase 1 would. Honour every human gate and update `progress.md` at each seam so `sf:continue` / `sf:build` / `sf:review` / `sf:ci-green` resume this run cleanly.

`--model <slug>` (strip before slug inference) and `--stay-hot` pass through to the build/review phases as in `sf:build` / `sf:review`.
