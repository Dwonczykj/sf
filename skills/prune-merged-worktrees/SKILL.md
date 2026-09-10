---
name: prune-merged-worktrees
description: Clean up git worktrees in three tiers against a base branch (default `staging`). Auto-removes worktrees whose every commit is already merged AND have a clean tree; then asks before deleting unmerged-but-clean worktrees (summarising each branch's unmerged commit messages so the user can decide to resume or drop); then asks about worktrees with uncommitted changes (summarising the dirty diff so the user can judge if it's stale and `--force` remove). Use when the user says "delete merged worktrees", "prune worktrees", "clean up worktrees", or "remove worktrees merged into staging".
---

# Prune Merged Worktrees

Safely clean up `git worktree`s in three tiers. Never delete uncommitted or unmerged work without explicit confirmation.

## Base branch

Default base is `staging`. If the user names another base (e.g. `main`), use that. Always `git fetch origin <base>` first and compare against `origin/<base>`.

## Options

- **`--require-pushed`** — before deleting ANY worktree, require its branch to exist on origin at HEAD (`pushed=YES`). A worktree can be clean yet hold commits that live only in this checkout (no remote branch) — removing it then loses that work even though the tree is "clean". With this guard, any `pushed=NO` worktree is never auto-removed and is surfaced in an ASK tier flagged "commits only local"; offer to `git push` it first. Default off, but treat push-state as advisory even without the flag.

## Definitions

For each worktree (excluding the main/current one the session runs in):
- **HEAD** = `git -C <wt> rev-parse HEAD`
- **branch** = `git -C <wt> symbolic-ref --short HEAD` (may be detached)
- **merged** = `git merge-base --is-ancestor <HEAD> origin/<base>` succeeds (every commit is in base)
- **clean** = `git -C <wt> status --porcelain` is empty
- **pushed** = branch exists on origin at HEAD: `git ls-remote --heads origin <branch>` returns a sha equal to HEAD. Use `ls-remote`, NOT the tracking ref `@{u}` — after a partial `git fetch origin <base>` the tracking ref is stale and lies about push-state.
- **ahead commits** = `git -C <wt> log origin/<base>..HEAD --oneline`
- **stale-for** = hours since last commit: `(now - <git -C <wt> log -1 --format=%ct>) / 3600`. A proxy for activity — a branch can be recently committed yet have uncommitted work, or old yet active; use it to prioritise, not to decide.

Note: ancestor check does NOT detect squash-merges. A squash-merged branch shows as "not merged" but its `git diff origin/<base>...HEAD` is empty (content already in base). Treat empty-diff branches as effectively merged.

## Procedure

### Step 0 — enumerate and size

Enumerate from `git worktree list` — it is the ONLY complete source. A directory glob like `~/FyxerGh/fyxer-web-app-trees/*` misses worktrees nested elsewhere (e.g. agent worktrees under `<repo>/.claude/worktrees/agent-*`), so size the paths git reports instead of globbing a directory. This one script builds the whole table:

```bash
df -h / | tail -1   # record free space now, to diff against the final step
git fetch origin <base>
main=$(git rev-parse --show-toplevel); now=$(date +%s)
git -C "$main" worktree list --porcelain | awk '/^worktree /{print $2}' | while read wt; do
  [ "$wt" = "$main" ] && continue
  br=$(git -C "$wt" symbolic-ref --short HEAD 2>/dev/null || echo "(detached)")
  head=$(git -C "$wt" rev-parse HEAD)
  git -C "$wt" merge-base --is-ancestor "$head" origin/<base> 2>/dev/null && merged=YES || merged=no
  [ -z "$(git -C "$wt" diff origin/<base>...HEAD)" ] && empty=YES || empty=no
  [ -z "$(git -C "$wt" status --porcelain)" ] && clean=YES || clean=DIRTY
  rsha=$(git -C "$main" ls-remote --heads origin "$br" 2>/dev/null | awk '{print $1}')
  [ "$rsha" = "$head" ] && pushed=YES || pushed=NO
  ahead=$(git -C "$wt" rev-list origin/<base>..HEAD --count)
  age=$(( (now - $(git -C "$wt" log -1 --format=%ct)) / 3600 ))
  sz=$(du -sh "$wt" 2>/dev/null | cut -f1)
  printf "%4dh %-6s merged=%-3s empty=%-3s clean=%-5s pushed=%-3s ahead=%-3s %s\n" \
    "$age" "$sz" "$merged" "$empty" "$clean" "$pushed" "$ahead" "$br"
done | sort -rn
```

