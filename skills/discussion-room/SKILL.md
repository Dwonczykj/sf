---
name: discussion-room
description: Convene a bounded advisory panel of senior-engineer and product-manager personas to explore a genuinely contested decision, produce options with trade-offs, and recommend one. Grounded in the repo's own product rules, read-only, advisory only, never a gate. Use when a scope decision is unresolved, when two model reviewers split on a plan, when a review finding is complex or reaches outside the PR's diff and needs brainstorming before a fix is chosen, or when the user says "take this to the discussion room", "/discussion-room", "brainstorm this with the panel".
user_invocable: true
---

# discussion-room

A room you take a hard decision into, not a stage every change passes through.

Every other gate in the factory resolves to something with ground truth: a lint exit code, a jest result, a `file:line` citation. This one does not. A persona has no evidence source of its own, which is exactly why it is bounded, grounded, and advisory. Ungrounded it produces confident opinion, and a loop cannot tell that from signal.

## When to convene

Only when a decision is genuinely contested and no tool call can settle it. In practice, three entry points:

1. **Scope (during `gather-requirements`).** A requirement could reasonably be drawn two ways and the two readings build different products.
2. **Plan (after `solve-in-worktrees` Phase 2b).** The two plan reviewers split, or both flag the same ambiguity, and the right design is a judgement call rather than a fact about the codebase.
3. **Review (during `pre-pr-gate` / `/review-feature`).** A finding is **complex**, **may change scope outside this PR's diff**, or needs options explored before one is chosen. This is the case the room exists for: not "this line is wrong" but "fixing this properly touches three other surfaces and we should decide how far to go."

**Do not convene** for anything a tool call, a grep, or a single reviewer already answers; for a finding with an obvious owner and an obvious fix; for style nits; or to break a tie you could break by reading the code.

## Composition

`m` senior-engineer personas and `n` product-manager personas. **Default `m = 2`, `n = 2`.** Raise only for a decision that is large and hard to reverse, and say why. Each persona is one agent call, so the room costs `m + n` on top of whatever else that phase is already spending.

- **Senior engineer** owns feasibility, blast radius, what breaks, what it costs to maintain, and whether a simpler version gets most of the value.
- **Product manager** owns whether the option serves Mike, what it does to the surface area, and whether the value is worth the complexity.

## Grounding, which is what makes it worth running

Every persona prompt carries, and every persona must cite:

- `.claude/rules/icp.md`, `product-philosophy.md`, `product-overview.md` for the PM seats;
- `coding-standards.md`, `backend-standards.md` / `frontend-standards.md` plus the relevant code for the engineer seats;
- the locked `requirements.md`, and the diff or plan under discussion.

**A claim with no citation is dropped, not weighed.** "This adds cognitive load" is worth nothing; "this violates product-philosophy's Simplicity above all because Mike has to find a setting to get value" is a finding. Personas are read-only: they never edit, create, or delete a file.

## Panel, not debate

Each persona answers **independently, in one round**, all calls concurrent. There is no cross-talk, no rebuttal round, no convergence loop. This matches how every other multi-model step here works (independent passes, then reconcile), and it is the difference between a bounded cost and an open one. Reconciling is the main session's job, using the same rule as the verify passes: agreement across seats is signal, a lone claim gets checked before it is acted on, and a split gets read against the code and the product rules rather than voted on.

## Output

One block, back to the caller:

```
Discussion room — <the decision, one line>
Options
  1. <option> — for: <…>  against: <…>  cites: <rule / file:line>
  2. …
Recommendation: <option n>, because <one sentence>
Dissent: <any seat that disagreed, and on what grounds>
Needs human: <yes + the specific question | no>
```

**It never blocks and never decides.** The recommendation goes to whoever convened the room. If the decision changes scope it goes into `requirements.md` and gets re-signed-off; if it settles a build question it goes to the build agent as a finding; if the seats could not resolve it, `Needs human: yes` names the question and stops.

## Cap

One round per decision. If the room does not produce a recommendation the caller can act on, that is a signal the decision is the user's to make, not a reason to convene it again with more seats.
