---
name: lint-in-ignored-worktree
description: Prettier/oxlint silently skip files in worktrees nested under a gitignored path (e.g. `.claude/worktrees/...`), so `pnpm lint` reports a false "no changes" and you can push formatting that fails CI's "lint produced file changes" gate. Use whenever you're about to run `pnpm lint`, `prettier`, or `oxlint` — or about to commit lint-sensitive changes — from inside a worktree whose path contains `.claude/` or any other gitignored segment.
user_invocable: false
---

# lint-in-ignored-worktree

Prettier (and oxlint) honour ignore rules relative to each file's path. When a git worktree is created **inside** a gitignored directory — the common case here is `.../.claude/worktrees/<name>/` — every file in that worktree matches the `**/.claude/*` ignore pattern. Prettier then treats those paths as ignored: given an explicitly-named ignored file it **passes the contents through unchanged** instead of formatting them.

The result: `pnpm lint` / `prettier --write` runs, exits 0, and reports **no changes** — even when the code genuinely violates `printWidth` or other rules. You commit, push, and CI (which checks the repo out at a normal path like `/home/runner/work/...`) reformats the file and fails with:

```
##[error]Lint produced file changes. Run 'pnpm lint' locally and commit the result.
```

This bit us on web-app PR #9794: a 124-char line in a `.test.ts` (over `printWidth: 120`) that local lint never wrapped because the worktree lived under `.claude/worktrees/`.

## When this skill fires

You're in a worktree whose absolute path contains `.claude/` (or any segment matched by `.gitignore` / `.prettierignore`), AND you're about to either:

- run `pnpm lint`, `prettier`, or `oxlint`, or
- commit/push changes to lint-sensitive files (`.ts`, `.tsx`, `.js`, `.cjs`, `.json`, `.css`, etc.).

Quick check:

```bash
pwd | grep -q '/\.claude/' && echo "IGNORED WORKTREE — lint will under-report"
```

If the worktree is at a normal (non-ignored) path, skip all of this — lint behaves correctly.

## How to verify formatting reliably

Do **not** trust an in-place `prettier --write` / `pnpm lint` no-op from an ignored worktree. Instead, verify each changed file at a non-ignored path:

```bash
# Find a prettier binary (the ignored worktree usually has no node_modules).
PRETTIER=$(ls /path/to/main-checkout/functions/node_modules/.bin/prettier 2>/dev/null \
  || ls /path/to/main-checkout/node_modules/.bin/prettier 2>/dev/null)

# Copy each changed file out and check it with the REAL repo config
# (the config references plugins like @ianvs/prettier-plugin-sort-imports,
#  so point --config at the repo's prettier.config.cjs and run from a dir
#  where that plugin resolves — i.e. the main checkout).
cp "<ignored-worktree>/<changed-file>" /tmp/verify.ts
cd /path/to/main-checkout
"$PRETTIER" --config ./prettier.config.cjs --check /tmp/verify.ts
```

`--check` reports whether CI would reformat. To get the exact reformatted output, swap `--check` for `--write` on the `/tmp` copy and diff it back, then apply that diff to the real file.

A faster sanity check for the most common failure (`printWidth`) is to scan for over-long lines:

```bash
awk 'length > 120 {print FILENAME":"NR" ("length")"}' <changed-files>
```

(use the repo's actual `printWidth` from `prettier.config.cjs` — currently 120 in web-app).

## Why not just `--write` in place?

`prettier --write` on an ignored path is a no-op — it won't error, it won't change the file, and it won't tell you it skipped. `--no-config` does **not** help: it disables config lookup but not the ignore behaviour. The only robust fixes are (a) verify at a non-ignored path as above, or (b) do lint-sensitive work in a worktree that isn't nested under a gitignored directory.

## Better: avoid the trap entirely

When creating worktrees for branches you'll lint and push, place them **outside** any gitignored path — e.g. a sibling directory like `../wt-<branch>/` rather than `.claude/worktrees/<branch>/`. Then `pnpm lint` behaves exactly as CI does and this whole dance is unnecessary.

## What this skill does NOT cover

- It's not about lint *rules* — it's about lint silently not running. If lint runs and reports real errors, fix them normally.
- Typecheck/jest aren't path-ignored the same way; this is specific to prettier/oxlint ignore resolution.
- It doesn't replace `commit-hang-guard` — that's about hooks hanging, this is about hooks under-reporting.
