---
description: "Run a multi-slice build from one orchestrator session: one worker session per slice, a single state board, and Joey only for bug questions and complexity reviews. --adopt takes over a build already under way."
---
Run Phase 3 of the `start-feature` skill as an orchestrator. `start-feature` and `sf:continue` hand any split of more than two slices to this command. Call it with `--adopt` to take over a build that is already running.

Arguments: `<slug>` (else derive it as `sf:continue` does), `--adopt`. An existing board in `~/FyxerGh/build-room/<slug>/progress.md` or `.scratch/<slug>/progress.md` means resume: migrate it if it still has a `## Log` (see "State"), refresh the state dir's `room` copy, read `ledger.md` and the events after its cursor, check which workers are still running, arm the wake (see "Loop"), then go to the loop.

Begin your first reply in this session with the line `sf-orchestrator: <slug> (Opus 5.5, xhigh)`. The context hook (`hooks/orchestrator-context.py`) only reports to sessions that start a reply with it. The orchestrator runs on Opus 5.5 at xhigh effort, because the app asks Joey before any start or switch that is dearer than the orchestrator's own model or effort, and at the top tier none is. Check with `get_session` (`"self"`): if its `model` is not `claude-opus-5-5` or its `effort` is not `xhigh`, say so in the same reply and ask Joey to pick Opus 5.5 and xhigh in the model menu (a session can't change its own), and start no worker until he has.

The orchestrator never writes feature code. It starts workers, reads what they log, keeps the queue and its ledger, renders the board, and talks to Joey. It is the only session that writes `tickets.json`, `ledger.md` or `progress.md`, and the only one that runs `room signoff` and `room render`; the `room-writers.py` hook refuses those to any other session. Workers only append events through `room log`.

## State

A new build keeps its state dir in `~/FyxerGh/build-room/<slug>/`, outside every checkout, so no worktree prune can take it. A run already under way in `.scratch/<slug>/` keeps its dir where it is when you adopt or resume it; never move a live run. `sf:continue` and the progress-tree mod look in both places, and the Build Room UI (`~/FyxerGh/agent-team`, `/room`) picks up every run under `~/FyxerGh/build-room/` by itself.

