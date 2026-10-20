---
description: "Set up sf on this machine: ask which reviewers, data, sheet and UI tools you use, check each is installed and logged in, write ~/.claude/sf-tools.json, then OpenSpec and Qodo (both optional), how start-feature works, and last the plugin settings."
---
Set sf up for the tools this machine actually has. sf reaches each kind of tool through one skill (a port) that falls back when the tool is missing, so a run never fails partway for want of a login. Don't just dump a checklist: ask, run the checks, report pass or fail per item, and only hand me the command for what's actually missing.

## 1. Ask which tools I use

One `AskUserQuestion` call with these four questions. It can't pre-tick boxes, so every option is labelled recommended:

1. **"Which reviewers would you like to use to review your code? Tick every one you have installed or plan to install."** Multi-select, header `Reviewers`: Claude Code (Recommended), Codex (Recommended), Cursor (Recommended), Gemini (Recommended). Other is for any CLI that reads a prompt on stdin and prints its review: ask me for its name and the exact command.
2. **"Which CLI do you use to query your data?"** Header `Data`: gcloud (Logging and BigQuery) (Recommended), None (impact figures are recorded as not measured).
3. **"Which CLI should sf use to make sheets for evals?"** Header `Sheets`: gws (Recommended), None (a CSV and an artifact table instead).
4. **"How should sf check UI changes?"** Header `UI check`: Claude in Chrome (Recommended), Built-in browser pane, Playwright, None (the gate notes that UI was not checked).

## 2. Check each choice

Run every check, then report a pass or fail line per choice:

