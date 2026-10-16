---
description: "Run a multi-slice build from one orchestrator session: one worker session per slice, a single state board, and Joey only for bug questions and complexity reviews. --adopt takes over a build already under way."
---
Run Phase 3 of the `start-feature` skill as an orchestrator. `start-feature` and `sf:continue` hand any split of more than two slices to this command. Call it with `--adopt` to take over a build that is already running.

Arguments: `<slug>` (else derive it as `sf:continue` does), `--adopt`. An existing board in `.scratch/<slug>/progress.md` means resume: migrate it if it still has a `## Log` (see "State"), read `ledger.md` and the events after its cursor, check which workers are still running, arm the wake (see "Loop"), then go to the loop.

Begin your first reply in this session with the line `sf-orchestrator: <slug>`. The context hook (`hooks/orchestrator-context.py`) only reports to sessions that start a reply with it.

The orchestrator never writes feature code. It starts workers, reads what they log, rewrites the board and its ledger, and talks to Joey. It is the only session that edits `progress.md` or `ledger.md`. Workers only append events through `room log`.

## State

Keep `.scratch/<slug>/` in a checkout no slice owns: the primary checkout, or wherever the run started. Never keep it inside a slice worktree, because slice worktrees are pruned once they merge.

- `progress.md`: the board only, per "Board format" in the `start-feature` skill. It has no log.
- `events.jsonl`: one JSON line per event, `{"ts","id","ticket","role","type","sha","note"}`, `type` one of state, question, answer, blocker, ci, note. Append only, and only through `room log`; `id` is a sequence number. Run it as `python3 ${CLAUDE_PLUGIN_ROOT}/scripts/room log --dir <state dir> --ticket <slice> --role <role> --type <type> [--sha <sha>] --note "<one line>"`. A state note starts with the board state (`PUSHED tests green`). The CLI refuses anything else; detail longer than 500 characters goes in a file whose path the note names.
- `ledger.md`: yours alone; see "Ledger". `ledger-archive.md`: older decisions, append only.

**Migrating an older board.** If `progress.md` still has a `## Log`, move everything from that heading down, unchanged, to the end of `log-archive.md` in the same dir, and cut it from `progress.md`. Write `ledger.md` with cursor 0 and the decisions and open asks you can find in the archived log, newest first. Never read `log-archive.md` again on a wake; a sub-agent searches it when a question needs history.

## Ledger

`ledger.md` is what you know that the board doesn't show. Rewrite it whole on every wake; never append to it. Keep it to 200 lines: when it would pass that, move the oldest decisions, unchanged, to the end of `ledger-archive.md`.

```md
# <slug>: ledger (rewritten by "<this session's name>" <YYYY-MM-DD HH:MM>)

Cursor: <id of the last event read>
Lineage: <first orchestrator session> → ... → <this session>

## Goal
<one or two lines from requirements.md>

## Open asks
- Q3 (slice2, event 41): <question>. Asked Joey <date>.

## Next steps
- <what you will do on the next wake, and what you are waiting on>

## Budget
<context used at the last wake; anything else with a cap>

## Decisions (newest first)
- <date> Q2, slice3: "<Joey's words, quoted>". Sent to slice3; requirements.md R7.
```

## Start a new build

Preconditions, read from `progress.md`: `requirements.md` signed off, `split.md` approved, and the spec signed off if one was requested. If any is missing, stop and name the gate.

1. Read `requirements.md` and `split.md`. Give each slice an "after" list: the slices it stacks on, plus any slice whose code decisions it should reuse even though it doesn't stack on it. Ask of each pair: will the later slice need a helper, model or pattern the earlier one introduces? If so it waits, so it reuses that code instead of inventing its own.
2. Write the board: every slice NOT STARTED with its blocker named, the tree in stack order, and this session named in the heading. Write `ledger.md` with cursor 0, and arm the wake.
3. Start workers for the slices whose "after" list is empty, at most three at once. Often that is one, and that's fine.

## Adopt a build under way (`--adopt`)

Change nothing until the board is written.

1. Build the evidence table. For every worktree of the feature (`git worktree list`, branches carrying its Linear code or slug), `git fetch`, then record the branch, local HEAD, `@{u}`, ahead/behind, dirty files and owning session (`claude agents --json --all`, or `list_sessions` in the desktop app). For every PR (`gh pr list --search <code> --state all`) record its head, base, review state and CI. Mark each one pushed, local only, behind the remote, or stale/orphaned.
2. Check the table against any existing `progress.md`, plan or split. Where they disagree, the evidence wins. Log each disagreement as a `note` event.
3. Move any older log or prose out of `progress.md` as "Migrating an older board" says, write the board in the standard format, write `ledger.md`, and arm the wake.
4. Send every running worker the worker contract below with `SendMessage`, with the state dir and the `room` path filled in. This is the last report-routing message they need: from here they log to the file, whoever the orchestrator is.
5. For each stale or orphaned item, propose the exact commands and list what would be lost. Run nothing destructive (reset, checkout over work, worktree remove, branch delete, force push) without Joey's explicit yes.

