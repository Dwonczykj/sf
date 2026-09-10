---
name: cursor-agent
description: Spawn a Cursor CLI agent (the `agent` binary, Cursor's own multi-model CLI) with arbitrary instructions, optionally pinning a model. Trigger on "ask cursor to...", "spawn a cursor agent", "get the cursor cli to...", "delegate to claude-opus-5-high", "use cursor-agent for a second opinion".
---

# cursor-agent

Runs `agent --print` headless with any instructions plus an optional model. Same shape
as `gemini-agent`, but backed by Cursor's CLI, which exposes many more model families
(GPT-5.x, Claude Opus/Sonnet 5, Gemini, Grok, Kimi, GLM) through one login.

## Requirements
`agent` on PATH (installed via the Cursor CLI installer), authenticated once already
(`agent status` shows an email, not "Not logged in") — login is a browser-based OAuth
flow, so run `agent login` yourself, it can't be done on your behalf. The one-time
permissions setup below also needs doing once per machine.

## Usage
```
echo "<instructions>" | node ${CLAUDE_PLUGIN_ROOT}/skills/cursor-agent/scripts/run-agent.mjs \
  [--model <slug>] [--timeout <seconds>] [--cwd <path>]
```
`--instructions "..."` works instead of piping, for short one-liners.

## Choosing a model and reasoning effort

**Default effort is `-high`, full stop.** Unless the user explicitly asks for a
different tier, pick a `-high` slug (e.g. `claude-opus-5-high`, `gpt-5.3-codex-high`).
Never go above it — no `-xhigh`, no `-max` — and never use a `-fast` variant either.
Both cost more and burn usage faster than the task justifies; `-high` is the ceiling,
not a starting point to escalate from on your own judgement. Only pick a lower tier
(`-low`/`-none`) for genuinely trivial/mechanical work per the table below, and only go
past `-high` if the user names that tier themselves.

Pass `--model <slug>` to the wrapper — that's the whole interface:

```bash
echo "<instructions>" | node ${CLAUDE_PLUGIN_ROOT}/skills/cursor-agent/scripts/run-agent.mjs --model claude-opus-5-high
```

There is **no separate `--effort` flag** on this CLI (gemini-agent's wrapper still
accepts one for parity with agy, but cursor-agent has nothing to pass it to). Cursor
bakes reasoning effort into the slug itself — pick the effort by picking the slug
variant: `claude-opus-5-low` vs `claude-opus-5-high` vs `claude-opus-5-max` are three
different slugs, not one slug plus a flag. Common suffixes across families: `-none`,
`-low`, `-medium`, `-high`, `-xhigh`, `-max`, with an optional trailing `-fast` on
several (`claude-opus-5-high-fast` trades some quality for speed at the same tier). Not
every family has every tier — run `agent models` rather than guessing a suffix onto a
family that doesn't list it.

`agent models` (or `--list-models`) lists the full current set for your account — 211
entries as of 2026-09-07, far too many and too volatile to snapshot in full here (the
2026-08-19 snapshot below already needed corrections three weeks later — see
Verification). Unlike `agy models`, this one is safe to call from a script (verified: no
TTY-hang, works fine via `execFile`). Durable landmarks by family, as of 2026-09-07 (a
sample, not the full list):

- Anthropic: `claude-opus-5-high` (the pre-pr-gate/solve-in-worktrees mirror pin),
  `claude-sonnet-5-high`
- OpenAI: `gpt-5.3-codex-high` (coding-specialized), `gpt-5.6-sol-high` (1M-context general)
- Google: `gemini-3.1-pro` (one tier only, no `-high`/`-low` split), `gemini-3.8-flash-high`
  (the Flash line does split by effort — `-low`/`-medium`/`-high`)
- xAI: `cursor-grok-4.6-high` (4.5 has dropped off the list — don't pin it)
- Moonshot: `kimi-k3-high`, `kimi-k3-max`, `kimi-k2.7-code` (code-specialized)
- Zhipu: `glm-5.2-high`, `glm-5.2-max`

`auto` (the default) lets Cursor's own router pick.

## Sizing the model to the task, not just naming a family

The CLI exposes no `$`/token pricing (`agent --help` has no cost flag, `agent models`
prints names only) — Cursor bills through the app subscription, not per-call price
lookup, so there's no dollar figure to snapshot here even if the model list were stable.
What *is* stable is the effort-suffix gradient within a family, and it's a direct cost
and latency dial: `none < low < medium < high < xhigh < max`. A `-thinking` variant
spends extra tokens on hidden reasoning before answering (more cost and latency for
harder problems); a `-fast` variant trims cost/latency off a given tier at some quality
cost. Family weight class matters too — `mini`/`nano`/`flash` families are cheaper and
faster than flagship families at the same effort word, by design.

Match the tier to the task instead of defaulting to the biggest name available:

| Task shape | Pick | Why |
|---|---|---|
| Trivial / mechanical — rename, one-line fix, lookup, formatting, a quick lint-comment triage | a `-low` or `-none` tier on a lightweight family: `gpt-5.4-mini-low`, `gemini-3.8-flash-low`, `claude-sonnet-5-low` | cheapest and fastest; the task has no reasoning depth to buy |
| Everyday dev work — typical single-file bugfix or feature, a straightforward second opinion | `-high` non-thinking on a mid-weight family: `claude-sonnet-5-high`, `gpt-5.3-codex-high` | best cost-for-intelligence on real coding work; this is the default |
| Hard / high-stakes — architecture call, adversarial review, cross-cutting refactor, an ambiguous bug | still `-high`, just on a flagship family: `claude-opus-5-high`, `gpt-5.6-sol-high` | more capable model at the same effort ceiling; don't reach for `-xhigh`/`-max`/`-thinking` unless the user names that tier |
| Second opinion / review-panel diversity | rotate across families (Opus, Grok, GLM, Kimi) at `-high` rather than pushing effort tiers | independent failure modes matter more than squeezing one model harder |

Don't guess a suffix onto a family that doesn't list it — run `agent models` (or grep
its output) to confirm the exact slug before pinning it anywhere durable (a script, a
review-mirror prompt, this file).

**Cursor IDE's per-model enable toggles don't gate the CLI.** The IDE's model-picker
settings let you flip individual models on/off for the interactive dropdown; a model
shown off there still works through `agent --model` — verified against `gemini-3.1-pro`,
`kimi-k3-high`, and `glm-5.2-high`, all toggled off in the IDE at the time, all returned
a normal result via the CLI. That toggle only controls IDE-picker visibility, not CLI
entitlement — don't bother syncing it before using a model here.

No client-side model validation needed: an unrecognized slug is rejected by `agent`
itself, loudly, with the full current model list in the error, before anything runs.
Nothing to reimplement.

## Permissions setup (one-time per machine)
`agent`'s approval model is a global JSON allowlist, not per-invocation flags. Global
config lives at `~/.cursor/cli-config.json` — this is the user's real Cursor settings
file (auth, model prefs, etc.), not a throwaway config, so only ever touch the
`permissions.allow` array in it, never the rest. It ships with `approvalMode:
"allowlist"` already set, and by default just `["Shell(ls)"]` allowed. Add:

```json
"permissions": {
  "allow": [
    "Shell(ls)",
    "Shell(pwd)",
    "Shell(cat)",
    "Shell(grep)",
    "Shell(rg)",
    "Shell(find)",
    "Shell(wc)",
    "Shell(git diff)",
    "Shell(git log)",
    "Shell(git show)",
    "Shell(git status)",
    "Shell(git branch)"
  ],
  "deny": []
}
```

Rule syntax: `Shell(prefix)` matches on a prefix of the tokens, same semantics as agy's
`command(prefix)` — `Shell(git status)` allows `git status --short` but not `git diff`.
No write tools are on this list and nothing here needs `--force`/`--yolo`
("Run Everything" — the `--dangerously-skip-permissions` equivalent, avoid it).

A command not on the list doesn't come back empty — unlike agy, `agent` degrades
gracefully: it explains it was blocked and either stops or works around it with an
allowed tool. Verified: asked to review for bugs, it once tried a `grep` that got
rejected and just switched to its own search tool instead of hanging or going silent.
One consequence worth prompting against: on a denied command it can retry the same
call several times over ~40s before giving up — tell it explicitly not to retry, see
the review-mirror prompt below.

Separately, cursor-agent also gates on **workspace trust** per directory (first-run only,
remembered after) — a brand-new directory (e.g. a freshly created worktree) exits 1
asking to be trusted interactively, distinct from the command-permission gate above.
The script always passes `--trust` to cover this; it marks the directory as
non-malicious only, it does not bypass the `Shell(...)` allowlist.

## Behavior
Unlike agy, `agent` correctly defaults to the process's cwd (verified: `pwd` inside a
plain `--print` call with no extra flags returned the real cwd) and has no flag-ordering
footgun around `--print` (verified: `--print --model X "prompt"` and
`--print "prompt" --model X` both work). Nothing to work around on either front — the
script just sets the child process's cwd via `--cwd` and lets `agent` follow it.

Uses `--output-format json` and reads the `result` field directly — no "write your
answer to a temp file" trick needed like the agy wrapper: the json result reliably
contains the model's full final answer, so there's no separate output channel to lose
track of. `is_error` and an empty `result` are both treated as failure. Default timeout
is 600s, enforced by Node's own `execFile` timeout (there's no `--print-timeout`
equivalent on this CLI to double up with).

