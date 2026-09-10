---
name: create-pr
description: Create a pull request with the correct base branch and assignment based on the repository (Fyxer-AI/web-app → staging, Fyxer-AI/eval → main, else → staging). Assigns to Dwonczykj. For web-app, asks about the deploy-preview label. Use when the user asks to create a PR, open a pull request, or push a branch for review.
user_invocable: true
---

# create-pr

Create a pull request targeting the correct base branch for this repository.

## Phase 1: Gather context in parallel

Run all of these at once:

```bash
gh repo view --json nameWithOwner --jq .nameWithOwner
git branch --show-current
git status --short
git log --oneline -10
```

## Phase 2: Determine base branch and settings

| Repo | Base branch | Assign |
|------|-------------|--------|
| `Fyxer-AI/web-app` | `staging` | `Dwonczykj` |
| `Fyxer-AI/eval` | `main` | `Dwonczykj` |
| anything else | `staging` | `Dwonczykj` |

## Phase 2b: deploy-preview label (web-app only)

If the repo is `Fyxer-AI/web-app`, use `AskUserQuestion` to ask:

> "Do you want to add the `deploy-preview` label to this PR? This triggers a QA deploy."

Options: **Yes, add it** / **No, skip it**

Remember the answer for Phase 7.

## Phase 3: Verify the branch has commits ahead of base

```bash
git log <base-branch>..HEAD --oneline
git diff <base-branch> --stat
```

If there are no commits ahead of the base branch, stop and tell the user there is nothing to PR.

If there are uncommitted changes, warn the user and ask if they want to commit them first before continuing.

## Phase 4: Link to a Linear issue (Context Pod)

1. Invoke `/linear-list-my-context-pod-issues` to fetch open issues assigned to the user in Context Pod Q2 2026. Show the list inline.
2. Use `AskUserQuestion` to ask:

   > "Is this PR linked to an existing Context Pod Linear issue, or should I create a new one?"

   Options: **Pick existing** / **Create new** / **Skip — no Linear issue**

3. If **Pick existing**: ask the user to provide the issue identifier (e.g. `PRE-123`). Call `mcp__ac8e4a0b-1ec5-4ab5-8b10-e46579796632__get_issue` with that identifier to resolve the URL. Store the identifier + URL for use in the PR body.

4. If **Create new**: invoke `/linear-create-context-pod-issue`. The title/description should be derived from the commits and diff already gathered. Use the returned identifier + URL in the PR body.

5. If **Skip**: continue without a Linear reference.

## Phase 4b: Blast-radius analysis (subagent)

Spawn an `Agent` (subagent_type `general-purpose`, foreground — Phase 5 needs the result) to read the diff explicitly and assess risk, separately from the agent writing the PR:

> Read the complete diff for this PR (`git diff <base-branch>...HEAD`), file by file — not just the stat summary. For each changed file, judge blast radius: what breaks if this change is wrong, which callers/consumers/production paths are affected, whether it touches a shared or high-traffic path (webhook handler, provider call, migration, config read by other services), and whether it's easily reversible. Ignore style and correctness — only blast radius.
>
> Specifically answer:
> - Will any user visibly see a change in production because of this PR — even a subtle one (copy, timing, an email/draft going out differently)?
> - Who is affected: all users, only internal/staff users, or only users behind a specific PostHog or GrowthBook flag? Name the flag if there is one, and say what happens to users NOT in the flag.
> - If new code in this PR throws, times out, or short-circuits, does that failure silently change existing production behaviour for any user (e.g. a guard that now no-ops, a fallback that now takes a different path, a feature that now silently disables)? Trace it, don't assume the existing error handling catches it.
>
> Return: an overall risk level (low/medium/high), the specific files/paths carrying the risk, and one sentence per risky file naming the concrete failure scenario — folding the three answers above into that.

Use this verdict, not a guess, to write the **Risks** section in Phase 5. "None" is still valid if the subagent finds nothing risky.

## Phase 5: Draft the PR title and body

Read the commits and diff to write:

