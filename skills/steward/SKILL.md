---
name: steward
description: Codebase-care review for one feature, run twice. At shaping, after the requirements are grilled and before the split, it says where the change should live, which existing module or helper to use instead of adding one, and what the change adds; scores complexity (S, M, L) and blast risk (low, medium, high); and sets a budget. On the slice's green PR it compares the diff with that budget and lists cuts, reuse first. Read-only on code. Called by start-feature Phase 1 and sf:orchestrate; not user-invoked directly.
---

# steward

The steward looks after the codebase while a feature goes through it, in the spirit of Matt Pocock's improve-codebase-architecture: prefer deepening a module that exists over adding a shallow one, and test anything new with the deletion test (would deleting it concentrate complexity, or just move it?). It never edits code. It writes one report and hands it back. What to cut is Joey's decision: an over-budget result goes to him, never into a silent cut.

Run it as a sub-agent so its reading stays out of the caller's context. Give it the mode, the state dir and the inputs below; take back the report's path and its one-line verdict.

## Blast-risk paths

Blast risk depends on the repo, so read it from the repo's `sf:repo-instructions` supplements file: resolve the slug as that skill's "Load" step says, then read its `## Blast risk` section. Globs under **High** make a path high; under **Medium**, medium. Match paths against the globs, case-insensitively; don't judge for yourself whether a path is risky.

With no supplements file, or no `## Blast risk` section in it, score blast from what the plan says it touches and write the score as `<score> (unsupported)`, for example `medium (unsupported)`, so nobody mistakes it for a glob match.

## Mode 1: shape

Inputs: the grilled requirement list, the repo checkout (read from `origin/staging`, never another session's worktree), and the state dir.

1. **Trace first.** For each requirement, find the code it changes and the code nearest to what it adds. Read it; don't guess from names.
2. **Where it lives.** Name the package and module each requirement belongs in, by the repo's own layout rules (`AGENTS.md`, `docs/structure.md` or similar). One line each.
3. **Reuse.** For each thing the plan would add, search for an existing module, helper, collection, flag or pattern that does the job or nearly does. Name it with its path and say what using it instead saves. Where nothing fits, say "nothing found" and the searches you ran.
4. **What it adds.** List each new file, abstraction, collection and flag by name, after the reuse above. An abstraction is a new exported type, class, interface, registry, factory or module boundary whose job no existing one does. A collection also counts as an abstraction. Count planned flag keys, not call sites.
5. **Complexity.** S: one package, no new abstraction, no change to a shared helper. M: two or three packages, or one new abstraction, or a change to a shared helper. L: more than that, or a new collection, or a change to a helper with callers in other domains. Give the reasons.
6. **Blast risk.** List the paths the plan names, each with the glob it matches. The highest match wins; no match is low. Give the reasons.
7. **Budget.** Four limits: New files, New abstractions, Net source lines, New flags. The first, second and fourth are the counts from step 4. Net source lines is your estimate of added minus removed lines in non-test, non-generated source, plus a quarter, rounded up to the next ten. Tests, snapshots, generated files and Markdown don't count.

Write `<state dir>/steward.md`:

````md
# <slug>: steward at shaping (<YYYY-MM-DD>)

Verdict: <complexity> complexity, <blast> blast. Budget: <n> files, <n> abstractions, <n> lines, <n> flags.

## Where it lives
- R1: <package/module>. <one line why>

## Reuse
- R3 wants a retry queue: use `<path>` (<what it already does>) instead of a new one.

## What it adds
- Files: `<path>`, ...
- Abstractions: `<Name>` in `<path>`: <its job>
- Collections: ...
- Flags: ...

## Complexity: <S|M|L>
- <reason>

## Blast risk: <low|medium|high>[ (unsupported)]
- `<path>` matches `<glob>` (High)

## Budget
| Row | Limit |
|---|---|
| New files | <n> |
| New abstractions | <n> |
| Net source lines | <n> |
| New flags | <n> |

```json
{"complexity": "<S|M|L>", "blast": "<low|medium|high>[ (unsupported)]",
 "budget": {"New files": [null, <n>], "New abstractions": [null, <n>], "Net source lines": [null, <n>], "New flags": [null, <n>]}}
```
````

The JSON block is what the caller copies into a ticket; `[actual, limit]` is the shape `tickets.json` and the Build Room use, with `null` until the review fills it.

## Mode 2: review

Inputs: the slice's PR or branch, its budget, complexity and blast (its ticket in `tickets.json`, or its share in `split.md`), its section of `requirements.md`, and the state dir.

1. **Measure.** From `git diff <merge-base> origin/<branch>`, with tests, snapshots, generated files and Markdown left out: new files (`--diff-filter=A --name-only`), net source lines (`--numstat`, added minus removed), new abstractions and new flag keys (read the added lines; list each by name). Compare each with its limit.
2. **Rescore blast** from the diff's paths with the same globs. Name any high or medium path the shaping report didn't list.
3. **Cuts, reuse first.** If `~/.claude/skills/complexity-reduction/SKILL.md` exists, run that skill on the PR and take its cuts. It lives outside sf, so a colleague may not have it. Without it, do the reuse check yourself: for each new function, type or module in the diff, search the repo for one that already does the job and list the matches; then, for each part, ask what breaks for the user if it's gone. Either way, list hand-rolled code that should reuse an existing helper first, then everything else. Give each cut the budget rows it brings down and roughly by how much.

Write `<state dir>/steward-<ticket>.md`:

```md
# <ticket>: steward on the green PR (<YYYY-MM-DD>, <sha>)

Verdict: within budget | over budget on <rows>.

| Row | Actual | Limit |
|---|---|---|
| New files | <n> | <n> |
| New abstractions | <n> | <n> |
| Net source lines | <n> | <n> |
| New flags | <n> | <n> |

Blast: <score>. New paths since shaping: <list, or none>.

## Cuts (reuse first)
1. <what to cut or reuse instead>, `<path:line>`. Saves <rows and amounts>.
```

End with the same JSON block as Mode 1, with each row's actual filled in. Return the report's path and its verdict line, nothing else.
