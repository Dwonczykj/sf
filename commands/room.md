---
description: "Start, stop or check the two local UIs behind sf:orchestrate: the agent-team Build Room (:7777) and Podium (:4317), with a minute-by-minute memory log. Stop then offers to close each room."
---
Run `python3 ${CLAUDE_PLUGIN_ROOT}/scripts/roomui $ARGUMENTS` (arguments: `start`, `stop`, `status`, `rooms` or `close <room>`; `status` when none) and show its output as it is. Do not open a browser, and do not run anything else against the servers.

- `start` starts whichever of agent-team and Podium is down (detached, so they outlive this session) and a sampler that logs each server's pid, RSS and CPU once a minute to `~/FyxerGh/build-room/roomui-samples.log`. A server that is up is left alone.
- `stop` stops both servers and the sampler. It checks each process's command line first and leaves anything else on the ports untouched.
  After the servers are stopped it lists the rooms (runs under `~/FyxerGh/build-room/`) with their open questions and time since the last event. If it lists any, ask Joey which to close: one `AskUserQuestion` with a multi-select, one option per room using the line it printed, and "None" first and recommended, so the default is no. For each room he picks, run `python3 ${CLAUDE_PLUGIN_ROOT}/scripts/roomui close <room> --force`; the printed line already told him about any open questions, so his pick is the confirmation. Never close a room he did not pick.
- `rooms` lists the rooms without stopping anything.
- `close <room>...` archives each room into `~/FyxerGh/build-room/.closed/<room>-<time>/` instead of deleting it, and prints the `rm -r` for deleting it for good. It refuses a room with open questions or an event in the last 10 minutes unless `--force` is given, and it refuses any name that is not a room.
- `status` shows each server's state, pid, RSS, CPU, uptime and URL, and its peak and average RSS over the last 24 hours.

Repo locations come from `ROOMUI_AGENT_TEAM_DIR` and `ROOMUI_PODIUM_DIR` (defaults `~/FyxerGh/agent-team` and `~/FyxerGh/podium`); the script says so if one is missing. Never read or print Podium's token or `~/.podium/config.env`.
