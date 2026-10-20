---
name: get-worktree
description: Get a git worktree ready to work in — either the one for an existing PR (reusing it and reconciling local/remote if it already exists, syncing safely) or a fresh one for new work off the right base branch. Use when the user gives a PR link and wants to pick up work on it, or asks to start a new worktree with no PR yet, or says "get me a worktree for <PR link>", "set up a worktree for this PR", "/get-worktree".
user_invocable: true
---

# get-worktree

Takes an optional PR link from `$ARGUMENTS`. The two modes share nothing but the paths step — read the one that applies.

## Paths (both modes)

Derive from git so this works wherever the repo is checked out, same as `setup-worktree-webapp`:

```bash
MAIN=$(git worktree list --porcelain | sed -n 's/^worktree //p' | head -1)  # main worktree
TREES_ROOT=$(dirname "$MAIN")                                               # siblings live here
NEW="$TREES_ROOT/<slug>"                                                    # worktree to create, if needed
```

`<slug>` is a short kebab-case slug of the branch name.

## Mode A: PR link given

### A0. Resolve the PR

```bash
gh pr view <url> --json number,headRefName,baseRefName,isCrossRepository,state,title
```

If `isCrossRepository` is true (the PR is from a fork), stop and tell the user — this skill assumes the branch lives on `origin`, and force-with-lease against a fork remote needs different handling. If `state` is `MERGED` or `CLOSED`, tell the user and ask if they still want a worktree for it.

`BRANCH` = `headRefName` from here on.

### A1. Try to add a worktree for it — this IS the existence check

```bash
git fetch origin "$BRANCH"
git worktree add "$NEW" "$BRANCH" 2>&1 || git worktree add "$NEW" -b "$BRANCH" "origin/$BRANCH" 2>&1
```

Two outcomes:

- **Succeeds** → there was no existing worktree for this branch. `$NEW` is ready to use. Skip to A3.
- **Fails with `'<branch>' is already checked out at '<path>'`** → an existing worktree already has it. Set `EXISTING="<path>"` from the error (or confirm with `git worktree list --porcelain | grep -B2 "branch refs/heads/$BRANCH"`) and continue to A2.

Any other failure (e.g. network error on fetch) — stop and surface it, don't guess.

### A2. Reconcile the existing worktree with `origin/$BRANCH`

Work inside `$EXISTING` (`git -C "$EXISTING" ...` throughout, or `cd` there).

```bash
git -C "$EXISTING" fetch origin "$BRANCH"
git -C "$EXISTING" status --porcelain            # dirty tree?
git -C "$EXISTING" rev-list --left-right --count HEAD..."origin/$BRANCH"   # "<ahead> <behind>"
```

`rev-list --left-right --count HEAD...origin/$BRANCH` prints `<local-ahead> <remote-ahead>`. Combine with the dirty-tree check to pick exactly one branch below — don't mix them:

1. **In sync** (`0 0`, clean tree) → nothing to reconcile. Go to A3.
2. **Remote ahead only** (`0 N`, clean tree) → fast-forward, no conflicts possible: `git -C "$EXISTING" merge --ff-only "origin/$BRANCH"`.
3. **Remote ahead AND local diverged** (`M N` with `M>0`, or remote ahead with a dirty tree) → this is the rebase case:
   - If the tree is dirty, `git -C "$EXISTING" stash push -u -m get-worktree-reconcile` first.
   - `git -C "$EXISTING" rebase "origin/$BRANCH"`. If it stops on conflicts, resolve them by reading both sides' diffs and understanding what each was trying to do — don't guess blindly, and if a conflict is genuinely ambiguous (both sides changed the same logic in incompatible ways), stop and ask the user rather than picking a side.
   - Restore the stash (`git -C "$EXISTING" stash pop`) if you stashed, resolving any further conflicts the same way.
   - Only once the rebase is clean: `git -C "$EXISTING" push --force-with-lease origin "$BRANCH"`. `--force-with-lease` is safe here because it only overwrites `origin/$BRANCH` if it's still at the commit you just rebased from — but this is still a force-push, so only ever do it to this PR's own feature branch, never to `staging`/`main`.
4. **Local ahead only, clean tree** (`M 0`) → check the local commits are genuinely this PR's work, not something else that happened to land on the branch: `git -C "$EXISTING" log "origin/$BRANCH..HEAD" --oneline` and compare against the PR title/description. If they look right, `git -C "$EXISTING" push origin "$BRANCH"` (plain push, no force needed — remote hasn't moved). If they look unrelated or you're unsure, stop and ask.
5. **Local ahead only, dirty tree, no new commits** (`0 0` but `status --porcelain` shows changes) → this is uncommitted work sitting ahead of remote with nothing to reconcile it against. Stop and check with the user before touching anything.

`$EXISTING` is now the worktree to use. Skip A3.

### A3. Done

Report the worktree path (`$NEW` or `$EXISTING`) and which case above applied, in one line.

## Mode B: no PR link

### B0. Pick the base branch

```bash
gh repo view --json nameWithOwner --jq .nameWithOwner
```

- `Fyxer-AI/web-app` → `staging`
- `Fyxer-AI/data-platform` → `main`
- anything else → `staging` if `git show-ref --verify --quiet refs/remotes/origin/staging` succeeds, else `main`

```bash
git fetch origin <base>
```

### B1. Name the branch

Follow `sf:create-branch`'s naming convention (prefix resolution + `<type>-<LINEAR-CODE>-<kebab-title>`) to compute `BRANCH_NAME` — but don't run its `git switch -c` step; this skill creates a worktree instead of switching in place.

### B2. Create the worktree off a fresh base

```bash
git worktree add -b "$BRANCH_NAME" "$NEW" "origin/<base>"
```

### B3. Done

Report the worktree path and its base branch in one line. Point to `setup-worktree-webapp` if the user also wants it running locally — that's a separate step, not part of this skill.

## Rules

- Never force-push anywhere but the PR's own feature branch (case A3.3), and never without a clean rebase first.
- Never stash, rebase, or push over uncommitted changes without being explicit about it in the report — the user should always be able to tell what happened to their dirty tree.
- If a rebase conflict or a suspicious commit can't be resolved with confidence, stop and ask rather than guessing.
