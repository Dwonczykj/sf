---
description: "Switch the default model provider for sf's spawned build/test sub-agents: anthropic (default), codex, or cursor — to manage usage limits."
---
Set or show the default model provider sf routes its spawned **worker sub-agents** (the build agent and the T1/T2/T3 test agents) through. Switching it lets you push that work onto a different vendor's subscription when you're near a usage limit.

The choice is persisted to `~/.claude/sf-model-provider` (one lowercase word), same convention as `~/.claude/sf-stay-hot.log`. It survives plugin updates. Absent file = `anthropic`.

## What to do

Argument: `$ARGUMENTS`.

- **empty, `status`, or `show`** — read `~/.claude/sf-model-provider` (treat missing as `anthropic`) and report the current provider plus what it routes to, in one or two lines. Don't write anything.
- **`anthropic` / `claude` / `default` / `best`** — write `anthropic`.
- **`codex`** — write `codex`.
- **`cursor`** — write `cursor`.
- **anything else** — don't write; list the three valid values.

Write the canonical token with a trailing newline (e.g. `printf 'codex\n' > ~/.claude/sf-model-provider`), then read it back and confirm the new value in one line.

## The routing contract (what each value means)

This is the single source of truth the build/verify skills read (`build`, `solve-in-worktrees`, `start-feature` Phase 3). They check `~/.claude/sf-model-provider` before spawning the build + test workers and route them:

| Provider | Build + test workers run via | Consumes |
|---|---|---|
| `anthropic` (default) | the `Agent` tool, model `claude-opus-4-8` | your Claude Code usage |
| `codex` | the `codex-agent` skill (`gpt-5.6-sol`, medium) | your OpenAI/ChatGPT Codex subscription |
| `cursor` | the `cursor-agent` skill (`claude-opus-5-high`) | your Cursor subscription |

**Only `anthropic` spends your Claude Code / Anthropic usage** — that's the point of the switch. Set `codex` or `cursor` to keep a factory run going when Anthropic limits are tight, then set it back to `anthropic` for the best quality.

## What this does NOT change

- **The cross-vendor review panel** (Codex + Gemini-via-Cursor + Cursor, in `pre-pr-gate` / `solve-in-worktrees` verify) stays three independent vendors — that diversity is the whole point of the gate, and each seat already runs on its own vendor subscription, not your Claude Code usage. A worker-provider switch doesn't collapse it.
- **The deterministic `sf:build-verify` workflow** picks its worker model from its own `--model` arg (default `claude-opus-4-8`), not this file — a workflow script can't read local state. Pass `sf:build-verify ... --model <slug>` there, or use the interactive `sf:build` / `sf:start-feature` path, which does honour this setting.

End by stating the current provider and reminding me I can switch anytime with `/sf:model-provider codex|cursor|anthropic`.