## As a review mirror in the factory
Same slot as `gemini-agent` — an independent model's opinion on a diff, run from a
worktree:

```bash
echo "<the review prompt, verbatim>
Read-only review: only use git/grep/cat/find/ls to inspect the repo. Do not run
build/test/typecheck/lint commands, and do not execute code to test a hypothesis. If a
shell command is rejected, don't retry it — note that and continue with what's already
visible. Do not edit, create, or delete any file." | node ${CLAUDE_PLUGIN_ROOT}/skills/cursor-agent/scripts/run-agent.mjs \
  --model claude-opus-5-high --cwd <worktree path> --timeout 280
```

The read-only + don't-retry caveats are required, not flavour text — without them it
tries build/typecheck commands the allowlist correctly denies, and can burn a couple of
minutes retrying a denied call before answering. On later loop rounds, re-run fresh
against the current diff rather than trying to continue a session — there's a
`--resume`/`--continue` mechanism but reconciliation across rounds is handled in
`pre-pr-gate`, same as for agy.

## On failure
Surface the error and stop. Don't try to install, re-authenticate, or click through the
workspace-trust prompt on the user's behalf — `agent login` is their browser session,
not something this script can do for them.

## Verification (2026-08-19)
`agent --print "Reply with exactly: BETA" --model gpt-5.2` → `BETA`, via both the raw
CLI and the wrapper. A real read-only review with `claude-opus-5-high` against this
repo's last commit found a genuine semantic bug (a per-response tool-call cap being
described as equivalent to a per-turn budget) and ended with a `VERDICT:` line — not an
empty string, not a hang.

## Verification (2026-09-07)
Re-ran `agent models` (`agent --version` 2026.09.02-c22c1a3) to check the landmarks
above: 211 slugs total. `cursor-grok-4.5-high` is gone (only 4.6 remains) — updated.
`claude-opus-5-high`, `claude-sonnet-5-high`, `gpt-5.3-codex-high`, `gpt-5.6-sol-high`,
`gemini-3.1-pro`, `kimi-k3-*`, `glm-5.2-*` all still resolve. Confirms the list churns
within weeks — treat any specific slug here as a landmark to sanity-check against
`agent models`, not a guarantee.
