---
description: "Check and set up sf's external dependencies: Cursor CLI, Codex CLI (+ optional codex MCP), explain start-feature, then configure the branch prefix."
---
Verify the things the factory's cross-vendor review (Codex + Gemini-via-Cursor + Cursor) depends on, and walk me through fixing whatever's missing. Don't just dump a checklist — run the checks, report pass/fail per item, and only hand me the command for what's actually missing.

1. **Cursor CLI** — run `agent --version` (or `cursor-agent --version`). If missing: give me the installer, `curl https://cursor.com/install -fsS | bash`, then tell me to run `agent login` myself (browser OAuth, can't be done on my behalf). Confirm auth with `agent status` (should show an email, not "Not logged in").

2. **Codex CLI** — run `codex --version`. If missing: give me `npm install -g @openai/codex` (or the user's package manager of choice). Then tell me to run `codex login` myself (also browser OAuth). Confirm with `codex login status`. This is the only codex dependency the `codex-agent` skill needs — it calls the CLI directly (`codex exec`), no MCP.

3. **Codex MCP registration (optional)** — run `claude mcp list` and check for a connected `codex` entry. This makes `mcp__codex__codex` callable, which the `pre-pr-gate` / `solve-in-worktrees` review passes still use for its per-pass `threadId` + `codex-reply` across rounds. The `codex-agent` skill does **not** need it. If it's missing and you want the MCP-based review path, register it at user scope:
   ```
   claude mcp add codex -s user -- codex mcp-server
   ```
   Then re-run `claude mcp list` to confirm it shows connected. If you'd rather not register an MCP, the CLI (`codex-agent`) covers codex on its own.

Then finish, in this order:

**a. One-line status summary** — which items were already fine, which I fixed, which still need me (auth logins can't be scripted). If Cursor + Codex CLI both pass, say the factory's cross-vendor review is ready.

**b. How `start-feature` works** (print this, keyword/arrow form):
> frame → `<slug>` + `progress.md` (state) → **scope** (gather-requirements + grill-me) → `requirements.md` 🔒 → **split** (pr-split-audit) → `split.md` 🔒 → optional **spec** (Opus-4.8-High grill → design.md → plan.md) 🔒 → per slice: worktree → **plan-review** 3 models 🔒 → build agent ∥ 3 test agents (tests-first) → **verify** 3 passes × 3 models, loop → RELEASE → open PR → CI + bot-comments loop → green → **report**. State = markdown in `.scratch/<slug>/`; gates = real tool calls (Codex / lint / jest) + human 🔒; orchestration = prompt, not script (deterministic machine = `sf:build-verify`).

**c. Adopting an in-flight session** (one line): `/sf:adopt` seeds the factory from the session you're already in (plus any existing `specs/<n>-<slug>/`), cuts the branch, and enters the `start-feature` pipeline at the first unmet gate — grilling only to close gaps in the seeded contract, not re-scoping from zero; use it instead of `start-feature` when this chat already did the scoping, and `sf:continue` to resume a run whose state is already on disk.

**d. Model provider** (one line): `/sf:model-provider anthropic|codex|cursor` routes the build + test sub-agents to one vendor — flip it to spare Anthropic usage limits; the cross-vendor review panel stays as is.

**e. Branch prefix** — then ask me to run `/plugin configure sf` to set `branchPrefix` (blank falls back to my shell username via `whoami`); it's an interactive prompt, so I run it myself, and can re-run it anytime to change the prefix.
