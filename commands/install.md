---
description: "Set up sf on this machine: ask which reviewers, data, sheet and UI tools you use, check each is installed and logged in, write ~/.claude/sf-tools.json, then OpenSpec and Qodo (both optional), how start-feature works, and the plugin settings."
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

`reviewers` holds the passing choices (`claude`, `codex`, `cursor`, `gemini`); `otherReviewers` is `[]` without an Other. `data`, `sheets` and `ui` are `null` for None or a dropped choice; `ui` is one of `claude-in-chrome`, `browser-pane`, `playwright`. Write the whole file, then read it back.

Then print what each port will use and what it falls back to:

- **review-seat**: run `seats.py` and list the three seats with their vendor and model. Any `fallback` or `singleVendor: true` gets a line saying the panel is weaker for it.
- **query-data**: gcloud, else "not measured" with the reason.
- **make-sheet**: gws, else a CSV beside the report plus an artifact table.
- **check-ui**: the chosen tool, then whichever of Claude in Chrome, the built-in browser pane and Playwright is available at run time, else the gate notes that UI was not checked.

A run started in the cloud has none of these logins; every port then falls back, which is expected.

## 4. The rest of setup

1. **OpenSpec CLI** — run `openspec --version`. If missing: give me `npm install -g openspec`. No login needed. This is what the optional Phase 2.5 spec step (`start-feature` / `plan` / `adopt` / `investigate`) depends on for `openspec propose` / `archive` / `sync`. Per-repo setup (`openspec init` + `openspec update`, which generates the `openspec-propose` / `openspec-archive-change` / … skills into that repo) happens lazily the first time a run in that repo needs a spec — not here.

2. **Qodo CLI (optional)**: run `qodo --version`. If missing, give me the official installer, `curl -fsSL https://get.qodo.ai | sh` (docs: https://docs.qodo.ai/agentic-toolbox/cli), then tell me to run `qodo login` myself (browser auth). Confirm with `qodo read whoami --json` (exit 0, shows an email). This powers `pre-pr-gate` Pass E, a local run of the Qodo PR reviewer before the PR opens. Without it the gate skips Pass E and everything else runs as normal, so a missing Qodo is a note, not a failure. One thing the CLI can't check up front: the repo must be connected to my Qodo workspace (Qodo's Git integration settings). If it isn't, the first review fails with `repo_not_connected`, and the gate reports that and carries on.

Then finish, in this order:

**a. One-line status summary** — which items were already fine, which I fixed, which still need me (auth logins can't be scripted). Say whether the review panel is cross-vendor or single-vendor; note separately whether the OpenSpec CLI is ready for the optional spec step, and whether Qodo is ready for the optional Pass E.

**b. How `start-feature` works** (print this, keyword/arrow form):
> frame → `<slug>` + `progress.md` (state) → **scope** (gather-requirements + grill-me) → `requirements.md` 🔒 → **split** (pr-split-audit) → `split.md` 🔒 → optional **spec** (Opus-4.8-High grill → `openspec-propose`: proposal → design → delta specs → tasks) 🔒 → per slice: worktree → **plan-review** 3 seats 🔒 → build agent ∥ 3 test agents (tests-first) → **verify** 3 passes × 3 seats, loop → RELEASE → open PR → CI + bot-comments loop → green → merge → `openspec archive` → **report**. State = markdown in `.scratch/<slug>/`; gates = real tool calls (review panel / lint / jest) + human 🔒; orchestration = prompt, not script (deterministic machine = `sf:build-verify`).

**c. Adopting an in-flight session** (one line): `/sf:adopt` seeds the factory from the session you're already in (plus any existing `openspec/changes/<slug>/`), cuts the branch, and enters the `start-feature` pipeline at the first unmet gate — grilling only to close gaps in the seeded contract, not re-scoping from zero; use it instead of `start-feature` when this chat already did the scoping, and `sf:continue` to resume a run whose state is already on disk.

**d. Model provider** (one line): `/sf:model-provider anthropic|codex|cursor` routes the build + test sub-agents to one vendor — flip it to spare Anthropic usage limits; the review panel stays as set here. Re-run `/sf:install` any time to change the tools.

**e. Plugin settings** — then ask me to run `/plugin configure sf` and set three options; it's an interactive prompt, so I run it myself, and can re-run it anytime to change them. All three can stay blank:
- `branchPrefix`: prefix for branches sf creates (blank falls back to my shell username via `whoami`).
- `prAssignee`: GitHub login sf assigns the PRs it opens to (blank assigns to me, `@me`).
- `linearProject`: name of the Linear project sf searches when linking a PR to an issue, and checks when it updates the issue after merge (blank searches all my assigned issues and skips the project check).