| Choice | Check | Fix to show on a fail |
|---|---|---|
| Claude Code | always passes | |
| Codex, Cursor, Gemini | `python3 ${CLAUDE_PLUGIN_ROOT}/skills/review-seat/scripts/seats.py probe codex` (or `cursor`, `gemini`) prints `"ok": true` | the probe's `fix` field |
| Other reviewer | `command -v <first word of its command>` | install it, or check the command I gave |
| gcloud | `command -v gcloud bq`, and `gcloud auth list --filter=status:ACTIVE --format='value(account)'` prints an account | install the SDK (https://cloud.google.com/sdk/docs/install), then `gcloud auth login` and `gcloud auth application-default login` |
| gws | `command -v gws`, and `gws auth status` prints `"has_refresh_token": true` | `npm install -g @googleworkspace/cli`, then `gws auth login` |
| Claude in Chrome | load `mcp__claude-in-chrome__list_connected_browsers` with `ToolSearch` and call it; it lists a browser | install the Claude in Chrome extension and connect it to this app |
| Built-in browser pane | `mcp__Claude_Browser__tabs_context` is among your tools | only the Claude desktop app has it; pick another |
| Playwright | `ToolSearch` with `+playwright` finds a `mcp__playwright__browser_navigate` tool | `claude mcp add playwright -- npx @playwright/mcp@latest`, then restart |

Logins (`codex login`, `agent login`, `gcloud auth login`, `gws auth login`) are browser OAuth, so I run them myself. For each failing choice, ask with `AskUserQuestion`: **"Installed it, check again"** or **"Drop it"**. Re-run that check on the first, and remove the choice on the second. Loop until every choice passes or is dropped.

## 3. Write `~/.claude/sf-tools.json`

```json
{"reviewers": ["claude", "codex", "cursor", "gemini"], "otherReviewers": [{"name": "<name>", "command": "<command>"}],
 "data": "gcloud", "sheets": "gws", "ui": "claude-in-chrome"}
```

`reviewers` holds the passing choices (`claude`, `codex`, `cursor`, `gemini`); `otherReviewers` is `[]` without an Other. `data`, `sheets` and `ui` are `null` for None or a dropped choice; `ui` is one of `claude-in-chrome`, `browser-pane`, `playwright`. Keep `slackUserId` from the old file if it has one (step 4 asks for it). Write the whole file, then read it back.

Then print what each port will use and what it falls back to:

- **review-seat**: run `seats.py` and list the three seats with their vendor and model. Any `fallback` or `singleVendor: true` gets a line saying the panel is weaker for it.
- **query-data**: gcloud, else "not measured" with the reason.
- **make-sheet**: gws, else a CSV beside the report plus an artifact table.
- **check-ui**: the chosen tool, then whichever of Claude in Chrome, the built-in browser pane and Playwright is available at run time, else the gate notes that UI was not checked.

A run started in the cloud has none of these logins; every port then falls back, which is expected.

## 4. The rest of setup

1. **OpenSpec CLI** — run `openspec --version`. If missing: give me `npm install -g openspec`. No login needed. This is what the optional Phase 2.5 spec step (`start-feature` / `plan` / `adopt` / `investigate`) depends on for `openspec propose` / `archive` / `sync`. Per-repo setup (`openspec init` + `openspec update`, which generates the `openspec-propose` / `openspec-archive-change` / … skills into that repo) happens lazily the first time a run in that repo needs a spec — not here.

2. **Qodo CLI (optional)**: run `qodo --version`. If missing, give me the official installer, `curl -fsSL https://get.qodo.ai | sh` (docs: https://docs.qodo.ai/agentic-toolbox/cli), then tell me to run `qodo login` myself (browser auth). Confirm with `qodo read whoami --json` (exit 0, shows an email). This powers `pre-pr-gate` Pass E, a local run of the Qodo PR reviewer before the PR opens. Without it the gate skips Pass E and everything else runs as normal, so a missing Qodo is a note, not a failure. One thing the CLI can't check up front: the repo must be connected to my Qodo workspace (Qodo's Git integration settings). If it isn't, the first review fails with `repo_not_connected`, and the gate reports that and carries on.

3. **Slack user id (optional)**: one `AskUserQuestion`, header `Slack`: **"Which Slack user should `sf:measure-change-impact` DM its follow-up results to? Type your Slack member id (Profile → ⋮ → Copy member ID) under Other. Now: `<current or blank>`."** Options: **Keep `<current>`** and **Clear it (desktop notification only)** when it is set, else **Skip (desktop notification only)** and **Type my member id under Other**. Write it to `~/.claude/sf-tools.json` as `slackUserId`, changing only that key, or remove the key on skip or clear. Without it, the follow-up task notifies with `osascript` only.

Then print these, in this order, before step 5:

**a. One-line status summary** — which items were already fine, which I fixed, which still need me (auth logins can't be scripted). Say whether the review panel is cross-vendor or single-vendor; note separately whether the OpenSpec CLI is ready for the optional spec step, and whether Qodo is ready for the optional Pass E.

**b. How `start-feature` works** (print this, keyword/arrow form):
> frame → `<slug>` + `progress.md` (state) → **scope** (gather-requirements + grill-me) → `requirements.md` 🔒 → **split** (pr-split-audit) → `split.md` 🔒 → optional **spec** (Opus-4.8-High grill → `openspec-propose`: proposal → design → delta specs → tasks) 🔒 → per slice: worktree → **plan-review** 3 seats 🔒 → build agent ∥ 3 test agents (tests-first) → **verify** 3 passes × 3 seats, loop → RELEASE → open PR → CI + bot-comments loop → green → merge → `openspec archive` → **report**. State = markdown in `.scratch/<slug>/`; gates = real tool calls (review panel / lint / jest) + human 🔒; orchestration = prompt, not script (deterministic machine = `sf:build-verify`).

**c. Adopting an in-flight session** (one line): `/sf:adopt` seeds the factory from the session you're already in (plus any existing `openspec/changes/<slug>/`), cuts the branch, and enters the `start-feature` pipeline at the first unmet gate — grilling only to close gaps in the seeded contract, not re-scoping from zero; use it instead of `start-feature` when this chat already did the scoping, and `sf:continue` to resume a run whose state is already on disk.

**d. Model provider** (one line): `/sf:model-provider anthropic|codex|cursor` routes the build + test sub-agents to one vendor — flip it to spare Anthropic usage limits; the review panel stays as set here. Re-run `/sf:install` any time to change the tools.

## 5. Plugin settings (always the last step)

Do this on every run, even when nothing else changed, and say nothing after it except the restart line.

sf's four options are its `userConfig` (in `.claude-plugin/plugin.json`). Claude Code keeps their values in `~/.claude/settings.json` under `pluginConfigs["<id>"].options`, where `<id>` is sf's key in that file's `enabledPlugins` (usually `sf@sf`). Read the current values:

```bash
python3 -c 'import json,os;s=json.load(open(os.path.expanduser("~/.claude/settings.json")));i=next(k for k in s.get("enabledPlugins",{}) if k.startswith("sf@"));print(i,json.dumps(s.get("pluginConfigs",{}).get(i,{}).get("options",{})))'
```

Then one `AskUserQuestion` call with four questions. Each shows the current value and lets me keep it; I type a new one under Other. Blank is allowed for all four:

1. **"Branch prefix for the branches sf creates (`<prefix>/feat-PRE-123-title`)? Now: `<current or blank>`."** Header `Branch`. Options: **Keep `<current>`** (or **Keep blank (uses `<whoami output>`)**), and **Clear it (uses `<whoami output>`)** when it is set, else **Use `<whoami output>`**.
2. **"GitHub login sf assigns the PRs it opens to? Now: `<current or blank>`."** Header `Assignee`. Options: **Keep `<current>`** (or **Keep blank (assigns to me)**), and **Clear it (assigns to me)** when it is set, else **Use `<gh api user -q .login>`**.
3. **"Linear project sf searches when linking a PR to an issue, and checks when it updates the issue after merge? Now: `<current or blank>`."** Header `Linear`. Options: **Keep `<current>`** (or **Keep blank (searches all my assigned issues)**), and **Clear it (searches all my assigned issues)** when it is set, else **Type a project name under Other**.
4. **"Linear team a topic room's mirror project goes in (`/sf:room new`)? Now: `<current or blank>`."** Header `Room team`. Options: **Keep `<current>`** (or **Keep blank (asks when a room is mirrored)**), and **Clear it (asks when a room is mirrored)** when it is set, else **Type a team name under Other**.

Write the answers back, changing only that one entry so the rest of `settings.json` stays as it is (`""` for blank), then read them back with the command above:

```bash
python3 - <id> '<branchPrefix>' '<prAssignee>' '<linearProject>' '<linearTeam>' <<'PY'
import json, os, sys
p = os.path.expanduser("~/.claude/settings.json")
s = json.load(open(p))
o = s.setdefault("pluginConfigs", {}).setdefault(sys.argv[1], {}).setdefault("options", {})
o.update(zip(["branchPrefix", "prAssignee", "linearProject", "linearTeam"], sys.argv[2:6]))
json.dump(s, open(p, "w"), indent=2)
open(p, "a").write("\n")
PY
```

End with this line, and nothing after it: **Restart Claude Code to apply the new sf settings.** (`/plugin configure sf` changes them later too.)
