---
name: codex-agent
description: Spawn an OpenAI Codex CLI agent (the `codex` binary, run headless via `codex exec`) with arbitrary instructions, optionally pinning a model and reasoning effort. Backed by the codex CLI directly — no codex MCP registration or plugin needed. Trigger on "ask codex to...", "spawn a codex agent", "get the codex cli to...", "use codex-agent for a second opinion", or as a review-panel seat alongside cursor-agent/gemini-agent.
---

# codex-agent

Runs `codex exec` headless with any instructions, plus an optional model and reasoning
effort. Same shape as `cursor-agent` and `gemini-agent`, but backed by OpenAI's Codex
CLI. Using this skill means the factory calls codex through its own CLI, so it does
**not** depend on the `mcp__codex__codex` MCP server being registered.

## Requirements
`codex` on PATH (`npm install -g @openai/codex`), authenticated once already
(`codex login status` shows logged in, not an error) — login is a browser OAuth flow, so
run `codex login` yourself, it can't be done on your behalf. No MCP registration is
needed for this skill (that's the whole point); `sf:install` still checks the MCP because
the review/gate skills currently call it directly.

## Usage
```
echo "<instructions>" | node ${CLAUDE_PLUGIN_ROOT}/skills/codex-agent/scripts/run-agent.mjs \
  [--model <slug>] [--effort <minimal|low|medium|high>] [--sandbox <mode>] \
  [--timeout <seconds>] [--cwd <path>]
```
`--instructions "..."` works instead of piping, for short one-liners.

## Model and reasoning effort

**Default is `gpt-5.6-sol` at `medium` effort, and never fast.** That's the factory
default — pass nothing and you get it. Codex names a model as a base slug (`-m`) plus a
*separate* reasoning-effort config, unlike Cursor's combined `family-effort` slug:

- `--model` sets the base model (default `gpt-5.6-sol`, the coding-general 1M-context
  line; `gpt-5.3-codex` is the coding-specialised alternative).
- `--effort` sets reasoning effort: `minimal` < `low` < `medium` < `high` (default
  `medium`). This maps to codex's `model_reasoning_effort` config.

For convenience the wrapper also accepts a Cursor-style combined slug and splits the
trailing effort off: `--model gpt-5.6-sol-high` is treated as base `gpt-5.6-sol` +
effort `high`. An explicit `--effort` wins over a suffix.

**Never fast.** There is no fast tier in the factory's codex use — the wrapper refuses a
`-fast` model slug or `--effort fast` outright. Don't add one; `high` is the ceiling,
`medium` is the default, and only drop to `low`/`minimal` for genuinely trivial work.

```bash
# default: gpt-5.6-sol, medium effort
echo "<instructions>" | node ${CLAUDE_PLUGIN_ROOT}/skills/codex-agent/scripts/run-agent.mjs

# harder review at high effort
echo "<instructions>" | node ${CLAUDE_PLUGIN_ROOT}/skills/codex-agent/scripts/run-agent.mjs --effort high
```

An unrecognised base model is rejected by `codex` itself, loudly, before anything runs —
no client-side model list to maintain.

## Sandbox and behaviour
Defaults to `--sandbox read-only`: model-generated shell commands can read the repo but
not write or execute-to-mutate, which is what a review seat wants. `--sandbox
workspace-write` lets it edit within the working root; `danger-full-access` is not used
here. `codex exec` is non-interactive — there are no approval prompts to answer.

`--cwd` sets the working root (passed as `codex -C`); the wrapper also passes
`--skip-git-repo-check` so a fresh worktree or non-repo dir doesn't error. The final
answer is captured via codex's `-o <file>` (last-message) rather than parsing the `--json`
JSONL event stream — the file reliably holds the model's full final message; an empty
file is treated as failure. Default timeout is 600s, enforced in the wrapper with SIGKILL.

Two implementation details that matter, both the reason a naive wrapper hangs for minutes:

- **`--ignore-user-config` is why it's fast.** Without it, every `codex exec` cold-starts
  the user's `~/.codex/config.toml` — its MCP servers (one doing a failing OAuth that
  retries for the whole run), SessionStart/UserPromptSubmit hooks, and skills — turning a
  6-second call into a 4-minute one. The MCP path (`codex mcp-server`) doesn't pay this
  per call because it's a warm long-lived process; the CLI pays it every cold start unless
  the config is skipped. Auth lives in `CODEX_HOME`, so it survives the skip; if you ever
  rely on a **custom model provider** defined in that config (a non-ChatGPT base URL),
  that's the one thing this drops — pass it back with `-c` or don't use `--ignore-user-config`.
- **The wrapper uses `spawn` with stdin closed, not `execFile`.** `codex exec` blocks
  reading stdin to EOF whenever stdin looks piped; `execFile` leaves the child's stdin an
  open pipe (and ignores a `stdio` option), so codex waits on it until the timeout even
  though the prompt is already a positional arg. `spawn` with `stdio` stdin `'ignore'`
  gives it a closed fd, so it proceeds straight to the prompt.

## As a review mirror in the factory
Same slot as `cursor-agent` / `gemini-agent` — an independent model's opinion on a diff,
run from a worktree. Codex already runs sandboxed read-only, so it needs less prompt
armouring than the others, but keep the review discipline explicit:

```bash
echo "<the review prompt, verbatim>
Read-only review: inspect the repo only. Do not edit, create, or delete any file, and do
not run build/test/typecheck/lint commands or execute code to test a hypothesis. Output
findings and a VERDICT line." | node ${CLAUDE_PLUGIN_ROOT}/skills/codex-agent/scripts/run-agent.mjs \
  --cwd <worktree path> --timeout 280
```

This wrapper is stateless: each call is fresh, with no thread resume. On later loop
rounds, re-run against the current diff — same as cursor-agent and gemini-agent already
do. (The `mcp__codex__codex` path in `pre-pr-gate` / `solve-in-worktrees` keeps a
`threadId` for `codex-reply` across rounds; this CLI skill trades that for having no MCP
dependency.)

## On failure
Surface the error and stop. Don't try to install or re-authenticate on the user's behalf
— `codex login` is their browser session.
