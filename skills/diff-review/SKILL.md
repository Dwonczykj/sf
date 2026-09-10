---
name: diff-review
description: Iteratively review and improve a diff (PR, or working tree vs a base branch — default `staging`). Loops three passes — correctness, minimality, dead-code — auto-applying fixes after each pass and re-diffing, until no more auto-fixable changes are found or a clarifying question is needed. Reports per-file findings (file:line, grouped by pass), per-iteration LoC deltas, and a final cross-iteration summary.
---

# diff-review

Ralph-style iterative review of a diff. Auto-applies safe fixes each pass, re-diffs, repeats until convergence.

## When to use

User asks to review, polish, or shrink a diff before opening / merging a PR. Examples: "review my changes", "tighten this PR", "/diff-review", "/diff-review main", "/diff-review --staged-only".

## Arguments

- `[base-branch]` — base ref to diff against. **Default: `staging`.** Examples: `main`, `origin/main`, `HEAD~3`, a PR number resolved via `gh pr view`.
- `--staged-only` — review only staged changes. Default reviews **both staged and unstaged**.
- `[PR <number>]` — if invoked on a GitHub PR, resolve the base branch via `gh pr view <n> --json baseRefName` and check out / fetch as needed.

## Hard rules

- **Follow all project-level rules.** Read every `CLAUDE.md` from cwd up to repo root before starting. Honor every linked skill (e.g. `coding-standards`, `frontend-standards`, `backend-standards`, `no-comments`). Never violate these in the name of "minimality."
- **Don't game LoC.** Keep names readable. Don't collapse readable multi-line code into one-liners just to shrink the diff. Don't strip whitespace inside strings. Don't remove blank lines that exist for readability.
- **Don't introduce new abstractions** to shrink a diff. The goal is to remove unnecessary additions, not invent helpers.
- **Never run destructive git** (`reset --hard`, `clean -f`, force push, branch deletion). The user's working tree is the source of truth.
- **Don't run `tsc --noEmit`** where the repo's `CLAUDE.md` forbids it (the Fyxer web-app does — transitive imports hang/OOM). Verify types by reading the diff.
- **Stop and ask** if a finding requires a product/design decision, removes a public API, or you can't tell whether code is reachable. Loop terminates on a clarifying question.

## Setup (once, before the loop)

1. Resolve the base branch (arg → default `staging`). Confirm it exists locally; `git fetch` if needed.
2. Read `git status` and the relevant `CLAUDE.md` files.
3. Compute initial LoC baseline:
   ```
   git diff --shortstat <base>...HEAD     # committed
   git diff --shortstat                    # unstaged (skip if --staged-only)
   git diff --cached --shortstat           # staged
   ```
   Combine into a single "starting diff" baseline.

## The loop (no max iterations)

Each iteration K does **three passes**, applies fixes, then re-diffs. Continue until either:
- The current pass produces zero auto-applicable changes AND zero pending suggestions, OR
- A finding requires a clarifying question (ask the user, then halt).

### Pass 1 — Correctness

For each changed file, read the **full file** (not just the hunk) plus any caller/callee files the change interacts with. For each hunk, check:

- Logic / off-by-one / null-handling / async-await / error-handling bugs
- Type contracts with callers and callees
- Edge cases the diff introduces or ignores
- Race conditions, unhandled promise rejections, missing `await`
- Security: injection, unescaped user input, leaked secrets, broadened permissions
- Project conventions (cn() vs template literals in className, abtest() patterns, GrowthBook usage, etc.)
- Tests: did behavior change in a way that needs new/updated tests?

Apply fixes you're confident in. Record everything else as findings.

### Pass 2 — Minimality

Look for hunks that can be **shrunk or removed without changing behavior**:

- Unrelated reformatting, whitespace, import reordering
- Speculative abstractions, helpers used once, parameters never set to non-default
- Comments restating what the code says, defensive validation for impossible inputs
- Re-exports, alias indirection, "just in case" feature flags
- Backwards-compat shims for code that no caller hits anymore
- Renames that ripple across the diff without semantic value

Apply the reductions. Don't rename for brevity. Don't merge readable lines.

### Pass 3 — Dead code (pre-diff)

For each touched file, scan whether the diff makes any **previously-existing** code unreachable / unused:

- Imports no longer referenced
- Functions, types, constants, components no whose only callers were removed/redirected by the diff
- Branches / flags whose condition is now always true or always false
- Tests covering deleted behavior

Verify with `grep` across the repo before deletion. If the symbol is exported and might be used outside the repo, flag and ask rather than delete.

## Per-iteration logging

After each iteration K, emit:

```
## Iteration K

### Pass 1 — Correctness
- src/foo.ts:42 — [applied] missing await on saveDraft(); promise was discarded
- src/bar.tsx:88 — [suggestion] empty-state branch unreachable when `items` is required; needs product decision

### Pass 2 — Minimality
- src/baz.ts:10-25 — [applied] removed unused `formatRetry` helper (only caller deleted)
- src/qux.tsx — [applied] reverted unrelated reformatting in untouched function

### Pass 3 — Dead code
- src/old.ts — [applied] removed `legacyParse` (no remaining callers after diff)

### LoC delta this iteration
−42 lines, −1,180 chars, +6 lines, +180 chars across 4 files
```

Use `[applied]` / `[suggestion]` / `[question]` tags. Every finding has a `file:line` (or `file:start-end`) reference.

## Final summary

When the loop exits, emit:

```
## Diff-review summary (vs <base-branch>, N iterations)

Starting diff:  +<a> / −<b> across <f> files
Final diff:     +<a'> / −<b'> across <f'> files
Net change from review: −<X> lines, −<Y> chars, +<Z> lines added

By pass (totals across iterations):
- Correctness fixes: <n>
- Minimality reductions: <n>
- Dead code removals: <n>

Open suggestions / questions: <list, or "none">
```

LoC measurement: use `git diff --shortstat` plus `wc -c` on `git diff` output for char counts. Compute against the same base each time so the numbers are comparable.

## Termination

The loop ends when:
1. A full iteration produces zero `[applied]` and zero `[suggestion]` findings, OR
2. A `[question]` finding blocks further automatic progress — stop and ask the user.

Never spin on the same finding twice. If a fix you applied gets re-flagged in the next iteration, that's a signal to stop and ask.
