---
description: "Seed the factory from an existing PR or PR stack instead of live session context, judge whether it warrants a spec, build one via opsx:propose if so, then green the affected PR(s) with the usual review agents."
---
Like `sf:adopt`, but the seed is an already-open PR (or PR stack) read from GitHub, not this session's conversation — and there is no fresh code to build. This command exists for exactly two outcomes: retrospective OpenSpec docs for shipped/in-review work, and/or greening up a PR that needed a nudge. It never opens a new PR.

Target: $ARGUMENTS — one PR URL/number, or several (a stack, bottom to top). Else use the PR for the current branch (`gh pr view`) and walk `gh stack` if it's part of one.

## 1. Resolve the PR(s)

For each PR, in merge order (bottom of the stack first):

```bash
gh pr view <num> --json number,title,body,headRefName,baseRefName,url,state
gh pr diff <num>
```

Follow any Linear reference in the body via the Linear MCP for the issue title/description. If any PR is `MERGED` or `CLOSED`, note it — you can still write retrospective docs for it, but there is nothing to green.

`<slug>` = derived from the stack's shared feature name (Linear code + title if there is one, else the bottom PR's title).

## 2. Get the carrier worktree

The **carrier** is the bottom-most PR in the stack (or the only PR, if there's no stack) — it's the one that will carry an OpenSpec change if one is written, per the same "change rides the first slice" rule `start-feature` Phase 2.5 uses. Run `sf:get-worktree` with that PR's link to get or reconcile its worktree. You don't need a worktree for the other PRs in the stack yet — `fix-bot-comments`/`ci-green` resolve their own in step 6/7.

## 3. Seed the contract from the PR(s), not from tracing

Create `.scratch/<slug>/` and write:

- `requirements.md` — a numbered list of what the PR(s) actually implement, read off the diffs + descriptions (+ Linear issue), one sentence each, same shape as a forward-looking contract but stating what **was built**, not what should be. Header it **INFERRED FROM PR(S) <numbers> — reflects shipped/proposed code, not a pre-build contract**.
- `split.md` — the PR stack itself, in its real order. There's nothing to plan here: one slice per existing PR, already merge-ordered.
- `progress.md` — Phase 0 (frame) and the seeding done; Phase 1/2 pending your sign-off below; no Phase 3 build (nothing to build).

## 4. Sign off the seeded contract  🔒 human gate

Present `requirements.md`. Grill only to close gaps against what the diff(s) actually show — don't re-derive from scratch. Get an explicit yes before continuing; this is still the acceptance record for the spec decision below.

Present `split.md` (trivially: "these PRs, in this order") for a one-line go-ahead.

## 5. Judge whether this warrants a spec

Don't default to asking. Decide first, using the same bar `AGENTS.md` sets: a spec is for a **big or irreversible** change; small, reversible changes don't need one — tests are enough. Weigh it from what you now know: blast radius of the diff(s), whether anything here is hard to reverse (schema/data migrations, a removed guard, a public contract change), and total size across the stack. State your call and the one or two reasons behind it.

Only fall back to `AskUserQuestion` when the call is genuinely close — e.g. a sizeable diff that's still easily reversible, or a stack whose individual PRs are small but whose combined effect is large. Don't ask when it's clearly one or the other.

### 5a. If yes — build the OpenSpec assets

Run **`/opsx:propose <slug>`** (the project's OpenSpec skill — same artifact flow `start-feature` Phase 2.5 calls, just invoked by its `opsx:` command name) to create `proposal.md`, `design.md`, the delta `specs/<capability>/spec.md`, and `tasks.md` under `openspec/changes/<slug>/`. It grills for ambiguity on its own where needed; feed it `requirements.md` + the diffs as the material, not a fresh description. Sign off each artifact as `openspec status --change <slug> --json` reports it ready, same gate as Phase 2.5.

Commit the whole `openspec/changes/<slug>/` directory onto the **carrier** worktree's branch (`docs: add <slug> openspec change`) — it rides that PR, never a PR of its own.

Then green the carrier: run the `fix-pr` flow on it — pre-push review (Codex + Cursor) of this new commit against the PR base, push, then loop `fix-bot-comments` until every check is green and every thread is resolved.

For every **other** PR in the stack that isn't already green, run `sf:ci-green` on it (no pre-push review needed — you didn't change anything there).

### 5b. If no — check green, only loop if needed

Check every PR in the stack: `gh pr checks <num>` plus its unresolved bot threads.

- **All already green** → stop here. Report that no spec was warranted and nothing needed fixing.
- **Any not green** → run `sf:ci-green` on each PR that isn't, same review-agent loop the rest of the factory uses (`fix-bot-comments` verify → fix → reply → resolve, re-check, repeat until green). No pre-push review pass — you're not introducing a new diff, just clearing what's already there.

## 6. Report

One line per PR: number, final state (merged/green/still blocked and why), and whether it carries the new OpenSpec change. If a spec was written, include its `openspec/changes/<slug>/` path and the one-line reasoning from step 5.

Per-role models follow `~/.claude/sf-models.json` (`/sf:models`); worker vendor follows `/sf:model-provider`. Strip any such flag out of $ARGUMENTS before resolving PR args.
