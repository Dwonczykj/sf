---
description: "Set or show the per-role models the factory runs on: planReview, build, tests, verify. Persisted default + per-run flag overrides."
---
Set or show which model each **role** of the factory spawns its Claude agents on. The build agent does the real work; the plan-review and verify agents are thin drivers that shell out to the real vendors (Codex/Gemini/Cursor) and only parse the result — so they default cheap. This is the knob for cost/speed vs quality per run.

Persisted to `~/.claude/sf-models.json`. Absent file = the defaults below.

## The four roles and their defaults

| Role | What runs on it | Default |
|---|---|---|
| `planReview` | Phase 2b plan-review drivers (parse vendor verdicts) | `claude-sonnet-5` |
| `build` | the build agent — the real coding work | `claude-opus-4-8` |
| `tests` | T1/T2/T3 + T1-diff test agents | `claude-sonnet-5` |
| `verify` | Phase 4 verify drivers (parse vendor findings) | `claude-sonnet-5` |

Model slugs are **Claude** slugs (`claude-opus-4-8`, `claude-opus-5`, `claude-sonnet-5`, `claude-haiku-4-5`) — these are the Agent-tool models. Which *vendor* the build/test workers run on (Anthropic vs codex/cursor) is the separate `/sf:model-provider` switch; even under codex/cursor the thin drivers here are still Claude and use these models.

## What to do

Argument: `$ARGUMENTS`.

- **empty, `status`, or `show`** — read `~/.claude/sf-models.json` (missing = defaults), merge over the defaults, and print the four resolved roles in a short block. Don't write.
- **`reset`** — delete `~/.claude/sf-models.json` (back to defaults). Confirm.
- **one or more `role model` (or `role=model`) pairs** — set those roles and leave the rest. Accept aliases: `plan`→`planReview`, `test`/`tests`→`tests`, `build`, `verify`. Reject an unknown role (list the four) and an obviously non-Claude slug (say models must be Claude slugs). Merge into the file (create it if absent), then read back and print the four resolved roles.

Write the JSON with the four keys it knows about, preserving any already set; e.g. `{"planReview":"claude-sonnet-5","build":"claude-opus-4-8","tests":"claude-sonnet-5","verify":"claude-haiku-4-5"}`.

## The resolution contract (what entry commands read)

Every entry point resolves each role's model the same way, so a run entered any way behaves identically:

**per-run flag → `~/.claude/sf-models.json` → blanket `--model` → built-in default.**

- Per-run flags (on `sf:build`, `sf:build-verify`, `sf:start-feature`, `sf:continue`, `sf:adopt`): `--plan-model`, `--build-model`, `--test-model`, `--verify-model`, and `--model` as the blanket for all four.
- `sf:build-verify` reads this file (and the flags) and passes a `models` object into the Workflow (the script has no filesystem access). The interactive prose paths read it directly at each spawn.

End by printing the four resolved roles and reminding me I can set one with `/sf:models build claude-opus-5` or reset with `/sf:models reset`.
