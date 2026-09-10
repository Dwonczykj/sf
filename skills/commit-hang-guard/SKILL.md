---
name: commit-hang-guard
description: When running `git commit` in this workspace, watch for pre-commit hooks that hang. If the commit hasn't finished in 3 minutes, kill it, run `pnpm i` to surface dependency drift, fix anything obvious, and otherwise stop and ask the user before retrying. Use whenever you're about to run `git commit` in any repo with pre-commit hooks (Fyxer web-app, eval, anything with husky/lefthook/.pre-commit-config.yaml).
user_invocable: false
---

# commit-hang-guard

Pre-commit hooks in this workspace (prettier, oxlint, typecheck, jest, gpg-sign) can take 30–90s on a clean run. They can also hang indefinitely on stale `node_modules`, a wedged jest worker, or a corrupted pnpm store. This skill caps that risk so you don't burn 5+ minutes polling a dead commit.

## When this skill fires

Before every `git commit` invocation in a workspace with pre-commit hooks. Detect hooks by checking for any of: `.husky/`, `lefthook.yml`, `.pre-commit-config.yaml`, `package.json` with a `simple-git-hooks` block, or a `.git/hooks/pre-commit` symlink pointing into `node_modules`.

If none of those exist, skip the timeout dance — just commit normally.

## How to commit

1. **Always run the commit in the background** with `run_in_background: true`. Never inline a commit you expect to take >10s.
2. **Poll with `TaskOutput` using a 180000ms (3 min) timeout**, not longer. If it returns `<status>running</status>`, treat that as the timeout.
3. Pass the message via `-F /tmp/<branch>-commit-msg.txt` (Write the file first). Heredocs through `bash -c` truncate to the first line when the shell wrapper gets killed mid-flight — this has bitten us before.

## When the commit hangs (>3 min, no output)

Do **not** poll again. Kill it and diagnose.

```bash
# 1. Stop the background task.
#    Use TaskStop or `kill -TERM <pid>` if you have the PID from the output file.

# 2. Check whether the commit landed despite the hang.
git log --oneline -1
git status

# 3. If the commit is already there, you're done — the hook printed nothing
#    on success and the harness lost the notification. Move on.

# 4. If the commit is NOT there, the hook is the culprit. Diagnose:
pnpm i 2>&1 | tail -40
```

### Interpreting `pnpm i` output

**Obvious fix — proceed without asking:**
- "Lockfile is up to date, resolution step is skipped" + everything succeeds → not a deps issue; the hook itself is wedged. Skip to "ask the user".
- "ERR_PNPM_OUTDATED_LOCKFILE" → run `pnpm i --no-frozen-lockfile`, commit the lockfile diff in a separate commit, then retry the original commit.
- "ENOENT" on a workspace package → run `pnpm i` again from the repo root; pnpm self-heals symlinks.
- A peer dep warning that names a package you just added → ignore, it's noise.

**Stop and ask the user — do not guess:**
- Engine warnings only (`Unsupported engine: wanted node 22, current node 25`) → not the hang's cause; ask the user whether to retry or investigate the hook itself.
- A failed `postinstall` script → could be unrelated build state; ask before re-running.
- Anything mentioning "permission denied", "EACCES", or `~/.pnpm-store` corruption → ask before running anything destructive.
- The hang reproduces after a clean `pnpm i` → ask the user. Likely a jest worker leak or hook deadlock; user needs to weigh `--no-verify` vs. debugging.

### Asking the user

Use `AskUserQuestion`. Three options, in this order:

1. **Retry the commit** — the simplest case; the hang was a fluke.
2. **Skip hooks once (`--no-verify`)** — flagged as last resort. Only offer this if the user has previously approved it for this session OR if the hang is reproducible and they're blocked. CLAUDE.md forbids it by default.
3. **Stop and investigate** — show the user the hook config file paths and let them debug.

Never silently `--no-verify`. Never amend a commit that "looks" landed without confirming via `git log`.

## Why the 3-minute cap

Empirically, every hook in this workspace that's going to succeed has done so inside 2 minutes. Anything past 3 minutes is either (a) a hung jest worker, (b) gpg-agent waiting for a passphrase you can't see, or (c) the pnpm store rebuilding itself. None of those are worth blind-polling.

The lefthook/husky hooks in this repo print to stderr periodically when running normally. A truly silent >60s window is itself a signal.

## What this skill does NOT do

- It doesn't bypass hooks. `--no-verify` stays a user-approved escape hatch.
- It doesn't auto-fix lockfile drift across multiple commits in a session — fix once, then resume normal flow.
- It doesn't apply to `git commit --amend -F <file>` of an already-pushed commit; those are short and shouldn't hang.
- It doesn't replace `diagnose` — if the hook is failing repeatedly with the same error, hand off to `/diagnose`.