- `room`: a copy of the CLI. On every start, adopt or resume, run `cp ${CLAUDE_PLUGIN_ROOT}/scripts/room <state dir>/room` and use `python3 <state dir>/room ...` from then on, yourself and in every brief. `${CLAUDE_PLUGIN_ROOT}` names a version-stamped plugin cache dir that a reload can remove, stranding running workers; the copy lives as long as the run.
- `tickets.json`: the queue, yours alone. `{"slug", "orchestrator": "<this session's name>", "orchestratorSessionId": "<this session's `local_…` id, from `get_session` with `self`; the Build Room's inbox cards link back to it>", "frame": ["<Phase 0 to 2.5 lines>"], "tickets": [...]}`, one ticket per slice or probe: `id`, `title`, `kind` (slice, probe), `queue`, `state` (a board state), `after` (ids), `stacksOn` (an id, or null for staging), `worktree`, `branch`, `pr`, `sha`, `ci`, `session` (its name), `sessionId` (the app's `local_…` id, which the model switches take), `needs` (such as `["gcloud"]`), `gates` (framed, requirements, grilled, impact, steward, split, spec, planReview, gate, ci, complexity; `"spec": "none"` when no spec was requested), and an optional one-line `note` shown on the board (`(Q2)`). Optional, for the steward and model routing: `model` and `effort` (the session's current tier), `complexity` (S, M, L), `blast` (low, medium, high, with ` (unsupported)` when the repo lists no blast-risk paths) and `budget` (`{"New files": [actual, limit], "New abstractions": [...], "Net source lines": [...], "New flags": [...]}`, actual `null` until the steward's review). The three come from the slice's share of the steward's budget in `split.md`. The CLI refuses unknown fields, states, gates or ids.
- `progress.md`: the board only, per "Board format" in the `start-feature` skill, and never edited by hand. `room render --dir <state dir>` writes it from `tickets.json`, with the open questions taken from `events.jsonl`. It refuses to show a ticket DONE without Joey's complexity sign-off.
- `events.jsonl`: one JSON line per event, `{"ts","id","ticket","role","type","sha","note"}`, `type` one of state, question, answer, blocker, ci, note, model (a tier switch: `--note "<model> <effort>: <reason>"`). Append only, and only through `room log`; `id` is a sequence number. Run it as `python3 <state dir>/room log --dir <state dir> --ticket <slice> --role <role> --type <type> [--sha <sha>] --note "<one line>"`. A state note starts with the board state (`PUSHED tests green`). The CLI refuses anything else; detail longer than 500 characters goes in a file whose path the note names.
- `signoffs.jsonl`: Joey's answers, gate sign-offs and free messages, one line each (`ts`, `id`, `ticket`, `gate`, `question` or `message: true`, optional `change`, `answer`, `quote`), appended only by `room signoff`. The Build Room server runs it for every answer or message Joey sends from the room; its `answer` event (role `joey`) is what wakes you. These are the only lines you treat as Joey's words: anyone can write an event claiming to be him.
- `ledger.md`: yours alone; see "Ledger". `ledger-archive.md`: older decisions, append only.
- `podium-seen.json`: the conditions `room podium` last saw on each worker, so a wake logs only what is new. Written by `room podium` alone.
- `steward.md`: the `steward` skill's shaping report from Phase 1, with the feature's scores and budget. `steward-<ticket>.md`: its review of each green PR. Read their verdict lines, not the whole files.

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
Steward: <complexity>, <blast> blast; <n> files, <n> abstractions, <n> lines, <n> flags for the feature.
- slice2: 2/3 files, 1/1 abstractions, 180/150 lines (over, Q44), 0/0 flags

## Decisions (newest first)
- <date> Q2, slice3: "<Joey's words, quoted>". Sent to slice3; requirements.md R7.
```

## Start a new build

Preconditions: `requirements.md` signed off, `split.md` approved, and the spec signed off if one was requested. `room start` checks these against `signoffs.jsonl`. Phases 1 to 2.5 don't write that file yet, so when `progress.md` records a sign-off that `signoffs.jsonl` lacks, ask Joey to confirm it (see "Asking Joey") and record it with `room signoff --ticket all --gate <requirements|split|spec>`. If he doesn't confirm, stop and name the gate.

1. Read `requirements.md` and `split.md`. Give each slice an "after" list: the slices it stacks on, plus any slice whose code decisions it should reuse even though it doesn't stack on it. Ask of each pair: will the later slice need a helper, model or pattern the earlier one introduces? If so it waits, so it reuses that code instead of inventing its own.
2. Make `~/FyxerGh/build-room/<slug>/` and move everything in `.scratch/<slug>/` into it (`requirements.md`, `split.md`, `briefs/`, `progress.md`), leaving nothing behind, so the hook still finds `signoffs.jsonl` next to `requirements.md`. Copy `room` into it. Write `tickets.json` with every slice NOT STARTED, in stack order, and this session as `orchestrator`, each with its `complexity`, `blast` and `budget` from its share in `split.md` and `"steward": "ok, budget set"` in its gates, then `room render`. Write `ledger.md` with cursor 0 and the steward's scores and budget in its Budget section, and arm the wake. A run with no `steward.md` has no budget: say so in the ledger, and the review pass in "Joey's two gates" reports actuals and cuts only.
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

Start a worker only after `python3 <state dir>/room start --dir <state dir> <slice>` exits 0. When it refuses, it names the human gates with no line in `signoffs.jsonl`; ask Joey for those and start nothing until they pass. Never start a worker any other way, and never write a sign-off Joey didn't give. On success it prints the session name, worktree, branch, base, `needs` and Joey's tier `override` (null when he has set none); a ticket that needs `gcloud` runs on this Mac.

Start one session per slice with `start_session` (load it, `set_session_model`, `set_session_effort` and `get_session` with `ToolSearch`): `initiation: "user_asked"`, `context: "fresh"`, `use_worktree: true`, `source_branch` the slice's base (staging, or the branch it stacks on), `name` the `start` value `room start` printed (lowercased, cut to 24 characters), and `model` and `effort` from "Model routing" for its first phase. If the app refuses the start because an event rather than Joey began this turn, propose it instead with `initiation: "own_initiative"` and the same fields, and log a `note` that the slice waits on Joey starting that card. Set the ticket's `session` to that name and `sessionId` to the id the result gives, its `worktree` and `branch` from `get_session`, its `model`, `effort` and `state`, log the `model` event, and render. Only where there is no desktop app (no `start_session` tool) use the `fork-session` skill, with the same model and effort; a session started that way can't be switched from outside, so its tier holds for the whole slice. The brief carries the slug, the absolute path of the state dir, the absolute path of the `room` copy (`<state dir>/room`), the slice and its section of `requirements.md`, the worktree, branch and base, the `--build-model` and `--test-model` flags for its tier (see "Model routing"), the ticket's budget, the high-blast globs from the repo's "Blast risk" list (the `repo-instructions` skill), and the worker contract word for word with both paths filled in. The worker runs `start-feature` Phase 3 steps 1 to 6 for its slice only: plan review, build and tests, `/review-feature` to RELEASE, push, draft PR, then CI and bot comments to green.

Worker contract:
- Report only through `python3 <room path> log --dir <state dir> --ticket <slice> --role <build|ci> --type <type> [--sha <head sha>] --note "<one line>"`. Never send the orchestrator a message to report; the orchestrator wakes on the file, so a report reaches whoever is orchestrating now. Never edit `progress.md`, `ledger.md` or `events.jsonl` any other way.
- Log `--type state` at every state change, the note starting with the board state (`LOCAL tests green`, `PUSHED`, `DRAFT PR #15061`, `PR CI green, threads resolved`). Log `--type ci` for a CI result worth knowing (a red, or green after a fix), and `--type blocker` when you stop on something outside your slice.
- Push your own branch and open your PR as a draft without asking. Change your base, edit your PR body and merge your base into your branch yourself, keeping the merge-order block intact. Fetch and merge `@{u}` and your base before every commit and push.
- Never rebase, force-push, merge a PR, merge into staging or main, or touch another slice's worktree. No bare `git stash`; use a WIP commit.
- Log any bug the contract doesn't settle, and any requirement you can't meet, as `--type question` (never ask Joey yourself), then wait. The answer comes as a message from the orchestrator.
- Log `--type note` with one of these openings when it happens, since each can move you to a higher model: `plan review failed round <n>`, `gate failed round <n>`, `test failed outside the diff: <test>`, `over budget: <row> <actual>/<limit>` (check your diff against the budget in your brief before each push), `unplanned high-blast path: <path>` (a changed path matching the brief's high-blast globs that the plan didn't name).
- Run `start-feature` and `/review-feature` with the `--build-model` and `--test-model` flags in your brief, and with the new ones when a message from the orchestrator gives them.
- Once the PR is green with every thread resolved, log it and wait for the complexity review's cuts.

## Model routing

Each worker's model and effort follow the work its ticket is doing now. The picker's ids are `claude-opus-5-5` and `claude-sonnet-5-5`; if `set_session_model` refuses one, its result lists the picker's ids, so use the matching one and fix this table.

| Work | Model | Effort |
|---|---|---|
| Merging a base in, conflict resolution, PR body edits, simple bot-comment triage | `claude-sonnet-5-5` | high |
| CI watch on a pushed build | `claude-sonnet-5-5` | high |
| Build-verify-review (BUILDING to LOCAL, and building the complexity cuts), S complexity and low blast | `claude-sonnet-5-5` | high |
| Build-verify-review, M complexity or medium blast | `claude-opus-5-5` | high |
| Build-verify-review, L complexity or high blast | `claude-opus-5-5` | xhigh |
| Shaping, and the steward's review | `claude-opus-5-5` | high, xhigh when blast is high |

A ticket with no complexity or blast score takes the M row. A bot comment that needs more than a few lines of code is build work, not triage.

Flags for the worker's own sub-agents: on a `claude-sonnet-5-5` tier pass `--build-model claude-sonnet-5-5 --test-model claude-sonnet-5-5`; on a `claude-opus-5-5` tier pass `--build-model claude-opus-5-5 --test-model claude-sonnet-5-5` (tests stay on Sonnet, as `/sf:models` defaults them). The cross-vendor review seats (Codex, Gemini, Cursor) stay as `/sf:models` sets them.

**On every state event**, and on every step-up note below, work out the ticket's tier:

1. `python3 <state dir>/room tier --dir <state dir> <slice>`. Non-null is Joey's override: use its tier and skip the rest.
2. Else take the table row for the work the ticket does next.
3. Step up one tier (Sonnet high, then Opus high, then Opus xhigh, never max) when the ticket's events show plan review failing a second round, the pre-PR gate failing a third, a test failing outside the diff, a `question` from the worker, the diff passing the steward's budget, or a high-blast path the plan didn't name. A step-up holds until the ticket next reaches a step-down phase.
4. Step down to the Sonnet row when the build reaches CI watch, or when all that is left is merging a base or resolving a conflict.

If the tier differs from the ticket's `model` and `effort`, call `set_session_model` and `set_session_effort` (whichever changed) on the ticket's `sessionId` before you send the worker its next instruction, since a switch applies from the session's next turn. Then write the new `model` and `effort` to `tickets.json`, log `room log --ticket <slice> --role orchestrator --type model --note "<model> <effort>: <reason>"`, and put the matching flags in that next instruction. Neither switch prompts Joey while the orchestrator is on Opus 5.5 at xhigh and started the worker itself. A worker it didn't start (adopted, or after a fork) may ask Joey, and a `fork-session` worker can't be switched at all: log the tier it should have as a `note` and leave it.

**Joey's override.** When Joey names a tier for a ticket ("put slice2 on Opus xhigh", "everything on Sonnet"), record it with `room signoff --ticket <slice|all> --tier "<model id> <effort>" --quote "<his words, verbatim>"`, then switch as above. It wins over the table and the step rules until he clears it, which you record with `--tier clear`. A ticket's own line beats an older `all` line, and the latest line wins. A tier above the orchestrator's own asks him in the app first; that is his choice to make.

## Loop

**Arm the wake.** Start a `Monitor` with the command `tail -n 0 -F <state dir>/events.jsonl`, description `<slug> events`, and `timeout_ms` 1800000. Each new event arrives as a notification. When it expires, re-arm it. Keep one armed at a time. Events written while no monitor ran are not lost: every wake reads from the cursor, not from the notification.

On every monitor notification or user message:

1. Run `python3 <state dir>/room podium --dir <state dir>`. It reads Podium's fleet state (the dashboard at `http://127.0.0.1:4317` that the `podium-reporter` mod reports every session to), matches each live session to a ticket by its worktree or branch, and logs a `blocker` event with role `podium` for each worker that waits on a prompt, has gone stale, has a failed agent it hasn't retried, or has used 80% of its context window, once per new condition, with the session's Podium link. It reads Podium's token itself; never read, print or pass it. When Podium isn't running or refuses the token it prints one line and exits 0: carry on without it. Read what it reports from the events, never from transcripts. A worker waiting at a prompt (a permission prompt or a plan approval) is Joey's to answer, in that session or in Podium: put it on the board as the ticket's `note` (`(waits on Joey in its session)`) and never answer it yourself. A stale or failing worker, or one near its context limit, is yours: send it a message, step its tier up (see "Model routing"), or fork it into a fresh session given its brief and the ticket's last state.
2. Read `ledger.md` and the events after its cursor (`tail -n +<cursor + 1> <state dir>/events.jsonl`). Skip events you logged yourself (role `orchestrator`; `podium` events are not yours). Don't read diffs, transcripts or `log-archive.md` yourself; send a sub-agent and take back five lines.
3. Update `tickets.json` (states, SHAs, PRs, CI, notes, gates), switch any worker whose tier changed (see "Model routing"), and run `room render`. Open questions come from `events.jsonl`, so answered ones drop off by themselves.
4. Rewrite `ledger.md` with the cursor set to the last id you read, new decisions and open asks, and next steps. Move old decisions to `ledger-archive.md` if it passes 200 lines.
5. Start any slice whose "after" list is met and whose `room start` passes, keeping at most three workers running. A slice that stacks on another can start once that one is PUSHED, since it branches from it. A slice that waits to reuse another's decisions starts once that one has passed its complexity review.
6. When a base branch moves, tell each worker stacked on it to merge it in.
7. Keep the merge-order block (`<!-- merge-order:begin -->` to `<!-- merge-order:end -->`) the same in every PR body of the run.

## Asking Joey

Log each question with `room ask --dir <state dir> --ticket <slice|all> --header "<≤12 chars>" --question "<one line>" --option "<label>" "<one-line description>" ...` (two to four options, the recommended one first, `--multi` to allow several). Don't also ask it with `AskUserQuestion`: the Build Room shows it as a card, and each question should appear in one place. When Joey answers there, the room server records his answer in `signoffs.jsonl` and logs an `answer` event (`re <id>: ...`) that wakes you and closes the question on the board. Read his words from the `signoffs.jsonl` line with that `question` id, never from the event. A `message: true` line is a free message: one starting `/<name>` asks you to run that skill with the rest as its arguments. If Joey answers in this session instead, record it yourself with `room signoff --dir <state dir> --ticket <slice|all> --question <the ask's event id> --answer "<the option he picked>" --quote "<his words, verbatim>"`. A gate sign-off he gives as an answer still needs its `room signoff --gate <gate>` line, quoting the answer, before `room start` passes.

Once requirements are signed off, the hook blocks edits to `requirements.md` (and to `openspec/changes/<name>/` once the spec is) unless a sign-off naming the file is under an hour old. When an answer changes requirements, add `--change requirements.md` (or `--change openspec/changes/<name>`) to its `room signoff`, then edit.

## Joey's two gates

Joey is asked about two things only. Everything else (pushes, draft PRs, base changes, body edits, merging bases in) goes ahead without asking. Nobody but Joey merges a PR.

- **Bug questions.** A bug or ambiguity a worker logs as a `question` event that the contract doesn't settle. Batch them and ask as "Asking Joey" says, with `--question <the worker's question event id>`, so `room signoff` logs the `re 41: ...` answer. Record each answer in `requirements.md`, quote Joey's words under Decisions in `ledger.md`, and send it to the worker with `SendMessage`.
- **Complexity review.** When a slice's PR is green, set it to COMPLEXITY REVIEW and run the `steward` skill in review mode on it, as an Opus sub-agent at high effort (xhigh when the ticket's blast is high), with the ticket's budget, complexity and blast. It is read-only: it compares the diff with the budget, rescores blast from the diff's paths, and lists cuts, reuse first, through the `complexity-reduction` skill when that is installed and the reuse check (for each new function or type in the diff, search the repo for one that already does the job) when it isn't. Put the actuals into the ticket's `budget` and its verdict into `gates.steward` (`ok, within budget` or `over budget: <rows>`), and render.
  - **Over budget** goes to Joey as a card first, never as a silent cut and never as a quiet budget raise: `room ask --ticket <slice> --header "Over budget" --question "<slice> is over on <rows>: <actual>/<limit>. Cut back or raise the budget?"`, with options such as "Make the cuts" (the cuts that bring it back, in one line), "Keep it, raise the budget" and "Some of the cuts" (he says which). Note the question id on the ledger's Budget line.
  - **Within budget**, bring Joey the cuts the same way, leading with hand-rolled code that should reuse an existing helper or abstraction.
  - Either answer is his complexity decision: record it with `room signoff --ticket <slice> --gate complexity`, quoting him, and send the cuts he chose to the worker, which builds them and runs `/review-feature` again. A raised budget goes into the ticket's limits and the ledger. A slice is DONE only after this; `room render` refuses DONE without that line.

## Forking yourself

When the context hook says the threshold has passed, fork at the next natural point: after a board rewrite, never during a merge, a question to Joey or an adopt step. Rewrite `ledger.md` first, so its cursor and open asks are current. Start it with `start_session` (`context: "fresh"`, `use_worktree: false`, `model: "claude-opus-5-5"`, `effort: "xhigh"`), named `<slug>-orchestrator-<n>`, with the brief `Run /sf:orchestrate <slug>`; the ledger carries everything else. Use `fork-session` only where there is no desktop app. The new orchestrator didn't start the running workers, so its first switch on each of them may ask Joey; fork when few are mid-build. Put the new session's name in the board heading and add it to the ledger's lineage, stop your monitor with `TaskStop`, then stop working on the run. Workers need no telling: they log to the file, and the new session wakes on it.

## Finish

When every slice is DONE, run Phase 5 of the `start-feature` skill (the final report).