- **Title**: conventional-commit style matching the project convention (`feat:`, `fix:`, `chore:`, `experiment:`). Under 70 chars. No apostrophes.
- **Sentence length**: every sentence in the body, in any section, targets about 12 words and never exceeds 18. Split anything longer into two sentences.
- **Body**: web-app requires each of `Problem`, `Changes`, `Testing`, `Risks` as its own markdown heading (`.github/PULL_REQUEST_TEMPLATE.md`) — the CI check "Description follows template" (`.github/workflows/pr-description.yml`) fails the PR otherwise. The check matches `^[ ]{0,3}#{1,6}[ \t]*<Heading>\b` case-insensitively after stripping HTML comments and fenced code blocks, so keep each heading on its own line and outside any ``` fence. Editing the PR description re-runs the check with no new commit. The `skip-template` label exempts a PR (last-resort escape hatch). Non-web-app repos have no such check (e.g. `eval` has no `.github/` at all) and use the shorter Summary/Test plan form below. Include the Linear line only if a Linear issue was resolved in Phase 4.

  For `Fyxer-AI/web-app`:

  ```
  ## Problem

  <at most 2 sentences: what is wrong or missing today, and why it matters — link the
  issue/ticket/incident>

  ## Changes

  <one bullet per change, each bullet a single sentence. Call out explicitly: any
  behavioural change to an external provider call (Graph, Gmail, Stripe, ...); any removal
  of existing behaviour (guard, filter, condition, retry), with the reasoning and evidence>
  - <change 1, one sentence>
  - <change 2, one sentence>

  ## Testing

  <an ordered list of single-sentence tasks for the human reviewer to run manually — not
  commands you already ran. Say what was not tested. Write "None" if there is nothing for
  the human to check>
  1. <task 1, one sentence>
  2. <task 2, one sentence>

  ## Risks

  <from the Phase 4b subagent verdict: blast radius, rollback plan, latent paths (e.g.
  cache-miss fallbacks that only run in production). Lead each risk with a bold flag
  matching its severity — **High risk:**, **Medium risk:**, **Low risk:** — one sentence
  each. Write "None" if genuinely none>

  Linear: <PRE-123 url>   ← omit this line if no Linear issue

  🤖 Generated with [Claude Code](https://claude.com/claude-code)
  ```

  For other repos:

  ```
  ## Summary
  - <bullet 1>
  - <bullet 2>
  - <bullet 3 if needed>

  ## Test plan
  - [ ] <test step 1>
  - [ ] <test step 2>

  Linear: <PRE-123 url>   ← omit this line if no Linear issue

  🤖 Generated with [Claude Code](https://claude.com/claude-code)
  ```

Keep each section factual and specific — "None" is a real, valid answer for Testing/Risks on a trivial change, not something to pad out.

## Phase 6: Push and create the PR

First push the branch if it isn't already on the remote:

```bash
git push -u origin <current-branch>   # only if not already pushed
```

Then create the PR:

```bash
gh pr create \
  --base <base-branch> \
  --assignee Dwonczykj \
  --title "<title>" \
  --body "$(cat <<'EOF'
<body>
EOF
)"
```

## Phase 6b: Stacking on another PR (dependent PRs only)

Skip this unless the PR builds on **another open PR's branch** rather than on the trunk.

Stacking is native to `gh` now — the built-in `gh stack` (gh ≥ 2.97). The old Rust `github/gh-stack` extension is **deprecated; do not use it**. Do **not** hand-chain bases with `gh pr create --base <parent-branch>` and then manually re-target each child on merge — that is the error-prone approach that predates `gh stack`. Register a native stack instead: GitHub then sets every base, shows the stack in its UI, and auto-retargets each child down as its parent merges.

Create each PR the normal way (Phase 6, `--base` = the trunk each will finally land on, usually `staging`), then register the stack **bottom to top**:

```bash
gh stack link --base <trunk> <bottom-pr> <middle-pr> <top-pr>   # PR numbers or URLs, bottom→top
```

- `--base` is the trunk beneath the **bottom** PR (`staging` for web-app), not a parent branch. Passing a PR its current base is a safe no-op, so include the whole feature chain to register it as one stack.
- Pass PR **numbers** for already-open PRs: `gh stack link` then only moves base pointers on GitHub — it pushes/rebases nothing, so a member branch checked out in another worktree is fine.
- It sets each PR's base to the branch below it and prints a stack number. A member's diff stays scoped because GitHub diffs against the immediate base (siblings off a shared ancestor keep that ancestor as their merge base).
- Grow an existing stack by passing its stack number first: `gh stack link <stack-number> <new-top-pr>`.
- To detach (let the bottom PR merge onto the trunk alone): `gh stack unstack <stack-number>` — always **by number**, never bare inside a worktree. See the `reference_gh_native_stack_unstack` memory for the unstack gotchas.

## Phase 7: deploy-preview label (web-app only)

If the repo is `Fyxer-AI/web-app` and the user said yes in Phase 2b:
```bash
gh pr edit --add-label "deploy-preview"
```

## Phase 8: Report back

Return the PR URL so the user can click through to it.

If the repo is `Fyxer-AI/web-app` and the label was added, confirm that too.

## Rules

- Never force-push or reset. If the push fails due to divergence, surface the error and stop.
- Never commit on the user's behalf — if uncommitted changes exist, warn and wait.
- If `gh pr create` fails because a PR already exists for this branch, surface the existing PR URL instead of erroring.
- Do NOT run lint or typecheck — that is the user's responsibility before invoking this skill.
