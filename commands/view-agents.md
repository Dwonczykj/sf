---
description: "Open the agent-team dashboard in the browser, starting its dev server on port 7777 first if it isn't already running."
---
Open the agent-team dashboard.

1. Check whether the server is already up:
   `curl -sf -o /dev/null http://127.0.0.1:7777/ && echo RUNNING || echo DOWN`

2. If DOWN, start it in the background: `cd ~/FyxerGh/agent-team && npm start` (run_in_background: true), then poll the curl check every few seconds until it returns RUNNING. Don't restart if step 1 already reports RUNNING.

3. Once RUNNING, open http://127.0.0.1:7777/ in the browser via preview_start (url).
