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
| `podium-seen.json` | `room podium` only | what Podium last showed for each worker, so a wake logs only what is new |
| `requirements.md`, `split.md`, `briefs/` | the contract, signed off before any build starts | |
| `features/<slug>/` | a topic room's feature: its contract, or an adopted run's `source.md` and `summary.md` | one feature each |
| `tasks/<id>.md`, `tasks/<id>/` | the task that ran | its findings, under 40 lines; a design task's chosen screenshots |
| `light/<id>.md` | the orchestrator, signed by the human | a light build's 1 to 5 numbered requirements |

## Bringing sessions into a room

- **Sessions the orchestrator starts.** It starts one session per slice with `start_session` and sends each the worker contract.
- **A session started by hand.** Run `/sf:room join` inside it. It appends a `join` event with that session's id and the ticket chosen (an existing ticket, `new:<title>`, or watching). The orchestrator folds it into `tickets.json` on its next wake, and asks first if the ticket already has a live session.
- **Sessions already running under an older coordinator.** Run `/sf:orchestrate <slug> --adopt` in a fresh session. It moves the state into the build-room dir, builds tickets from the evidence, and sends every running worker the worker contract with `SendMessage`. From then on they log to the file.
- **Slices sent to the cloud factory.** `build-route` can send a slice to the cloud factory instead of a worker. That ticket's state is `FACTORY`. Cloud sessions can't message local ones, so the orchestrator runs the factory's watch itself and logs what it sees with `room log --role factory`.

## What the human sees

- **The Room UI** (agent-team, `http://127.0.0.1:7777/room`) shows the inbox and the board, and is where answers are sent from.
- **The build-room-view mod** shows a read-only Inbox and Board pane inside the orchestrator's session.
- **Podium** (`http://127.0.0.1:4317`) shows every session's live state. The orchestrator reads it with `room podium` to spot stuck workers.

`/sf:room start`, `stop`, `status`, `rooms`, `new`, `close` and `join` manage these (`commands/room.md`).

## Topic rooms

A room can also hold a topic rather than one feature. `/sf:room new <topic>` makes `~/FyxerGh/build-room/<topic>/` with no contract and records the session that ran it as orchestrator. Sessions report through `events.jsonl` exactly as above. The full rules are in "Topic rooms" in `commands/orchestrate.md`.

- **Tasks start freely.** Eight task kinds (explore, investigate, plan, design, prototype, size, evaluate, measure) each have a default skill, code rights and a starting model. `room start` passes them with no sign-off. Each ends with a findings file, `tasks/<id>.md`, and a note pointing to it, so what an explore found reaches the later spec.
- **Several features.** Each full contract lives in `features/<slug>/`. A ticket's `feature` field says which; `room start` checks only that feature's sign-offs, and every event and sign-off line names its feature. The board draws one tree per feature. A plan task becomes a feature when the human signs its contract and split. A room with its contract at the root, as every run before topic rooms, is a room with one feature.
- **Light builds.** One PR, at most five requirements, no spec, steward complexity S: the orchestrator proposes the requirements on one inbox card, linked to the session behind it, and the human signs there. The factory is the recommended route.
- **Linear mirror.** Asked once at `new`. The room is a project, each feature a milestone, each build an issue, and project updates go out only at checkpoints. It never posts to Slack. Without the Linear connector the room is not mirrored.
- **Adopt by reference.** `room adopt` brings an existing run in as one feature, read-only: `source.md` names it, a Sonnet sub-agent writes `summary.md`, and `room refresh` copies its tickets onto the board on each wake without writing to that run.
- **Clean-up.** A finished task's or build's session (DONE or MERGED) stays open until the room closes, then is archived. Its worktree is pruned only if its branch is merged into the remote base, no open ticket in any room names that branch, and it has nothing uncommitted (`roomui closeout` works this out).

A single-feature run still needs its signed contract before a build starts, as before.
