---
name: setup-worktree-webapp
description: Set up a dedicated git worktree of the Fyxer web-app so a branch can run locally (create worktree, copy env/secret files, install deps, build functions, free emulator ports, hand over the two dev-server commands). Use when the user wants to run or test a web-app branch locally in an isolated worktree, or says "set up a worktree for <branch>", "run this branch locally", "spin up a local env", "/setup-worktree-webapp".
---

# Set up a web-app worktree for local run

Creates a **dedicated sibling worktree** of the Fyxer web-app so a branch can run locally without touching the shared main tree at `fyxer-web-app/` (concurrent agents branch-switch it out from under you). Perform steps 1–6, then hand the user the two server commands in step 7 (they run the long-lived servers themselves, or run them with `run_in_background`).

## Inputs
- **branch** (required) — from `$ARGUMENTS`, e.g. `joeydwonczyk/streaming-vis-chat`.
- **worktree name** (optional) — short dir name; default to a slug of the branch.

## Paths

Derive both from git so this works wherever the repo is checked out (no hardcoded home path). Run this from inside any worktree of the repo, then reuse `$MAIN` / `$NEW` in the steps below:
```bash
MAIN=$(git worktree list --porcelain | sed -n 's/^worktree //p' | head -1)  # main worktree = env-file source
TREES_ROOT=$(dirname "$MAIN")                                               # worktrees live as siblings here
NEW="$TREES_ROOT/<name>"                                                     # the new worktree to create
```

## Steps

1. **Create the worktree** (from any existing worktree of the repo):
   - `git worktree add "$NEW" <branch>`
   - If the branch is only on origin: `git worktree add "$NEW" -b <branch> origin/<branch>`
   - If git says the branch is already checked out elsewhere, reuse that worktree instead.

2. **Copy the gitignored local env/secret files** from the main worktree. The worktree-add hook auto-copies `dataScience/.env.*` but NOT these three, and the servers fail without them:
   ```bash
   # $MAIN and $NEW as derived in ## Paths above
   for f in app/.env.local functions/.env.local functions/.secret.local; do cp "$MAIN/$f" "$NEW/$f"; done
   ```
   `functions/.env.local` is REQUIRED — `functions:dev` errors `functions/.env.local not found` without it (it's separate from `.secret.local`).

3. **Install deps** (node_modules is per-worktree, not shared; ~20s via the pnpm store; runs the shared + node-commons prepare builds):
   `cd <path> && pnpm i`

4. **Verify auth — do NOT run `pnpm auth` in a non-interactive session.** `pnpm auth` = `firebase login --reauth && gcloud auth application-default login`, which is interactive browser OAuth and fails with "Cannot run login in non-interactive mode" (the `--reauth` forces a fresh login). Instead check cached creds:
   ```bash
   firebase login:list
   gcloud auth list --filter=status:ACTIVE --format="value(account)"
   gcloud auth application-default print-access-token >/dev/null 2>&1 && echo "ADC valid" || echo "ADC missing"
   ```
   If all show valid creds for the user, the servers run without re-auth. If any are missing/expired, tell the user to run `pnpm auth` themselves in an interactive terminal.

5. **Build the functions codebase(s).** For chat / general web-app testing the main package is enough — chat runs on the `normal-functions` codebase (= the main `functions` package):
   `pnpm --filter functions build`
   - `functions:dev` also tries to load the aux codebases; if unbuilt it logs `⬢ Failed to load function definition ... build/index.js does not exist` but **still reaches "All emulators ready"** — those errors are non-fatal and unrelated to chat.
   - Build feature-specific ones only when testing that flow:
     - `pnpm --filter functions-parse-pdf build` — PDF/attachment chat flows (import attachments, `ask_document` on a PDF)
     - `pnpm --filter functions-outlook-email build` — only for an Outlook-connected inbox (Gmail doesn't need it)
   - Not needed for local feature testing: `functions-stripe-event-handler`, `functions-plain`, `sync-functions`.
   - Build everything (silences all load-errors): `pnpm --filter functions build && pnpm --filter "./functions-*" build && pnpm --filter "./sync-functions" build`

6. **Free the emulator ports first.** A prior `functions:dev` often leaves orphaned Java Firestore/Pub-Sub emulators (parent PPID 1) holding 8080/8085 after the parent dies, which blocks a fresh start with "Could not start Firestore Emulator, port taken". Only do this when the user isn't intentionally running another local instance:
   ```bash
   for p in 8080 8085 4000 4400 4500 5001 9099 9199 5173; do lsof -ti :$p 2>/dev/null | xargs -r kill -9 2>/dev/null; done
   ```

7. **Hand the user the two dev-server commands** (run in separate terminals, or via `run_in_background`):
   ```bash
   cd "$NEW" && pnpm functions:dev   # Firebase emulators; UI at http://localhost:4000
   cd "$NEW" && pnpm app:dev         # Vite frontend at http://localhost:5173
   ```

## Gotchas
- Only one worktree can run the emulators/Vite at a time — port conflicts on 8080/8085/4000/5173/etc. Stop other instances first (step 6).
- The local Firebase emulator **buffers SSE**, so dashboard chat appears one-shot (no incremental streaming) locally even when the code streams fine deployed — not a bug.
- Node engine warning (wanted 20, have v22) is harmless.
- To confirm the emulators booted without a foreground `sleep`, start a background `until` loop polling ports 8080 + 4000, or watch the Emulator UI at http://localhost:4000.
- Do feature work / long-running servers in this dedicated worktree, never the shared `fyxer-web-app/` main tree.
