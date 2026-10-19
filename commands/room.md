---
description: "Start, stop or check the two local UIs behind sf:orchestrate: the agent-team Build Room (:7777) and Podium (:4317), with a minute-by-minute memory log. Stop then offers to close each room. `join` adds a session Joey started by hand to a run."
---
If the first argument is `join`, follow "Join a run" below instead of running roomui.

Otherwise run `python3 ${CLAUDE_PLUGIN_ROOT}/scripts/roomui $ARGUMENTS` (arguments: `start`, `stop`, `status`, `rooms` or `close <room>`; `status` when none) and show its output as it is. Do not open a browser, and do not run anything else against the servers.

- `start` starts whichever of agent-team and Podium is down (detached, so they outlive this session) and a sampler that logs each server's pid, RSS and CPU once a minute to `~/FyxerGh/build-room/roomui-samples.log`. A server that is up is left alone.
- `stop` stops both servers and the sampler. It checks each process's command line first and leaves anything else on the ports untouched.
  After the servers are stopped it lists the rooms (runs under `~/FyxerGh/build-room/`) with their open questions and time since the last event. If it lists any, ask Joey which to close: one `AskUserQuestion` with a multi-select, one option per room using the line it printed, and "None" first and recommended, so the default is no. For each room he picks, run `python3 ${CLAUDE_PLUGIN_ROOT}/scripts/roomui close <room> --force`; the printed line already told him about any open questions, so his pick is the confirmation. Never close a room he did not pick.
- `rooms` lists the rooms without stopping anything.
- `close <room>...` archives each room into `~/FyxerGh/build-room/.closed/<room>-<time>/` instead of deleting it, and prints the `rm -r` for deleting it for good. It refuses a room with open questions or an event in the last 10 minutes unless `--force` is given, and it refuses any name that is not a room.
- `status` shows each server's state, pid, RSS, CPU, uptime and URL, and its peak and average RSS over the last 24 hours.

Repo locations come from `ROOMUI_AGENT_TEAM_DIR` and `ROOMUI_PODIUM_DIR` (defaults `~/FyxerGh/agent-team` and `~/FyxerGh/podium`); the script says so if one is missing. Never read or print Podium's token or `~/.podium/config.env`.

## Join a run (`join`)

For a Claude Code desktop session Joey started himself that should report to a run's Build Room. It writes one `join` event and nothing else; the orchestrator folds it into `tickets.json`.

1. Load `mcp__ccd_session_mgmt__get_session` with `ToolSearch` and call it with `session_id: "self"`. Take this session's `name` (its title) and its `local_…` id. If the tool does not exist (a CLI session), join by name only: ask Joey for a short name (letters, digits, `.`, `_`, `-`) and say the room will show this session without an "Open session" link.
2. Run `python3 ${CLAUDE_PLUGIN_ROOT}/scripts/roomui rooms`. One room: use it. Several: ask Joey which with one `AskUserQuestion`. None: say so and stop. The state dir is `~/FyxerGh/build-room/<room>/`.
3. Read `<state dir>/tickets.json` and ask which ticket with one `AskUserQuestion`: one option per ticket (`<id>: <title> (<state>)`), plus "A new ticket" and "Just watching". For "A new ticket", ask Joey for its title in plain text. The session name must be letters, digits, `.`, `_` or `-`: turn spaces into `-` and tell him the result.
4. Run `python3 ${CLAUDE_PLUGIN_ROOT}/scripts/room join --dir <state dir> --ticket <ticket id | "new:<title>" | watching> --name <name> [--session-id <local_… id>]` (the plugin's copy, because a run's own `room` copy may predate `join`). If it refuses, show Joey the reason and fix the input; do not write any file by hand.
5. Tell this session, in a short block, how to report from now on. Use the worker contract in `commands/orchestrate.md` ("Workers"), with `<room path>` as `<state dir>/room`: report with `python3 <state dir>/room log --dir <state dir> --ticket <ticket id> --role <build|ci> --type <type> --note "<one line>"` at every state change (the note starts with the board state), log bugs and anything the contract doesn't settle as `--type question`, never ask Joey in this session, and never edit `progress.md`, `ledger.md`, `tickets.json` or `events.jsonl` directly. Joey answers in the Build Room inbox, and the answer arrives as a message. For a "new" ticket the id is the one the orchestrator assigns: until then, log against `all`. A watching session logs nothing unless Joey asks.
