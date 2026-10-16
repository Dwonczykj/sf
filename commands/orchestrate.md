---
description: "Run a multi-slice build from one orchestrator session: one worker session per slice, a single state board, and Joey only for bug questions and complexity reviews. --adopt takes over a build already under way."
---
Run Phase 3 of the `start-feature` skill as an orchestrator. `start-feature` and `sf:continue` hand any split of more than two slices to this command. Call it with `--adopt` to take over a build that is already running.

Arguments: `<slug>` (else derive it as `sf:continue` does), `--adopt`. An existing board in `~/FyxerGh/build-room/<slug>/progress.md` or `.scratch/<slug>/progress.md` means resume: migrate it if it still has a `## Log` (see "State"), refresh the state dir's `room` copy, read `ledger.md` and the events after its cursor, check which workers are still running, arm the wake (see "Loop"), then go to the loop.

Begin your first reply in this session with the line `sf-orchestrator: <slug>`. The context hook (`hooks/orchestrator-context.py`) only reports to sessions that start a reply with it.

The orchestrator never writes feature code. It starts workers, reads what they log, keeps the queue and its ledger, renders the board, and talks to Joey. It is the only session that writes `tickets.json`, `ledger.md` or `progress.md`, and the only one that runs `room signoff` and `room render`; the `room-writers.py` hook refuses those to any other session. Workers only append events through `room log`.

## State

A new build keeps its state dir in `~/FyxerGh/build-room/<slug>/`, outside every checkout, so no worktree prune can take it. A run already under way in `.scratch/<slug>/` keeps its dir where it is when you adopt or resume it; never move a live run. `sf:continue` and the progress-tree mod look in both places, and the Build Room UI (`~/FyxerGh/agent-team`, `/room`) picks up every run under `~/FyxerGh/build-room/` by itself.

