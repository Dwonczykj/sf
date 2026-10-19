# Impact method (shared)

The one copy of how impact work is done. `size-change-impact`, `measure-change-impact` and the `sf:impact-analyst`
agent all read this file; change the method here, nowhere else.

## Rules

- Prod is read-only. Every data read, log or SQL, goes through sf's `query-data` skill
  (`${CLAUDE_PLUGIN_ROOT}/skills/query-data/SKILL.md`); never call `bq` or `gcloud` yourself. When it returns
  `not measured: <reason>`, write the figure as `not measured (<reason>)` and carry on. Never fill the gap with an
  estimate, a figure from memory, or a number from another environment presented as prod.
- Never export rows. Never send prod data to another model or provider (Codex, Cursor, Gemini, any API), including query
  output pasted into a prompt. Aggregates in a report are fine.
- Label every number measured, back-tested, derived or projected, with its date window.
- Plain English, short sentences, no em dashes.

## Where the data is

Read the repo's impact data map if its `repo-instructions` file names one
(`${CLAUDE_PLUGIN_ROOT}/skills/repo-instructions/repos/<owner>__<repo>.md`, under `## Impact data map`; the path is
relative to the repo root). It says which project, datasets, tables and logs hold prod data, and their traps. Read it,
do not copy it into the report. With no map, say in the report that the data map is unknown, find tables with
`query-data` from the repo's own docs and code, and list what you had to guess.

## Sizing (before the change ships)

1. Read prior art: the run's state dir, earlier `impact.md` reports, the PR and ticket. Mark each claim measured,
   derived or assumed. A figure or script a PR cites but that is not on disk is unverified until reproduced.
2. Find the consumer before the metric: who reads the data or behaviour this change touches? `grep -rl` the table,
   event or log code across the repo and any data or dashboard repos the data map names. No consumer means
   "foundational", and say so.
3. Pick one primary metric with a pass threshold, then guardrails. Ground truth must be independent of the code under
   change: a vendor bill, a user action, revenue. Not the change's own output.
4. Check access first: ask `query-data` for a dry run, which reports the bytes it will scan or the access error.
5. Measure the baseline per day over at least one full week. Reproduce any baseline the PR already quotes.
6. Back-test the new logic on past data if a mirror holds its inputs. Apply the new rule in SQL to the same days and
   compare with ground truth. State its limits (timestamps, code-path differences).
7. Size each reviewer-raised edge case with a floor (logs, exact but only from the day the code shipped) and a ceiling
   (warehouse). Test the ceiling for time-travel bias: mirrors hold current state, so split the share by row age; if it
   moves with age, the mirror is misleading you.
8. Price with the cost model's own tables when the data map names them, never a typed rate.
9. Segment who is affected. Prefer medians and "share above X" over top percentiles.
10. Qualitative, briefly: Slack search (ticket ids mostly hit issue-tracker bot posts), feature-request boards with a
    small `limit` (skip for internal infrastructure), the support inbox, meeting search. Find each tool with
    `ToolSearch`. Say plainly when a source is unavailable.

## Designing the measurement into the change

For each metric in the plan, decide whether today's data can read it after deploy. If not, the change must emit it, and
that becomes an implementation requirement with its exact location:
- server milestones: a structured log with a code the data map says survives retention and reaches the warehouse;
- product behaviour: a product analytics event, or a feature-flag experiment when attribution needs a control group;
- cost: a usage event with attribution;
- dashboards: a metric declaration in the repo's telemetry setup.
Prefer what already exists. Each new signal needs a named reader in the plan, or it is not worth emitting.

## Power and the follow-up window

The follow-up waits long enough to see the minimum detectable effect (MDE), then the pipeline lag.
- Unit: one day of the primary metric (daily values absorb within-day noise). From the baseline, take the mean `m` and
  the day-to-day standard deviation `s`, weekdays and weekends separately when they differ.
- MDE: the smallest change worth acting on, as an absolute change `d` in the metric. Default 20% of the expected effect
  if the plan gives no business threshold.
- Days needed after deploy, comparing post-deploy days with an equal baseline window at 5% significance and 80% power:
  `n = ceil(2 * (1.96 + 0.84)^2 * s^2 / d^2) = ceil(15.7 * s^2 / d^2)`.
- `follow_up_days = max(n, 1)`, rounded up to whole weeks (7, 14, ...) when the metric has a weekly cycle and `n > 1`.
- `follow_up_hours` = the lag of the slowest source the check reads: logs about 1, incremental warehouse mirrors about 48
  to 72, vendor billing feeds 24 to 48. The data map may give exact lags. Round up.
- A deterministic change (for example a billing formula with a back-test) usually needs `n = 1`. Behavioural changes
  usually need weeks. If `n` exceeds 28, say the change cannot be read pre/post and recommend an experiment.
- Pre/post comparisons are confounded by anything else that shipped. Name the concurrent releases in the result.

## Logging the run

Keep `<state dir>/impact/LOG.md`: setup facts, dead ends the moment they happen, what worked, "do this next time".
Save each query as `queries/NN_name.sql` (or `.filter` for a log query) with its `.out` beside it. The log dir holds
prod output, so it stays out of commits and out of any public repo. If a lesson generalises, note it in the result's
method notes so it can be added here, or to the repo's data map.