Then run the loop.

## Workers

Start one session per slice with the `fork-session` skill, named `<slug>-<slice>`, in a fresh worktree cut from the slice's base (staging, or the branch it stacks on). The brief carries the slug, the absolute path of the state dir, the absolute path of the `room` script (`${CLAUDE_PLUGIN_ROOT}/scripts/room`, expanded), the slice and its section of `requirements.md`, the worktree, branch and base, and the worker contract word for word with both paths filled in. The worker runs `start-feature` Phase 3 steps 1 to 6 for its slice only: plan review, build and tests, `/review-feature` to RELEASE, push, draft PR, then CI and bot comments to green.

Worker contract:
- Report only through `python3 <room path> log --dir <state dir> --ticket <slice> --role <build|ci> --type <type> [--sha <head sha>] --note "<one line>"`. Never send the orchestrator a message to report; the orchestrator wakes on the file, so a report reaches whoever is orchestrating now. Never edit `progress.md`, `ledger.md` or `events.jsonl` any other way.
- Log `--type state` at every state change, the note starting with the board state (`LOCAL tests green`, `PUSHED`, `DRAFT PR #15061`, `PR CI green, threads resolved`). Log `--type ci` for a CI result worth knowing (a red, or green after a fix), and `--type blocker` when you stop on something outside your slice.
- Push your own branch and open your PR as a draft without asking. Change your base, edit your PR body and merge your base into your branch yourself, keeping the merge-order block intact. Fetch and merge `@{u}` and your base before every commit and push.
- Never rebase, force-push, merge a PR, merge into staging or main, or touch another slice's worktree. No bare `git stash`; use a WIP commit.
- Log any bug the contract doesn't settle, and any requirement you can't meet, as `--type question` (never ask Joey yourself), then wait. The answer comes as a message from the orchestrator.
- Once the PR is green with every thread resolved, log it and wait for the complexity review's cuts.

## Loop

**Arm the wake.** Start a `Monitor` with the command `tail -n 0 -F <state dir>/events.jsonl`, description `<slug> events`, and `timeout_ms` 1800000. Each new event arrives as a notification. When it expires, re-arm it. Keep one armed at a time. Events written while no monitor ran are not lost: every wake reads from the cursor, not from the notification.

On every monitor notification or user message:

1. Read `ledger.md` and the events after its cursor (`tail -n +<cursor + 1> <state dir>/events.jsonl`). Skip events you logged yourself. Don't read diffs, transcripts or `log-archive.md` yourself; send a sub-agent and take back five lines.
2. Rewrite the board: tree, states, SHAs, CI, blockers, probes and open questions. Update the stamp.
3. Rewrite `ledger.md` with the cursor set to the last id you read, new decisions and open asks, and next steps. Move old decisions to `ledger-archive.md` if it passes 200 lines.
4. Start any slice whose "after" list is met, keeping at most three workers running. A slice that stacks on another can start once that one is PUSHED, since it branches from it. A slice that waits to reuse another's decisions starts once that one has passed its complexity review.
5. When a base branch moves, tell each worker stacked on it to merge it in.
6. Keep the merge-order block (`<!-- merge-order:begin -->` to `<!-- merge-order:end -->`) the same in every PR body of the run.

## Joey's two gates

Joey is asked about two things only. Everything else (pushes, draft PRs, base changes, body edits, merging bases in) goes ahead without asking. Nobody but Joey merges a PR.

- **Bug questions.** A bug or ambiguity a worker logs as a `question` event that the contract doesn't settle. Batch them, ask with `AskUserQuestion`, record each answer in `requirements.md`, quote Joey's words under Decisions in `ledger.md`, log it as an `answer` event whose note starts with the question's event id (`re 41: ...`), and send it to the worker with `SendMessage`.
- **Complexity review.** When a slice's PR is green, run the `complexity-reduction` skill on it (read-only). Bring Joey its cuts, leading with hand-rolled code that should reuse an existing helper or abstraction. Send his decisions to the worker, which builds the cuts and runs `/review-feature` again. A slice is DONE only after this. If the skill isn't installed, do the reuse check yourself: for each new function or type in the diff, search the repo for one that already does the job, and list the matches.

## Forking yourself

When the context hook says the threshold has passed, fork at the next natural point: after a board rewrite, never during a merge, a question to Joey or an adopt step. Rewrite `ledger.md` first, so its cursor and open asks are current. Use `fork-session`, named `<slug>-orchestrator-<n>`, with the brief `Run /sf:orchestrate <slug>`; the ledger carries everything else. Put the new session's name in the board heading and add it to the ledger's lineage, stop your monitor with `TaskStop`, then stop working on the run. Workers need no telling: they log to the file, and the new session wakes on it.

## Finish

When every slice is DONE, run Phase 5 of the `start-feature` skill (the final report).
