---
name: query-data
description: Run a read-only log query or SQL query for sf (impact sizing, measurement, evals) through the data CLI chosen at /sf:install (gcloud Logging and BigQuery today). With no data tool, or one that is logged out, it returns "not measured" and the reason, and the caller records that instead of a number. Called by start-feature's impact steps and by skills that need prod figures; not user-invoked directly.
---

# query-data

Callers ask for a result ("run this log filter", "run this SQL") and never call `gcloud` or `bq` themselves.

## 1. Pick the tool

Read `data` in `~/.claude/sf-tools.json` (no file means `gcloud`, today's setup). Then check it now:

- `gcloud`: `command -v gcloud bq` finds both, and `gcloud auth list --filter=status:ACTIVE --format='value(account)'` prints an account.
- `null`, or a failed check: return `not measured: <reason>` (for example "no data tool chosen in /sf:install", "gcloud logged out, run gcloud auth login") and stop.

## 2. Run the query

Read-only, always: `gcloud logging read` and `SELECT` only, never DML, DDL or anything that writes. The repo's instructions decide the project, any service account to impersonate, and which datasets are prod; follow them (Fyxer's web-app `AGENTS.md` has its prod log command and footguns).

- **Logs:**

  ```bash
  gcloud logging read '<filter>' --project=<project> --freshness=<window> --limit=<n> --format=json [--impersonate-service-account=<sa>]
  ```

- **BigQuery:** dry-run first and say the bytes it will scan, then run.

  ```bash
  bq query --use_legacy_sql=false --dry_run '<sql>'
  bq query --use_legacy_sql=false --format=json --max_rows=<n> '<sql>'
  ```

Return the rows and the exact command, so the caller can cite where each figure came from. An auth or permission error is a "not measured" with the error's own message, never a reason to retry with wider access.

## 3. What the caller does with "not measured"

It writes the figure as `not measured (<reason>)` wherever the number would go: an impact report, a PR body's evidence section, a gap table. It never fills the gap with an estimate, a figure from memory, or a number from another environment presented as prod. A report with every figure not measured is still a valid report; say in one line what to run, and where, to measure it.

Prod rows never go to a model provider under anything but that provider's prod key; follow the repo's rule on this before passing results to any model.

## Adding a tool

One check in section 1 and one command block in section 2, plus its option in `/sf:install`'s data question.
