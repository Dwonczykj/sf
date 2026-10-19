---
name: measure-change-impact
description: Measure a shipped change's impact against the measurement plan size-change-impact wrote before it shipped. "schedule" sets a local follow-up task that waits for the prod release, then runs follow_up_days plus follow_up_hours later and sends the result as a Slack DM (or a desktop notification), and a fix if it fails. "run" does the measurement now. Use when the user says "schedule the impact follow-up", "measure the impact of <PR> now", at sf start-feature Phase 4 close-out, or when a measure-impact scheduled task fires.
user_invocable: true
arguments: "schedule|run <slug> [--plan <path>] [--pr <number>] [--days <n>] [--hours <n>]"
---

# measure-change-impact

The "after" of the loop that `sf:size-change-impact` starts. The method is `${CLAUDE_PLUGIN_ROOT}/skills/size-change-impact/method.md`; the work runs in the `sf:impact-analyst` agent. This skill reports; it drafts nothing for anyone and posts nothing public.

Paths:
- plan: `--plan <path>` when given (an older plan kept elsewhere), else `<state dir>/impact.md`, where the state dir is the folder of the run's `progress.md`: `~/FyxerGh/build-room/<slug>/` after an orchestrate adopt, else `.scratch/<slug>/` in the worktree or at the repo root;
- result: the plan path with `.md` replaced by `-result.md`;
- log: the plan path without `.md`, as a dir (`<state dir>/impact/` for the default plan);
- repo: `gh repo view --json nameWithOwner -q .nameWithOwner`, run in the repo; work dir: its main worktree, `git worktree list --porcelain | sed -n 's/^worktree //p' | head -1`;
- release tags: the glob on the `Release tags:` line of the repo's `repo-instructions` file, under `## Impact data map`. With none, the merge commit reaching the default branch is the release;
- notify: `slackUserId` in `~/.claude/sf-tools.json`. With one, the task DMs that user on Slack; with none, it shows a desktop notification with `osascript` only.

## schedule

1. Read the plan. If it is missing, stop and offer `sf:size-change-impact` first. Take `follow_up_days` and `follow_up_hours` from its follow-up section, with the power reasoning (`m`, `s`, `d`, `n`, lag source).
2. **The two parameters are required.** If the user passed `--days` and `--hours`, use them. Otherwise ask with `AskUserQuestion`, offering the plan's defaults first, labelled "(Recommended)", with the one-line power reasoning as the description. If the plan has no follow-up section, use 7 days and 48 hours and say so.
3. Resolve the PR (`--pr`, the plan, or the slug's branch) and its merge commit: `gh pr view <n> --repo <repo> --json mergeCommit,mergedAt,state`. If it is not merged, stop: schedule after the merge.
4. Create one local scheduled task with `mcp__scheduled-tasks__create_scheduled_task`:
   - `taskId`: `measure-impact-<slug>`, `title`: `Measure impact: <slug>`;
   - schedule: daily at 09:30 local (`cronExpression: "30 9 * * *"`). The task turns itself into a one-shot at the due time once the release is known (see the prompt);
   - `prompt`: the template below, filled in with absolute paths. It must stand alone. Fill in the Slack steps (4 to 6) only when `slackUserId` is set; without it, every message goes through the `osascript` line.
5. Tell the user: the task id, what it waits for, the follow-up timing, and three limits: tasks run only while the Claude app is open (a missed time runs on next launch); data-tool logins (for example gcloud) expire about daily, so a run may fail on auth and send the fix; and the task never merges, posts publicly or edits code.

### Task prompt template

```
Measure the impact of <slug> (<PR url>) after its prod release, then send the result.

Fixed values: repo <repo>, PR #<n>, merge commit <sha>, merged at <merged at>, release tag glob <glob or "none">, follow_up_days=<D>, follow_up_hours=<H>, plan <plan path>, result <result path>, log dir <log dir>, this task id measure-impact-<slug>, Slack DM user <slackUserId or "none">, created <date>.

Work from <work dir> and read its AGENTS.md or CLAUDE.md first. Read-only on prod: no merges, pushes, code edits, flag changes or public posts. Never send prod data to another model or provider. The only message you send is the one notification below.

1. Release check. `git fetch origin --tags`. With a tag glob: `git tag --contains <sha> --list '<glob>' --sort=creatordate | head -1`; no tag means not in prod yet. With none: the release is the merge, at <merged at>. If not in prod and more than 21 days have passed since <date>, notify once ("<slug> still not in prod after 21 days; task measure-impact-<slug> is still waiting") and stop; otherwise stop silently.
2. Due time. Release time = that tag's creator date (`git for-each-ref --format='%(creatordate:iso8601-strict)' refs/tags/<tag>`), or the merge time. Due = release + <D> days + <H> hours. If now is before due, call mcp__scheduled-tasks__update_scheduled_task with taskId measure-impact-<slug> and fireAt = due (ISO 8601 with offset), then stop. If that tool is unavailable, just stop; a later daily run will measure.
3. Measure. Use the sf:measure-change-impact skill's "run" steps for slug <slug>, plan <plan path>, release <tag or merge>, release time <release>.
4. Report. On success, notify in under 80 words: verdict (PASS, FAIL or INCONCLUSIVE), the primary metric before and after against its threshold, one guardrail line if any breached, and the result file path. Then disable this task (update_scheduled_task enabled=false).
5. On any failure in steps 1 to 4 (auth expired, query error, missing plan, agent failure), notify: "Impact measurement for <slug> failed: <one-line error>. Fix: <exact command, e.g. gcloud auth login && gcloud auth application-default login>. Then press Run now on task measure-impact-<slug>." Leave the task enabled.
6. How to notify. With a Slack DM user: find the Slack send tool with ToolSearch and send the text as a DM to <slackUserId>; if only a draft tool loads, save it as a draft to that user. Always also run: osascript -e 'display notification "<first sentence>" with title "Impact: <slug>"'.
```

## run

1. Read the plan. Note the release tag and time (from the caller, or resolve them as in step 1 of the template).
2. Spawn the `sf:impact-analyst` agent (subagent_type `sf:impact-analyst`) with a standalone brief: the repo root, the plan path, the absolute path of `method.md`, the result path, the log dir, the release time, "run the measurement plan: the primary query for the same number of days before and after the release, every guardrail, and name other releases in that window (`git log <previous release>..<release> --oneline` on the default branch)". It writes the result to the result path in this shape:
   - **Verdict**: PASS (primary threshold met, no guardrail breached), FAIL (threshold missed or a guardrail breached), or INCONCLUSIVE (not enough days, a figure not measured, or a confound that cannot be separated);
   - **Primary metric**: before vs after per day and in total, against the threshold;
   - **Guardrails**: each against its threshold;
   - **Confounds**: concurrent releases and anything else that moved;
   - **Compared with the plan**: did the back-test or projection hold, and by how much did it miss;
   - **Method notes**: anything new for `method.md` or the repo's data map.
3. Return the verdict and key numbers to the caller. Interactive runs: show them to the user and recommend the next step with one reason (keep it, roll it back, or "wait N more days" for INCONCLUSIVE).
