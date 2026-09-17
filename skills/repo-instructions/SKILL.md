---
name: repo-instructions
description: Load repo-specific supplementary build rules that the factory must surface at planning and enforce at build time — conventions that live outside the diff (e.g. "change a Firestore model → also register it in sync-functions") and that external sub-agents (Codex/Cursor/Gemini) never see because they don't read the repo's .claude/rules. Keyed by git remote slug. Use from sf:plan, sf:build-verify, and start-feature; not user-invoked directly.
---

# repo-instructions

Some repos carry conventions a single-file diff can't reveal: changing one thing
obliges you to change another, elsewhere, or a deploy breaks. Claude Code sees the
repo's `.claude/rules`/`AGENTS.md`; the factory's cross-vendor sub-agents (Codex,
Cursor, Gemini in worktrees) do **not**. This skill forwards those rules explicitly,
at the two moments that matter: stated at planning, checked post-build.

## Load

1. Resolve the repo slug from the target worktree:
   ```
   git -C <worktree> remote get-url origin
   ```
   Reduce to `<owner>/<repo>` (strip `git@host:` or `https://host/` prefix and a
   trailing `.git`). Example: `Fyxer-AI/web-app`.
2. Look for `${CLAUDE_PLUGIN_ROOT}/skills/repo-instructions/repos/<owner>__<repo>.md`
   (slash → `__`). If it doesn't exist, this repo has no supplements — **silently
   no-op**, change nothing.
3. If it exists, read it. Each `###` block is one rule with **When / Then / Check**
   lines. Treat the whole file as prose; there is nothing to parse.

## Consume — per phase

**Planning (`sf:plan` Scope, `start-feature` Phase 1):** for each rule whose **When**
the feature's planned diff plausibly triggers, raise it in `gather-requirements` as a
scope decision — "this touches X, so rule R obliges Y; include it?". The user's
answer is explicit (per the request that added this skill): a yes turns **Then** into
a numbered requirement in `requirements.md`; a no gets one line saying it was
considered and excluded. Rules whose **When** clearly can't fire are left unraised.

**Build + verify (`sf:build-verify` setup, `start-feature` Phase 3):** append the
matched rules verbatim to each slice's `.scratch/<slug>/requirements.md` under a
`## Repo build-checks (sf:repo-instructions)` heading, before handing the slice to the
workflow. The build agent, the T-pass verify agents, and the Codex test agents all
read `requirements.md`, so the **Check** line becomes a real post-build gate and the
rule reaches the non-Claude vendors that never saw the repo's own standards.

That's the whole contract: load if present, raise at plan, carry into requirements.md
at build. No config schema, no new workflow args.

## Adding a repo

Drop a `repos/<owner>__<repo>.md` file next to this skill, following the shape of the
existing ones. The rule text should also live in that repo's own `AGENTS.md` /
`.claude/rules` so the team owns it and native Claude sessions see it — this file is
the copy that reaches everything else.
