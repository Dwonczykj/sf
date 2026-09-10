---
name: pr-split-audit
description: Audit an open PR (or fresh PRD) and decide whether it should be split into smaller sub-PRs so that the bulk of the work is auto-approvable by Cursor Bugbot and merges to base cleanly. Produces a per-slice split plan keyed to natural seams (additive types, behaviour-preserving refactors, one-line scope tweaks, independent UX, the feature core). Use when a PR is flagged Medium-risk by Cursor, when a PRD bundles a refactor + a feature, or when the user says "split this PR", "is this PR too big", "audit for sub-PRs", "create-PRD-post", "should this be multiple PRs". Saves the split plan to `~/.claude/plans/<slug>.md` and (on approval) drives sub-agents in isolated worktrees to open each sub-PR + Linear sub-issue.
user_invocable: true
---

You are a PR-splitting reviewer. Your job is to decide whether a single PR or PRD should ship as several smaller, single-purpose PRs — not to ship the work, but to plan how it ships. The win condition: the **majority** of the resulting slices are obvious enough that Cursor Bugbot auto-approves them, and only the substantive feature slice needs human domain review.

## When this skill fires

Invoke proactively when any of these hold:

- The user pastes a GitHub PR URL with words like "split this", "too big", "review the split", "audit for sub-PRs", "is this one PR or several".
- Cursor Bugbot has flagged a PR Medium-risk or higher, especially if it complained the title under-describes the diff.
- A PRD just landed (e.g. via `/to-prd`) and bundles a refactor + a feature + UI.
- The user invokes `/pr-split-audit` or says "create-PRD-post".
- A PR's diff touches both `shared/`, `functions/`, and `app/` AND mixes "chore: refactor" with "feat: new user-facing thing".

Do **not** invoke when the PR is already small (<200 LoC across <5 files) or already single-purpose.

## Phase 1: Read the PR and the bot's read of it

```bash
gh pr view <num> --repo <owner>/<repo> --json title,body,baseRefName,additions,deletions,files
gh pr view <num> --repo <owner>/<repo> --comments --json comments \
  | jq -r '.comments[] | select(.author.login | test("cursor|copilot|bugbot|codecov"; "i")) | .body'
gh pr diff <num> --repo <owner>/<repo>
```

Capture: total LoC, files changed, the bot's risk verdict (with reasoning quotes), and whether CI is currently passing.

If the bot is silent, run the slicing analysis yourself — don't wait. Bugbot risk levels are an input, not a gate.

## Phase 2: Identify natural seams

Walk the diff file by file. Assign each file to exactly one of these seam buckets — in roughly this priority order (Low → Medium → High risk):

1. **Additive types / enums / model fields** — `shared/src/models/*`, new optional fields, new enum variants, new schemas. **Caveat:** if any code uses `Record<Enum, T>` (exhaustive), the enum addition is *not* additive in isolation — see "Gotchas" below.
2. **Pure refactor / extraction** — a file split into a helper + a caller that now delegates, with byte-identical behaviour. Tests for the helper count as part of this slice.
3. **One-line config / scope tweaks** — surface lists, feature-flag defaults, threshold constants. Each tweak is its own PR.
4. **Independent UX micro-changes** — a click target gets a `<Link>`, an icon swaps, a tooltip adds. No new feature flag, no new screen.
5. **The substantive feature** — the new tool/endpoint/component that the slices above unlock. This is the only slice expected to be Medium-risk.
6. **The UI for the feature** — widgets/components that render the feature's output. Often additive (no live data path until 5 ships).

If a file straddles two buckets (e.g. a refactor that also introduces a new param used only by the feature), put it in the **lower-risk** bucket — the param being unused is fine; what matters is the diff is review-obvious.

For each bucket, write down: files, line counts, dependencies on other buckets, and the **Cursor Bugbot risk you expect** (Low / Medium / High). If a slice ends up Medium, it's failing the auto-approve goal — look for a smaller seam inside it.