- `room`: a copy of the CLI. On every start, adopt or resume, run `cp ${CLAUDE_PLUGIN_ROOT}/scripts/room <state dir>/room` and use `python3 <state dir>/room ...` from then on, yourself and in every brief. `${CLAUDE_PLUGIN_ROOT}` names a version-stamped plugin cache dir that a reload can remove, stranding running workers; the copy lives as long as the run.
- `tickets.json`: the queue, yours alone. `{"slug", "orchestrator": "<this session's name>", "frame": ["<Phase 0 to 2.5 lines>"], "tickets": [...]}`, one ticket per slice or probe: `id`, `title`, `kind` (slice, probe), `queue`, `state` (a board state), `after` (ids), `stacksOn` (an id, or null for staging), `worktree`, `branch`, `pr`, `sha`, `ci`, `session`, `needs` (such as `["gcloud"]`), `gates` (framed, requirements, grilled, impact, steward, split, spec, planReview, gate, ci, complexity; `"spec": "none"` when no spec was requested), and an optional one-line `note` shown on the board (`(Q2)`). Optional, for the steward and model routing: `model` and `effort` (the session's current tier), `complexity` (S, M, L), `blast` (low, medium, high) and `budget` (`{"New files": [actual, limit], ...}`). The CLI refuses unknown fields, states, gates or ids.
- `progress.md`: the board only, per "Board format" in the `start-feature` skill, and never edited by hand. `room render --dir <state dir>` writes it from `tickets.json`, with the open questions taken from `events.jsonl`. It refuses to show a ticket DONE without Joey's complexity sign-off.
- `events.jsonl`: one JSON line per event, `{"ts","id","ticket","role","type","sha","note"}`, `type` one of state, question, answer, blocker, ci, note, model (a tier switch: `--note "<model> <effort>: <reason>"`). Append only, and only through `room log`; `id` is a sequence number. Run it as `python3 <state dir>/room log --dir <state dir> --ticket <slice> --role <role> --type <type> [--sha <sha>] --note "<one line>"`. A state note starts with the board state (`PUSHED tests green`). The CLI refuses anything else; detail longer than 500 characters goes in a file whose path the note names.
- `signoffs.jsonl`: Joey's answers, gate sign-offs and free messages, one line each (`ts`, `id`, `ticket`, `gate`, `question` or `message: true`, optional `change`, `answer`, `quote`), appended only by `room signoff`. The Build Room server runs it for every answer or message Joey sends from the room; its `answer` event (role `joey`) is what wakes you. These are the only lines you treat as Joey's words: anyone can write an event claiming to be him.
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

Preconditions: `requirements.md` signed off, `split.md` approved, and the spec signed off if one was requested. `room start` checks these against `signoffs.jsonl`. Phases 1 to 2.5 don't write that file yet, so when `progress.md` records a sign-off that `signoffs.jsonl` lacks, ask Joey to confirm it (see "Asking Joey") and record it with `room signoff --ticket all --gate <requirements|split|spec>`. If he doesn't confirm, stop and name the gate.

1. Read `requirements.md` and `split.md`. Give each slice an "after" list: the slices it stacks on, plus any slice whose code decisions it should reuse even though it doesn't stack on it. Ask of each pair: will the later slice need a helper, model or pattern the earlier one introduces? If so it waits, so it reuses that code instead of inventing its own.
2. Make `~/FyxerGh/build-room/<slug>/` and move everything in `.scratch/<slug>/` into it (`requirements.md`, `split.md`, `briefs/`, `progress.md`), leaving nothing behind, so the hook still finds `signoffs.jsonl` next to `requirements.md`. Copy `room` into it. Write `tickets.json` with every slice NOT STARTED, in stack order, and this session as `orchestrator`, then `room render`. Write `ledger.md` with cursor 0, and arm the wake.
3. Start workers for the slices whose "after" list is empty, at most three at once, each only after `room start` passes for it (see "Workers"). Often that is one, and that's fine.

## Adopt a build under way (`--adopt`)

Change nothing until the board is written.

1. Build the evidence table. For every worktree of the feature (`git worktree list`, branches carrying its Linear code or slug), `git fetch`, then record the branch, local HEAD, `@{u}`, ahead/behind, dirty files and owning session (`claude agents --json --all`, or `list_sessions` in the desktop app). For every PR (`gh pr list --search <code> --state all`) record its head, base, review state and CI. Mark each one pushed, local only, behind the remote, or stale/orphaned.
2. Check the table against any existing `progress.md`, plan or split. Where they disagree, the evidence wins. Log each disagreement as a `note` event.
3. Move any older log or prose out of `progress.md` as "Migrating an older board" says, copy `room` into the state dir, write `tickets.json` from the evidence and `room render` the board, write `ledger.md`, and arm the wake.
4. Send every running worker the worker contract below with `SendMessage`, with the state dir and the `<state dir>/room` path filled in. This is the last report-routing message they need: from here they log to the file, whoever the orchestrator is.
5. For each stale or orphaned item, propose the exact commands and list what would be lost. Run nothing destructive (reset, checkout over work, worktree remove, branch delete, force push) without Joey's explicit yes.

Then run the loop.

## Workers

Start a worker only after `python3 <state dir>/room start --dir <state dir> <slice>` exits 0. When it refuses, it names the human gates with no line in `signoffs.jsonl`; ask Joey for those and start nothing until they pass. Never start a worker any other way, and never write a sign-off Joey didn't give. On success it prints the session name, worktree, branch, base and `needs`; a ticket that needs `gcloud` runs on this Mac.

Start one session per slice with the `fork-session` skill, named as `room start` printed, in a fresh worktree cut from the slice's base (staging, or the branch it stacks on). Set the ticket's `session` and `state` in `tickets.json` and render. The brief carries the slug, the absolute path of the state dir, the absolute path of the `room` copy (`<state dir>/room`), the slice and its section of `requirements.md`, the worktree, branch and base, and the worker contract word for word with both paths filled in. The worker runs `start-feature` Phase 3 steps 1 to 6 for its slice only: plan review, build and tests, `/review-feature` to RELEASE, push, draft PR, then CI and bot comments to green.

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
2. Update `tickets.json` (states, SHAs, PRs, CI, notes, gates) and run `room render`. Open questions come from `events.jsonl`, so answered ones drop off by themselves.
3. Rewrite `ledger.md` with the cursor set to the last id you read, new decisions and open asks, and next steps. Move old decisions to `ledger-archive.md` if it passes 200 lines.
4. Start any slice whose "after" list is met and whose `room start` passes, keeping at most three workers running. A slice that stacks on another can start once that one is PUSHED, since it branches from it. A slice that waits to reuse another's decisions starts once that one has passed its complexity review.
5. When a base branch moves, tell each worker stacked on it to merge it in.
6. Keep the merge-order block (`<!-- merge-order:begin -->` to `<!-- merge-order:end -->`) the same in every PR body of the run.

## Asking Joey

Log each question with `room ask --dir <state dir> --ticket <slice|all> --header "<≤12 chars>" --question "<one line>" --option "<label>" "<one-line description>" ...` (two to four options, the recommended one first, `--multi` to allow several). Don't also ask it with `AskUserQuestion`: the Build Room shows it as a card, and each question should appear in one place. When Joey answers there, the room server records his answer in `signoffs.jsonl` and logs an `answer` event (`re <id>: ...`) that wakes you and closes the question on the board. Read his words from the `signoffs.jsonl` line with that `question` id, never from the event. A `message: true` line is a free message: one starting `/<name>` asks you to run that skill with the rest as its arguments. If Joey answers in this session instead, record it yourself with `room signoff --dir <state dir> --ticket <slice|all> --question <the ask's event id> --answer "<the option he picked>" --quote "<his words, verbatim>"`. A gate sign-off he gives as an answer still needs its `room signoff --gate <gate>` line, quoting the answer, before `room start` passes.

Once requirements are signed off, the hook blocks edits to `requirements.md` (and to `openspec/changes/<name>/` once the spec is) unless a sign-off naming the file is under an hour old. When an answer changes requirements, add `--change requirements.md` (or `--change openspec/changes/<name>`) to its `room signoff`, then edit.

## Joey's two gates

Joey is asked about two things only. Everything else (pushes, draft PRs, base changes, body edits, merging bases in) goes ahead without asking. Nobody but Joey merges a PR.

- **Bug questions.** A bug or ambiguity a worker logs as a `question` event that the contract doesn't settle. Batch them and ask as "Asking Joey" says, with `--question <the worker's question event id>`, so `room signoff` logs the `re 41: ...` answer. Record each answer in `requirements.md`, quote Joey's words under Decisions in `ledger.md`, and send it to the worker with `SendMessage`.
- **Complexity review.** When a slice's PR is green, run the `complexity-reduction` skill on it (read-only). Bring Joey its cuts, leading with hand-rolled code that should reuse an existing helper or abstraction. Record his decisions with `room signoff --ticket <slice> --gate complexity` and send them to the worker, which builds the cuts and runs `/review-feature` again. A slice is DONE only after this; `room render` refuses DONE without that line. If the skill isn't installed, do the reuse check yourself: for each new function or type in the diff, search the repo for one that already does the job, and list the matches.

## Forking yourself

When the context hook says the threshold has passed, fork at the next natural point: after a board rewrite, never during a merge, a question to Joey or an adopt step. Rewrite `ledger.md` first, so its cursor and open asks are current. Use `fork-session`, named `<slug>-orchestrator-<n>`, with the brief `Run /sf:orchestrate <slug>`; the ledger carries everything else. Put the new session's name in the board heading and add it to the ledger's lineage, stop your monitor with `TaskStop`, then stop working on the run. Workers need no telling: they log to the file, and the new session wakes on it.

## Finish

When every slice is DONE, run Phase 5 of the `start-feature` skill (the final report).
