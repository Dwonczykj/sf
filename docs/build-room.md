# How a Build Room works

A Build Room is one run of `sf:orchestrate`: a single orchestrator session that keeps a queue of tickets, starts a worker session per slice, and brings the human only the questions that need them. This page covers how its sessions talk to each other. The commands themselves are in `commands/orchestrate.md` and `commands/room.md`.

## One shared event file, not messages

Every session in a room writes to one append-only file, and the orchestrator watches that file. Nobody reports by messaging the orchestrator.

```
worker sessions ──room log──▶ events.jsonl ──Monitor (tail -F)──▶ orchestrator
                                   ▲                                  │
Room UI answers ──room signoff─────┘                                  │
                                                                      ▼
workers ◀────────────── SendMessage (by sessionId in tickets.json) ───┘
```

- **Workers report with `room log`.** Each builder or planner runs `python3 <state dir>/room log --dir <state dir> --ticket <slice> --role build --type <state|question|blocker|ci|note> --note "<one line>"`. That appends one JSON line to `events.jsonl`. The worker contract tells workers never to message the orchestrator to report, and workers don't need to know its session id.
- **The orchestrator wakes on the file.** It keeps a `Monitor` running `tail -n 0 -F events.jsonl`, and each new line wakes it. It reads every event after the cursor saved in `ledger.md`, updates `tickets.json`, and redraws `progress.md` with `room render`. Events written while it slept or forked are not lost, because every wake reads from the cursor.
- **The orchestrator messages workers by session id.** Only orchestrator-to-worker messages use `SendMessage`, to the `sessionId` stored on each ticket in `tickets.json`.
- **The human answers through the same file.** Answers and messages sent from the Room UI go through `room signoff`, which records them in `signoffs.jsonl` and logs an `answer` event to `events.jsonl`.
- **`progress.md` is output only.** `room render` writes it from `tickets.json` for people to read. Nobody reports through it.

Because reports go to a file rather than to a session, a fork of the orchestrator (at the context threshold, 500k tokens by default, set by `SF_ORCHESTRATOR_FORK_TOKENS`) or a new orchestrator after a restart carries on exactly where the last one stopped.

The desktop app also notifies a parent session when a session it started ends a turn. That channel only covers sessions the orchestrator started itself and dies with the orchestrator, so sf does not rely on it.

## The state dir

Each room lives in `~/FyxerGh/build-room/<slug>/`. Each file has one writer, enforced by the `room-writers.py` hook:

| File | Written by | Holds |
|---|---|---|
| `events.jsonl` | every session, through `room log`, `room ask` or `room join` | one line per event: state changes, questions, answers, blockers, CI, notes, model switches, joins |
| `tickets.json` | the orchestrator only | the queue: each ticket's state, session, `sessionId`, model, PR, gates; plus `orchestratorSessionId` |
| `ledger.md` | the orchestrator only, rewritten whole on every wake | the event cursor, decisions and open asks the board doesn't show |
| `progress.md` | `room render` only | the board for people to read |
| `signoffs.jsonl` | `room signoff` only | the human's answers, gate sign-offs and free messages |
| `prs.json` | `room prs` only | every PR the room's tickets name, read from GitHub: CI, human reviews, unresolved bot and human threads (per bot, with links), Qodo's unresolved Medium and above issues read from its "Code Review by Qodo" comment, mergeable, how far behind, merge times, and the merge order of the unmerged ones |
| `podium-seen.json` | `room podium` only | what Podium last showed for each worker, so a wake logs only what is new |
| `requirements.md`, `split.md`, `briefs/` | the contract, signed off before any build starts | |
| `features/<slug>/` | a topic room's feature: its contract, or an adopted run's `source.md` and `summary.md` | one feature each |
| `tasks/<id>.md`, `tasks/<id>/` | the task that ran | its findings, under 40 lines; a design task's chosen screenshots |
| `light/<id>.md` | the orchestrator, signed by the human | a light build's 1 to 5 numbered requirements |