The table (one row per worktree, oldest first) carries: stale-for, size, merged?, empty-diff?, clean?, pushed?, ahead-count, branch. The main worktree is skipped.

Note: most of the disk bulk per worktree is its own `node_modules` checkout — removing a worktree reclaims that. Committed history is NOT lost; branches survive intact in the main repo (and on origin when `pushed=YES`).

### Tier 1 — merged + clean → auto-remove

Worktrees that are **merged AND clean** (or **empty-diff AND clean**) are safe to delete with no data loss. Remove them directly and report what was removed:

```bash
git worktree remove "<wt>"
# NOT rm -rf — git tracks worktree metadata; deleting the folder by hand
# leaves dangling refs. Use git's own command so metadata stays consistent.
```

Removal robustness: deleting a worktree with a ~3G `node_modules` can take minutes and blow a default 2-min tool timeout. Remove them ONE AT A TIME with a long timeout (or in the background), not batched in a single tight-timeout call. If a remove is interrupted partway, the worktree is left with a working tree full of `D` (deletion) entries and `git worktree remove` refuses it as "modified". That dirtiness is the aborted delete, not real work — confirm every change is a `D` (`git -C <wt> status --porcelain | grep -v '^ *D' `is empty`) and that it was `pushed=YES`, then finish with `git worktree remove --force <wt>`.

Report the list grouped sensibly (by PR/ticket prefix if obvious).

After all Tier 1 removals, sweep dangling metadata left by any worktrees that were already deleted manually in the past:

```bash
git worktree prune
```

### Tier 2 — unmerged + clean → ASK first

Worktrees that are **NOT merged but clean** (have committed work not in base). These are safe to delete (nothing uncommitted) but represent real work. For EACH such worktree, summarise the unmerged commits so the user can decide:

```bash
git -C "<wt>" log origin/<base>..HEAD --oneline
```

Present a per-worktree summary: branch name + its unmerged commit subjects (a one-line reminder of what the work is), and flag whether it is `pushed`. Then use **AskUserQuestion** (multiSelect) to let the user pick which of these worktrees to delete vs keep. Only remove the ones they select. This summary doubles as a record of work to resume or a branch to drop.

Under `--require-pushed`: split this tier — offer only `pushed=YES` worktrees for deletion (their branch survives on origin, so removal loses nothing), and list `pushed=NO` ones separately as blocked "commits only local", offering to `git push` them first rather than delete.

### Tier 3 — uncommitted changes → ASK first, may need --force

Worktrees with a **dirty tree**. For EACH, summarise the uncommitted diff so the user can judge whether it is stale junk or work worth keeping:

```bash
git -C "<wt>" status --porcelain
git -C "<wt>" diff --stat
git -C "<wt>" diff          # show enough to judge; truncate huge diffs
```

Filter out noise (e.g. `.claude/settings.json`, build artifacts) when describing. Present a per-worktree summary of what the dirty changes actually do. Then use **AskUserQuestion** to ask, per worktree, whether to `--force` remove (changes are stale/unwanted) or keep. Removing a dirty worktree requires:

```bash
git worktree remove --force "<wt>"
```

### Final step — disk usage

After all tiers are settled (auto-removed, user-approved deletes done, kept ones left alone), run `df -h /` again and diff it against the Step 0 reading to report actual free-space reclaimed — don't estimate from worktree sizes, the real before/after numbers are already in hand.

## Rules

- Always use `git worktree remove` (not `rm -rf`). Deleting the folder by hand leaves dangling metadata in `.git/worktrees/`; git's own command cleans it up properly.
- Run `git worktree prune` after Tier 1 to sweep stale metadata from any worktrees already deleted manually.
- Never `--force` remove without explicit per-worktree confirmation.
- Never delete the main/current worktree.
- Tier 1 is the only auto-action; Tiers 2 and 3 always ask. Under `--require-pushed`, Tier 1 additionally requires `pushed=YES`.
- Prefer one `AskUserQuestion` per tier with multiSelect over many small prompts. `AskUserQuestion` allows at most 4 options per question — when a tier has more than 4 worktrees, chunk them across multiple questions (each still multiSelect).
- Remove one worktree at a time with a generous timeout (node_modules deletion is slow); an interrupted remove leaves an all-`D` dirty tree that needs `--force` to finish (see Tier 1).
- After all tiers, print a final summary: removed (with disk reclaimed, from the before/after `df -h` diff), kept, and why.
- Use `git -C <path>` rather than `cd` to avoid permission prompts.

## Fast path one-liner

Shows every worktree path next to its branch for a quick inventory:

```bash
git worktree list --porcelain | awk '/^worktree /{w=$2} /^branch /{print w, $2}'
```
