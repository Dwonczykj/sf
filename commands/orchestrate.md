---
description: "Run a multi-slice build from one orchestrator session: one worker session per slice, a single state board, and Joey only for bug questions and complexity reviews. --adopt takes over a build already under way."
---
Run Phase 3 of the `start-feature` skill as an orchestrator. `start-feature` and `sf:continue` hand any split of more than two slices to this command. Call it with `--adopt` to take over a build that is already running. A topic room, made by `/sf:room new <topic>`, runs here too, with no contract up front: see "Topic rooms".

Arguments: `<slug>` (else derive it as `sf:continue` does), `--adopt`. An existing board in `~/FyxerGh/build-room/<slug>/progress.md` or `.scratch/<slug>/progress.md` means resume: migrate it if it still has a `## Log` (see "State"), refresh the state dir's `room` copy, read `ledger.md` and the events after its cursor, check which workers are still running, arm the wake (see "Loop"), then go to the loop.

Begin your first reply in this session with the line `sf-orchestrator: <slug>`. The context hook (`hooks/orchestrator-context.py`) only reports to sessions that start a reply with it. The orchestrator runs on whatever model and effort the session has, with Opus as its advisor (`/advisor opus`, which saves `advisorModel` to user settings, so every new session picks it up). Nothing here checks the model, and no worker waits on a model switch: start workers as soon as `room start` passes. A model can't run `/advisor` itself, so if you have no advisor tool, say so once in your first reply, ask Joey to type `/advisor opus`, and carry on. Consult the advisor before you set the `after` lists, before you answer a worker's bug question, and before you brief a complexity review.

The orchestrator never writes feature code. It starts workers, reads what they log, keeps the queue and its ledger, renders the board, and talks to Joey. It is the only session that writes `tickets.json`, `ledger.md` or `progress.md`, and the only one that runs `room signoff` and `room render`; the `room-writers.py` hook refuses those to any other session. Workers only append events through `room log`.

## State

A new build keeps its state dir in `~/FyxerGh/build-room/<slug>/`, outside every checkout, so no worktree prune can take it. `--adopt` moves a run found in `.scratch/<slug>/` there first (step 1 of "Adopt"), copying before it deletes; a plain resume finds a run in either place and leaves it. `sf:continue` and the progress-tree mod look in both places, and the Build Room UI (`/sf:room start`, `http://127.0.0.1:7790/room`) picks up every run under `~/FyxerGh/build-room/` by itself.

- `room`: a copy of the CLI. On every start, adopt or resume, run `cp ${CLAUDE_PLUGIN_ROOT}/scripts/room <state dir>/room` and use `python3 <state dir>/room ...` from then on, yourself and in every brief. `${CLAUDE_PLUGIN_ROOT}` names a version-stamped plugin cache dir that a reload can remove, stranding running workers; the copy lives as long as the run.
- `tickets.json`: the queue, yours alone. `{"slug", "topic": true (a topic room only), "linear" (a topic room's mirror, see "Linear mirror"), "adopted" (`{feature: state dir}`, see "Adopt a run by reference"), "orchestrator": "<this session's name>", "orchestratorSessionId": "<this session's `local_…` id, from `get_session` with `self`; the Build Room's inbox cards link back to it>", "frame": ["<Phase 0 to 2.5 lines>"], "tickets": [...]}`, one ticket per slice, probe or task: `id`, `title`, `kind` (slice, probe, light, or a task kind from "Tasks"; none means slice), `feature` (the feature whose contract it builds, `features/<slug>/`; see "Features"), `queue`, `state` (a board state), `after` (ids), `stacksOn` (an id, or null for staging), `worktree`, `branch`, `pr`, `sha`, `ci`, `session` (its name), `sessionId` (the app's `local_…` id, which the model switches take), `needs` (such as `["gcloud"]`), `gates` (framed, requirements, grilled, impact, steward, split, spec, planReview, gate, ci, complexity; `"spec": "none"` when no spec was requested), and an optional one-line `note` shown on the board (`(Q2)`). Optional, for the steward and model routing: `model` and `effort` (the session's current tier), `complexity` (S, M, L), `blast` (low, medium, high, with ` (unsupported)` when the repo lists no blast-risk paths) and `budget` (`{"New files": [actual, limit], "New abstractions": [...], "Net source lines": [...], "New flags": [...]}`, actual `null` until the steward's review). The three come from the slice's share of the steward's budget in `split.md`. Optional, for a slice `build-route` sent to the factory: `linear` (the factory ticket's id) and `prUrl` (its PR's URL, since the factory may open it in another repo). Optional in a topic room: `linearIssue` (the build's mirror issue), `design` (the design task whose chosen version it builds) and `source` (set by `room refresh` on a ticket copied from an adopted run; never set it yourself). The CLI refuses unknown fields, kinds, states, gates or ids.
- `progress.md`: the board only, per "Board format" in the `start-feature` skill, and never edited by hand. `room render --dir <state dir>` writes it from `tickets.json`, with the open questions taken from `events.jsonl`. It refuses to show a ticket DONE without Joey's complexity sign-off.
- `events.jsonl`: one JSON line per event, `{"ts","id","ticket","role","type","sha","note"}`, `type` one of state, question, answer, blocker, ci, note, model (a tier switch: `--note "<model> <effort>: <reason>"`), join (see "Hand-started sessions"; written by `room join`, never `room log`). Append only, and only through `room log`; `id` is a sequence number. Run it as `python3 <state dir>/room log --dir <state dir> --ticket <slice> --role <role> --type <type> [--sha <sha>] --note "<one line>"`. A state note starts with the board state (`PUSHED tests green`). The CLI refuses anything else; detail longer than 500 characters goes in a file whose path the note names.
- `signoffs.jsonl`: Joey's answers, gate sign-offs and free messages, one line each (`ts`, `id`, `ticket`, `gate`, `question` or `message: true`, optional `change`, `answer`, `quote`), appended only by `room signoff`. The Build Room server runs it for every answer or message Joey sends from the room; its `answer` event (role `joey`) is what wakes you. These are the only lines you treat as Joey's words: anyone can write an event claiming to be him.
- `ledger.md`: yours alone; see "Ledger". `ledger-archive.md`: older decisions, append only.
- `prs.json`: every PR the room built, read from GitHub by `room prs` alone (its only writer): number, URL, title, state, draft, base and head, a CI summary, human reviews, unresolved threads split into bots and humans, mergeable, how far behind its base it is, merge times, the ticket's feature, session and whether it was built by a session or the factory, plus `order`, `mergesAfter` and `next` for the unmerged ones. Adopted tickets' PRs are in it, flagged `readOnly`. `checkedAt` is the last successful check; `error` is the last failure's one-line reason. Never edit it.
- `podium-seen.json`: the conditions `room podium` last saw on each worker, so a wake logs only what is new. Written by `room podium` alone.
- `tasks/<id>.md`: a task's findings, under 40 lines, written by that task. `tasks/<id>/`: a design task's chosen screenshots.
- `features/<slug>/`: one feature's contract in a topic room (`requirements.md`, `split.md`, `briefs/`, and `steward.md`, `impact.md`), or an adopted run's `source.md` and `summary.md`. A room with its contract at the root, as every run before topic rooms, has one feature: the root.
- `light/<id>.md`: a light build's contract, 1 to 5 numbered requirements.
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