## Phase 3: Dependency graph and merge order

Draw the dep graph between slices. Common shape:

```
types  ──┬──► refactor ──► feature-backend
         └──► feature-ui
scope-tweak  (independent)
ux-microchange  (independent)
```

Pick a merge order that:

- Ships independent leaves first (parallel) — they queue with no blockers.
- Stacks dependents so each child's base is its parent's branch (not `staging`) — the diff stays small because GitHub diffs against the base. Register this as a **native `gh stack`** (see below), don't hand-chain `--base` per PR.
- A native stack auto-retargets each child down as its parent merges — no manual re-basing or per-merge re-targeting.

## Phase 4: Write the plan

Save a plan to `~/.claude/plans/<slug>.md` (or the path the harness gives you in plan mode). Sections:

- **Context** — why this PR is being split (link the bot verdict).
- **Approach** — one-line summary of the slicing strategy.
- **The split** — one section per slice with: title, conventional commit prefix, files, line counts, dependencies, expected Bugbot risk.
- **Merge order** — ASCII dep graph + a Phase 1/2/3 ordering.
- **Execution recipe** — exact commands to cherry-pick each slice (see Phase 5).
- **Verification per sub-PR** — what to check before each merges.
- **Out of scope** — what isn't covered.

Keep it concise (scannable in 60s). The plan is the deliverable of this skill — execution is optional and gated on user approval.

## Phase 5: Execute (only on user approval)

Spawn one `tech-lead` agent **per slice** with `isolation: "worktree"`. Run independent leaves in parallel (single message, multiple Agent calls). The recipe each agent follows:

```bash
git fetch origin && git fetch origin pull/<source-pr>/head:pr-<source-pr>
git checkout -b <slug>/pr<N>-<short-name> origin/<base-branch>   # base = staging OR parent slice's branch
git checkout pr-<source-pr> -- <files for this slice>            # paths quoted if they contain []
git status && git diff --cached --stat                            # sanity-check the slice
pnpm --filter <package> lint                                     # NOT typecheck — project rule
git commit -m "<conventional title>"                              # signed with Co-Authored-By
```

**The agent then stops at the push step** — `git push` is blocked in worktree-isolated agents in this environment. The agent reports the branch + commit SHA in its final message; you push from the main worktree (worktrees share refs):

```bash
git push -u origin <branch>
```

Then you (the orchestrator) create the PR + Linear sub-issue:

```bash
gh pr create --repo <owner>/<repo> --base <base-branch> --head <branch> \
  --assignee <user> [--label deploy:qa] \
  --title "<conventional title>" --body "<body>"
```

For `Fyxer-AI/web-app`, `<body>` must carry each of `Problem`, `Changes`, `Testing`, `Risks` as its own markdown heading (see `create-pr`) or CI's "Description follows template" check fails the sub-PR; the `skip-template` label bypasses it.

**Register the stack once the dependent sub-PRs exist.** Create each with `--base` = the trunk it will finally land on (usually `staging`), then chain them with the native `gh stack` (gh ≥ 2.97; the old Rust `github/gh-stack` is deprecated), bottom to top — see `create-pr` Phase 6b:

```bash
gh stack link --base staging <bottom-pr> <middle-pr> <top-pr>   # PR numbers, bottom→top
```

This sets each child's base to its parent's branch and auto-retargets on merge, so you never hand-maintain `--base` re-targets. Independent leaves that sit directly on `staging` don't need linking.

Linear sub-issue under the parent PRD via the `notion-/linear-create-context-pod-issue` style skill or the Linear MCP `save_issue` tool with `parentId: <parent-issue>`.

Backfill the Linear URL into the PR body with `gh pr edit <num> --body ...` once the issue ID is known.

## Phase 6: Post

Add a comment on the original PR linking all sub-PRs in a table, so reviewers can find them. Plan calls for closing the original after the splits land — don't auto-close.

## Gotchas (learned from the import-email-attachments split)

