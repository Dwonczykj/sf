---
name: fork-session
description: Spawn a persistent, resumable Claude Code session in the background, with its own model and reasoning effort, instead of an in-process subagent. Use when the user says "fork a session", "spawn a claude session", "run this in a persistent/resumable session", "background claude agent", or wants a task to keep running and be resumable across turns rather than a one-shot Agent/Task subagent.
argument-hint: "[task] [--model <alias>] [--effort <level>] [--worktree [name]]"
---

# fork-session

Spawns a real, separate `claude` process in the background via `claude --bg`. Unlike
the in-process `Agent` tool, this is a full session with its own resumable history —
addressable later through `ListAgents`/`SendMessage`, or from a terminal via
`claude attach`/`claude logs`/`claude stop`. Use this when the user explicitly wants
persistence/resumability across turns, not for ordinary parallel subagent work (that's
what `Agent` is for).

## Step 1 — Build the prompt

If the task should carry context from the current conversation, compress it the same
way `fork-prompt` does (goal, key entities/definitions verbatim, current state, next
step) rather than pasting the raw transcript. If the user gave a self-contained task,
just use that.

## Step 2 — Choose flags

```bash
claude --bg \
  --model <alias-or-full-name> \
  --effort <low|medium|high|xhigh|max> \
  -n "<short-name>" \
  [--worktree [worktree-name]] \
  "<prompt>"
```

- `--model`: alias (`sonnet`, `opus`, `fable`) for each family's current default, or a
  full name for a specific version. Omit to inherit the caller's default. When the user
  names a model the way the model switcher shows it (screenshot-named, e.g. "Opus 4.8"),
  map it to its full id — dot becomes dash, no other change — rather than guessing:

  | Name shown in the switcher | `--model` value |
  |---|---|
  | Opus 5.5 | `claude-opus-5-5` |
  | Opus 5 | `claude-opus-5` |
  | Opus 4.8 | `claude-opus-4-8` |
  | Opus 4.7 | `claude-opus-4-7` |
  | Opus 4.6 | `claude-opus-4-6` |
  | Fable 5.1 | `claude-fable-5-1` |
  | Sonnet 5 | `claude-sonnet-5` |
  | Sonnet 4.6 | `claude-sonnet-4-6` |
  | Haiku 4.5 | `claude-haiku-4-5-20251001` |

  This list is whatever was in the switcher as of 2026-09-23 — it changes as models
  ship/retire, so if the user names something not on it, pass it through as given
  (dot-to-dash) rather than refusing or guessing a different id. Other skills that spawn
  a `fork-session` with a user-named model (e.g. `pull-impact-evidence`) should point
  here instead of keeping their own copy of this table.
- `--effort`: omit to inherit default; set explicitly when the user asked for a specific
  tier.
- `-n/--name`: always set one explicitly — never let it auto-generate from cwd (that's
  where names like `web-app-b9` come from: a directory slug plus a random suffix,
  which tells you nothing about the task and is useless for linking a session back to
  what it's for). Build it as `<feature>-<intent>`, short kebab-case, derived from the
  title of the session this skill is being called from plus what the fork is being asked
  to do:
  - `feature` is the PR feature being worked on, taken from the *current session's
    title* — the session the skill fires from already names the feature, so reuse that
    handle (fetch it with `mcp__ccd_session_mgmt__get_session` if it isn't obvious from
    context). Slug it to a couple of durable words: a title like "Contextual speaker
    naming for shared rooms" becomes `speaker-naming`.
  - `intent` is what *this fork* is doing — `gate`, `review`, `fix`, `rebase`, `stage2`,
    `migrate`, `docs` — not a generic word like `task` or `work`.
  - Do **not** put a PRE or PR number in the name. The feature slug from the session
    title is the anchor now; numbers drift out of the title and add nothing a human
    greps for.
  - Good: `speaker-naming-gate`, `outlook-addin-review`, `memory-recall-fix`,
    `connector-factory-rebase`. Bad: `web-app-b9` (no task info), `task1` /
    `worker` (no feature info), `stage2-pr11216` (carries a number, no feature), a long
    free-text sentence (defeats "short").
  - The name shows up in `claude agents`, `/resume`, and the terminal title, so it's the
    *only* thing distinguishing this session from every other one running against the
    same repo — never reuse a name for a different task, and don't let two concurrent
    sessions on the same feature collide (append `-a`/`-b` or a second qualifier if
    genuinely needed, rather than dropping the feature to stay short).
- `--worktree [name]`: add this when the task will edit files in a git repo and
  shouldn't collide with the current working tree (verified: composes cleanly with
  `--bg`, creates `.claude/worktrees/<name>`, session's cwd becomes that worktree). Skip
  it for read-only/research tasks.
- Run from the target `cwd` (or `cd` first) — the background session inherits the
  shell's cwd at spawn time.
- **Named worktree (e.g. a sibling `../cf-foo` on a stacked branch)**: create it in
  *this* session first (`git worktree add -b <branch> <path> <base>`), then spawn with
  `cd <path> && claude --bg ...` so the fork starts inside it. Never ask the fork to
  create or switch into a worktree itself, and end the prompt with: "You are already in
  your worktree. Do not call EnterWorktree; use `cd`/absolute paths in Bash." A fork
  that calls `EnterWorktree` on a path outside its launch directory hits a permission
  prompt it cannot show, and hangs forever on "Entering a worktree" (seen 2026-10-12:
  `connector-writes-batch` and `connector-writes-resend` blocked for 4h).

## Step 3 — Report back

Report the printed name/id and the three ways to interact with it:
- From this or another session: `ListAgents` to see it, `SendMessage({to: "<name>",
  message: "..."})` to resume it with full context — this is the same mechanism used
  for in-process peers, no special-casing needed.
- From a terminal: `claude attach <id>` (open interactively), `claude logs <id>` (peek
  output), `claude stop <id>` (kill it).

Do not poll it yourself in a sleep loop — either wait for the user to ask, or use
`SendMessage` once when you actually need the result.

## Caveats

- **Permissions**: a background session that never gets attached still applies the
  caller's permission mode. If the task needs approvals nobody will grant, either pass
  `--permission-mode acceptEdits` (or similar) explicitly, or expect it to stall until
  someone attaches — mention this tradeoff rather than silently picking one.
- **Not free**: this is a separate billed session, not a lightweight subagent. Don't use
  it for work the in-process `Agent` tool already covers.
- **Naming collisions**: `SendMessage` resolves the bare name to whichever session most
  recently claimed it — the `<feature>-<intent>` pattern above avoids most collisions
  since the intent distinguishes forks off the same feature; still check `ListAgents`
  before spawning if the user has several sessions going on the same feature, and add a
  qualifier if two would share a name.
