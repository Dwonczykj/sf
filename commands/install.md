---
description: "Check and set up sf's external dependencies: Cursor CLI, Codex CLI, and the codex MCP registration."
---
Verify the three things the factory's cross-vendor review (Codex + Gemini-via-Cursor + Cursor) depends on, and walk me through fixing whatever's missing. Don't just dump a checklist — run the checks, report pass/fail per item, and only hand me the command for what's actually missing.

1. **Cursor CLI** — run `agent --version` (or `cursor-agent --version`). If missing: give me the installer, `curl https://cursor.com/install -fsS | bash`, then tell me to run `agent login` myself (browser OAuth, can't be done on my behalf). Confirm auth with `agent status` (should show an email, not "Not logged in").

2. **Codex CLI** — run `codex --version`. If missing: give me `npm install -g @openai/codex` (or the user's package manager of choice). Then tell me to run `codex login` myself (also browser OAuth). Confirm with `codex login status` or equivalent.

3. **Codex MCP registration** — run `claude mcp list` and check for a `codex` entry connected. This is what makes `mcp__codex__codex` callable from Claude Code — a plugin isn't needed here, only a registered MCP server. If missing, register it at user scope so it's available in every project, not just this one:
   ```
   claude mcp add codex -s user -- codex mcp-server
   ```
   Then re-run `claude mcp list` to confirm it shows connected.

Finish with a one-line summary: which of the three were already fine, which I fixed, and which still need me to do something (auth logins can't be scripted). If all three pass, say the factory's cross-vendor review is ready to use.