- **Enum-addition is rarely additive — grep before splitting**: an "additive" enum variant breaks any consumer that enumerates the enum. Before treating an enum addition as a Low-risk slice, run **two** greps from repo root:
  - `Record<<EnumName>,` and `Record<\s*<EnumName>` — exhaustive Record mappings (NOT `Partial<Record<…>>`). Each site requires a corresponding entry in the same PR.
  - `<EnumName>.\w+,\s*\n` near test files (especially `*registry*.test.ts`, `*lock*.test.ts`, snapshot tests) — hard-coded enum membership lists that pin `Set.size` / array length. The test will fail with `Expected: N / Received: N+1` the moment the enum gains a variant.
  - If either grep hits, either bundle the consumer update into the types PR (broadens it but keeps each PR green) or land a tiny prep PR that relaxes the exhaustiveness (e.g. `Record` → `Partial<Record>`, registry-lock → derived from `Object.values(Enum)`) before the enum addition. Don't ship the enum addition alone and trust the title — CI will catch it but you'll have wasted a review cycle.
- **Firestore composite indexes**: queries that are all `==` filters with no `orderBy` / range filter don't need a composite index (Firestore zigzag-merges single-field indexes per project CLAUDE.md). Only add a composite if there's a range filter, an `orderBy` on a different field, or you've benchmarked contention.
- **Push restrictions in worktree-isolated agents**: agents can commit but not push. Always have the agent stop after `git commit` and report the branch + SHA; push from the main worktree.
- **Branch deletion on merge**: a native `gh stack` auto-retargets each child before its parent's branch is deleted, so this is mostly handled. If a child is *not* in the stack and its parent used "Delete branch on merge", the branch disappears on merge and the child errors with `Head sha can't be blank` — re-target it to a still-living branch (one level up the stack or `staging`) with `gh pr edit <child> --base <branch>`.
- **Lint in gitignored worktree**: if the worktree path contains a gitignored segment (e.g. `.claude/`), Prettier and oxlint silently skip files — see the `lint-in-ignored-worktree` skill. Run lint from a non-gitignored location, or trust pre-commit hooks.
- **Pre-commit typecheck failures in fresh worktree**: husky may run `tsc --noEmit` which the project's parent CLAUDE.md says to avoid. If it fails with `Cannot find module '@fyxer-ai/...'`, run `pnpm i` in the worktree first — the workspace links are missing, not the types broken.
- **CI cascade**: when one workflow (Build/Typecheck) fails, downstream jobs (Lint, Stripe-guard, Test) often `##[error]The operation was canceled` — those aren't independent failures, fix the upstream one first.
- **Cursor auto-approve != Cursor Bugbot pass**: there are two separate Cursor checks. Bugbot reads the diff and posts a verdict; the auto-approve check posts a `cursor.com/agents/...` review. Both need to be green for the auto-approve target to land.

## Decision criteria — when NOT to split

A few cases where splitting is wrong:

- **Atomic semantic change**: a refactor + the only caller that uses the new shape in one PR is fine — splitting would leave dead code in the first PR.
- **Migration with rollback coupling**: a Firestore index addition + the query that needs it must ship together so you can revert atomically.
- **Time pressure**: the user is shipping at 5pm to unblock a customer — splitting adds ceremony, not safety.

If splitting would create a PR with no semantic value on its own (just type definitions referenced by nothing in the same PR), that's a signal the split is too aggressive — bundle that slice into the next.

## Output format

When this skill finishes its analysis phase (Phases 1-4), the output is:

1. A one-line verdict: "Split into N sub-PRs (M auto-approvable, K need review)" or "Keep as one PR".
2. The plan file path.
3. A short table of slices with title / files / risk / merge-base.

Wait for user approval (via ExitPlanMode if in plan mode, or AskUserQuestion otherwise) before running Phase 5. Phase 5 can take 10-20 minutes and burns several agent invocations — don't fire it without explicit go.
