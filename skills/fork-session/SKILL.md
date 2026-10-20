---
name: fork-session
description: Spawn a persistent, resumable Claude Code session with its own model and reasoning effort, through the desktop app's native `start_session` tool, instead of an in-process subagent. Use when the user says "fork a session", "spawn a claude session", "run this in a persistent/resumable session", "background claude agent", or wants a task to keep running and be resumable across turns rather than a one-shot Agent/Task subagent. Where there is no desktop app (no `start_session` tool), use `fork-cli-session`.
argument-hint: "[task] [--model <id>] [--effort <level>] [--worktree [name]]"
---

# fork-session

Starts a real, separate session in the Claude desktop app with `start_session`: a row in
the sidebar the user can open, talk to and stop, with its own resumable history. Unlike
the in-process `Agent` tool it persists across turns. Use it when the user explicitly
wants that, not for ordinary parallel subagent work (that's what `Agent` is for).

If `start_session` is not in your tool list (CLI only, no desktop app), stop here and run
the `fork-cli-session` skill instead; it does the same job with `claude --bg`. Load
`start_session` first with `ToolSearch` (`select:mcp__ccd_session__start_session`) if it
is only listed as deferred.

## Step 1 — Build the brief

The fork starts with only what you give it: `context: "fresh"`, never `"fork"`. Compress
the current conversation the way `fork-prompt` does (goal, key entities and definitions
verbatim, current state, next step) rather than pasting the raw transcript. If the user
gave a self-contained task, use that.

- `prompt`: the task, the files or area, and what done looks like.
- `background`: required with `fresh`, at least 80 characters. The overall goal, the
  decisions and constraints so far, and how this piece fits, for someone who has not seen
  this conversation.

## Step 2 — Call `start_session`

```
start_session({
  initiation: "user_asked",
  context: "fresh",
  title: "<under 60 chars>",
  name: "<feature>-<intent>",
  prompt, background,
  model, effort,            // optional
  use_worktree,             // true for edits, false for read-only
  source_branch, branch_name // only with a worktree
})
```

- `initiation`: `"user_asked"`, since the user invoked this skill. If the app refuses
  because an event rather than the user began the turn, propose it instead with
  `"own_initiative"` and the same fields, and tell the user it waits on their click.
- `model`: a model id, same family as yours or cheaper; anything higher is ignored. Omit
  to inherit. For a user-named model ("Opus 4.8"), map it to its id (dot becomes dash)
  using the table in `fork-cli-session`, and pass unlisted names through the same way.
  Other skills that spawn a fork with a user-named model (e.g. `pull-impact-evidence`)
  should point at that table rather than keeping their own copy.
- `effort`: `low|medium|high|xhigh|max`, at or below yours. Omit to inherit, and set it
  only when the user asked for a tier.
- `name`: always set one, `[a-z0-9-]`, at most 24 characters. Build it as
  `<feature>-<intent>`, derived from the title of the session this skill fires from
  (fetch it with `mcp__ccd_session_mgmt__get_session` if it isn't obvious) plus what the
  fork is doing:
  - `feature` is a couple of durable words from the current session's title: "Contextual
    speaker naming for shared rooms" becomes `speaker-naming`.
  - `intent` is what this fork does (`gate`, `review`, `fix`, `rebase`, `stage2`,
    `migrate`, `docs`), never `task` or `work`.
  - No PRE or PR number in the name.
  - Good: `speaker-naming-gate`, `outlook-addin-review`, `memory-recall-fix`. Bad: a
    name with no feature, a name with no intent, a number, a sentence.
  - Never reuse a name for a different task. Two concurrent forks on one feature get a
    qualifier (`-a`/`-b`); cut the feature word before dropping the intent to fit 24.
- `use_worktree`: `true` when the task edits files in a git repo and shouldn't collide
  with this checkout, `false` for read-only or research. Pass `source_branch` (the base
  the new worktree is cut from: staging, or the branch a stacked slice sits on) and a
  short `branch_name`. Commit first if the fork must see this session's work; uncommitted
  edits stay here.
- **An existing worktree** (e.g. a sibling `../cf-foo` you already made): pass its
  absolute path as `cwd` with `use_worktree: false` so the fork starts inside it, and end
  the brief with: "You are already in your worktree. Do not call EnterWorktree; use
  `cd`/absolute paths in Bash." A fork that calls `EnterWorktree` on a path outside its
  launch directory hits a permission prompt it cannot show and hangs.
- `permission_mode`: optional, this session's own or lower. A fork nobody attaches to
  stalls on approvals nobody gives, so name this tradeoff to the user rather than
  silently choosing.

## Step 3 — Report back

Say the session started (only once the tool result says so), link it as
`[title](#local_<id>)` using the id the result gives, and note it is now in the sidebar.
To continue it from here, `SendMessage` with `to` set to its `local_…` id (the id, never
the display name), or `mcp__ccd_session_mgmt__list_sessions {"linked": true}` to see it.

Do not poll it. The app continues this session when the fork ends its turn and you are
idle; otherwise wait for the user to ask. Never predict its result.

## Caveats

- **Not free**: a separate billed session, not a lightweight subagent. Don't use it for
  work the in-process `Agent` tool already covers.
- **Two sessions must never edit the same worktree.** If the fork takes over this
  session's work, stop working on it here.
- **A worktree fork has its own branch.** Its changes are not in this checkout until that
  branch is merged; tell the user the branch name from `get_session`.
