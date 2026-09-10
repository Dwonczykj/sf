---
name: create-branch
description: Create a git branch following the naming convention `<prefix>/<type>-<LINEAR-CODE>-<title>`, where `<prefix>` is the plugin's configured author prefix (defaults to your shell username). Use when the user asks to create a branch, start work on a Linear issue, cut a branch for a ticket, or says "/create-branch", "make me a branch", "branch off staging for PRE-1234".
---

# create-branch

Create a branch named:

```
<prefix>/<type>-<LINEAR-CODE>-<kebab-title>
```

`<prefix>` is not hardcoded — resolve it in step 0 below. It's the plugin's `branchPrefix` config option (set once at install), falling back to your shell username.

## Parts

- **`type`** — conventional-commit type: `feat`, `fix`, `chore`, `refactor`, `experiment`, `docs`, `test`. Pick from what the work actually is; if the user gave a Linear issue, infer from its title/labels (bug → `fix`, feature → `feat`, cleanup/menial → `chore`).
- **`LINEAR-CODE`** — the Linear identifier, uppercase, e.g. `PRE-2884`. Omit this segment entirely (no double dash) if there is no issue.
- **`kebab-title`** — lowercase kebab-case, 3–6 words, describing the change not the trigger. Strip the Linear code if it appears in the issue title.

Examples (with `<prefix>` resolved to `joeydwonczyk`):

```
joeydwonczyk/fix-PRE-2884-outlook-source-weblink
joeydwonczyk/feat-PRE-3086-person-relationship-subcollection
joeydwonczyk/chore-drop-dead-ml-fields
```

## Steps

0. **Resolve the author prefix** into `$PREFIX`, once, before cutting the branch:

```bash
# ${user_config.branchPrefix} is substituted by Claude Code from the plugin's install-time config.
# Blank (default) or an unconfigured install falls back to your shell username.
PREFIX='${user_config.branchPrefix}'
case "$PREFIX" in ''|*user_config.branchPrefix*) PREFIX="$(whoami)" ;; esac
```

The `*user_config.branchPrefix*` arm catches an install that never persisted the option (the token is left verbatim); the empty arm catches the blank default. A configured value passes straight through.

1. **Work out the parts.** If the user gave a bare `PRE-1234`, fetch the issue title with the Linear MCP (`mcp__ac8e4a0b-1ec5-4ab5-8b10-e46579796632__get_issue`) rather than guessing. If they gave a description and no issue, skip the code segment. Ask only if the type is genuinely ambiguous — otherwise pick and say what you picked.

2. **Pick the base branch** by repo:
   - `Fyxer-AI/web-app` → `staging`
   - `Fyxer-AI/eval` → `main`
   - anything else → `staging` if it exists, else the default branch

3. **Cut it from a fresh base**, without disturbing uncommitted work:

```bash
git fetch origin && git switch -c "$PREFIX/<type>-<CODE>-<title>" origin/<base>
```

If the working tree is dirty, stop and ask before doing anything that would move those changes. Never stash or discard without being told to.

4. **Report** the branch name and its base in one line.

## Notes

- The web-app main worktree is shared with other agents that auto-stash and switch branches. If the user wants to run this branch locally, use the `setup-worktree-webapp` skill instead of switching branches in place.
- Do not push. Pushing and opening the PR is the `create-pr` skill's job.
