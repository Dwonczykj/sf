---
description: "Loop fix-bot-comments + CI rechecks on a PR until all checks pass and every thread is resolved."
---
Drive an open PR to fully green.

Target PR: the arg ($ARGUMENTS), else the PR for the current branch (`gh pr view`).

Loop until done:
1. Run `fix-bot-comments` on the PR — it independently verifies each bot claim against the real code before touching anything, classifies each as real / not-worth-fixing / stale, fixes the real ones, pushes, replies per thread, and resolves.
2. Re-check state: `gh pr checks` + re-list unresolved bot threads. If any check is red or any thread still needs attention, loop again. (`Typecheck` / `Build` sitting queued behind the staging→main guard is green, not blocked — don't loop on it.)
3. Stop when every check passes and no thread needs attention.

Judgement rule (the reason this is a supervised loop, not a fire-and-forget): when you're unsure whether a bot comment is worth fixing — the fix would add more code or complexity than this simple feature warrants (a guard for an input that can't occur, an abstraction for a single case, a config toggle for a value that never changes) — do NOT silently fix it and do NOT silently skip it. Stop, show me the comment and the trade-off, and ask what to do. Otherwise apply the standard bot-triage rule: fix real defects on paths that actually run; decline when guarding the edge case costs more than the edge case costs in practice, and when you decline, reply on the thread with the reason (intentional / can't-occur / cost outweighs benefit) and resolve it. Update `progress.md` if this is part of a factory run.
