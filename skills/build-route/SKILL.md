---
name: build-route
description: At the start of each slice's build, recommend building it locally or in the Fyxer factory (a cloud Claude session that builds a Linear ticket labelled `factory`, opens the PR, fixes CI and review findings and merges once its gate passes), ask Joey once, and on FACTORY hand the slice over and watch it to merge. Called once per slice by start-feature Phase 3, sf:build, sf:build-verify and sf:orchestrate; not user-invoked directly.
---

# build-route

Callers run this once per slice, before any worktree, plan or worker exists for it. It returns LOCAL or FACTORY. On LOCAL the caller builds as it always has. On FACTORY this skill hands the slice over and the caller builds nothing for it.

The factory is defined by the repo's own `factory` skill (`.claude/skills/factory/` in `Fyxer-AI/web-app`) and `apps/factory/brief.md`. Read those, never a copy of them here: this skill only says when to use the factory and what sf adds around it. Where they and this skill differ on how the factory works, they win.

## 1. Recommend

Recommend **LOCAL** if any of these hold, else **FACTORY**. Stop at the first that holds; it is the reason.

- **No factory here.** The repo is not `Fyxer-AI/web-app`, `Fyxer-AI/fyxer-admin` or `Fyxer-AI/desktop-app`, or you can't find the `factory` skill. Then skip the question below: say in one line that this slice builds locally and why, and return LOCAL.
- **No Routine.** Joey has no `Fyxer factory` Routine, or it lacks this repo. Check as the factory skill's `handoff.md` step 1 does.
- **High scores.** The slice's share of the steward's budget in `split.md` scores complexity L or blast high.
- **Waits on an open PR.** The slice stacks on, or is `after`, a slice whose PR has not merged. The factory never stacks a PR on an open PR.
- **Needs local access to build or verify.** Its requirements, plan or repo build-checks need any of: `query-data` or prod data, `check-ui` or browser testing, emulators or running servers, MCP connectors, local `.env` or `.secret.local` secrets. A step that only runs after merge (Phase 4's impact measurement) doesn't count.
- **Too big or too contested.** It looks like more than 4 PRs, or more than the factory's 10 counted pushes per PR, or like a lot of review back-and-forth: a `discussion-room` was convened on its requirements, or `progress.md` still has an open question on it.

## 2. Ask

One `AskUserQuestion`, header `Build where`, question `Where should <slice> be built?`. Two options, the recommended one first with ` (Recommended)` on its label and the reason from step 1 as its description:

- **Build locally**: this session builds it with sf's full panel (Codex, Cursor and Gemini seats, local connectors), and Joey merges.
- **Build in the factory**: a cloud session builds it from a Linear ticket and merges it once CI, Qodo and Codex pass. It has no Codex, Cursor or Gemini seats and no local connectors; Joey's preferences file sets its pre-push review.

Under `sf:orchestrate`, ask through `room ask` instead, with the same header, question and options, so the question shows in one place.

Record the answer in `progress.md` as one line, `<slice>: build-route <LOCAL|FACTORY>`, so a resumed run keeps it (an orchestrated run records it in `tickets.json` instead). LOCAL: return to the caller. FACTORY: go on.

## 3. Hand off

Follow the factory skill:

- **No commits yet for the slice:** `new.md`, steps 1 to 4. The contract has already settled step 2's questions, so ask none unless step 1 finds the work done.
- **Work already on a branch:** `handoff.md`, steps 1 to 8.

Write the ticket from the state dir, since `.scratch/` is gitignored and the cloud session sees only the ticket. On top of the sections the factory file asks for, it carries:

- **Requirements:** the slice's numbered requirements from `requirements.md`, word for word, numbers kept. Its preferences file reviews the diff against this list.
- **Done when:** one line per requirement or test that proves the slice works.
- **Decisions** and **Approaches rejected**, each with why, from `requirements.md`, `split.md` and `progress.md`.
- **Measurement:** the measurement requirements that `impact.md` gave this slice, if any.
- **Repo build-checks:** the rules `repo-instructions` matched for this slice, since the cloud session cannot load sf.
- **Follow-ups:** each step that needs local access, as "ship without it; list it in the PR as a follow-up for Joey".

No `Review-By:` line: Joey chose to let the factory merge a slice once its gate passes. That is his one exception to merging himself. If the slice already has a Linear issue with no `factory` label and no comment starting `Factory `, write into it instead of making a second one.

Never open the PR from here. The factory ignores a PR opened before its `Factory session starting` comment, and the run then stops with nothing merged.

## 4. Watch

Run the watch in `new.md` step 5 from the session that handed off, `handoff.md` included (its step 9 says not to; sf watches anyway, so the slice's outcome comes back to the run). Cloud sessions cannot message local ones, so this watch is the only way news comes back. Once the watch starts, tell Joey it is safe to end this session: the factory keeps building, and `/factory watch <ticket>` in any session picks the news up again. Report the milestones it names: PR opened, question, stall, takeover, stopped run, merged.

- **A `Question for @` comment:** bring Joey each decision with its options, the session's recommendation and sf's own view (what `requirements.md` and the decisions say, in one line). Post his answers and remove `needs human` exactly as `new.md` says. An answer that changes the contract goes into `requirements.md` first, re-signed if material.
- **A stall, or the factory stops the run:** tell Joey what `new.md` says to, and offer to take it back locally (`/factory takeover`, then `sf:review` on the branch).
- Add the ticket's link to the slice's `progress.md` line once it exists, and the PR's once it opens.
- **Merged:** run start-feature Phase 4 for the slice as for a local build: `linear-update-issue-on-pr-merge`, then `sf:measure-change-impact schedule <slug>` when the impact tier was Light or Full.
- **Then a steward review, read-only.** Run the `steward` skill in review mode on the merged PR, as for a local slice's green PR. Nothing is cut from the merged code: give Joey the cuts it finds, and on his yes write each as a new Linear ticket (a follow-up he may send to the factory or build locally).

## Orchestrated runs

`sf:orchestrate` runs this per slice after `room start` passes and before `start_session`. A FACTORY slice gets no worker session:

- In `tickets.json` set `state` to `FACTORY`, `linear` to the ticket id and, once it opens, `pr` and `prUrl`. Log `room log --role factory --type state --note "FACTORY <ticket id> labelled"`.
- The orchestrator runs each FACTORY ticket's watch shell itself, as a background Bash command; its exit wakes it like a monitor event. Log each milestone with `room log --role factory`.
- Questions go to Joey with `room ask`, one per decision, the options as the factory session gave them and sf's pick first.
- On merge, set the ticket to `MERGED` and run Phase 4 for it, then the read-only steward review above, its cuts sent to Joey with `room ask`. A FACTORY ticket needs no complexity sign-off before merge: the factory merged it.