Change nothing in the repo or any worktree until the board is written. The one exception is step 1, which copies the state dir and deletes nothing until the copy checks out.

1. Move the state dir first. Find the run's dir: `~/FyxerGh/build-room/<slug>/` if it exists (then there is nothing to move), else `.scratch/<slug>/` in this checkout or in any worktree from `git worktree list` (ask Joey which, if more than one has it). Make `~/FyxerGh/build-room/<slug>/` and copy the dir's files into it with `cp -R`, overwriting nothing. Check the copy: `diff -r <old dir> <new dir>` must report no difference. If it reports one, stop, leave the old dir as it is and tell Joey. Only when the check is clean, delete the old copies of those files (the dir's own files, never its siblings in `.scratch/` or anything else in the worktree) and leave a one-line `MOVED.md` in the old dir naming the new one, so a session still writing there finds out. From here on `<state dir>` is the new dir. A running worker still holds the old path until step 5's message, so move the dir as soon as the evidence table is built and send that message straight after the board is written.
2. Build the evidence table. For every worktree of the feature (`git worktree list`, branches carrying its Linear code or slug), `git fetch`, then record the branch, local HEAD, `@{u}`, ahead/behind, dirty files and owning session (`claude agents --json --all`, or `list_sessions` in the desktop app). For every PR (`gh pr list --search <code> --state all`) record its head, base, review state and CI. Mark each one pushed, local only, behind the remote, or stale/orphaned.
3. Check the table against any existing `progress.md`, plan or split. Where they disagree, the evidence wins. Log each disagreement as a `note` event.
4. Move any older log or prose out of `progress.md` as "Migrating an older board" says, copy `room` into the state dir, write `tickets.json` from the evidence and `room render` the board, write `ledger.md`, and arm the wake.
5. Send every running worker the worker contract below with `SendMessage`, with the state dir and the `<state dir>/room` path filled in. This is the last report-routing message they need: from here they log to the file, whoever the orchestrator is.
6. For each stale or orphaned item, propose the exact commands and list what would be lost. Run nothing destructive (reset, checkout over work, worktree remove, branch delete, force push) without Joey's explicit yes.

Then run the loop.

## Workers

Start a worker only after `python3 <state dir>/room start --dir <state dir> <slice>` exits 0. When it refuses, it names the human gates with no line in `signoffs.jsonl` (for a build in a topic room, its own feature's lines; for a light build, its own ticket's); ask Joey for those and start nothing until they pass. A task passes with no gates: see "Tasks". Never start a worker any other way, and never write a sign-off Joey didn't give. On success it prints the session name, worktree, branch, base, `needs` and Joey's tier `override` (null when he has set none); a ticket that needs `gcloud` runs on this Mac.

Then run the `build-route` skill for the slice, asking Joey through `room ask` as it says. On FACTORY, start no session: follow `build-route`'s "Orchestrated runs" (state `FACTORY`, the ticket's `linear` id, and its watch run by you). On LOCAL, go on.