## The room CLI

`<state dir>/room` (a copy of `scripts/room`) is how every session touches a room's files. Each subcommand:

| Subcommand | Who runs it | What it does |
|---|---|---|
| `log` | every session | appends one validated event to `events.jsonl` |
| `ask` | orchestrator | appends a question shaped like an `AskUserQuestion` card |
| `signoff` | the Room UI server, or the orchestrator with the human's words | appends an answer, gate sign-off or free message to `signoffs.jsonl` |
| `start` | orchestrator | refuses a ticket whose human gates have no sign-off, else prints what to start |
| `tier` | orchestrator | prints the human's standing model and effort override for a ticket, or null |
| `join` | any session started by hand | appends a `join` event so the orchestrator adds that session to the room |
| `render` | orchestrator | writes `progress.md` from `tickets.json` and the open questions |
| `podium` | orchestrator | reads Podium's fleet state and logs a blocker once per new stuck or waiting worker |
| `new` | the session that becomes orchestrator | makes a topic room with no contract |
| `adopt` | orchestrator | adds another run to the room as a feature, by reference |
| `refresh` | orchestrator | copies adopted runs' tickets onto this room's board, never writing to those runs |
| `prs` | orchestrator, the mod, the Room UI's Refresh | reads every PR the tickets name from GitHub into `prs.json` |
| `withdraw` | orchestrator, or the asking session | closes a question card that is stale or was answered outside the room (Joey answered in the asking session), with the reason; every reader treats it as answered |
| `reopen` | the Room UI (Joey's Undo) | undoes an answer: re-asks the question as a new open `question` event with `reopens: <old id>`, once per question |

`scripts/roomui` runs the two local servers behind `/sf:room` (`start`, `stop`, `status`, `rooms`, `close`, `closeout`, `sampler`).

## Stale cards

A question card stays in the inbox until an `answer` event closes it. If Joey answers in the asking session instead of the room, or the work moves on, the card would stay. So the asking worker closes it with `room withdraw` when Joey answers in its session, and the orchestrator checks every open card on each wake (loop step 3b) and withdraws those whose ticket is finished or closed, that a newer question replaced, or that Joey has clearly settled elsewhere. A withdrawal is an `answer` event whose note is `re <id>: withdrawn, <reason>`, so the board, the Room UI and the mod all drop the card, and the reason stays in the log. Cards still undecided are never withdrawn.

The orchestrator also prints each open card in its own session, once, and records an answer typed there with `room signoff`, so a card can be answered from either place; an answer given in the Room UI closes the card there as before. It prints text rather than asking, so the loop keeps running.

Joey can undo an answer from the Room UI. `room reopen` writes the question again as a new open card whose `reopens` field names the old one, so every reader shows it without change. The server cannot press Escape in Claude, so on each wake the orchestrator checks for a `reopens` question whose old answer it has not acted on (drop that answer and wait for the new one), and for one it has already acted on (stop the worker that started from it, say so in the ledger, then wait).

## Bringing sessions into a room

- **Sessions the orchestrator starts.** It starts one session per slice with `start_session` and sends each the worker contract.
- **A session started by hand.** Run `/sf:room join` inside it. It appends a `join` event with that session's id and the ticket chosen (an existing ticket, `new:<title>`, or watching). The orchestrator folds it into `tickets.json` on its next wake, and asks first if the ticket already has a live session.
- **Sessions already running under an older coordinator.** Run `/sf:orchestrate <slug> --adopt` in a fresh session. It moves the state into the build-room dir, builds tickets from the evidence, and sends every running worker the worker contract with `SendMessage`. From then on they log to the file.
- **Slices sent to the cloud factory.** `build-route` can send a slice to the cloud factory instead of a worker. That ticket's state is `FACTORY`. Cloud sessions can't message local ones, so the orchestrator runs the factory's watch itself and logs what it sees with `room log --role factory`.

## What the human sees

- **The Room UI** (`http://127.0.0.1:7790/room`, served by `roomserver/` in this plugin and started by `/sf:room start`) shows the board as a pipeline strip with one stage open (each ticket a card joined to its PR, in merge order), an inbox bar at the foot that opens the questions waiting in this room, and is where answers are sent from.
- **The build-room-view mod** shows a read-only Inbox, Board and merge-train pane inside the orchestrator's session.
- **Podium** (`http://127.0.0.1:4317`) shows every session's live state. The orchestrator reads it with `room podium` to spot stuck workers.

`/sf:room start`, `stop`, `status`, `rooms`, `new`, `close` and `join` manage these (`commands/room.md`).

## Pull requests

`room prs --dir <state dir>` reads each PR a ticket names (`pr`, `prUrl`, or a `branch` with an open PR) from GitHub with `gh`, one PR at a time and read-only, and writes `prs.json`. It orders the unmerged PRs by the tickets' `stacksOn` and `after` and by GitHub's base branches, marks the first with nothing blocking it as `next`, and includes adopted tickets' PRs flagged `readOnly`. A PR is not `ready` while Qodo has an unresolved Medium or High issue. The Room UI's PRs tab shows these: open and draft PRs in merge order with their dependencies and bot status, tickets with no PR yet, and merged PRs (a toggle) newest first. It logs a `ci` event only when a PR's state, CI, review or mergeable state changes. When `gh` is missing, logged out or rate limited, it keeps the last good data and writes the reason to `error`. The repo comes from the ticket's PR URL or its worktree's git remote.

Nothing polls GitHub. Three things run it:

- **The orchestrator**, on every wake, before it renders the board.
- **The build-room-view mod**, on Claude events in a session that belongs to a room, at most once a minute and never two at once.
- **The Room UI's Refresh button**, for when the mod can't reach `gh`. The room server runs `room prs` for that room with a fixed argv and the page picks up the new `prs.json` by its file watch.

The Room UI shows each unmerged PR on its ticket's card, in merge order, with merged ones behind a "Merged" history; the mod's pane shows a compact text merge train.

## Topic rooms

A room can also hold a topic rather than one feature. `/sf:room new <topic>` makes `~/FyxerGh/build-room/<topic>/` with no contract and records the session that ran it as orchestrator. Sessions report through `events.jsonl` exactly as above. The full rules are in "Topic rooms" in `commands/orchestrate.md`.

- **Tasks start freely.** Eight task kinds (explore, investigate, plan, design, prototype, size, evaluate, measure) each have a default skill, code rights and a starting model. `room start` passes them with no sign-off. Each ends with a findings file, `tasks/<id>.md`, and a note pointing to it, so what an explore found reaches the later spec.
- **Several features.** Each full contract lives in `features/<slug>/`. A ticket's `feature` field says which; `room start` checks only that feature's sign-offs, and every event and sign-off line names its feature. The board draws one tree per feature. A plan task becomes a feature when the human signs its contract and split. A room with its contract at the root, as every run before topic rooms, is a room with one feature.
- **Light builds.** One PR, at most five requirements, no spec, steward complexity S: the orchestrator proposes the requirements on one inbox card, linked to the session behind it, and the human signs there. The factory is the recommended route.
- **Linear mirror.** Asked once at `new`. The room is a project, each feature a milestone, each build an issue, and project updates go out only at checkpoints. It never posts to Slack. Without the Linear connector the room is not mirrored.
- **Adopt by reference.** `room adopt` brings an existing run in as one feature, read-only: `source.md` names it, a Sonnet sub-agent writes `summary.md`, and `room refresh` copies its tickets onto the board on each wake without writing to that run.
- **Clean-up.** A finished task's or build's session (DONE or MERGED) stays open until the room closes, then is archived. Its worktree is pruned only if its branch is merged into the remote base, no open ticket in any room names that branch, and it has nothing uncommitted (`roomui closeout` works this out).

A single-feature run still needs its signed contract before a build starts, as before.
