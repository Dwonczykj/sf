---
description: "Start, stop or check the two local UIs behind sf:orchestrate: the agent-team Build Room (:7777) and Podium (:4317), with a minute-by-minute memory log."
---
Run `python3 ${CLAUDE_PLUGIN_ROOT}/scripts/roomui $ARGUMENTS` (arguments: `start`, `stop` or `status`; `status` when none) and show its output as it is. Do not open a browser, and do not run anything else against the servers.

- `start` starts whichever of agent-team and Podium is down (detached, so they outlive this session) and a sampler that logs each server's pid, RSS and CPU once a minute to `~/FyxerGh/build-room/roomui-samples.log`. A server that is up is left alone.
- `stop` stops both servers and the sampler. It checks each process's command line first and leaves anything else on the ports untouched.
- `status` shows each server's state, pid, RSS, CPU, uptime and URL, and its peak and average RSS over the last 24 hours.

Repo locations come from `ROOMUI_AGENT_TEAM_DIR` and `ROOMUI_PODIUM_DIR` (defaults `~/FyxerGh/agent-team` and `~/FyxerGh/podium`); the script says so if one is missing. Never read or print Podium's token or `~/.podium/config.env`.