**Small fixes to an open spec PR suit the factory.** Once a feature's spec PR (an OpenSpec change) is open, small review fixes to it, such as wording, a task line over the word limit, a structure-check failure or a minor reviewer comment, are a good job for the factory (`/factory new`, or `/factory handoff` on the spec's branch) rather than a local worker session. Suggest it to Joey through `room ask`; he decides, as with every factory route. A fix that changes a requirement is not small: it goes back through the plan task and Joey's spec sign-off.

Start one session per slice with `start_session` (load it, `set_session_model`, `set_session_effort` and `get_session` with `ToolSearch`): `initiation: "user_asked"`, `context: "fresh"`, `use_worktree: true`, `source_branch` the slice's base (staging, or the branch it stacks on), `name` the `start` value `room start` printed (lowercased, cut to 24 characters), and `model` and `effort` from "Model routing" for its first phase. If the app refuses the start because an event rather than Joey began this turn, propose it instead with `initiation: "own_initiative"` and the same fields, and log a `note` that the slice waits on Joey starting that card. Set the ticket's `session` to that name and `sessionId` to the id the result gives, its `worktree` and `branch` from `get_session`, its `model`, `effort` and `state`, log the `model` event, and render. Only where there is no desktop app (no `start_session` tool) use the `fork-cli-session` skill, with the same model and effort; a session started that way can't be switched from outside, so its tier holds for the whole slice. The brief carries the slug, the absolute path of the state dir, the absolute path of the `room` copy (`<state dir>/room`), the slice and its section of `requirements.md` (its feature's `features/<slug>/requirements.md` in a topic room, or the whole of `light/<id>.md` for a light build: `room start` prints the `contract` path), the worktree, branch and base, the `--build-model` and `--test-model` flags for its tier (see "Model routing"), the ticket's budget, the high-blast globs from the repo's "Blast risk" list (the `repo-instructions` skill), and the worker contract word for word with both paths filled in. The worker runs `start-feature` Phase 3 steps 1 to 6 for its slice only: plan review, build and tests, `/review-feature` to RELEASE, push, draft PR, then CI and bot comments to green.

Worker contract:
- Report only through `python3 <room path> log --dir <state dir> --ticket <slice> --role <build|ci> --type <type> [--sha <head sha>] --note "<one line>"`. Never send the orchestrator a message to report; the orchestrator wakes on the file, so a report reaches whoever is orchestrating now. Never edit `progress.md`, `ledger.md` or `events.jsonl` any other way.
- Log `--type state` at every state change, the note starting with the board state (`LOCAL tests green`, `PUSHED`, `DRAFT PR #15061`, `PR CI green, threads resolved`). Log `--type ci` for a CI result worth knowing (a red, or green after a fix), and `--type blocker` when you stop on something outside your slice.
- Push your own branch and open your PR as a draft without asking. Change your base, edit your PR body and merge your base into your branch yourself, keeping the merge-order block intact. Fetch and merge `@{u}` and your base before every commit and push.
- Never rebase, force-push, merge a PR, merge into staging or main, or touch another slice's worktree. No bare `git stash`; use a WIP commit.
- Log any bug the contract doesn't settle, and any requirement you can't meet, as `--type question` (never ask Joey yourself), then wait. The answer comes as a message from the orchestrator.
- If Joey answers one of your questions directly in your own session, carry on with his answer and close the card with `python3 <room path> withdraw --dir <state dir> --question <id> --role <your role> --reason "Joey answered in this session"`, so it leaves his inbox.
- Log `--type note` with one of these openings when it happens, since each can move you to a higher model: `plan review failed round <n>`, `gate failed round <n>`, `test failed outside the diff: <test>`, `over budget: <row> <actual>/<limit>` (check your diff against the budget in your brief before each push), `unplanned high-blast path: <path>` (a changed path matching the brief's high-blast globs that the plan didn't name).
- Run `start-feature` and `/review-feature` with the `--build-model` and `--test-model` flags in your brief, and with the new ones when a message from the orchestrator gives them.
- When your brief names a design dir (`room start`'s `design`), put its screenshots in your PR body under `## Design`, and give the dir to `/review-feature` so `pre-pr-gate`'s `check-ui` step compares the built pages with them. GitHub takes images only through its web editor: attach them there with Claude in Chrome's `file_upload` when you have it; otherwise list the files and the design's link under `## Design` and log `--type note --note "design images wait on Joey: <dir>"`. Either way, when the room is mirrored to Linear, also attach the screenshots to the build's Linear issue (`prepare_attachment_upload`, then `create_attachment_from_upload`, loaded with `ToolSearch`) and link that issue under `## Design`, so the images are always one click from the PR.
- Once the PR is green with every thread resolved, log it and wait for the complexity review's cuts.

## Hand-started sessions

Joey can start a Claude Code session himself and add it to the run with `/sf:room join`, which appends a `join` event (role `joined`) with `name`, an optional `sessionId`, and `ticket`: a ticket id, or `all` with a `newTitle` for a new ticket, or `all` alone for a watcher. Fold each one in when you read it, then `room render`:

- Ticket id: set the ticket's `session` to `name` and `sessionId` to the event's (leave `sessionId` as it is when the event has none). If the ticket already has a different `session` that is still running (`list_sessions`; a session with no `sessionId` counts as running while its name is in the list), don't replace it silently. Ask Joey with `room ask`, header `Joined`, options "Replace it" (the newcomer takes the ticket), "Keep it, newcomer watches" and "Ignore the join", and act on his answer: replace sets the fields above, keep changes nothing, ignore changes nothing. Tell the replaced worker, if you can reach it, to stop.
- `newTitle`: add a ticket with the next free id, that title, `kind` `slice`, `state` `BUILDING`, no `pr`, `gates` empty (so none passed), `session` and `sessionId` from the event, then log a `note` for it saying it was hand-started. It needs `requirements` and `split` sign-offs like any ticket before `room start` would pass; a hand-started session skips that start, so say in the note that the gates are still open.
- Watching: change nothing. The Build Room lists it under "Unassigned sessions".

The joiner reports with `room log` under the worker contract, so treat its events like any worker's. Send it messages through its `sessionId` when it has one; a joiner with none can only be answered in its own session, so tell Joey that.

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

If the tier differs from the ticket's `model` and `effort`, call `set_session_model` and `set_session_effort` (whichever changed) on the ticket's `sessionId` before you send the worker its next instruction, since a switch applies from the session's next turn. Then write the new `model` and `effort` to `tickets.json`, log `room log --ticket <slice> --role orchestrator --type model --note "<model> <effort>: <reason>"`, and put the matching flags in that next instruction. The app asks Joey before a start or switch that is dearer than the orchestrator's own model or effort, so on a Sonnet orchestrator a worker moving to Opus, or to xhigh, may wait on his approval in the app. When one does, log a `note` and send the worker nothing until the switch lands. A worker it didn't start (adopted, or after a fork) may ask Joey, and a `fork-cli-session` worker can't be switched at all: log the tier it should have as a `note` and leave it.

**Joey's override.** When Joey names a tier for a ticket ("put slice2 on Opus xhigh", "everything on Sonnet"), record it with `room signoff --ticket <slice|all> --tier "<model id> <effort>" --quote "<his words, verbatim>"`, then switch as above. It wins over the table and the step rules until he clears it, which you record with `--tier clear`. A ticket's own line beats an older `all` line, and the latest line wins. A tier above the orchestrator's own asks him in the app first; that is his choice to make.

## Loop

**Arm the wake.** Start a `Monitor` with the command `tail -n 0 -F <state dir>/events.jsonl`, description `<slug> events`, and `timeout_ms` 1800000. Each new event arrives as a notification. When it expires, re-arm it. Keep one armed at a time. Events written while no monitor ran are not lost: every wake reads from the cursor, not from the notification.

On every monitor notification or user message:

1. Run `python3 <state dir>/room podium --dir <state dir>`. It reads Podium's fleet state (the dashboard at `http://127.0.0.1:4317` that the `podium-reporter` mod reports every session to), matches each live session to a ticket by its worktree or branch, and logs a `blocker` event with role `podium` for each worker that waits on a prompt, has gone stale, has a failed agent it hasn't retried, or has used 80% of its context window, once per new condition, with the session's Podium link. It reads Podium's token itself; never read, print or pass it. When Podium isn't running or refuses the token it prints one line and exits 0: carry on without it. Read what it reports from the events, never from transcripts. A worker waiting at a prompt (a permission prompt or a plan approval) is Joey's to answer, in that session or in Podium: put it on the board as the ticket's `note` (`(waits on Joey in its session)`) and never answer it yourself. A stale or failing worker, or one near its context limit, is yours: send it a message, step its tier up (see "Model routing"), or fork it into a fresh session given its brief and the ticket's last state.
2. In a room with adopted runs, run `python3 <state dir>/room refresh --dir <state dir>` (see "Adopt a run by reference"). Then read `ledger.md` and the events after its cursor (`tail -n +<cursor + 1> <state dir>/events.jsonl`). Skip events you logged yourself (role `orchestrator`; `podium` events are not yours). Don't read diffs, transcripts or `log-archive.md` yourself; send a sub-agent and take back five lines.
3. Run `python3 <state dir>/room prs --dir <state dir>`. It reads every PR the tickets name from GitHub with `gh` (read-only) into `prs.json`, works out the merge order of the unmerged ones, and logs a `ci` event (role `github`) only when a PR's state, CI, review or mergeable state changed since the last check, so the board stays quiet; fold those into the ticket's `ci`, `pr` and state like any worker's report. When `gh` is missing, logged out or rate limited it keeps the last good data and writes the reason to `prs.json`'s `error`: carry on. It never polls: this wake, the build-room-view mod (on Claude events in a room's session, at most once a minute) and the Room UI's Refresh button are its only triggers. Then fold any `join` event into `tickets.json` (see "Hand-started sessions"). Update `tickets.json` (states, SHAs, PRs, CI, notes, gates), switch any worker whose tier changed (see "Model routing"), and run `room render`. Open questions come from `events.jsonl`, so answered ones drop off by themselves.
3b. Clear stale cards. An open question is a `question` event with no later `answer` event whose note starts `re <its id>:`. Withdraw each one that no longer needs Joey, with `python3 <state dir>/room withdraw --dir <state dir> --question <id> --reason "<one line>"`: Joey's own answer is in the asking worker's later events or in its session (a state or note event after the question that follows from it, or a worker saying he answered there); its ticket has gone MERGED, DONE or closed; a newer question on the same ticket replaces it; or its worktree or session no longer exists and the work moved on. A `question` event with `reopens: <id>` is Joey taking back his answer to that question: if you have not acted on the answer, drop it and wait for the new answer; if you have, stop the worker that started from it, note that in the ledger, then wait. Never withdraw a card that is still undecided: ask Joey about those. The card leaves the inbox; the withdrawal and its reason stay in the log.
3c. Keep the cards in this session in step with the Room UI, so Joey can answer from either. Run `python3 <state dir>/room inbox --dir <state dir> --since <the ledger's inbox cursor>` (no `--since` the first time) and print everything above its last line in this session exactly as it comes, then write the number on its last line (`cursor <n>`) to the ledger as the inbox cursor. It prints each card opened since the cursor in full, lettered, and one line for each card shown here before that has since closed in the Room UI or by a withdrawal, so the card here and the card in the room never disagree for long. Do not use AskUserQuestion: it would block the loop. When Joey answers a card here ("Q12: A", an option's label, or his own words), record it with `python3 <state dir>/room signoff --dir <state dir> --ticket <the card's ticket> --question <id> --answer "<option label, or Other: text>" --quote "<his words>" --via chat`, which closes the card in the Room UI, then act on the answer. If signoff says the card is already closed, he answered it in the room first: tell him which answer stands and do nothing more. An answer in the Room UI wakes you as an event; the next inbox says the card closed there.
4. Rewrite `ledger.md` with the cursor set to the last id you read, new decisions and open asks, and next steps. Move old decisions to `ledger-archive.md` if it passes 200 lines.
5. Start any slice whose "after" list is met and whose `room start` passes, keeping at most three workers running, routing each through `build-route` first (see "Workers"). Tasks don't count toward the three. A slice that stacks on another can start once that one is PUSHED, since it branches from it. A slice that waits to reuse another's decisions starts once that one has passed its complexity review. A slice that waits on a FACTORY ticket, either way, starts once that ticket is MERGED. FACTORY tickets don't count toward the three.
8. When a FACTORY ticket's watch shell exits, poll it as the factory's `new.md` step 5 says, log what changed with `room log --ticket <slice> --role factory`, update `tickets.json` (`pr`, `prUrl`, `ci`, `MERGED`), and start the next shell.
6. When a base branch moves, tell each worker stacked on it to merge it in.
7. Keep the merge-order block (`<!-- merge-order:begin -->` to `<!-- merge-order:end -->`) the same in every PR body of the run.
9. In a mirrored topic room, bring Linear up to date with what this wake changed (see "Linear mirror").

## Asking Joey

Log each question with `room ask --dir <state dir> --ticket <slice|all> --header "<≤12 chars>" --question "<one line>" --option "<label>" "<one-line description>" ...` (two to four options, the recommended one first, `--multi` to allow several). Don't also ask it with `AskUserQuestion`: the Build Room shows it as a card, and each question should appear in one place. When Joey answers there, the room server records his answer in `signoffs.jsonl` and logs an `answer` event (`re <id>: ...`) that wakes you and closes the question on the board. Read his words from the `signoffs.jsonl` line with that `question` id, never from the event. A `message: true` line is a free message: one starting `/<name>` asks you to run that skill with the rest as its arguments. If Joey answers in this session instead, record it yourself with `room signoff --dir <state dir> --ticket <slice|all> --question <the ask's event id> --answer "<the option he picked>" --quote "<his words, verbatim>"`. A gate sign-off he gives as an answer still needs its `room signoff --gate <gate>` line, quoting the answer, before `room start` passes.

Once requirements are signed off, the hook blocks edits to `requirements.md` (and to `openspec/changes/<name>/` once the spec is) unless a sign-off naming the file is under an hour old. When an answer changes requirements, add `--change requirements.md` (or `--change openspec/changes/<name>`) to its `room signoff`, then edit.

## Joey's two gates

Joey is asked about two things only, besides where each slice is built (`build-route`) and the questions a factory session asks. Everything else (pushes, draft PRs, base changes, body edits, merging bases in) goes ahead without asking. Nobody but Joey merges a PR, except the factory, which merges a FACTORY ticket's PR once its gate passes: Joey chose that for factory slices.

- **Bug questions.** A bug or ambiguity a worker logs as a `question` event that the contract doesn't settle. Batch them and ask as "Asking Joey" says, with `--question <the worker's question event id>`, so `room signoff` logs the `re 41: ...` answer. Record each answer in `requirements.md`, quote Joey's words under Decisions in `ledger.md`, and send it to the worker with `SendMessage`.
- **Complexity review.** When a slice's PR is green, set it to COMPLEXITY REVIEW and run the `steward` skill in review mode on it, as an Opus sub-agent at high effort (xhigh when the ticket's blast is high), with the ticket's budget, complexity and blast. It is read-only: it compares the diff with the budget, rescores blast from the diff's paths, and lists cuts, reuse first, through the `complexity-reduction` skill when that is installed and the reuse check (for each new function or type in the diff, search the repo for one that already does the job) when it isn't. Put the actuals into the ticket's `budget` and its verdict into `gates.steward` (`ok, within budget` or `over budget: <rows>`), and render.
  - **Over budget** goes to Joey as a card first, never as a silent cut and never as a quiet budget raise: `room ask --ticket <slice> --header "Over budget" --question "<slice> is over on <rows>: <actual>/<limit>. Cut back or raise the budget?"`, with options such as "Make the cuts" (the cuts that bring it back, in one line), "Keep it, raise the budget" and "Some of the cuts" (he says which). Note the question id on the ledger's Budget line.
  - **Within budget**, bring Joey the cuts the same way, leading with hand-rolled code that should reuse an existing helper or abstraction.
  - Either answer is his complexity decision: record it with `room signoff --ticket <slice> --gate complexity`, quoting him, and send the cuts he chose to the worker, which builds them and runs `/review-feature` again. A raised budget goes into the ticket's limits and the ledger. A slice is DONE only after this; `room render` refuses DONE without that line.

## Topic rooms

A topic room holds one topic's work: tasks that come before any contract, several features, and light builds. `/sf:room new <topic>` makes it (`commands/room.md`) in `~/FyxerGh/build-room/<topic>/`, with no contract, this session as orchestrator (`orchestratorSessionId`) and Joey's answer to "Mirror this room to Linear?". Every session in it reports through `events.jsonl` under the worker contract, as in any run. Everything above holds, with these additions.

Besides the two gates in "Joey's two gates", a topic room asks Joey to sign each feature's contract and split, to sign each light contract, and to pick a design version. Tasks start without asking him.

### Tasks

A task is a ticket whose `kind` is one of the eight below. `room start` passes it with no sign-off and prints its default skill, code rights, start tier and findings path. Start its session as for a worker, at the printed tier (or Joey's override), with `use_worktree` set to the printed `useWorktree` (a prototype only). You may change a task's tier as you do a build's ("Model routing"); its step-ups are a `question` from it and a second failed attempt at the same step.

| Kind | Default skill | Code | Start tier |
|---|---|---|---|
| explore | none, reads code and docs | read-only | Sonnet 5.5 high |
| investigate | `query-data`, logs (prod read-only) | read-only | Opus 5.5 high |
| plan | search the past, then `gather-requirements`, grilling, split | writes the plan only | Opus 5.5 high |
| design | Claude Design: several versions (default 3) or one if asked; Joey picks on a `room ask` card | read-only | Opus 5.5 high |
| prototype | none | own worktree, never pushes or opens a PR | Sonnet 5.5 high |
| size | `sf:size-change-impact` | read-only | Opus 5.5 high |
| evaluate | asks first what is evaluated and against what; scans installed skills, offers the 1-3 best fits plus "a plain sheet (sf:make-sheet)" | read-only; model calls on prod data only under that provider's prod key | Opus 5.5 high |
| measure | `sf:measure-change-impact run` | read-only | Opus 5.5 high |

The brief carries the slug, the state dir, the `room` copy, the ticket, its kind, skill, code rights and findings path as `room start` printed them, its feature's dir when it has one, and this task contract with the paths filled in:

- Report only through `python3 <room path> log --dir <state dir> --ticket <id> --role task --type <type> --note "<one line>"`: `--type state` with `BUILDING` when you start and `DONE` when you finish, `--type question` or a card (below) when you need Joey, never a message to the orchestrator and never a question to Joey in this session.
- Keep to your code rights. Read-only means no edits to any repo or worktree; a plan task writes only into `<state dir>/features/<slug>/`; a prototype works only in its own worktree, and never pushes or opens a PR.
- A question with a few clear answers goes on a card: `python3 <room path> ask --dir <state dir> --ticket <id> --role task --header "<≤12 chars>" --question "<one line>" --option "<label>" "<description>" ...`, the recommended option first. The answer comes back as a message from the orchestrator.
- End with your findings in `<state dir>/tasks/<id>.md`, under 40 lines: what you found, with links and paths, and what you recommend. Then log `--type note --note "findings tasks/<id>.md"` and `--type state --note "DONE <one line>"`. `room log` refuses DONE until both are there.

A task's question card is already in the inbox when its event arrives: don't ask it again. When Joey answers, send the task his words from `signoffs.jsonl` with `SendMessage`. When a task is DONE, read its findings file (not its transcript) and put what it changes into the ledger. A finished task's session stays open until the room closes ("Close the room").

**Plan tasks search the past first.** Before it asks Joey anything, a plan task searches for decisions already made on its topic: earlier sessions (`search_session_transcripts`, loaded with `ToolSearch`; in a CLI session without it, `grep -l -F '<phrase>' ~/.claude/projects/*/*.jsonl | xargs ls -t` for a few distinctive phrases, then read only the matching lines), memory notes (`~/.claude/projects/*/memory/`), the repo's private docs (`docs-private/`, when the repo has one) and Linear (issues, projects and documents on the topic). It lists what it found, each with its link or path, in its first card or note, then asks only what those leave open. Then it runs `start-feature` Phases 1 and 2 for its feature (`gather-requirements`, `grill-me`, the steward's shaping, `sf:size-change-impact`, `pr-split-audit`, and Phase 2.5's spec question), asking Joey through cards, and writes `requirements.md`, `split.md` and `briefs/` into `features/<slug>/`. Its ticket names that feature.

**A plan task graduates into a feature** when Joey signs its contract and approves its split. Ask him with `room ask --ticket <plan id> --header "Contract"` (one card for the requirements, then one for the split), and record each yes with `room signoff --ticket all --feature <slug> --gate requirements` (then `--gate split`), quoting him. Then add the feature's build tickets: `kind` `slice`, `feature` the slug, NOT STARTED, with `complexity`, `blast` and `budget` from its `split.md`, as "Start a new build" steps 1 and 2 say for a whole run. Each goes through `build-route` when it starts, as any slice does. In a mirrored room, make the feature's milestone now ("Linear mirror").

**A design task** makes its versions with Claude Design (the Artifact tool's design type: `quickstart` with intent `design`): three by default, or one when Joey asked for one. It asks Joey to pick on one card, header `Design`, one option per version (its label and a one-line description with the version's link), plus "None, change them". It saves the chosen version's screenshots, at desktop width and at 375px, to `<state dir>/tasks/<id>/` as `<page>-desktop.png` and `<page>-375.png`, and names the version, its link and the files in its findings. A build that implements it carries `design: <task id>` on its ticket, so `room start` prints the screenshots' dir. Its worker puts them in its PR body under `## Design`, and at verify passes the dir to `pre-pr-gate`, whose `check-ui` step compares the built pages with them.

**An evaluate task** first asks Joey, on a card, what it evaluates and against what (its best reading of each as the options; he can type his own). Then it scans the installed skills (the session's skill list, and `SearchSkills` when present) and offers, on a second card, the one to three that fit best, each with a line on why, plus "A plain sheet (sf:make-sheet)". It runs what he picks, read-only. A model call on prod data goes only to a provider the repo's instructions allow for that data, under that provider's prod key, never a personal or dev key; with no such key it stops and says so.

### Features

A topic room can hold several features. Each full contract lives in `features/<slug>/` (`requirements.md`, `split.md`, `briefs/`, and the steward's and size reports). A build ticket names its feature in `feature`; a task or a light build may name one or none. `room start` checks only the ticket's own feature's sign-offs, and a sign-off for `--ticket all` covers one feature: `room signoff --ticket all --feature <slug> --gate <requirements|split|spec>`. `events.jsonl` and `signoffs.jsonl` stay one file each for the room, and each line names its feature: `room log` adds a ticket's own, `--feature` names it for a line on `all`. `room render` draws one tree per feature, then one for the tickets with none. The hook locks a feature's `requirements.md` once it is signed, as it does a root contract: let it change with `room signoff --change features/<slug>/requirements.md`.

A room with its contract at the root, as every run before topic rooms, works as before: the root contract is its one feature, its tickets name none, and `--ticket all` sign-offs with no feature sign it.

### Light builds

Recommend a light contract when the work is one PR, has at most five requirements, needs no spec, and the steward, run in shape mode on the proposed list, scores it complexity S. Anything bigger goes through a plan task and a full contract.

1. Write the numbered requirements, one line each, to `<state dir>/light/<id>.md`, and add the ticket: `kind` `light`, NOT STARTED, its `feature` if it belongs to one, its steward scores and budget.
2. Ask Joey on one card that links to the session behind it, the session the work came from (Joey's own, or the task that found it): `room ask --ticket <id> --header "Light build" --question "Sign the light contract for <id>: <title>?" --body <state dir>/light/<id>.md --from-name <that session's name> --from-session <its local_… id>`, options "Sign it", "Change it" and "Make it a plan task". Leave the `--from` flags out when the work came from you.
3. On "Sign it", record `room signoff --ticket <id> --gate requirements`, quoting him. `room start` then checks that line and that `light/<id>.md` holds one to five numbered requirements. The hook locks the file from then on; a change goes through `room signoff --change light/<id>.md`.
4. Run `build-route` as for any slice. The factory is the recommended route unless `build-route` finds a reason to build locally. The gate and the PR rules are unchanged: a local light build gets its complexity review before DONE.

### Linear mirror

When Joey said yes at `/sf:room new`, the room has a mirror in Linear: one project, a milestone per feature, an issue per build, and project updates at checkpoints. His yes covers the writes below; nothing goes to Slack. The tools are the Linear connector's (load them with `ToolSearch`): `save_project`, `save_milestone`, `save_issue`, `save_document`, `save_status_update`, `get_status_updates`, `list_issue_statuses`. Keep every id you get back in `tickets.json` (`linear.project`, `linear.milestones`, `linear.updates`, each build's `linearIssue`), so a later wake edits instead of creating. Without the connector the room says "not mirrored" and none of this runs.

- **The project.** At `room new`: `save_project` with `name` `sf room: <topic>`, `addTeams` the room's `linear.team`, and a description of one paragraph on the topic plus a `## Join` section holding this prompt, filled in:

  > Paste into your Claude: "Read the Linear project <project link>, its milestones and the signed requirements in each milestone's description, and follow along: summarise where each feature stands and what is open. To work on a ticket, ask <owner> to add you to the room. For a small change, take the factory route: a Linear issue with the `factory` label."

  Real joining waits for the cloud step. The first time a mirrored room exists, tell Joey once to make an "all sf rooms" view by hand (projects whose name starts with `sf room:`), since the connector can't make views; note in the ledger that you told him.
- **A feature is a milestone.** When a feature's contract is signed and its split approved: `save_milestone` in the project, named the feature's slug, its description the signed numbered requirements and the slice list, plus the plan task's findings when a plan graduated into it. An adopted feature gets one too, from its `summary.md`.
- **Only builds become issues.** For each `slice` or `light` ticket: `save_issue` with the team and project, the feature's milestone (a light build has none and carries its requirements in the description), title `[<kind>] <title>`, and the state below. A ticket that already has an issue (its `linear` factory id, or one Joey named) is linked, not duplicated: update that issue instead. Set the order with `blockedBy` from its `stacksOn` and `after` tickets' issues. Attach the PR as a link (`links`) once it opens. Tasks get no issues.
- **The state follows the ticket.** Map board states to the team's statuses by type (`list_issue_statuses`): NOT STARTED to unstarted, BUILDING through COMPLEXITY REVIEW (and FACTORY) to started, DONE and MERGED to completed. Update the issue when the mapped status changes, not on every event.
- **Size reports.** When a size task's findings informed a build (the build is `after` it, or the findings name it), put the report in a project document (`save_document`, title `Size: <task title>`) and link it from each such build's issue.
- **Checkpoints only.** Post a project update (`save_status_update`, type `project`) when a contract is signed, a PR merges, a ticket has been blocked or waiting on Joey for more than a day, a feature is done, and when the room closes. Keep each short: what happened and where the board stands, `health` atRisk while anything is blocked. Record each update's id under a key (`signed:<feature>`, `merged:<ticket>`, `blocked:<ticket>`, `done:<feature>`, `closed`) and never post the same key twice. A wrong update is edited with its `id`, never posted again.

### Adopt a run by reference

An existing run can join a topic room as one feature, read-only, while its own coordinator keeps running it.

1. `python3 <state dir>/room adopt --dir <state dir> --feature <slug> --source <that run's state dir>`. It records the run in `adopted`, writes `features/<slug>/source.md` (its state dir, orchestrator and session ids, and each ticket's PR link) and copies its tickets onto this board as `<slug>.<id>`, each with `source` set. `room start` refuses those copies, and `room render` needs no sign-off for them.
2. Have a Sonnet 5.5 sub-agent (the `Agent` tool, model `sonnet`) write `features/<slug>/summary.md` from that run's transcripts (`search_session_transcripts` by its session names), its board (`progress.md`, `ledger.md`, `tickets.json`) and its PRs (`gh pr view`), under 80 lines: what's built, each slice's state, decisions and why, and what's open. It reads only and writes that one file.
3. On every wake, `room refresh` re-copies the run's tickets from its `tickets.json` and rewrites `source.md`. It reads that run and never writes to it. When it says the run is finished, have the sub-agent rewrite `summary.md` once more, and note in the ledger that it is final.
4. Never write to that run: no `room log`, `ask` or `signoff` against its dir, no edits to its files, no messages to its coordinator or workers. Anything it needs goes to Joey.

### Close the room

When Joey closes a topic room (`/sf:room close`, or after `stop`), post the `closed` checkpoint if the room is mirrored, then follow "Close a room" in `commands/room.md`: it archives each finished task's and merged build's session, prunes their worktrees only when that is safe, and reports what it kept.

## Forking yourself

When the context hook says the threshold has passed, fork at the next natural point: after a board rewrite, never during a merge, a question to Joey or an adopt step. Rewrite `ledger.md` first, so its cursor and open asks are current. Start it with `start_session` (`context: "fresh"`, `use_worktree: false`, no `model` or `effort`, so it inherits this session's), named `<slug>-orchestrator-<n>`, with the brief `Run /sf:orchestrate <slug>`; the ledger carries everything else. It gets its Opus advisor from the saved `advisorModel`; a pick made over Remote Control holds for that one session only, so it will ask Joey to type `/advisor opus` if it has none. Use `fork-cli-session` only where there is no desktop app. The new orchestrator didn't start the running workers, so its first switch on each of them may ask Joey; fork when few are mid-build. Put the new session's name in the board heading and add it to the ledger's lineage, stop your monitor with `TaskStop`, then stop working on the run. Workers need no telling: they log to the file, and the new session wakes on it.

## Finish

When every slice is DONE, or MERGED for a FACTORY slice, run Phase 5 of the `start-feature` skill (the final report).
